import assert from 'node:assert/strict';
import { before, after, test as nodeTest } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const directory = join(process.cwd(), '.expo');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'lan-security-results.json'),
    JSON.stringify(
      { ranAt: new Date().toISOString(), tests: passed + failed, passed, failed, failures },
      null,
      2,
    ),
  );
});
import { z } from 'zod';
import { createHarness, prepareHarness } from './pos-test-harness';

const failureSchema = z.object({
  ok: z.literal(false),
  code: z.enum(['AUTH_EXPIRED', 'REJECTED']),
  error: z.string(),
});
const withdrawalExportSchema = z.array(
  z.object({
    amount: z.number(),
    reason: z.string(),
    authorized_by: z.string(),
  }),
);
const approvalExportSchema = z.array(
  z.object({
    id: z.number(),
    reason: z.string(),
  }),
);
import type { MutationCommand } from '../lib/database';
import type { PosArgs } from '../lib/network/operations';
before(prepareHarness);
const url = 'https://192.168.43.1:8787';
const pin = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const base = {
  name: 'Café molido de tueste oscuro',
  category: 'Alimentos',
  subcategory: '',
  unit: 'kg',
  quantity_decimals: 3,
  stock: 10,
  price_cash: 100,
  price_transfer: 100,
  image_path: null,
};
const command = (action: string, suffix = ''): MutationCommand => ({
  commandId: `${action}-${suffix}`,
  clientId: 'terminal-a',
  username: 'admin',
  action,
  fingerprint: 'payload-1',
});
async function fixture() {
  const h = createHarness();
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  return { ...h, db };
}
void test('todas las mutaciones generales recuperan el mismo resultado sin repetir efectos', async () => {
  const f = await fixture();
  const id = await f.db.saveProduct(base, 'admin', command('saveProduct'));
  assert.equal(await f.db.saveProduct(base, 'admin', command('saveProduct')), id);
  assert.equal((await f.db.getDemoUsage()).products, 1);
  assert.equal(await f.db.addArea('Mostrador', command('addArea')), undefined);
  assert.equal(await f.db.addArea('Mostrador', command('addArea')), undefined);
  assert.equal((await f.db.listAreas()).filter((a) => a.name === 'Mostrador').length, 1);
  const movement = {
    productId: id,
    type: 'entrada' as const,
    quantity: 2,
    toArea: 'Mostrador',
    username: 'admin',
  };
  const beforeMovement = (await f.db.listMovements()).length;
  await f.db.registerMovement(movement, command('registerMovement'));
  assert.equal((await f.db.listMovements()).length, beforeMovement + 1);
  await f.db.registerMovement(movement, command('registerMovement'));
  assert.equal((await f.db.listMovements()).length, beforeMovement + 1);
  const user = await f.db.saveUser(
    { username: 'vendedor', password: 'pass1234', role: 'seller' },
    command('saveUser'),
  );
  assert.equal(
    await f.db.saveUser(
      { username: 'vendedor', password: 'pass1234', role: 'seller' },
      command('saveUser'),
    ),
    user,
  );
  await f.db.deleteUser(user, 1, command('deleteUser'));
  await f.db.deleteUser(user, 1, command('deleteUser'));
  assert.equal((await f.db.listUsers()).length, 1);
  const rows = [{ name: 'Azúcar', stock: 2, price_cash: 20 }];
  assert.equal(await f.db.importProducts(rows, 'admin', command('importProducts')), 1);
  assert.equal(await f.db.importProducts(rows, 'admin', command('importProducts')), 1);
  const sid = await f.db.openCashSession(100, 'admin', command('openCashSession'));
  assert.equal(await f.db.openCashSession(100, 'admin', command('openCashSession')), sid);
  const closure = {
    denominations: [{ denomination: 100, quantity: 1 }],
    withdrawalCount: 0,
    transferCount: 0,
    products: [],
    adminUsername: 'admin',
    adminPassword: 'admin123',
  };
  await f.db.closeCashSession(sid, closure, command('closeCashSession'));
  await f.db.closeCashSession(sid, closure, command('closeCashSession'));
  assert.equal((await f.db.listCashClosures()).length, 1);
  const unused = await f.db.saveProduct(
    { ...base, name: 'Producto sin movimientos', stock: 0 },
    'admin',
  );
  await f.db.deleteProduct(unused, command('deleteProduct'));
  await f.db.deleteProduct(unused, command('deleteProduct'));
  assert.equal(await f.db.getProduct(unused), null);
});
void test('cache numérico valida id y sobre value sin repetir escrituras', async () => {
  const f = await fixture();
  const c = command('saveProduct');
  const id = await f.db.saveProduct(base, 'admin', c);
  const initial = f.database.export();
  assert.equal(await f.db.saveProduct(base, 'admin', c), id);
  assert.deepEqual(f.database.export(), initial);
  for (const response of [
    '{}',
    'null',
    '[]',
    '{"value":"1"}',
    '{"value":null}',
    '{"value":0}',
    '{"value":-1}',
    '{"value":1.5}',
    '{"value":1e999}',
    '{broken',
  ]) {
    f.database.run('UPDATE network_commands SET response=? WHERE command_id=?', [
      response,
      c.commandId,
    ]);
    const bytesBefore = f.database.export();
    await assert.rejects(f.db.saveProduct(base, 'admin', c));
    if (['{broken', '{}', 'null', '[]'].includes(response))
      await assert.rejects(f.db.findMutationReceipt(c));
    assert.deepEqual(f.database.export(), bytesBefore);
  }
});
void test('cache de conteo admite cero y rechaza forma distinta', async () => {
  const f = await fixture();
  const c = command('importProducts');
  assert.equal(await f.db.importProducts([], 'admin', c), 0);
  assert.equal(await f.db.importProducts([], 'admin', c), 0);
  for (const value of [null, '0', -1, 0.5, {}]) {
    f.database.run('UPDATE network_commands SET response=? WHERE command_id=?', [
      JSON.stringify({ value }),
      c.commandId,
    ]);
    const bytesBefore = f.database.export();
    await assert.rejects(f.db.importProducts([], 'admin', c));
    assert.deepEqual(f.database.export(), bytesBefore);
  }
});
void test('cache void normaliza null a undefined y falla cerrado ante corrupción', async () => {
  const f = await fixture();
  const c = command('addArea');
  assert.equal(await f.db.addArea('Cache void', c), undefined);
  const initial = f.database.export();
  assert.equal(await f.db.addArea('Cache void', c), undefined);
  assert.deepEqual(f.database.export(), initial);
  assert.deepEqual(await f.db.findMutationReceipt(c), { found: true, value: null });
  for (const response of [
    '{}',
    '{"value":0}',
    '{"value":{}}',
    '{"value":"undefined"}',
    '{broken',
  ]) {
    f.database.run('UPDATE network_commands SET response=? WHERE command_id=?', [
      response,
      c.commandId,
    ]);
    const bytesBefore = f.database.export();
    await assert.rejects(f.db.addArea('Cache void', c));
    assert.deepEqual(f.database.export(), bytesBefore);
  }
});
void test('cache objeto de cierre valida campos y nunca vuelve a cerrar', async () => {
  const f = await fixture();
  const sid = await f.db.openCashSession(0, 'admin');
  const c = command('closeCashSession');
  const input = {
    denominations: [],
    withdrawalCount: 0,
    transferCount: 0,
    products: [],
    adminUsername: 'admin',
    adminPassword: 'admin123',
  };
  const result = await f.db.closeCashSession(sid, input, c);
  const initial = f.database.export();
  assert.deepEqual(await f.db.closeCashSession(sid, input, c), result);
  assert.deepEqual(f.database.export(), initial);
  for (const value of [null, {}, { ...result, cashCount: '0' }, { ...result, products: [{}] }]) {
    f.database.run('UPDATE network_commands SET response=? WHERE command_id=?', [
      JSON.stringify({ value }),
      c.commandId,
    ]);
    const bytesBefore = f.database.export();
    await assert.rejects(f.db.closeCashSession(sid, input, c));
    assert.deepEqual(f.database.export(), bytesBefore);
  }
});
void test('cache objeto de aprobación valida id y autorización sin otra auditoría', async () => {
  const f = await fixture();
  const sid = await f.db.openCashSession(100, 'admin');
  const c = command('authorizeCashDifference');
  const input = {
    kind: 'money' as const,
    counted: 90,
    transferCount: 0,
    reason: 'Conteo',
    adminUsername: 'admin',
    adminPassword: 'admin123',
  };
  const result = await f.db.authorizeCashDifference(sid, input, c);
  const initial = f.database.export();
  assert.deepEqual(await f.db.authorizeCashDifference(sid, input, c), result);
  assert.deepEqual(f.database.export(), initial);
  for (const value of [null, {}, { ...result, id: -1 }, { ...result, authorized_by: null }]) {
    f.database.run('UPDATE network_commands SET response=? WHERE command_id=?', [
      JSON.stringify({ value }),
      c.commandId,
    ]);
    const bytesBefore = f.database.export();
    await assert.rejects(f.db.authorizeCashDifference(sid, input, c));
    assert.deepEqual(f.database.export(), bytesBefore);
  }
});
void test('mismo UUID no admite otro usuario, terminal o contenido; recibo no expone ajenos', async () => {
  const f = await fixture();
  const c = command('addArea');
  assert.equal(await f.db.addArea('Zona independiente', c), undefined);
  assert.deepEqual(await f.db.findMutationReceipt(c), { found: true, value: null });
  for (const changed of [
    { ...c, username: 'otro' },
    { ...c, clientId: 'otro' },
    { ...c, fingerprint: 'otro' },
    { ...c, action: 'saveUser' },
  ]) {
    await assert.rejects(f.db.addArea('Zona independiente', changed), /identificador/);
    await assert.rejects(f.db.findMutationReceipt(changed), /identificador/);
  }
  assert.deepEqual(await f.db.findMutationReceipt({ ...c, commandId: 'nuevo' }), { found: false });
});
void test('concurrencia de un mismo comando produce una mutación y una respuesta', async () => {
  const f = await fixture();
  const c = command('saveProduct');
  const [a, b] = await Promise.all([
    f.db.saveProduct(base, 'admin', c),
    f.db.saveProduct(base, 'admin', c),
  ]);
  assert.equal(a, b);
  assert.equal((await f.db.listProducts()).length, 1);
});
void test('fallo al persistir recibo revierte mutación y cuota; retry ejecuta una sola vez', async () => {
  const f = await fixture();
  const c = command('saveProduct');
  f.failWritesContaining('INSERT INTO network_commands');
  await assert.rejects(f.db.saveProduct(base, 'admin', c), /Injected/);
  assert.equal((await f.db.listProducts()).length, 0);
  assert.equal((await f.db.getDemoUsage()).products, 0);
  f.failWritesContaining('');
  await f.db.saveProduct(base, 'admin', c);
  assert.equal((await f.db.listProducts()).length, 1);
});
void test('revision cambia con catálogo/inventario y no crece por replay', async () => {
  const f = await fixture();
  const revision = () =>
    Number(f.database.exec('SELECT COALESCE(MAX(id),0) FROM network_events')[0].values[0][0]);
  const initial = revision();
  const c = command('saveProduct');
  await f.db.saveProduct(base, 'admin', c);
  const next = revision();
  assert.ok(next > initial);
  await f.db.saveProduct(base, 'admin', c);
  assert.equal(revision(), next);
  await f.db.addArea('Mostrador');
  assert.ok(revision() > next);
});
void test('limita intentos de login sin alterar los hashes existentes', async () => {
  const f = await fixture();
  const hash = await f.db.hashPassword('admin123');
  for (let i = 0; i < 5; i++)
    assert.equal(await f.db.authenticateForLogin('admin', 'incorrecta'), null);
  await assert.rejects(f.db.authenticateForLogin('admin', 'admin123'), /Espera un minuto/);
  f.database.run('UPDATE login_attempts SET window_start=window_start-61000');
  assert.equal((await f.db.authenticateForLogin('admin', 'admin123'))?.password_hash, hash);
});
void test('neutraliza fórmulas CSV sin cambiar importes numéricos y preserva comillas', () => {
  const csv = createHarness().load('@/lib/csv');
  for (const text of ['=1+1', '+SUM(A1)', '@SUM(A1)', '-1+2', '  =1+1', '\t=1+1', '\rtexto'])
    assert.ok(csv.escapeCsvCell(text).startsWith('"\''));
  assert.equal(csv.escapeCsvCell(-25), '"-25"');
  assert.equal(csv.escapeCsvCell('Café "molido"'), '"Café ""molido"""');
});
void test('venta local registra nombre actual y bloquea unidad obsoleta', async () => {
  const f = await fixture();
  const id = await f.db.saveProduct(base, 'admin');
  const product = await f.db.getProduct(id);
  assert.ok(product);
  const sid = await f.db.openCashSession(0, 'admin');
  const area = (await f.db.listAreas())[0];
  await f.db.saveProduct({ ...product, name: 'Café renombrado', unit: 'lb' }, 'admin');
  const cart = [{ product, areaId: area.id, quantity: 1, price: 100 }];
  await assert.rejects(
    f.db.registerSale(
      cart,
      'transfer',
      [{ type: 'transfer', amount: 100 }],
      'admin',
      undefined,
      sid,
    ),
    /unidad|actualiza|cambió/i,
  );
  assert.equal((await f.db.getProduct(id))?.stock, product.stock);
  assert.equal((await f.db.getDemoUsage()).sales, 0);
  // Restore the unit before any sale: changing a sold product's unit is intentionally blocked.
  await f.db.saveProduct({ ...product, name: 'Café renombrado' }, 'admin');
  const sale = await f.db.registerSale(
    cart,
    'transfer',
    [{ type: 'transfer', amount: 100 }],
    'admin',
    undefined,
    sid,
  );
  const detail = await f.db.getSale(sale);
  assert.ok(detail);
  assert.equal(detail.lines[0].name, 'Café renombrado');
});

