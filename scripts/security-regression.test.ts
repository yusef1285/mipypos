import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';

import type { AuthorizationProof } from '../lib/finance-models';
import { createHarness, prepareHarness } from './pos-test-harness';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];
function test(name: string, action: () => void | Promise<void>) {
  return nodeTest(name, async () => {
    try {
      await action();
      passed += 1;
    } catch (error) {
      failed += 1;
      failures.push({ name, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });
}
after(() => {
  mkdirSync('.expo', { recursive: true });
  writeFileSync(
    join('.expo', 'security-regression-results.json'),
    JSON.stringify(
      { ranAt: new Date().toISOString(), tests: passed + failed, passed, failed, failures },
      null,
      2,
    ),
  );
});
before(prepareHarness);

async function fixture() {
  const h = createHarness();
  const db = h.load('@/lib/database');
  const password = h.load('@/lib/password');
  await db.initializeDatabase();
  const hashOf = (username: string) =>
    String(
      h.database.exec('SELECT password_hash FROM users WHERE username=?', [username])[0]
        ?.values[0]?.[0],
    );
  return { ...h, db, password, hashOf };
}
const legacy = (value: string) => createHash('sha256').update(`MipyPOS:${value}`).digest('hex');

void test('contraseñas nuevas usan PBKDF2 con sal única por cuenta', async () => {
  const f = await fixture();
  await f.db.saveUser({ username: 'ana', password: 'clave-segura', role: 'seller' });
  await f.db.saveUser({ username: 'luis', password: 'clave-segura', role: 'seller' });
  const [a, b] = [f.hashOf('ana'), f.hashOf('luis')];
  assert.match(a, /^pbkdf2-sha256\$310000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.ok(await f.db.authenticate('ana', 'clave-segura'));
  assert.equal(await f.db.authenticate('ana', 'clave-segurA'), null);
});

void test('hash heredado SHA-256 se acepta una vez y se actualiza al iniciar sesión', async () => {
  const f = await fixture();
  f.database.run("INSERT INTO users(username,password_hash,role) VALUES('vieja',?, 'seller')", [
    legacy('antigua1'),
  ]);
  assert.equal(await f.db.authenticate('vieja', 'otra'), null);
  assert.equal(f.hashOf('vieja'), legacy('antigua1'));
  const user = await f.db.authenticate('vieja', 'antigua1');
  assert.ok(user);
  assert.match(f.hashOf('vieja'), /^pbkdf2-sha256\$/);
  assert.equal(user.password_hash, f.hashOf('vieja'));
  assert.ok(await f.db.authenticate('vieja', 'antigua1'));
});

void test('la contraseña inicial debe cambiarse y deja de funcionar', async () => {
  const f = await fixture();
  assert.equal(await f.db.hasDefaultAdministratorPassword(), true);
  await assert.rejects(f.db.changeOwnPassword('admin', 'admin123', 'corta'), /8 caracteres/);
  await assert.rejects(f.db.changeOwnPassword('admin', 'admin123', 'ADMIN123'), /distinta/);
  await assert.rejects(
    f.db.changeOwnPassword('admin', 'incorrecta', 'nueva-clave-1'),
    /incorrectos/,
  );
  const changed = await f.db.changeOwnPassword('admin', 'admin123', 'nueva-clave-1');
  assert.equal(changed.password_hash, f.hashOf('admin'));
  assert.equal(await f.db.hasDefaultAdministratorPassword(), false);
  assert.equal(await f.db.authenticate('admin', 'admin123'), null);
  assert.ok(await f.db.authenticate('admin', 'nueva-clave-1'));
  const audit = f.database.exec(
    "SELECT COUNT(*) FROM audit_log WHERE action='user.password_changed'",
  )[0]?.values[0]?.[0];
  assert.equal(audit, 1);
});

void test('usuarios nuevos o editados no aceptan contraseñas débiles', async () => {
  const f = await fixture();
  await assert.rejects(
    f.db.saveUser({ username: 'x', password: 'abc123', role: 'seller' }),
    /8 caracteres/,
  );
  await assert.rejects(
    f.db.saveUser({ username: 'x', password: 'admin123', role: 'seller' }),
    /distinta/,
  );
});

void test('huellas de comandos no contienen contraseñas ni hashes', async () => {
  const f = await fixture();
  const input = { id: 1, authorization: { username: 'admin', password: 'secreta-1' } };
  assert.deepEqual(f.password.withoutSecrets(input), {
    id: 1,
    authorization: { username: 'admin', password: '[secreto]' },
  });
  const operation = f.load('@/lib/network/pending-operation');
  const one = await operation.operationFingerprint('x', input);
  const two = await operation.operationFingerprint('x', {
    ...input,
    authorization: { username: 'admin', password: 'otra-clave' },
  });
  assert.equal(one, two);
});

void test('una prueba heredada con hash no autoriza cuentas ya protegidas con PBKDF2', async () => {
  const f = await fixture();
  const id = await f.db.saveProduct(
    {
      name: 'Arroz',
      category: 'Alimentos',
      subcategory: '',
      stock: 5,
      price_cash: 10,
      price_transfer: 10,
      unit: 'kg',
      quantity_decimals: 3,
      image_path: null,
    },
    'admin',
  );
  const area = (await f.db.listAreas())[0];
  const consume = (authorization: AuthorizationProof) =>
    f.db.registerConsumption(
      {
        commandId: crypto.randomUUID(),
        productId: id,
        areaId: area.id,
        quantity: 1,
        reason: 'Uso interno',
        notes: 'Prueba',
        authorization,
      },
      'admin',
    );
  await assert.rejects(
    consume({ username: 'admin', passwordHash: legacy('admin123') }),
    /autorización no es válida/,
  );
  assert.ok(await consume({ username: 'admin', password: 'admin123' }));
});
