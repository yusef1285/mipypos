import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';

import { LICENSE_PUBLIC_KEYS } from '../lib/license-keys';
import {
  base64UrlDecode,
  base64UrlEncode,
  decodeLicense,
  deviceCodeFrom,
  evaluateLicense,
} from '../lib/license-token';
import { createHarness, prepareHarness } from './pos-test-harness';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];
function test(name: string, action: () => void | Promise<void>) {
  void nodeTest(name, async () => {
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
before(prepareHarness);
after(() => {
  mkdirSync('.expo', { recursive: true });
  writeFileSync(
    join('.expo', 'license-regression-results.json'),
    JSON.stringify(
      { ranAt: new Date().toISOString(), tests: passed + failed, passed, failed, failures },
      null,
      2,
    ),
  );
});

// A throwaway signing key registered only for this process.
const dir = mkdtempSync(join(tmpdir(), 'mipy-license-'));
const keyPath = join(dir, 'test.pem');
const pair = generateKeyPairSync('ed25519');
writeFileSync(keyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
const rawPublic = pair.publicKey.export({ format: 'jwk' }).x!;
const kid = createHash('sha256')
  .update(Buffer.from(rawPublic, 'base64url'))
  .digest('hex')
  .slice(0, 8);
(LICENSE_PUBLIC_KEYS as Record<string, string>)[kid] = rawPublic;

const DAY = 86_400_000;
const DEVICE = deviceCodeFrom('android-test-id');
function issue(...extra: string[]) {
  const out = execFileSync(
    process.execPath,
    ['tools/licencias/generar-licencia.mjs', '--key', keyPath, ...extra],
    { encoding: 'utf8' },
  );
  return out.trim().split('\n').at(-1)!;
}
const tamper = (token: string, change: (payload: Record<string, unknown>) => void) => {
  const [prefix, body, signature] = token.split('.');
  const parsed: unknown = JSON.parse(String.fromCharCode(...base64UrlDecode(body)));
  assert.ok(parsed && typeof parsed === 'object');
  const payload = { ...parsed } as Record<string, unknown>;
  change(payload);
  return `${prefix}.${base64UrlEncode(Uint8Array.from(Buffer.from(JSON.stringify(payload))))}.${signature}`;
};

test('el generador crea planes de 7, 30 y 365 días verificables sin conexión', () => {
  for (const [plan, days] of [
    ['trial', 7],
    ['monthly', 30],
    ['annual', 365],
  ] as const) {
    const payload = decodeLicense(issue('--plan', plan));
    assert.equal(payload.plan, plan);
    assert.equal(payload.kid, kid);
    assert.equal((Date.parse(payload.exp) - Date.parse(payload.iat)) / DAY, days);
    const status = evaluateLicense(issue('--plan', plan), DEVICE, Date.now());
    assert.equal(status.state, 'active');
    if (status.state === 'active') assert.equal(status.daysLeft, days);
  }
});

test('plan personalizado exige días y respeta nombre de cliente con acentos', () => {
  const payload = decodeLicense(
    issue('--plan', 'custom', '--days', '90', '--customer', 'Cafetería Ñico'),
  );
  assert.equal(payload.customer, 'Cafetería Ñico');
  assert.throws(() => issue('--plan', 'custom'), /days/);
});

test('licencia atada al dispositivo solo funciona en ese código', () => {
  const token = issue('--plan', 'monthly', '--device', DEVICE);
  assert.equal(evaluateLicense(token, DEVICE, Date.now()).state, 'active');
  const other = evaluateLicense(token, deviceCodeFrom('otro'), Date.now());
  assert.equal(other.state, 'invalid');
  assert.throws(() => issue('--device', 'ABC'), /XXXX/);
});

test('alterar vencimiento, plan, dispositivo o firma invalida la licencia', () => {
  const token = issue('--plan', 'trial', '--device', DEVICE);
  const variants = [
    tamper(token, (p) => (p.exp = '2099-01-01T00:00:00.000Z')),
    tamper(token, (p) => (p.plan = 'annual')),
    tamper(token, (p) => delete p.device),
    `${token.slice(0, -4)}AAAA`,
    token.replace('MIPY1', 'MIPY2'),
    tamper(token, (p) => (p.kid = '00000000')),
  ];
  for (const variant of variants)
    assert.equal(evaluateLicense(variant, DEVICE, Date.now()).state, 'invalid');
});

test('vencida y reloj atrasado no reactivan Pro; saltos y espacios se toleran', () => {
  const token = issue('--plan', 'trial');
  const now = Date.now();
  assert.equal(evaluateLicense(token, DEVICE, now + 8 * DAY).state, 'expired');
  // Clock moved back after having seen a later date.
  assert.equal(evaluateLicense(token, DEVICE, now - 3 * DAY, now).state, 'clock');
  // Device clock earlier than the issue date.
  assert.equal(evaluateLicense(token, DEVICE, now - 3 * DAY).state, 'clock');
  // Having seen a date after expiry keeps it expired even if the clock goes back a bit.
  assert.equal(evaluateLicense(token, DEVICE, now + 6.5 * DAY, now + 7.2 * DAY).state, 'expired');
  const wrapped = token.replace(/(.{40})/g, '$1\n ');
  assert.equal(evaluateLicense(wrapped, DEVICE, now).state, 'active');
  const soon = evaluateLicense(token, DEVICE, now + 2 * DAY);
  assert.ok(soon.state === 'active' && soon.expiringSoon);
  assert.equal(evaluateLicense('MP-123-456-789', DEVICE, now).state, 'invalid');
  assert.equal(evaluateLicense('', DEVICE, now).state, 'none');
});

test('la cuota demo vuelve cuando vence la fecha guardada aunque el modo diga pro', async () => {
  const harness = createHarness();
  const db = harness.load('@/lib/database');
  await db.initializeDatabase();
  const base = {
    category: 'A',
    subcategory: '',
    unit: 'u',
    quantity_decimals: 0,
    stock: 0,
    price_cash: 1,
    price_transfer: 1,
    image_path: null,
  };
  for (let i = 0; i < 5; i += 1) await db.saveProduct({ ...base, name: `P${i}` }, 'admin');
  await db.setSetting('license_mode', 'pro');
  await db.setSetting('license_expires_at', new Date(Date.now() + DAY).toISOString());
  assert.equal(await db.getLicenseMode(), 'pro');
  await db.saveProduct({ ...base, name: 'P6' }, 'admin');
  await db.setSetting('license_expires_at', new Date(Date.now() - 1000).toISOString());
  assert.equal(await db.getLicenseMode(), 'demo');
  await assert.rejects(db.saveProduct({ ...base, name: 'P7' }, 'admin'), /5 productos/);
});

test('el repositorio no contiene claves privadas', () => {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
  assert.ok(!tracked.some((file) => /\.pem$|licencias-emitidas/.test(file)));
  let keys = '';
  try {
    keys = execFileSync('git', ['grep', '-l', ['BEGIN', 'PRIVATE', 'KEY'].join(' ')], {
      encoding: 'utf8',
    });
  } catch {
    keys = ''; // git grep exits 1 when nothing matches
  }
  assert.ok(!keys);
});