type Handler = (request: { data: unknown }) => Promise<unknown>;
async function lanFixture() {
  const routes = new Map<string, Handler>();
  let loseResponse = false;
  let offline = false;
  class Server {
    get(path: string, handler: Handler) {
      routes.set(path, handler);
    }
    post(path: string, handler: Handler) {
      routes.set(path, handler);
    }
    async listen() {}
    stop() {}
  }
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const h = createHarness({
    'expo-network': { getIpAddressAsync: async () => '192.168.43.1' },
    'react-native': { Platform: { OS: 'android' }, NativeModules: { MipyTls: {} } },
    '@/lib/network/hotspot': { getLanHostIp: async () => '192.168.43.1' },
    '@/lib/network/tls': {
      SecureLanServer: Server,
      pinnedRequest: async (
        _url: string,
        path: string,
        body: Record<string, unknown> = {},
        expectedPin?: string,
      ) => {
        if (expectedPin !== undefined) assert.equal(expectedPin, pin, 'identidad TLS original');
        if (offline) throw new Error('offline');
        calls.push({ path, body });
        const handler = routes.get(path);
        assert.ok(handler, `missing ${path}`);
        const result = await handler({ data: body });
        if (loseResponse && path === '/v1/operation') {
          loseResponse = false;
          throw new Error('respuesta perdida');
        }
        return JSON.stringify(result);
      },
    },
  });
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  await db.saveUser({ id: 1, username: 'admin', password: 'admin-securo-123', role: 'admin' });
  const config = h.load('@/lib/network/config');
  await config.saveNetworkConfig({
    mode: 'client',
    hostUrl: url,
    hostPin: pin,
    clientId: 'terminal-a',
  });
  const host = h.load('@/lib/network/host');
  await host.startLanHost();
  const client = h.load('@/lib/network/client');
  await client.loginToHost(url, 'admin', 'admin-securo-123');
  return {
    ...h,
    db,
    host,
    client,
    config,
    calls,
    routes,
    loseNextResponse: () => {
      loseResponse = true;
    },
    setOffline: (value: boolean) => {
      offline = value;
    },
  };
}
void test('ONAT LAN reintenta un perfil confirmado sin duplicarlo', async () => {
  const f = await lanFixture();
  const fiscalProfile = {
    taxpayerId: 'default',
    name: 'Contribuyente de prueba',
    nit: 'TEST-LAN',
    category: 'TCP',
    province: 'La Habana',
    municipality: 'Plaza',
    address: 'Prueba',
    activity: 'Comercio',
    secondaryActivities: '',
    regime: 'Prueba',
    startDate: '2020-01-01',
    fiscalPeriod: 'Anual',
    registration: '',
    accountant: 'Prueba',
    source: 'POS',
    reservePercent: 0,
    reserveBase: 'Ingresos',
    effectiveFrom: '2020-01-01',
  } as const;
  const args: PosArgs<'executeFiscalCommand'> = [
    { action: 'profile', commandId: 'onat-lan-profile', value: fiscalProfile },
    'admin',
  ];
  f.loseNextResponse();
  await assert.rejects(
    f.client.requestHostOperation(url, 'executeFiscalCommand', args, 'admin', 'terminal-a'),
    /perdida/,
  );
  await f.client.requestHostOperation(url, 'executeFiscalCommand', args, 'admin', 'terminal-a');
  const data = await f.client.requestHostOperation(
    url,
    'getFiscalData',
    [{ taxpayerId: 'default', start: '2026-01-01', end: '2026-01-31' }, 'admin'],
    'admin',
    'terminal-a',
  );
  assert.equal(data.profiles.length, 1);
  f.host.stopLanHost();
});
void test('ONAT LAN rechaza consulta sin autorización expresa', async () => {
  const f = await lanFixture();
  await f.db.saveUser({ username: 'vendedor-fiscal', password: 'abc123', role: 'seller' });
  await f.client.loginToHost(url, 'vendedor-fiscal', 'abc123');
  await assert.rejects(
    f.client.requestHostOperation(
      url,
      'getFiscalData',
      [{ taxpayerId: 'default', start: '2026-01-01', end: '2026-01-31' }, 'admin'],
      'vendedor-fiscal',
      'terminal-a',
    ),
    /permite|permiso|autorización/,
  );
  f.host.stopLanHost();
});
void test('ONAT LAN contador autorizado accede; revocación impide nueva lectura', async () => {
  const f = await lanFixture();
  const id = await f.db.saveUser({
    username: 'contador-fiscal',
    password: 'abc123',
    role: 'auditor',
  });
  await f.db.setFiscalPermission(id, true, 'admin');
  await f.client.loginToHost(url, 'contador-fiscal', 'abc123');
  const args: PosArgs<'getFiscalData'> = [
    { taxpayerId: 'default', start: '2026-01-01', end: '2026-01-31' },
    'admin',
  ];
  assert.ok(
    await f.client.requestHostOperation(
      url,
      'getFiscalData',
      args,
      'contador-fiscal',
      'terminal-a',
    ),
  );
  await f.db.setFiscalPermission(id, false, 'admin');
  await assert.rejects(
    f.client.requestHostOperation(url, 'getFiscalData', args, 'contador-fiscal', 'terminal-a'),
    /permite|permiso|autorización/,
  );
  f.host.stopLanHost();
});
void test('host/client reintentan después de commit y respuesta perdida sin duplicar', async () => {
  const f = await lanFixture();
  f.loseNextResponse();
  await assert.rejects(
    f.client.requestHostOperation(url, 'addArea', ['Zona nueva'], 'admin', 'terminal-a'),
    /perdida/,
  );
  const pending = f.load('@/lib/network/pending-operation');
  const saved = await pending.getPendingOperation();
  assert.ok(saved);
  const result = await f.client.requestHostOperation(
    url,
    'addArea',
    ['Zona nueva'],
    'admin',
    'terminal-a',
  );
  assert.equal((await f.db.listAreas()).filter((a) => a.name === 'Zona nueva').length, 1);
  assert.equal(result, null);
  assert.equal(await pending.getPendingOperation(), null);
  assert.equal(f.calls.filter((c) => c.path === '/v1/operation').length, 1);
});
void test('login recupera operación pendiente del mismo usuario por recibo durable', async () => {
  const f = await lanFixture();
  f.loseNextResponse();
  await assert.rejects(
    f.client.requestHostOperation(
      url,
      'addArea',
      ['Recuperar tras reinicio'],
      'admin',
      'terminal-a',
    ),
  );
  const pending = f.load('@/lib/network/pending-operation');
  const saved = await pending.getPendingOperation();
  assert.ok(saved);
  await f.client.loginToHost(url, 'admin', 'admin-securo-123');
  assert.equal(await pending.getPendingOperation(), null);
  assert.equal(
    (await f.db.listAreas()).filter((a) => a.name === 'Recuperar tras reinicio').length,
    1,
  );
});
void test('receipt confirma cambio de rol propio sin repetir una operación ya confirmada', async () => {
  const f = await lanFixture();
  const pending = f.load('@/lib/network/pending-operation');
  await assert.rejects(
    f.client.requestHostOperation(
      url,
      'saveUser',
      [{ id: 1, username: 'admin', role: 'seller' }],
      'admin',
      'terminal-a',
    ),
    (error: unknown) =>
      error instanceof f.client.HostRejection &&
      error.code === 'NOT_COMMITTED' &&
      /al menos un administrador/.test(error.message),
  );
  assert.equal(await pending.getPendingOperation(), null);
  assert.equal((await f.db.listUsers()).find((u) => u.id === 1)?.role, 'admin');
  // The last admin cannot demote themself; add another before testing a successful change.
  await f.db.saveUser({ username: 'segundo-admin', password: 'secure123', role: 'admin' });
  f.loseNextResponse();
  await assert.rejects(
    f.client.requestHostOperation(
      url,
      'saveUser',
      [{ id: 1, username: 'admin', role: 'seller' }],
      'admin',
      'terminal-a',
    ),
    /perdida/,
  );
  assert.ok(await pending.getPendingOperation());
  assert.equal((await f.db.listUsers()).find((u) => u.id === 1)?.role, 'seller');
  const operationCalls = f.calls.filter((c) => c.path === '/v1/operation').length;
  await f.client.loginToHost(url, 'admin', 'admin-securo-123');
  assert.equal(await pending.getPendingOperation(), null);
  assert.equal(f.calls.filter((c) => c.path === '/v1/operation').length, operationCalls);
  assert.equal((await f.db.listUsers()).find((u) => u.id === 1)?.role, 'seller');
});
void test('logout revoca token; desconectado limpia local y revoca al siguiente acceso', async () => {
  const f = await lanFixture();
  const token = await f.config.getNetworkToken();
  assert.ok(token);
  await f.client.logoutFromHost(url, pin);
  assert.equal(await f.config.getNetworkToken(), null);
  const snapshot = f.routes.get('/v1/snapshot');
  assert.ok(snapshot);
  assert.deepEqual(failureSchema.parse(await snapshot({ data: { token } })).code, 'AUTH_EXPIRED');
  await f.client.loginToHost(url, 'admin', 'admin-securo-123');
  const offlineToken = await f.config.getNetworkToken();
  f.setOffline(true);
  await f.client.logoutFromHost(url, pin);
  assert.equal(await f.config.getNetworkToken(), null);
  f.setOffline(false);
  await f.client.loginToHost(url, 'admin', 'admin-securo-123');
  assert.equal(
    failureSchema.parse(await snapshot({ data: { token: offlineToken } })).code,
    'AUTH_EXPIRED',
  );
});
void test('permisos denegados son REJECTED, no AUTH_EXPIRED; login está limitado en host', async () => {
  const f = await lanFixture();
  await f.db.saveUser({ username: 'cajero', password: 'cajero123', role: 'seller' });
  await f.client.loginToHost(url, 'cajero', 'cajero123');
  await assert.rejects(
    f.client.requestHostOperation(url, 'listUsers', []),
    (error: unknown) => error instanceof f.client.HostRejection && error.code === 'REJECTED',
  );
  for (let i = 0; i < 5; i++) await assert.rejects(f.client.loginToHost(url, 'nadie', 'errada'));
  await assert.rejects(f.client.loginToHost(url, 'nadie', 'errada'), /Espera un minuto/);
});
void test('pending conserva UUID y bloquea usuario, terminal, host y contenido distintos', async () => {
  const f = await fixture();
  const p = f.load('@/lib/network/pending-operation');
  const input = {
    hostUrl: url,
    username: 'admin',
    clientId: 'terminal-a',
    operation: 'addArea' as const,
    args: ['A'] satisfies PosArgs<'addArea'>,
  };
  const first = await p.prepareOperation(input);
  assert.equal((await p.prepareOperation(input)).commandId, first.commandId);
  for (const change of [
    { ...input, hostUrl: 'https://192.168.43.2:8787' },
    { ...input, username: 'otro' },
    { ...input, clientId: 'otro' },
    { ...input, args: ['B'] satisfies PosArgs<'addArea'> },
  ])
    await assert.rejects(p.prepareOperation(change), /pendiente/);
  assert.ok([...f.storage.keys()].some((k) => k.startsWith('secure:')));
  assert.ok(!f.storage.has('mipypos.pending-operation'));
});
void test('token antiguo se migra solo tras verificar la escritura segura; pin queda privado', async () => {
  const h = createHarness();
  h.storage.set('mipypos.network.token', 'copiado');
  const config = h.load('@/lib/network/config');
  assert.equal(await config.getNetworkToken(), 'copiado');
  assert.equal(h.storage.get('secure:mipypos.network.token'), 'copiado');
  assert.equal(h.storage.has('mipypos.network.token'), false);
  await config.saveNetworkToken('seguro');
  assert.equal(await config.getNetworkToken(), 'seguro');
  await config.saveNetworkConfig({
    mode: 'client',
    hostUrl: url,
    hostPin: pin,
    clientId: 'terminal-a',
  });
  assert.equal((await config.loadNetworkConfig()).hostPin, pin);
  assert.ok(!h.storage.get('mipypos.network.config')?.includes(pin));
});
void test('transporte falla cerrado sin pin/bridge y propaga fallo de pin nativo', async () => {
  const observed: unknown[][] = [];
  const h = createHarness({
    'react-native': {
      Platform: { OS: 'android' },
      NativeModules: {
        MipyTls: {
          start: async () => pin,
          stopServer: async () => undefined,
          respond: () => undefined,
          addListener: () => undefined,
          removeListeners: () => undefined,
          request: async (...args: unknown[]) => {
            observed.push(args);
            throw new Error('pin incorrecto');
          },
        },
      },
    },
  });
  const tls = h.load('@/lib/network/tls');
  await assert.rejects(tls.pinnedRequest(url, '/v1/login', { password: 'secreto' }), /QR/);
  assert.equal(observed.length, 0);
  await assert.rejects(
    tls.pinnedRequest(url, '/v1/login', { password: 'secreto' }, pin),
    /pin incorrecto/,
  );
  assert.equal(observed.length, 1);
  assert.equal(observed[0][3], pin);
  await assert.rejects(tls.pinnedRequest('http://192.168.43.1:8787', '/v1/health', undefined, pin));
  const missing = createHarness().load('@/lib/network/tls');
  await assert.rejects(
    missing.pinnedRequest(url, '/v1/health', undefined, pin),
    /compilación Android/,
  );
});
void test('rejection elimina pending; timeout o respuesta incompleta lo conserva', async () => {
  const f = await lanFixture();
  await assert.rejects(
    f.client.requestHostOperation(url, 'addArea', [''], 'admin', 'terminal-a'),
    /Revisa los datos|obligatorio/,
  );
  assert.equal(await f.load('@/lib/network/pending-operation').getPendingOperation(), null);
  const other = createHarness({ '@/lib/network/tls': { pinnedRequest: async () => '{}' } });
  await other.load('@/lib/network/config').saveNetworkToken('token');
  await assert.rejects(
    other
      .load('@/lib/network/client')
      .requestHostOperation(url, 'addArea', ['Nueva'], 'admin', 'terminal-a'),
    /confirmar/,
  );
  assert.ok(await other.load('@/lib/network/pending-operation').getPendingOperation());
});
void test('autorización idempotente y exportación incluyen extracciones y motivos reales', async () => {
  const f = await fixture();
  const sid = await f.db.openCashSession(100, 'admin');
  await f.db.registerCashWithdrawal(
    sid,
    {
      commandId: 'retiro-1',
      amount: 20,
      reason: 'Entrega al proveedor',
      adminUsername: 'admin',
      adminPassword: 'admin123',
    },
    'admin',
  );
  const input = {
    kind: 'withdrawals' as const,
    counted: 10,
    reason: 'Se contó solo una parte de los comprobantes',
    adminUsername: 'admin',
    adminPassword: 'admin123',
  };
  const c = command('authorizeCashDifference');
  const approval = await f.db.authorizeCashDifference(sid, input, c);
  assert.deepEqual(await f.db.authorizeCashDifference(sid, input, c), approval);
  await f.db.closeCashSession(sid, {
    denominations: [{ denomination: 20, quantity: 4 }],
    withdrawalCount: 10,
    transferCount: 0,
    products: [],
    adminUsername: 'admin',
    adminPassword: 'admin123',
    approvalIds: [approval.id],
  });
  const rows = await f.db.getExportRows('cash');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].closure_authorized_by, 'admin');
  assert.equal(typeof rows[0].closure_detail, 'string');
  const detail = z.string().parse(rows[0].closure_detail);
  assert.ok(detail.includes(input.reason));
  const withdrawals = withdrawalExportSchema.parse(
    JSON.parse(z.string().parse(rows[0].withdrawals)),
  );
  assert.equal(withdrawals.length, 1);
  assert.equal(withdrawals[0].amount, 20);
  assert.equal(withdrawals[0].reason, 'Entrega al proveedor');
  assert.equal(withdrawals[0].authorized_by, 'admin');
  const approvals = approvalExportSchema.parse(
    JSON.parse(z.string().parse(rows[0].difference_approvals)),
  );
  assert.equal(approvals.length, 1);
  assert.equal((await f.db.getExportRows('cash'))[0].closure_authorized_by, 'admin');
  await assert.rejects(f.db.getCashClosurePreview(sid), /cerrada/);
});
void test('pendientes de versión HTTP conservan UUID al vincular QR TLS del mismo host', async () => {
  const h = createHarness({ '@/lib/network/client': { HostRejection: class extends Error {} } });
  const sale = {
    hostUrl: 'http://192.168.43.1:8787',
    username: 'admin',
    command: {
      commandId: 'venta-original',
      clientId: 'terminal-a',
      sessionId: 1,
      method: 'transfer',
      payments: [{ type: 'transfer', amount: 100 }],
      items: [{ productId: 1, areaId: 1, quantity: 1 }],
    },
  };
  const withdrawal = {
    authority: 'http://192.168.43.1:8787',
    username: 'admin',
    commandId: 'retiro-original',
    sessionId: 1,
    amount: 10,
    reason: 'Entrega',
  };
  h.storage.set('mipypos.pendingLanSale.v2', JSON.stringify(sale));
  h.storage.set('mipypos.pendingWithdrawal.v1', JSON.stringify(withdrawal));
  const sales = h.load('@/lib/network/pending-sale');
  const withdrawals = h.load('@/lib/network/pending-withdrawal');
  await sales.upgradePendingSaleTransport('https://192.168.43.2:8787');
  await withdrawals.upgradePendingWithdrawalTransport('https://192.168.43.2:8787');
  assert.equal((await sales.getPendingSale())?.hostUrl, sale.hostUrl);
  await sales.upgradePendingSaleTransport(url);
  await withdrawals.upgradePendingWithdrawalTransport(url);
  assert.deepEqual(await sales.getPendingSale(), { ...sale, hostUrl: url });
  assert.deepEqual(await withdrawals.getPendingWithdrawal(), { ...withdrawal, authority: url });
});
void test('IP nueva conserva comandos pendientes después de verificar la identidad original', async () => {
  const f = await fixture();
  const p = f.load('@/lib/network/pending-operation');
  const input = {
    hostUrl: url,
    username: 'admin',
    clientId: 'terminal-a',
    operation: 'addArea' as const,
    args: ['A'] satisfies PosArgs<'addArea'>,
  };
  const first = await p.prepareOperation(input);
  const next = 'https://192.168.50.1:8787';
  await p.rebindPendingOperation('https://192.168.99.1:8787', next);
  assert.equal((await p.getPendingOperation())?.hostUrl, url);
  await p.rebindPendingOperation(url, next);
  assert.deepEqual(await p.getPendingOperation(), { ...first, hostUrl: next });
});
void test('dispatcher JS escucha el bridge TLS, devuelve resultados y libera sus listeners', async () => {
  let listener:
    | ((event: { id: string; method: string; path: string; body: string }) => void)
    | undefined;
  let respond: ((value: string) => void) | undefined;
  let removed = false;
  let stopped = false;
  class Emitter {
    addListener(_name: string, callback: typeof listener) {
      listener = callback;
      return {
        remove: () => {
          removed = true;
        },
      };
    }
  }
  const h = createHarness({
    'react-native': {
      Platform: { OS: 'android' },
      NativeEventEmitter: Emitter,
      NativeModules: {
        MipyTls: {
          start: async () => pin,
          stopServer: async () => {
            stopped = true;
          },
          respond: (_id: string, body: string) => {
            respond?.(body);
          },
          request: async () => {
            throw new Error('Unexpected client request in server fixture');
          },
          addListener: () => undefined,
          removeListeners: () => undefined,
        },
      },
    },
  });
  const tls = h.load('@/lib/network/tls');
  const server = new tls.SecureLanServer();
  server.post('/v1/test', async (request) => ({
    ok: true,
    data: z.object({ value: z.string() }).parse(request.data).value,
  }));
  await server.listen('192.168.43.1', 8787);
  assert.equal(tls.getHostPin(), pin);
  const emit = (path: string, body: string) =>
    new Promise<string>((resolve) => {
      respond = resolve;
      assert.ok(listener);
      listener({ id: 'request', method: 'POST', path, body });
    });
  assert.deepEqual(JSON.parse(await emit('/v1/test', '{"value":"confirmado"}')), {
    ok: true,
    data: 'confirmado',
  });
  assert.equal(failureSchema.parse(JSON.parse(await emit('/v1/test', '{'))).code, 'REJECTED');
  assert.equal(failureSchema.parse(JSON.parse(await emit('/v1/missing', '{}'))).code, 'REJECTED');
  server.stop();
  assert.equal(removed, true);
  assert.equal(stopped, true);
  assert.equal(tls.getHostPin(), '');
});
void test('configuración nativa mantiene pin, firma, validez y hostname; sin HTTP ni trust-all', () => {
  // Static guard only: this does not execute a TLS handshake or Android Keystore.
  const java = readFileSync('lib/network/native/MipyTlsModule.java', 'utf8');
  assert.ok(java.includes('MessageDigest.isEqual'));
  assert.ok(java.includes('checkValidity()'));
  assert.ok(java.includes('verify(chain[0].getPublicKey())'));
  assert.ok(!java.includes('setHostnameVerifier'));
  assert.ok(java.includes('setInstanceFollowRedirects(false)'));
  const identity = readFileSync('lib/network/native/LanIdentity.java', 'utf8');
  assert.ok(identity.includes('AndroidKeyStore'));
  assert.ok(identity.includes('InetAddress.getByName(ip).getAddress()'));
  const config = readFileSync('app.config.ts', 'utf8');
  assert.ok(config.includes('usesCleartextTraffic: false'));
  assert.ok(!config.includes('NSAllowsArbitraryLoads: true'));
});
void test('auditor LAN consulta sin cerrar caja ni impedir ventas y rechaza todas las mutaciones', async () => {
  const f = await lanFixture();
  await f.db.saveUser({ username: 'auditor', password: 'auditor123', role: 'auditor' });
  const id = await f.db.saveProduct(base, 'admin');
  const sessionId = await f.db.openCashSession(0, 'admin');
  await f.client.loginToHost(url, 'auditor', 'auditor123');
  const data = await f.client.requestHostOperation(
    url,
    'getAuditSnapshot',
    [],
    'auditor',
    'terminal-a',
  );
  assert.equal(data.sales.length, 0);
  assert.equal(data.products.length, 1);
  const cfg = f.load('@/lib/network/config');
  const token = await cfg.getNetworkToken();
  assert.ok(token);
  const operations = f.load('@/lib/network/operations');
  for (const operation of [...operations.mutationOperations, 'registerCashWithdrawal']) {
    const route = f.routes.get('/v1/operation');
    assert.ok(route);
    const result = await route({
      data: { token, operation, args: [], commandId: 'audit-attempt', clientId: 'terminal-a' },
    });
    assert.equal(failureSchema.parse(result).code, 'REJECTED');
  }
  const saleRoute = f.routes.get('/v1/sale');
  assert.ok(saleRoute);
  assert.equal(
    failureSchema.parse(
      await saleRoute({
        data: {
          token,
          commandId: 'audit-sale',
          clientId: 'terminal-a',
          items: [{ productId: id, quantity: 1, areaId: 1 }],
        },
      }),
    ).code,
    'REJECTED',
  );
  const product = await f.db.getProduct(id);
  assert.ok(product);
  await f.db.registerSale(
    [{ product, quantity: 1, price: 100, areaId: 1 }],
    'cash',
    [{ type: 'cash', amount: 100 }],
    'admin',
    undefined,
    sessionId,
    { cashReceived: 200, transferReceipt: null },
  );
  const latest = await f.client.requestHostOperation(
    url,
    'getAuditSnapshot',
    [],
    'auditor',
    'terminal-a',
  );
  assert.equal(latest.sales.length, 1);
  assert.equal((await f.db.getOpenSession())?.id, sessionId);
  assert.equal(
    (
      await f.client.requestHostOperation(
        url,
        'getSale',
        [latest.sales[0].id],
        'auditor',
        'terminal-a',
      )
    )?.sale.settlement?.changeDue,
    100,
  );
});
void test('consulta LAN de transacción devuelve solo la venta y permite datos personales vacíos', async () => {
  for (const method of ['transfer', 'mixed'] as const) {
    const f = await lanFixture();
    const id = await f.db.saveProduct(base, 'admin');
    const sid = await f.db.openCashSession(0, 'admin');
    const amount = method === 'mixed' ? 60 : 100;
    const input = {
      commandId: `receipt-${method}`,
      clientId: 'terminal-a',
      sessionId: sid,
      method,
      payments:
        method === 'mixed'
          ? [
              { type: 'cash' as const, amount: 40 },
              { type: 'transfer' as const, amount: 60 },
            ]
          : [{ type: 'transfer' as const, amount: 100 }],
      items: [{ productId: id, areaId: 1, quantity: 1 }],
      settlement: {
        cashReceived: method === 'mixed' ? 50 : null,
        transferReceipt: {
          ci: '',
          fullName: '',
          address: '',
          amount,
          rawText: `Monto: ${amount} CUP`,
          reference: 'UNICA-123',
          receiptDate: '',
          imageBase64: '/9j/AA==',
          reviewed: true,
        },
      },
    };
    assert.equal(
      await f.client.requestHostOperation(
        url,
        'findTransferTransaction',
        ['unica-123'],
        'admin',
        'terminal-a',
      ),
      null,
    );
    const saleId = await f.client.registerHostSale(url, input);
    assert.deepEqual(
      await f.client.requestHostOperation(
        url,
        'findTransferTransaction',
        [' unica-123 '],
        'admin',
        'terminal-a',
      ),
      { id: saleId },
    );
    await assert.rejects(
      f.client.registerHostSale(url, {
        ...input,
        commandId: `receipt-duplicate-${method}`,
        settlement: {
          ...input.settlement,
          transferReceipt: {
            ...input.settlement.transferReceipt,
            reference: 'unica-123',
            imageBase64: 'ZG90',
          },
        },
      }),
      /ya se usó/,
    );
    assert.equal((await f.db.getDemoUsage()).sales, 1);
    f.setOffline(true);
    await assert.rejects(
      f.client.requestHostOperation(
        url,
        'findTransferTransaction',
        ['UNICA-123'],
        'admin',
        'terminal-a',
      ),
    );
  }
});

