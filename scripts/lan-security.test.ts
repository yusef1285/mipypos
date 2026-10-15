import assert from 'node:assert/strict';
import { before, after, test as nodeTest } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
let passed = 0;
let failed = 0;
function test(name: string, action: () => void | Promise<void>) {
  return nodeTest(name, async () => {
    try {
      await action();
      passed += 1;
    } catch (error) {
      failed += 1;
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
      { ranAt: new Date().toISOString(), tests: passed + failed, passed, failed },
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
  assert.equal(await f.db.addArea('Mostrador', command('addArea')), null);
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
      pinnedRequest: async (_url: string, path: string, body: Record<string, unknown> = {}) => {
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
      error.code === 'REJECTED' &&
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
void test('tokens antiguos se eliminan y nunca se migran a una sesión autenticada', async () => {
  const h = createHarness();
  h.storage.set('mipypos.network.token', 'copiado');
  const config = h.load('@/lib/network/config');
  assert.equal(await config.getNetworkToken(), null);
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
    /obligatorio/,
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
  server.post<{ value: string }>('/v1/test', async (request) => ({
    ok: true,
    data: request.data.value,
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