void test('venta LAN exige cobro nuevo, calcula vuelto y conserva resultado al reintentar', async () => {
  const f = await lanFixture();
  const id = await f.db.saveProduct(base, 'admin');
  const sid = await f.db.openCashSession(0, 'admin');
  const input = {
    commandId: 'cash-new',
    clientId: 'terminal-a',
    sessionId: sid,
    method: 'cash' as const,
    payments: [{ type: 'cash' as const, amount: 100 }],
    items: [{ productId: id, areaId: 1, quantity: 1 }],
  };
  await assert.rejects(f.client.registerHostSale(url, input), /Actualiza la terminal/);
  const sale = await f.client.registerHostSale(url, {
    ...input,
    settlement: { cashReceived: 150, transferReceipt: null },
  });
  assert.equal(
    await f.client.registerHostSale(url, {
      ...input,
      settlement: { cashReceived: 150, transferReceipt: null },
    }),
    sale,
  );
  assert.equal((await f.db.getSale(sale))?.sale.settlement?.changeDue, 50);
  assert.equal((await f.db.getDemoUsage()).sales, 1);
});
void test('QR Wi-Fi Direct conserva pin y propietario y rechaza identidad inválida', () => {
  const h = createHarness();
  const qr = h.load('@/lib/network/qr');
  const code = qr.createLanQr('https://192.168.49.1:8787', undefined, pin, 'aa:bb:cc:dd:ee:ff');
  const connection = qr.parseLanConnection(code);
  assert.equal(connection.directAddress, 'aa:bb:cc:dd:ee:ff');
  assert.equal(connection.hostPin, pin);
  assert.equal(connection.wifi, undefined);
  assert.throws(() =>
    qr.parseLanConnection(qr.createLanQr(url, undefined, pin, '02:00:00:00:00:00')),
  );
});
void test('puentes Android usan P2P real y OCR incluido, no downloads de modelos en uso', () => {
  // Static verification only; hardware discovery and recognition still require an APK.
  const java = readFileSync('lib/network/native/MipyDirectModule.java', 'utf8');
  for (const call of [
    'WifiP2pManager',
    'manager.createGroup',
    'manager.discoverPeers',
    'manager.connect',
    'manager.removeGroup',
    'groupOwnerIntent = 0',
    'deadline',
  ])
    assert.ok(java.includes(call));
  const plugin = readFileSync('lib/network/withLocalHotspot.ts', 'utf8');
  assert.ok(plugin.includes('com.google.mlkit:text-recognition:16.0.1'));
  assert.ok(!plugin.includes('play-services-mlkit-text-recognition'));
});
void test('fallos de lectura o escritura segura conservan el token antiguo', async () => {
  for (const failure of ['read', 'write', 'verify']) {
    const h = createHarness({
      'expo-secure-store': {
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device',
        getItemAsync: async () => {
          if (failure === 'read') throw new Error('locked');
          return null;
        },
        setItemAsync: async () => {
          if (failure === 'write') throw new Error('full');
        },
      },
    });
    h.storage.set('mipypos.network.token', 'sesion-valida');
    await assert.rejects(h.load('@/lib/network/config').getNetworkToken());
    assert.equal(h.storage.get('mipypos.network.token'), 'sesion-valida');
  }
});
void test('sesión segura tiene prioridad y web no copia secretos al navegador', async () => {
  const h = createHarness();
  h.storage.set('mipypos.network.token', 'antiguo');
  h.storage.set('secure:mipypos.network.token', 'vigente');
  assert.equal(await h.load('@/lib/network/config').getNetworkToken(), 'vigente');
  const web = createHarness({ 'react-native': { Platform: { OS: 'web' }, NativeModules: {} } });
  web.storage.set('mipypos.network.token', 'antiguo');
  const config = web.load('@/lib/network/config');
  assert.equal(await config.getNetworkToken(), null);
  assert.equal(web.storage.get('mipypos.network.token'), 'antiguo');
  await assert.rejects(config.saveNetworkToken('nuevo'), /navegador/);
  assert.equal(web.storage.has('secure:mipypos.network.token'), false);
  const tls = web.load('@/lib/network/tls');
  const server = new tls.SecureLanServer();
  assert.doesNotThrow(() => server.stop());
  await assert.rejects(tls.pinnedRequest(url, '/v1/health', undefined, pin), /Android/);
});
void test('configuración normalizada conserva terminal y no cambia autoridad inválida a local', async () => {
  const h = createHarness();
  const config = h.load('@/lib/network/config');
  const first = await config.loadNetworkConfig();
  assert.equal((await config.loadNetworkConfig()).clientId, first.clientId);
  h.storage.set(
    'mipypos.network.config',
    JSON.stringify({ mode: 'standalone', transport: 'direct', hostUrl: url }),
  );
  const standalone = await config.loadNetworkConfig();
  assert.equal(standalone.transport, 'wifi');
  assert.equal(standalone.hostUrl, '');
  const broken = JSON.stringify({
    mode: 'client',
    transport: 'unknown',
    hostUrl: 'http://192.168.49.1:8787',
    clientId: 'old-client',
  });
  h.storage.set('mipypos.network.config', broken);
  const recovered = await config.loadNetworkConfig();
  assert.equal(recovered.mode, 'client');
  assert.equal(recovered.clientId, 'old-client');
  assert.ok(recovered.recoveryMessage);
  assert.equal(h.storage.get('mipypos.network.config'), broken);
});
void test('revisión real detecta todas las escrituras, rollback y no-op sin depender del log', async () => {
  const f = await fixture();
  const id = await f.db.saveProduct(base, 'admin');
  const initial = await f.db.getSharedSnapshot();
  f.database.run('DELETE FROM network_events');
  assert.equal((await f.db.getSharedSnapshot()).revision, initial.revision);
  f.database.run('UPDATE products SET price_cash=price_cash WHERE id=?', [id]);
  assert.equal((await f.db.getSharedSnapshot()).revision, initial.revision);
  f.database.run('UPDATE products SET price_transfer=125 WHERE id=?', [id]);
  const changed = await f.db.getSharedSnapshot();
  assert.ok(changed.revision > initial.revision);
  f.database.run('BEGIN; UPDATE products SET price_cash=300; ROLLBACK;');
  assert.equal((await f.db.getSharedSnapshot()).revision, changed.revision);
  const cmd = command('addArea', 'sync');
  await f.db.addArea('Otra zona', cmd);
  const committed = await f.db.getSharedSnapshot();
  await f.db.addArea('Otra zona', cmd);
  assert.equal((await f.db.getSharedSnapshot()).revision, committed.revision);
  await f.db.initializeDatabase();
  assert.equal((await f.db.getSharedSnapshot()).authorityId, initial.authorityId);
});
void test('protocolo rechaza operación desconocida y argumentos inválidos con ID', async () => {
  const f = await lanFixture();
  const token = await f.config.getNetworkToken();
  const route = f.routes.get('/v1/operation');
  assert.ok(route);
  const response = z.object({
    success: z.literal(false),
    ok: z.literal(false),
    code: z.string(),
    requestId: z.string(),
    error: z.string(),
  });
  const unknown = response.parse(
    await route({ data: { token, operation: 'constructor', args: [], commandId: 'unknown-1' } }),
  );
  assert.equal(unknown.code, 'UNKNOWN_OPERATION');
  assert.equal(unknown.requestId, 'unknown-1');
  const invalid = response.parse(
    await route({
      data: {
        token,
        operation: 'registerMovement',
        args: [{ productId: -1 }],
        commandId: 'invalid-1',
        clientId: 'terminal-a',
      },
    }),
  );
  assert.equal(invalid.code, 'INVALID_ARGUMENTS');
  assert.equal((await f.db.listMovements()).length, 0);
  assert.equal((await f.db.getDemoUsage()).sales, 0);
});
void test('pendiente corrupto se conserva y muestra error controlado, sin reenviarlo', async () => {
  const h = createHarness();
  h.storage.set('secure:mipypos.pending-operation', '{truncado');
  await assert.rejects(
    h.load('@/lib/network/pending-operation').getPendingOperation(),
    /Se conserva/,
  );
  assert.equal(h.storage.get('secure:mipypos.pending-operation'), '{truncado');
});
void test('copia SQLite confirmada y respuesta sin cambios no duplican datos ni revisiones', async () => {
  const f = await lanFixture();
  const id = await f.db.saveProduct(base, 'admin');
  const first = await f.client.getHostSnapshot(url);
  const second = await f.client.getHostSnapshot(url);
  assert.deepEqual(second, first);
  assert.equal(f.database.exec('SELECT COUNT(*) FROM network_replica')[0].values[0][0], 1);
  const lastCall = f.calls.filter((call) => call.path === '/v1/snapshot').at(-1);
  assert.equal(lastCall?.body.knownRevision, first.revision);
  const token = await f.config.getNetworkToken();
  assert.ok(token);
  const stored = String(f.database.exec('SELECT payload FROM network_replica')[0].values[0][0]);
  assert.ok(!stored.includes(token));
  f.setOffline(true);
  await assert.rejects(f.client.getHostSnapshot(url), /offline/);
  f.setOffline(false);
  f.database.run('UPDATE products SET price_cash=130 WHERE id=?', [id]);
  const updated = await f.client.getHostSnapshot(url);
  assert.ok(updated.revision > first.revision);
  assert.equal(updated.products.find((p) => p.id === id)?.price_cash, 130);
});
void test('cambio de usuario no reutiliza copia administrativa ni costos', async () => {
  const f = await lanFixture();
  const id = await f.db.saveProduct(base, 'admin');
  await f.db.setProductCost(
    { commandId: 'cost-cache', productId: id, cost: 25, reason: 'Compra' },
    'admin',
  );
  const admin = await f.client.getHostSnapshot(url);
  assert.equal(admin.products[0].unit_cost, 25);
  await f.db.saveUser({ username: 'seller-cache', password: 'seller123', role: 'seller' });
  await f.client.loginToHost(url, 'seller-cache', 'seller123');
  const seller = await f.client.getHostSnapshot(url);
  assert.equal(seller.products[0].unit_cost, undefined);
  assert.equal(f.database.exec('SELECT COUNT(*) FROM network_replica')[0].values[0][0], 2);
});
void test('UUID de venta liga contenido original y replay no incrementa revisión', async () => {
  const f = await lanFixture();
  const id = await f.db.saveProduct(base, 'admin');
  const sid = await f.db.openCashSession(0, 'admin');
  const input = {
    commandId: 'unique-sale',
    clientId: 'terminal-a',
    sessionId: sid,
    method: 'cash' as const,
    items: [{ productId: id, areaId: 1, quantity: 1 }],
    payments: [{ type: 'cash' as const, amount: 100 }],
    settlement: { cashReceived: 100, transferReceipt: null },
  };
  const sale = await f.client.registerHostSale(url, input);
  const revision = (await f.db.getSharedRevision()).revision;
  assert.equal(await f.client.registerHostSale(url, input), sale);
  assert.equal((await f.db.getSharedRevision()).revision, revision);
  await assert.rejects(
    f.client.registerHostSale(url, {
      ...input,
      items: [{ productId: id, areaId: 1, quantity: 2 }],
      payments: [{ type: 'cash', amount: 200 }],
      settlement: { cashReceived: 200, transferReceipt: null },
    }),
    /otros datos/,
  );
  assert.equal((await f.db.getDemoUsage()).sales, 1);
  assert.equal((await f.db.getProduct(id))?.stock, 9);
});
void test('respuesta de venta sin ID o rechazo incompleto conserva pendiente', async () => {
  for (const response of [{ ok: true, data: {} }, { ok: false }]) {
    const requestedPaths: string[] = [];
    const h = createHarness({
      '@/lib/network/tls': {
        pinnedRequest: async (_hostUrl: string, path: string) => {
          requestedPaths.push(path);
          return JSON.stringify(
            path === '/v1/sale-receipt' ? { ok: true, data: { saleId: null } } : response,
          );
        },
      },
    });
    const config = h.load('@/lib/network/config');
    await config.saveNetworkToken('token-valid');
    const pending = h.load('@/lib/network/pending-sale');
    const network = { mode: 'client' as const, hostUrl: url, clientId: 'terminal-a' };
    await assert.rejects(
      pending.createPendingSale(network, 'admin', {
        method: 'cash',
        sessionId: 1,
        items: [{ productId: 1, areaId: 1, quantity: 1 }],
        payments: [{ type: 'cash', amount: 100 }],
        settlement: { cashReceived: 100, transferReceipt: null },
      }),
      /confirmar/,
    );
    assert.deepEqual(requestedPaths, ['/v1/sale-receipt', '/v1/sale']);
    assert.ok(await pending.getPendingSale());
  }
});

void test('journal cifrado recupera una copia dañada sin cambiar UUID y no resucita una confirmación', async () => {
  const h = createHarness();
  const pending = h.load('@/lib/network/pending-operation');
  const input = {
    hostUrl: url,
    username: 'admin',
    clientId: 'terminal-a',
    operation: 'saveUser' as const,
    args: [
      { username: 'vendedor', password: 'dato-muy-privado-123', role: 'seller' },
    ] satisfies PosArgs<'saveUser'>,
  };
  const first = await pending.prepareOperation(input);
  const a = 'mipypos.pending-operation.journal.a';
  const b = 'mipypos.pending-operation.journal.b';
  assert.equal(h.storage.get(a), h.storage.get(b));
  assert.ok(!h.storage.get(a)?.includes('dato-muy-privado-123'));
  h.storage.set(a, 'copia dañada');
  assert.equal((await pending.getPendingOperation())?.commandId, first.commandId);
  assert.equal(h.storage.get(`${a}.damaged`), 'copia dañada');
  assert.equal(h.storage.get(a), h.storage.get(b));
  const old = h.storage.get(a)!;
  await pending.clearPendingOperation();
  h.storage.set(a, old);
  assert.equal(await pending.getPendingOperation(), null);
  assert.equal(h.storage.get(a), h.storage.get(b));
});
void test('journal con dos copias dañadas o clave perdida conserva evidencia y no envía', async () => {
  for (const lostKey of [false, true]) {
    const h = createHarness();
    const p = h.load('@/lib/network/pending-operation');
    await p.prepareOperation({
      hostUrl: url,
      username: 'admin',
      clientId: 'terminal-a',
      operation: 'addArea',
      args: ['Recuperación'],
    });
    const a = 'mipypos.pending-operation.journal.a';
    const b = 'mipypos.pending-operation.journal.b';
    if (lostKey) h.storage.delete('secure:mipypos.pending-operation.aes-key');
    else {
      h.storage.set(a, 'dañada a');
      h.storage.set(b, 'dañada b');
    }
    const storedCopiesBefore = [h.storage.get(a), h.storage.get(b)];
    await assert.rejects(p.getPendingOperation(), /conserva sin reenviarlo/);
    assert.deepEqual([h.storage.get(a), h.storage.get(b)], storedCopiesBefore);
  }
});
void test('migración de pendiente inválido mantiene el original y no genera una copia', async () => {
  const h = createHarness();
  h.storage.set('mipypos.pendingWithdrawal.v1', '{truncado');
  await assert.rejects(
    h.load('@/lib/network/pending-withdrawal').getPendingWithdrawal(),
    /conserva/,
  );
  assert.equal(h.storage.get('mipypos.pendingWithdrawal.v1'), '{truncado');
  assert.equal(h.storage.has('mipypos.pendingWithdrawal.v1.journal.a'), false);
});
void test('huella alterada en pendiente antiguo no se reenvía ni se descarta', async () => {
  const h = createHarness();
  const raw = JSON.stringify({
    hostUrl: url,
    username: 'admin',
    clientId: 'terminal-a',
    commandId: 'original',
    operation: 'addArea',
    args: ['A'],
    fingerprint: 'incorrecta',
  });
  h.storage.set('secure:mipypos.pending-operation', raw);
  await assert.rejects(h.load('@/lib/network/pending-operation').getPendingOperation(), /conserva/);
  assert.equal(h.storage.get('secure:mipypos.pending-operation'), raw);
});
void test('rechazo de lookup nunca elimina una mutación de resultado incierto', async () => {
  const f = await lanFixture();
  f.loseNextResponse();
  await assert.rejects(
    f.client.requestHostOperation(url, 'addArea', ['ACK incierto'], 'admin', 'terminal-a'),
  );
  const p = f.load('@/lib/network/pending-operation');
  const id = (await p.getPendingOperation())?.commandId;
  const receipt = f.routes.get('/v1/receipt')!;
  f.routes.set('/v1/receipt', async () => ({
    ok: false,
    code: 'REJECTED',
    error: 'No se pudo leer el recibo.',
  }));
  await assert.rejects(
    f.client.requestHostOperation(url, 'addArea', ['ACK incierto'], 'admin', 'terminal-a'),
  );
  assert.equal((await p.getPendingOperation())?.commandId, id);
  f.routes.set('/v1/receipt', receipt);
  await f.client.requestHostOperation(url, 'addArea', ['ACK incierto'], 'admin', 'terminal-a');
  assert.equal(await p.getPendingOperation(), null);
  assert.equal((await f.db.listAreas()).filter((area) => area.name === 'ACK incierto').length, 1);
});
void test('logout elimina replicas de todas las sesiones sin eliminar pendientes', async () => {
  const f = await lanFixture();
  await f.client.getHostSnapshot(url);
  assert.equal(f.database.exec('SELECT COUNT(*) FROM network_replica')[0].values[0][0], 1);
  await f.load('@/lib/network/pending-operation').prepareOperation({
    hostUrl: url,
    username: 'admin',
    clientId: 'terminal-a',
    operation: 'addArea',
    args: ['Por confirmar'],
  });
  await f.client.logoutFromHost(url, pin);
  assert.equal(f.database.exec('SELECT COUNT(*) FROM network_replica')[0].values[0][0], 0);
  assert.ok(await f.load('@/lib/network/pending-operation').getPendingOperation());
});
void test('snapshot rechaza referencias huérfanas, pares duplicados y stock diferente', async () => {
  const f = await fixture();
  await f.db.saveProduct(base, 'admin');
  const snapshot = await f.db.getSharedSnapshot();
  const parse = f.load('@/lib/network/snapshot').parseSnapshot;
  assert.doesNotThrow(() => parse(snapshot));
  for (const value of [
    { ...snapshot, areaStock: [...snapshot.areaStock, snapshot.areaStock[0]] },
    { ...snapshot, areaStock: [{ ...snapshot.areaStock[0], area_id: 999 }] },
    { ...snapshot, products: [...snapshot.products, snapshot.products[0]] },
    { ...snapshot, areaStock: [] },
  ])
    assert.throws(() => parse(value), /inconsistentes/);
});
void test('descubrimiento no confía en nombres ni direcciones: requiere pin previo y TLS', async () => {
  const checked: Array<{ address: string; pin: string }> = [];
  const h = createHarness({
    'react-native': {
      Platform: { OS: 'android' },
      NativeModules: {
        MipyDiscovery: {
          advertise: async () => undefined,
          stopAdvertisement: async () => undefined,
          cancelDiscovery: async () => undefined,
          discover: async () => [
            { name: 'MipyPOS-impostor', hostUrl: 'https://192.168.43.2:8787' },
            { name: 'MipyPOS-real', hostUrl: url },
          ],
        },
      },
    },
    '@/lib/network/client': {
      checkLanHost: async (address: string, paired: string) => {
        checked.push({ address, pin: paired });
        if (address !== url) throw new Error('Pin incorrecto');
      },
    },
  });
  const discovery = h.load('@/lib/network/discovery');
  await assert.rejects(discovery.findPairedLanHost(''), /QR/);
  assert.equal(checked.length, 0);
  assert.equal(await discovery.findPairedLanHost(pin), url);
  assert.ok(checked.every((entry) => entry.pin === pin));
});
void test('venta LAN con respuesta perdida se confirma por recibo sin volver a descontar stock', async () => {
  const f = await lanFixture();
  const productId = await f.db.saveProduct(base, 'admin');
  const sessionId = await f.db.openCashSession(0, 'admin');
  const saleRoute = f.routes.get('/v1/sale')!;
  let lost = true;
  f.routes.set('/v1/sale', async (request) => {
    const result = await saleRoute(request);
    if (lost) {
      lost = false;
      throw new Error('ACK perdido');
    }
    return result;
  });
  const pending = f.load('@/lib/network/pending-sale');
  const config = await f.config.loadNetworkConfig();
  await assert.rejects(
    pending.createPendingSale(config, 'admin', {
      method: 'cash',
      sessionId,
      items: [{ productId, areaId: 1, quantity: 1 }],
      payments: [{ type: 'cash', amount: 100 }],
      settlement: { cashReceived: 100, transferReceipt: null },
    }),
    /ACK perdido/,
  );
  const originalId = (await pending.getPendingSale())?.command.commandId;
  assert.ok(originalId);
  const saleId = await pending.sendPendingSale(config, 'admin');
  assert.ok(saleId > 0);
  assert.equal(await pending.getPendingSale(), null);
  assert.equal(f.calls.filter((call) => call.path === '/v1/sale').length, 1);
  assert.equal((await f.db.getProduct(productId))?.stock, 9);
  assert.equal((await f.db.getDemoUsage()).sales, 1);
});
void test('retiro LAN con respuesta perdida recupera recibo sin repetir la salida de caja', async () => {
  const f = await lanFixture();
  const sessionId = await f.db.openCashSession(100, 'admin');
  const pending = f.load('@/lib/network/pending-withdrawal');
  const values = {
    authority: url,
    username: 'admin',
    sessionId,
    amount: 10,
    reason: 'Entrega autorizada',
  };
  const credentials = { adminUsername: 'admin', adminPassword: 'admin-securo-123' };
  const register = (
    id: number,
    input: import('../lib/models').CashWithdrawalInput,
    username: string,
  ) =>
    f.client.requestHostOperation(
      url,
      'registerCashWithdrawal',
      [id, input, username],
      username,
      'terminal-a',
    );
  f.loseNextResponse();
  await assert.rejects(pending.submitWithdrawal(values, credentials, register), /perdida/);
  assert.ok(await pending.getPendingWithdrawal());
  await pending.submitWithdrawal(values, credentials, register);
  assert.equal(await pending.getPendingWithdrawal(), null);
  assert.equal((await f.db.getCashSummary(sessionId)).withdrawalTotal, 10);
  assert.equal(f.database.exec('SELECT COUNT(*) FROM cash_withdrawals')[0].values[0][0], 1);
});
void test('rechazo posterior a commit no elimina una venta ni produce un segundo cobro', async () => {
  const f = await lanFixture();
  const productId = await f.db.saveProduct(base, 'admin');
  const sessionId = await f.db.openCashSession(0, 'admin');
  const saleRoute = f.routes.get('/v1/sale')!;
  f.routes.set('/v1/sale', async (request) => {
    await saleRoute(request);
    return { ok: false, code: 'REJECTED', error: 'No se pudo construir la respuesta.' };
  });
  const pending = f.load('@/lib/network/pending-sale');
  const saleId = await pending.createPendingSale(await f.config.loadNetworkConfig(), 'admin', {
    method: 'cash',
    sessionId,
    items: [{ productId, areaId: 1, quantity: 1 }],
    payments: [{ type: 'cash', amount: 100 }],
    settlement: { cashReceived: 100, transferReceipt: null },
  });
  assert.ok(saleId > 0);
  assert.equal(await pending.getPendingSale(), null);
  assert.equal((await f.db.getProduct(productId))?.stock, 9);
  assert.equal((await f.db.getDemoUsage()).sales, 1);
});
void test('respuesta snapshot atrasada tras logout no repuebla la replica ni se devuelve', async () => {
  const f = await lanFixture();
  const route = f.routes.get('/v1/snapshot')!;
  let release!: () => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.routes.set('/v1/snapshot', async (request) => {
    const result = await route(request);
    started();
    await barrier;
    return result;
  });
  const response = f.client.getHostSnapshot(url);
  const rejected = assert.rejects(response, /sesión cambió/);
  await begun;
  await f.client.logoutFromHost(url, pin);
  release();
  await rejected;
  assert.equal(f.database.exec('SELECT COUNT(*) FROM network_replica')[0].values[0][0], 0);
});
void test('AUTH_EXPIRED atrasado no cierra una nueva sesión válida', async () => {
  const f = await lanFixture();
  let release!: () => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.routes.set('/v1/report', async () => {
    started();
    await barrier;
    return { ok: false, code: 'AUTH_EXPIRED', error: 'Sesión anterior vencida.' };
  });
  const response = f.client.getHostReport(url);
  const rejected = assert.rejects(response, /vencida/);
  await begun;
  await f.client.loginToHost(url, 'admin', 'admin-securo-123');
  const token = await f.config.getNetworkToken();
  release();
  await rejected;
  assert.equal(await f.config.getNetworkToken(), token);
});
void test('comprobante grande migra cifrado, recupera copia y mantiene UUID', async () => {
  const h = createHarness();
  const key = 'mipypos.pendingLanSale.v2';
  const record = {
    hostUrl: url,
    username: 'admin',
    command: {
      commandId: 'comprobante-original',
      clientId: 'terminal-a',
      sessionId: 1,
      method: 'transfer',
      payments: [{ type: 'transfer', amount: 100 }],
      items: [{ productId: 1, areaId: 1, quantity: 1 }],
      settlement: {
        cashReceived: null,
        transferReceipt: {
          ci: '',
          fullName: 'Datos privados del comprador',
          address: '',
          amount: 100,
          rawText: '',
          reference: 'TRANSFERENCIA-ORIGINAL',
          receiptDate: '',
          imageBase64: 'A'.repeat(500000),
          reviewed: true,
        },
      },
    },
  };
  h.storage.set(key, JSON.stringify(record));
  const p = h.load('@/lib/network/pending-sale');
  assert.deepEqual(await p.getPendingSale(), record);
  assert.equal(h.storage.has(key), false);
  assert.ok(!h.storage.get(`${key}.journal.a`)?.includes('Datos privados del comprador'));
  h.storage.set(`${key}.journal.b`, 'dañada');
  assert.equal((await p.getPendingSale())?.command.commandId, record.command.commandId);
});
void test('recibo de operación malformado muestra mensaje legible y conserva pendiente', async () => {
  for (const data of [{}, { found: true }, { found: 'sí', value: 1 }]) {
    const f = await lanFixture();
    f.routes.set('/v1/receipt', async () => ({ ok: true, data }));
    await assert.rejects(
      f.client.requestHostOperation(url, 'addArea', ['Sin confirmar'], 'admin', 'terminal-a'),
      { message: 'No se pudo confirmar la operación pendiente.' },
    );
    assert.ok(await f.load('@/lib/network/pending-operation').getPendingOperation());
    assert.equal(f.calls.filter((call) => call.path === '/v1/operation').length, 0);
    assert.equal(
      (await f.db.listAreas()).filter((area) => area.name === 'Sin confirmar').length,
      0,
    );
  }
});
void test('recibo de venta malformado muestra mensaje legible y conserva pendiente', async () => {
  for (const data of [{}, { saleId: 0 }, { saleId: '1' }]) {
    const f = await lanFixture();
    const productId = await f.db.saveProduct(base, 'admin');
    const sessionId = await f.db.openCashSession(0, 'admin');
    f.routes.set('/v1/sale-receipt', async () => ({ ok: true, data }));
    const pending = f.load('@/lib/network/pending-sale');
    await assert.rejects(
      pending.createPendingSale(await f.config.loadNetworkConfig(), 'admin', {
        method: 'cash',
        sessionId,
        items: [{ productId, areaId: 1, quantity: 1 }],
        payments: [{ type: 'cash', amount: 100 }],
        settlement: { cashReceived: 100, transferReceipt: null },
      }),
      { message: 'No se pudo confirmar la venta pendiente.' },
    );
    assert.ok(await pending.getPendingSale());
    assert.equal(f.calls.filter((call) => call.path === '/v1/sale').length, 0);
    assert.equal((await f.db.getProduct(productId))?.stock, 10);
    assert.equal((await f.db.getDemoUsage()).sales, 0);
  }
});
void test('recibo de retiro malformado muestra mensaje legible y conserva pendiente', async () => {
  for (const data of [{}, { withdrawalId: 0 }, { withdrawalId: '1' }]) {
    const f = await lanFixture();
    const sessionId = await f.db.openCashSession(100, 'admin');
    f.routes.set('/v1/withdrawal-receipt', async () => ({ ok: true, data }));
    const pending = f.load('@/lib/network/pending-withdrawal');
    const register = (
      id: number,
      input: import('../lib/models').CashWithdrawalInput,
      username: string,
    ) =>
      f.client.requestHostOperation(
        url,
        'registerCashWithdrawal',
        [id, input, username],
        username,
        'terminal-a',
      );
    await assert.rejects(
      pending.submitWithdrawal(
        { authority: url, username: 'admin', sessionId, amount: 10, reason: 'Entrega autorizada' },
        { adminUsername: 'admin', adminPassword: 'admin-securo-123' },
        register,
      ),
      { message: 'No se pudo confirmar la extracción pendiente.' },
    );
    assert.ok(await pending.getPendingWithdrawal());
    assert.equal(f.calls.filter((call) => call.path === '/v1/operation').length, 0);
    assert.equal((await f.db.getCashSummary(sessionId)).withdrawalTotal, 0);
  }
});

void test('journal anclado recupera pin perdido y confirma recibo sin repetir operación', async () => {
  const f = await lanFixture();
  const pending = f.load('@/lib/network/pending-operation');
  f.loseNextResponse();
  await assert.rejects(
    f.client.requestHostOperation(url, 'addArea', ['Recuperación anclada'], 'admin', 'terminal-a'),
    /perdida/,
  );
  const original = await pending.getPendingOperation();
  assert.ok(original);
  assert.equal(original.hostPin, pin);
  f.storage.delete('secure:mipypos.network.pin');
  const current = await f.config.loadNetworkConfig();
  const next = { ...current, hostUrl: url, hostPin: pin };
  const beforeCalls = f.calls.length;
  assert.throws(
    () =>
      f.config.assertPendingAuthority(
        current,
        { ...next, hostPin: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=' },
        [original.hostUrl],
        [original.hostPin],
      ),
    /identidad original/,
  );
  assert.equal(f.calls.length, beforeCalls);
  assert.equal((await pending.getPendingOperation())?.commandId, original.commandId);
  f.config.assertPendingAuthority(current, next, [original.hostUrl], [original.hostPin]);
  await f.config.saveNetworkConfig(next);
  await f.client.loginToHost(url, 'admin', 'admin-securo-123');
  assert.equal(await pending.getPendingOperation(), null);
  assert.equal(f.calls.filter((call) => call.path === '/v1/operation').length, 1);
  assert.equal(
    (await f.db.listAreas()).filter((area) => area.name === 'Recuperación anclada').length,
    1,
  );
});

void test('pin y dirección perdidos recuperan IP nueva exclusivamente desde journal anclado', async () => {
  const f = await lanFixture();
  f.loseNextResponse();
  await assert.rejects(
    f.client.requestHostOperation(url, 'addArea', ['Nueva IP segura'], 'admin', 'terminal-a'),
    /perdida/,
  );
  const pending = f.load('@/lib/network/pending-operation');
  const original = await pending.getPendingOperation();
  assert.ok(original);
  f.storage.delete('secure:mipypos.network.pin');
  const current = await f.config.loadNetworkConfig();
  assert.equal(current.hostUrl, '');
  const next = { ...current, hostUrl: 'https://192.168.1.2:8787', hostPin: pin };
  f.config.assertPendingAuthority(current, next, [original.hostUrl], [original.hostPin]);
  await f.client.checkLanHost(next.hostUrl, next.hostPin);
  await pending.rebindPendingOperation(original.hostUrl, next.hostUrl);
  const rebound = await pending.getPendingOperation();
  assert.equal(rebound?.hostPin, pin);
  assert.equal(rebound?.commandId, original.commandId);
  assert.equal(rebound?.fingerprint, original.fingerprint);
  await f.config.saveNetworkConfig(next);
  await f.client.loginToHost(next.hostUrl, 'admin', 'admin-securo-123');
  assert.equal(await pending.getPendingOperation(), null);
  assert.equal(f.calls.filter((call) => call.path === '/v1/operation').length, 1);
  assert.equal(
    (await f.db.listAreas()).filter((area) => area.name === 'Nueva IP segura').length,
    1,
  );
});

void test('venta anclada conserva UUID y stock tras recuperar pin perdido', async () => {
  const f = await lanFixture();
  const productId = await f.db.saveProduct(base, 'admin');
  const sessionId = await f.db.openCashSession(0, 'admin');
  const pending = f.load('@/lib/network/pending-sale');
  const route = f.routes.get('/v1/sale')!;
  f.routes.set('/v1/sale', async (request) => {
    await route(request);
    throw new Error('ACK perdido');
  });
  await assert.rejects(
    pending.createPendingSale(await f.config.loadNetworkConfig(), 'admin', {
      method: 'cash',
      sessionId,
      items: [{ productId, areaId: 1, quantity: 1 }],
      payments: [{ type: 'cash', amount: 100 }],
      settlement: { cashReceived: 100, transferReceipt: null },
    }),
    /ACK perdido/,
  );
  const original = await pending.getPendingSale();
  assert.ok(original);
  assert.equal(original.hostPin, pin);
  f.storage.delete('secure:mipypos.network.pin');
  const current = await f.config.loadNetworkConfig();
  await assert.rejects(pending.sendPendingSale(current, 'admin'), /mismo usuario/);
  const next = { ...current, hostUrl: url, hostPin: pin };
  f.config.assertPendingAuthority(current, next, [original.hostUrl], [original.hostPin]);
  await f.config.saveNetworkConfig(next);
  assert.equal((await pending.getPendingSale())?.command.commandId, original.command.commandId);
  assert.ok(await pending.sendPendingSale(next, 'admin'));
  assert.equal(await pending.getPendingSale(), null);
  assert.equal((await f.db.getProduct(productId))?.stock, 9);
  assert.equal(f.calls.filter((call) => call.path === '/v1/sale').length, 1);
});

void test('extracción anclada conserva identidad y confirma una única salida tras recuperar pin', async () => {
  const f = await lanFixture();
  const sessionId = await f.db.openCashSession(100, 'admin');
  const pending = f.load('@/lib/network/pending-withdrawal');
  const values = {
    authority: url,
    hostPin: pin,
    username: 'admin',
    sessionId,
    amount: 10,
    reason: 'Anticipo autorizado',
  };
  const credentials = { adminUsername: 'admin', adminPassword: 'admin-securo-123' };
  const register = (
    id: number,
    input: import('../lib/models').CashWithdrawalInput,
    username: string,
  ) =>
    f.client.requestHostOperation(
      url,
      'registerCashWithdrawal',
      [id, input, username],
      username,
      'terminal-a',
    );
  f.loseNextResponse();
  await assert.rejects(pending.submitWithdrawal(values, credentials, register), /perdida/);
  const original = await pending.getPendingWithdrawal();
  assert.ok(original);
  assert.equal(original.hostPin, pin);
  f.storage.delete('secure:mipypos.network.pin');
  const current = await f.config.loadNetworkConfig();
  const next = { ...current, hostUrl: url, hostPin: pin };
  f.config.assertPendingAuthority(current, next, [original.authority], [original.hostPin]);
  await f.config.saveNetworkConfig(next);
  await assert.rejects(
    pending.submitWithdrawal({ ...values, hostPin: undefined }, credentials, register),
    /pendiente/,
  );
  assert.equal((await pending.getPendingWithdrawal())?.commandId, original.commandId);
  await pending.submitWithdrawal(values, credentials, register);
  assert.equal(await pending.getPendingWithdrawal(), null);
  assert.equal((await f.db.getCashSummary(sessionId)).withdrawalTotal, 10);
  assert.equal(f.database.exec('SELECT COUNT(*) FROM cash_withdrawals')[0].values[0][0], 1);
});

void test('recuperación exige ancla para todos los pendientes y no la deduce de otro registro', async () => {
  const h = createHarness();
  const config = h.load('@/lib/network/config');
  const current = { mode: 'client' as const, hostUrl: url, clientId: 'terminal-a' };
  const next = { ...current, hostUrl: 'https://192.168.1.2:8787', hostPin: pin };
  assert.doesNotThrow(() =>
    config.assertPendingAuthority(current, next, [url, url, url], [pin, pin, pin]),
  );
  for (const anchors of [
    [pin, undefined],
    [pin, 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='],
    [],
  ])
    assert.throws(
      () => config.assertPendingAuthority(current, next, [url, url], anchors),
      /identidad original/,
    );
  assert.throws(
    () => config.assertPendingAuthority(current, next, [url.replace('https:', 'http:')], [pin]),
    /identidad original/,
  );
  assert.throws(
    () =>
      config.assertPendingAuthority(
        { ...current, hostPin: pin },
        next,
        [url],
        ['BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='],
      ),
    /identidad original/,
  );
});

void test('pin perdido bloquea QR de la misma IP y conserva el UUID pendiente', async () => {
  const f = await lanFixture();
  const p = f.load('@/lib/network/pending-operation');
  const original = await p.prepareOperation({
    hostUrl: url,
    username: 'admin',
    clientId: 'terminal-a',
    operation: 'addArea',
    args: ['Sin reenviar'],
  });
  f.storage.delete('secure:mipypos.network.pin');
  const recovered = await f.config.loadNetworkConfig();
  assert.ok(recovered.recoveryMessage);
  for (const candidate of [pin, 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=']) {
    assert.throws(
      () =>
        f.config.assertPendingAuthority(
          recovered,
          { mode: 'client', hostUrl: url, hostPin: candidate, clientId: 'terminal-a' },
          [original.hostUrl],
        ),
      /identidad original/,
    );
  }
  assert.equal((await p.getPendingOperation())?.commandId, original.commandId);
  assert.equal(
    (await f.db.listAreas()).some((area) => area.name === 'Sin reenviar'),
    false,
  );
});

void test('pendientes aceptan IP nueva solo con pin previo y rechazan autoridad distinta', async () => {
  const h = createHarness();
  const config = h.load('@/lib/network/config');
  const current = { mode: 'client' as const, hostUrl: url, hostPin: pin, clientId: 'terminal-a' };
  const next = { ...current, hostUrl: 'https://192.168.1.2:8787' };
  assert.doesNotThrow(() => config.assertPendingAuthority(current, next, [url]));
  assert.throws(
    () => config.assertPendingAuthority(current, { ...next, hostPin: 'otro-pin' }, [url]),
    /identidad original/,
  );
  assert.throws(
    () => config.assertPendingAuthority(current, next, ['https://192.168.1.3:8787']),
    /administrador original/,
  );
  assert.doesNotThrow(() => config.assertPendingAuthority(current, next, []));
  assert.doesNotThrow(() => config.assertPendingAuthority(current, next, ['local']));
  assert.throws(
    () =>
      config.assertPendingAuthority({ ...current, hostPin: undefined }, current, [
        url.replace('https:', 'http:'),
      ]),
    /identidad original/,
  );
});

void test('logout pendiente termina antes del nuevo login sin borrar su token', async () => {
  let token: string | null = 'sesion-anterior';
  let release!: () => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let logins = 0;
  const h = createHarness({
    '@/lib/network/config': {
      getNetworkToken: async () => token,
      loadNetworkConfig: async () => ({ hostPin: pin }),
      clearNetworkToken: async () => {
        started();
        await barrier;
        token = null;
      },
      saveNetworkToken: async (value: string) => {
        token = value;
      },
    },
    '@/lib/database': { clearNetworkReplicas: async () => undefined },
    '@/lib/network/revocations': {
      flushRevocations: async () => undefined,
      revokeOrDefer: async () => undefined,
    },
    '@/lib/network/pending-operation': { getPendingOperation: async () => null },
    '@/lib/network/tls': {
      pinnedRequest: async () => {
        logins += 1;
        return JSON.stringify({
          ok: true,
          data: {
            token: 'sesion-nueva',
            user: {
              id: 1,
              username: 'admin',
              role: 'admin',
              can_authorize_consumption: 1,
              can_manage_fiscal: 1,
            },
          },
        });
      },
    },
  });
  const client = h.load('@/lib/network/client');
  const leaving = client.logoutFromHost(url, pin);
  await begun;
  const entering = client.loginToHost(url, 'admin', 'clave-de-prueba');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const earlyLogins = logins;
  release();
  await Promise.all([leaving, entering]);
  assert.equal(earlyLogins, 0);
  assert.equal(token, 'sesion-nueva');
});

void test('borrado condicional no elimina un token posterior y serializa escritura', async () => {
  const h = createHarness();
  const config = h.load('@/lib/network/config');
  await config.saveNetworkToken('sesion-anterior');
  const clearing = config.clearNetworkToken('sesion-anterior');
  const saving = config.saveNetworkToken('sesion-nueva');
  assert.equal(await clearing, true);
  await saving;
  assert.equal(await config.clearNetworkToken('sesion-anterior'), false);
  assert.equal(await config.getNetworkToken(), 'sesion-nueva');
});

void test('crear areas exige admin tambien en repositorio local sin impedir movimientos', async () => {
  let role: import('../lib/models').UserRole = 'storekeeper';
  const h = createHarness({
    react: { useMemo: (factory: () => unknown) => factory() },
    '@/lib/app-context': {
      useApp: () => ({
        networkConfig: { mode: 'standalone' },
        user: { username: 'encargado', role },
      }),
    },
  });
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  const hook = h.load('@/lib/use-pos-repository');
  await assert.rejects(hook.usePosRepository().addArea('No autorizada'), /administrador/);
  assert.equal(
    (await db.listAreas()).some((area) => area.name === 'No autorizada'),
    false,
  );
  assert.deepEqual(await hook.usePosRepository().listMovements(), []);
  role = 'admin';
  await hook.usePosRepository().addArea('Autorizada');
  assert.equal(
    (await db.listAreas()).some((area) => area.name === 'Autorizada'),
    true,
  );
});

void test('resultado de operación de tipo prohibido conserva journal y UUID hasta ACK válido', async () => {
  const f = await lanFixture();
  const handler = f.routes.get('/v1/operation');
  assert.ok(handler);
  f.routes.set('/v1/operation', async (request) => {
    await handler(request); // Commit happened; the returned result must still be validated.
    return { ok: true, data: { unexpected: 1 } };
  });
  const pending = f.load('@/lib/network/pending-operation');
  await assert.rejects(
    f.client.requestHostOperation(url, 'addArea', ['ACK inválido'], 'admin', 'terminal-a'),
  );
  const saved = await pending.getPendingOperation();
  assert.ok(saved);
  assert.equal((await f.db.listAreas()).filter((a) => a.name === 'ACK inválido').length, 1);
  f.routes.set('/v1/operation', handler);
  assert.equal(
    await f.client.requestHostOperation(url, 'addArea', ['ACK inválido'], 'admin', 'terminal-a'),
    null,
  );
  assert.equal(await pending.getPendingOperation(), null);
  assert.equal(f.calls.filter((c) => c.path === '/v1/operation').length, 1);
  assert.equal((await f.db.listAreas()).filter((a) => a.name === 'ACK inválido').length, 1);
});

void test('valor de recibo de tipo prohibido no borra journal antes ni después de rechazo', async () => {
  for (const rejectFirst of [false, true]) {
    const f = await lanFixture();
    let lookups = 0;
    f.routes.set('/v1/receipt', async () => ({
      ok: true,
      data: rejectFirst && lookups++ === 0 ? { found: false } : { found: true, value: 123 },
    }));
    f.routes.set('/v1/operation', async () => ({
      ok: false,
      code: 'REJECTED',
      error: 'Rechazada',
    }));
    const pending = f.load('@/lib/network/pending-operation');
    await assert.rejects(
      f.client.requestHostOperation(url, 'addArea', ['Recibo inválido'], 'admin', 'terminal-a'),
    );
    const saved = await pending.getPendingOperation();
    assert.ok(saved);
    await assert.rejects(
      f.client.requestHostOperation(url, 'addArea', ['Recibo inválido'], 'admin', 'terminal-a'),
    );
    assert.equal((await pending.getPendingOperation())?.commandId, saved.commandId);
  }
});

void test('login malformado conserva token, replica y journal previos', async () => {
  const f = await lanFixture();
  const token = await f.config.getNetworkToken();
  await f.client.getHostSnapshot(url);
  const previousReplica = await (
    await f.db.getDatabase()
  ).getAllAsync('SELECT * FROM network_replica');
  const pending = f.load('@/lib/network/pending-operation');
  const saved = await pending.prepareOperation({
    hostUrl: url,
    hostPin: pin,
    username: 'admin',
    clientId: 'terminal-a',
    operation: 'addArea',
    args: ['Login inválido'],
  });
  for (const user of [
    { username: 'admin', role: 'admin' },
    { id: 1, username: 'admin', role: 'root', can_authorize_consumption: 1 },
  ]) {
    f.routes.set('/v1/login', async () => ({ ok: true, data: { token: 'no-guardar', user } }));
    await assert.rejects(f.client.loginToHost(url, 'admin', 'clave'));
    assert.equal(await f.config.getNetworkToken(), token);
    assert.equal((await pending.getPendingOperation())?.commandId, saved.commandId);
    assert.deepEqual(
      await (await f.db.getDatabase()).getAllAsync('SELECT * FROM network_replica'),
      previousReplica,
    );
  }
});

void test('transport 500 y readerror conservan journal de operación y venta', async () => {
  for (const message of ['HTTP 500', 'readerror']) {
    for (const failPath of ['/v1/receipt', '/v1/operation', '/v1/sale-receipt', '/v1/sale']) {
      const h = createHarness({
        '@/lib/network/tls': {
          pinnedRequest: async (_url: string, path: string) => {
            if (path === failPath) throw new Error(message);
            return JSON.stringify({
              ok: true,
              data: path === '/v1/receipt' ? { found: false } : { saleId: null },
            });
          },
        },
      });
      const config = h.load('@/lib/network/config');
      await config.saveNetworkToken('token-previo');
      const network = { mode: 'client' as const, hostUrl: url, clientId: 'terminal-a' };
      if (failPath.startsWith('/v1/sale')) {
        const pending = h.load('@/lib/network/pending-sale');
        await assert.rejects(
          pending.createPendingSale(network, 'admin', {
            method: 'cash',
            sessionId: 1,
            items: [{ productId: 1, areaId: 1, quantity: 1 }],
            payments: [{ type: 'cash', amount: 100 }],
          }),
          { message },
        );
        const saved = await pending.getPendingSale();
        assert.ok(saved);
        await assert.rejects(pending.sendPendingSale(network, 'admin'), { message });
        assert.equal((await pending.getPendingSale())?.command.commandId, saved.command.commandId);
      } else {
        const client = h.load('@/lib/network/client');
        const pending = h.load('@/lib/network/pending-operation');
        await assert.rejects(
          client.requestHostOperation(
            url,
            'addArea',
            ['Transport incierto'],
            'admin',
            'terminal-a',
          ),
          { message },
        );
        const saved = await pending.getPendingOperation();
        assert.ok(saved);
        await assert.rejects(
          client.requestHostOperation(
            url,
            'addArea',
            ['Transport incierto'],
            'admin',
            'terminal-a',
          ),
          { message },
        );
        assert.equal((await pending.getPendingOperation())?.commandId, saved.commandId);
      }
      assert.equal(await config.getNetworkToken(), 'token-previo');
    }
  }
});

void test('missing saleId en recibo o respuesta conserva el mismo journal al reintentar', async () => {
  for (const malformedPath of ['/v1/sale-receipt', '/v1/sale']) {
    const h = createHarness({
      '@/lib/network/tls': {
        pinnedRequest: async (_url: string, path: string) =>
          JSON.stringify({ ok: true, data: path === malformedPath ? {} : { saleId: null } }),
      },
    });
    const config = h.load('@/lib/network/config');
    await config.saveNetworkToken('token-valid');
    const pending = h.load('@/lib/network/pending-sale');
    const network = { mode: 'client' as const, hostUrl: url, clientId: 'terminal-a' };
    await assert.rejects(
      pending.createPendingSale(network, 'admin', {
        method: 'cash',
        sessionId: 1,
        items: [{ productId: 1, areaId: 1, quantity: 1 }],
        payments: [{ type: 'cash', amount: 100 }],
      }),
      /confirmar/,
    );
    const saved = await pending.getPendingSale();
    assert.ok(saved);
    await assert.rejects(pending.sendPendingSale(network, 'admin'), /confirmar/);
    assert.equal((await pending.getPendingSale())?.command.commandId, saved.command.commandId);
  }
});
