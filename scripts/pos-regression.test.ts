import assert from 'node:assert/strict';
import { after, before as beforeAll, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { XML } from 'expo/config-plugins';
import {
  androidLegacyBackupRules,
  androidDataExtractionRules,
  applyAndroidPrivateBackupPolicy,
} from '../lib/android-backup-policy';
import appConfig from '../app.config';
let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];
function regression(name: string, action: () => void | Promise<void>) {
  return test(name, async () => {
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
    join(directory, 'pos-regression-results.json'),
    JSON.stringify(
      { ranAt: new Date().toISOString(), tests: passed + failed, passed, failed, failures },
      null,
      2,
    ),
  );
});
import { createHarness, prepareHarness } from './pos-test-harness';
beforeAll(prepareHarness);
import type { Database } from 'sql.js';
import type { CartItem, CashClosureInput, Producto, TransferReceipt } from '../lib/models';
import {
  receiptAmount,
  receiptDetails,
  receiptPaymentAmounts,
  validateSettlement,
} from '../lib/settlement';

const pay = (amount: number) => [{ type: 'transfer' as const, amount }];

async function fixture(overrides: Record<string, unknown> = {}) {
  const harness = createHarness(overrides);
  const db = harness.load('@/lib/database');
  await db.initializeDatabase();
  const base = {
    name: 'Arroz de grano largo',
    category: 'Alimentos',
    subcategory: '',
    unit: 'kg',
    quantity_decimals: 3,
    stock: 10,
    price_cash: 100,
    price_transfer: 100,
    image_path: null,
  };
  const id = await db.saveProduct(base, 'admin');
  const product = await db.getProduct(id);
  assert.ok(product);
  const main = (await db.listAreas())[0];
  assert.ok(main);
  await db.addArea('Mostrador');
  const target = (await db.listAreas()).find((area) => area.name === 'Mostrador');
  assert.ok(target);
  const sessionId = await db.openCashSession(0, 'admin');
  const cart = (quantity: number, areaId?: number, p?: Producto): CartItem[] => {
    const selectedProduct = p ?? product;
    return [
      {
        product: selectedProduct,
        price: selectedProduct.price_cash,
        quantity,
        areaId: areaId ?? main.id,
      },
    ];
  };
  const closure = async (): Promise<CashClosureInput> => {
    const preview = await db.getCashClosurePreview(sessionId);
    return {
      denominations: [],
      withdrawalCount: preview.withdrawalTotal,
      transferCount: preview.transferSales,
      products: preview.products.map((p) => ({
        productId: p.productId,
        physicalStock: p.expectedStock,
      })),
      adminUsername: 'admin',
      adminPassword: 'admin123',
    };
  };
  return { ...harness, db, product, main, target, sessionId, cart, pay, closure };
}

// Recreate the actual pre-v9 schema in downgrade fixtures, not just its version.
function stripRecoveryJournal(database: Database) {
  const rows =
    database.exec(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'recovery_%'",
    )[0]?.values ?? [];
  for (const [name] of rows) database.run(`DROP TRIGGER "${String(name).replaceAll('"', '""')}"`);
  database.run('DROP TABLE recovery_journal; DROP TABLE recovery_lineage;');
}

void regression('migración conserva datos existentes y se puede repetir', async () => {
  const h = createHarness();
  h.database.run(
    "CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT UNIQUE,category TEXT,subcategory TEXT,stock REAL,price_cash REAL,price_transfer REAL,image_path TEXT); INSERT INTO products VALUES(1,'Producto existente','A','B',7,20,25,NULL);",
  );
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  await db.initializeDatabase();
  assert.equal((await db.getProduct(1))?.stock, 7);
  assert.equal((await db.getProduct(1))?.unit, 'u');
  assert.equal((await db.listAreaStock())[0]?.quantity, 7);
  assert.equal((await db.listUsers()).length, 1);
});
void regression(
  'venta de 1.003 kg descuenta exactamente el área elegida y conserva unidad',
  async () => {
    const f = await fixture();
    await f.db.registerMovement({
      type: 'traslado',
      productId: f.product.id,
      quantity: 3,
      fromArea: f.main.name,
      toArea: f.target.name,
      username: 'admin',
    });
    const id = await f.db.registerSale(
      f.cart(1.003, f.target.id),
      'transfer',
      f.pay(100.3),
      'admin',
      undefined,
      f.sessionId,
    );
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 8.997);
    const balances = await f.db.listAreaStock();
    assert.equal(balances.find((s) => s.area_id === f.main.id)?.quantity, 7);
    assert.equal(balances.find((s) => s.area_id === f.target.id)?.quantity, 1.997);
    assert.equal((await f.db.getSale(id))?.lines[0]?.unit, 'kg');
    assert.equal((await f.db.getSale(id))?.lines[0]?.area_id, f.target.id);
  },
);
void regression('área nueva inicia vacía y traslado conserva total', async () => {
  const f = await fixture();
  assert.equal(
    (await f.db.listAreaStock()).some((s) => s.area_id === f.target.id),
    false,
  );
  await f.db.registerMovement({
    type: 'traslado',
    productId: f.product.id,
    quantity: 2.323,
    fromArea: f.main.name,
    toArea: f.target.name,
    username: 'admin',
  });
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 10);
  assert.equal(
    (await f.db.listAreaStock()).find((s) => s.area_id === f.target.id)?.quantity,
    2.323,
  );
});
void regression('stock global no permite vender desde un área sin existencias', async () => {
  const f = await fixture();
  await assert.rejects(
    f.db.registerSale(f.cart(1, f.target.id), 'transfer', f.pay(100), 'admin'),
    /área/,
  );
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 10);
  assert.equal((await f.db.getHomeSummary()).salesCount, 0);
});
void regression('traslado insuficiente revierte todas sus escrituras', async () => {
  const f = await fixture();
  await assert.rejects(
    f.db.registerMovement({
      type: 'traslado',
      productId: f.product.id,
      quantity: 11,
      fromArea: f.main.name,
      toArea: f.target.name,
      username: 'admin',
    }),
    /insuficiente/,
  );
  assert.equal((await f.db.listAreaStock()).find((s) => s.area_id === f.main.id)?.quantity, 10);
  assert.equal((await f.db.listMovements()).length, 1);
});
void regression(
  'unidades enteras rechazan fracciones y peso rechaza más de tres decimales',
  async () => {
    const f = await fixture();
    const id = await f.db.saveProduct(
      { ...f.product, id: undefined, name: 'Caja de vasos', unit: 'caja', quantity_decimals: 0 },
      'admin',
    );
    const p = await f.db.getProduct(id);
    assert.ok(p);
    await assert.rejects(
      f.db.registerSale(f.cart(1.003, f.main.id, p), 'transfer', f.pay(100.3), 'admin'),
      /enteras/,
    );
    await assert.rejects(
      f.db.registerSale(f.cart(1.0001), 'transfer', f.pay(100.01), 'admin'),
      /3 decimales/,
    );
  },
);
void regression('dos ventas simultáneas no venden más que el stock disponible', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([
    f.db.registerSale(f.cart(6), 'transfer', f.pay(600), 'admin'),
    f.db.registerSale(f.cart(6), 'transfer', f.pay(600), 'admin'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 4);
  assert.equal((await f.db.getHomeSummary()).salesCount, 1);
});
void regression('repetir el mismo comando devuelve la venta sin otro descuento', async () => {
  const f = await fixture();
  const command = { commandId: 'same-command', clientId: 'terminal-a' };
  const ids = await Promise.all([
    f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin', command),
    f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin', command),
  ]);
  assert.equal(ids[0], ids[1]);
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 9);
  assert.equal(await f.db.findNetworkSale(command.commandId, command.clientId, 'admin'), ids[0]);
});
void regression('carrito de otra sesión no se cobra en la caja nueva', async () => {
  const f = await fixture();
  await f.db.closeCashSession(f.sessionId, await f.closure());
  await f.db.openCashSession(0, 'admin');
  await assert.rejects(
    f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin', undefined, f.sessionId),
    /caja cambió/,
  );
  assert.equal((await f.db.getHomeSummary()).salesCount, 0);
});
void regression('cierre incluye solo productos vendidos y cuenta todas las áreas', async () => {
  const f = await fixture();
  await f.db.saveProduct({ ...f.product, id: undefined, name: 'Sin ventas' }, 'admin');
  await f.db.registerMovement({
    type: 'traslado',
    productId: f.product.id,
    quantity: 2,
    fromArea: f.main.name,
    toArea: f.target.name,
    username: 'admin',
  });
  await f.db.registerSale(f.cart(1.003), 'transfer', f.pay(100.3), 'admin');
  const preview = await f.db.getCashClosurePreview(f.sessionId);
  assert.equal(preview.products.length, 1);
  assert.equal(preview.products[0]?.expectedStock, 8.997);
  await f.db.closeCashSession(f.sessionId, await f.closure());
  assert.equal(await f.db.getOpenSession(), null);
});
void regression('una venta durante el conteo impide cerrar con un conteo obsoleto', async () => {
  const f = await fixture();
  await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin');
  const input = await f.closure();
  await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin');
  await assert.rejects(f.db.closeCashSession(f.sessionId, input), /coincidir/);
  assert.ok(await f.db.getOpenSession());
});
void regression('cierre sin ventas no exige contar inventario intacto', async () => {
  const f = await fixture();
  assert.equal((await f.db.getCashClosurePreview(f.sessionId)).products.length, 0);
  await f.db.closeCashSession(f.sessionId, await f.closure());
  assert.equal(await f.db.getOpenSession(), null);
});
void regression('apertura y auditoría son atómicas', async () => {
  const h = createHarness();
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  h.failWritesContaining('INSERT INTO audit_log');
  await assert.rejects(db.openCashSession(0, 'admin'), /Injected/);
  assert.equal(await db.getOpenSession(), null);
});
void regression('importación inválida revierte todos los productos del lote', async () => {
  const f = await fixture();
  await assert.rejects(
    f.db.importProducts(
      [
        { name: 'Nuevo', stock: 1 },
        { name: 'Error', stock: -1 },
      ],
      'admin',
    ),
    /inválidos/,
  );
  assert.equal((await f.db.listProducts()).length, 1);
});
void regression('reportes y exportaciones conservan unidades de ventas fraccionarias', async () => {
  const f = await fixture();
  await f.db.registerSale(f.cart(2.323), 'transfer', f.pay(232.3), 'admin');
  assert.equal((await f.db.getDailyReport()).byProduct[0]?.unit, 'kg');
  assert.equal((await f.db.getExportRows('sold'))[0]?.quantity, 2.323);
  assert.equal((await f.db.getExportRows('sold'))[0]?.unit, 'kg');
});
void regression('dos degradaciones concurrentes conservan al menos un administrador', async () => {
  const f = await fixture();
  const second = await f.db.saveUser({ username: 'auditor', password: 'audit123', role: 'admin' });
  const first = (await f.db.listUsers()).find((u) => u.username === 'admin');
  assert.ok(first);
  const results = await Promise.allSettled([
    f.db.saveUser({ id: first.id, username: 'admin', role: 'seller' }),
    f.db.saveUser({ id: second, username: 'auditor', role: 'seller' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal((await f.db.listUsers()).filter((u) => u.role === 'admin').length, 1);
});
void regression(
  'cursor de apertura distingue entradas anteriores y posteriores con la misma fecha',
  async () => {
    const f = await fixture();
    await f.db.registerMovement({
      type: 'entrada',
      productId: f.product.id,
      quantity: 2,
      toArea: f.main.name,
      username: 'admin',
    });
    f.database.run('UPDATE movements SET date=(SELECT open_date FROM cash_sessions WHERE id=1)');
    await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin');
    const preview = await f.db.getCashClosurePreview(f.sessionId);
    assert.equal(preview.products[0]?.entries, 2);
    assert.equal(preview.products[0]?.expectedStock, 11);
  },
);
void regression('cierre en efectivo con centavos incluye billetes y monedas contadas', async () => {
  const f = await fixture();
  await f.db.registerSale(f.cart(1.003), 'cash', [{ type: 'cash', amount: 100.3 }], 'admin');
  const input = await f.closure();
  await f.db.closeCashSession(f.sessionId, {
    ...input,
    denominations: [{ denomination: 100, quantity: 1 }],
    coinsCount: 0.3,
  });
  assert.equal(await f.db.getOpenSession(), null);
});
const securePin = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
void regression('QR acepta solo TLS con identidad y direcciones LAN privadas', () => {
  const h = createHarness();
  const qr = h.load('@/lib/network/qr');
  assert.equal(
    qr.parseLanQr(qr.createLanQr('https://192.168.43.1:8787', undefined, securePin)),
    'https://192.168.43.1:8787',
  );
  for (const url of [
    'https://8.8.8.8:8787',
    'http://192.168.1.1:8787',
    'https://192.168.1.1:80',
    'https://user:pass@192.168.1.1:8787',
    'https://192.168.1.1:8787/sale',
  ])
    assert.throws(() => qr.createLanQr(url, undefined, securePin));
  assert.throws(() => qr.createLanQr('https://192.168.1.1:8787'));
  for (const version of [2, 3])
    assert.throws(
      () =>
        qr.parseLanQr(
          JSON.stringify({ app: 'MipyPOS', version, hostUrl: 'http://192.168.1.1:8787' }),
        ),
      /compatible/,
    );
  assert.throws(() =>
    qr.parseLanQr('{"app":"Otra","version":4,"hostUrl":"https://192.168.1.1:8787"}'),
  );
});
void regression('permisos LAN impiden al vendedor consultar el reporte completo', () => {
  const h = createHarness();
  const ops = h.load('@/lib/network/operations');
  const permissions = h.load('@/lib/permissions');
  assert.equal(permissions.canAccess('seller', ops.operationPermissions.getDailyReport), false);
  assert.equal(permissions.canAccess('seller', ops.operationPermissions.getHomeSummary), true);
});
void regression('venta pendiente conserva UUID tras timeout y reanudación', async () => {
  class HostRejection extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  const commands: string[] = [];
  let calls = 0;
  const h = createHarness({
    '@/lib/network/client': {
      HostRejection,
      registerHostSale: async (_host: string, command: { commandId: string }) => {
        commands.push(command.commandId);
        if (!calls++) throw new Error('timeout');
        return 23;
      },
    },
  });
  const pending = h.load('@/lib/network/pending-sale');
  const config = {
    mode: 'client' as const,
    hostUrl: 'http://192.168.43.1:8787',
    clientId: 'terminal-a',
  };
  await assert.rejects(
    pending.createPendingSale(config, 'admin', {
      method: 'transfer',
      sessionId: 1,
      payments: [{ type: 'transfer', amount: 100 }],
      items: [{ productId: 1, areaId: 1, quantity: 1 }],
    }),
    /timeout/,
  );
  assert.ok(await pending.getPendingSale());
  await assert.rejects(pending.sendPendingSale(config, 'otro'), /mismo usuario/);
  assert.equal(await pending.sendPendingSale(config, 'admin'), 23);
  assert.equal(commands[0], commands[1]);
  assert.equal(await pending.getPendingSale(), null);
});

const adminCredentials = { adminUsername: 'admin', adminPassword: 'admin123' };
const withdrawalInput = (amount: number, commandId = 'withdrawal-a') => ({
  ...adminCredentials,
  commandId,
  amount,
  reason: 'Entrega a propietario',
});
void regression(
  'nuevas ventas rechazan tarjeta individual y en mixto sin consumir cuota',
  async () => {
    const f = await fixture();
    await assert.rejects(
      Reflect.apply(f.db.registerSale, undefined, [
        f.cart(1),
        'card',
        [{ type: 'card', amount: 100 }],
        'admin',
      ]),
      /métodos/,
    );
    await assert.rejects(
      Reflect.apply(f.db.registerSale, undefined, [
        f.cart(1),
        'mixed',
        [
          { type: 'cash', amount: 50 },
          { type: 'card', amount: 50 },
        ],
        'admin',
      ]),
      /métodos/,
    );
    assert.equal((await f.db.getDemoUsage()).sales, 0);
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 10);
    await f.db.registerSale(
      f.cart(1),
      'mixed',
      [
        { type: 'cash', amount: 40 },
        { type: 'transfer', amount: 60 },
      ],
      'admin',
    );
    assert.equal((await f.db.getCashSummary(f.sessionId)).cashSales, 40);
  },
);
void regression(
  'extracción autorizada rebaja efectivo y reintento no duplica el retiro',
  async () => {
    const f = await fixture();
    await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
    const ids = await Promise.all([
      f.db.registerCashWithdrawal(f.sessionId, withdrawalInput(30), 'admin'),
      f.db.registerCashWithdrawal(f.sessionId, withdrawalInput(30), 'admin'),
    ]);
    assert.equal(ids[0], ids[1]);
    assert.equal((await f.db.getCashSummary(f.sessionId)).expectedCash, 70);
    const preview = await f.db.getCashClosurePreview(f.sessionId);
    assert.equal(preview.withdrawals.length, 1);
    assert.equal(preview.withdrawals[0]?.authorized_by, 'admin');
    await f.db.closeCashSession(f.sessionId, {
      ...(await f.closure()),
      denominations: [
        { denomination: 50, quantity: 1 },
        { denomination: 20, quantity: 1 },
      ],
    });
    assert.equal((await f.db.listCashClosures()).length, 1);
  },
);
void regression('extracción exige administrador, motivo y efectivo suficiente', async () => {
  const f = await fixture();
  await f.db.saveUser({ username: 'vendedor', password: 'vende123', role: 'seller' });
  await assert.rejects(
    f.db.registerCashWithdrawal(
      f.sessionId,
      { ...withdrawalInput(10), adminUsername: 'vendedor', adminPassword: 'vende123' },
      'admin',
    ),
    /credenciales/,
  );
  await assert.rejects(
    f.db.registerCashWithdrawal(f.sessionId, withdrawalInput(10), 'admin'),
    /supera/,
  );
  await assert.rejects(
    f.db.registerCashWithdrawal(f.sessionId, { ...withdrawalInput(10), reason: '' }, 'admin'),
    /motivo/,
  );
  assert.equal((await f.db.getCashClosurePreview(f.sessionId)).withdrawals.length, 0);
});
void regression('extracciones concurrentes no retiran más que el efectivo disponible', async () => {
  const f = await fixture();
  await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
  const results = await Promise.allSettled([
    f.db.registerCashWithdrawal(f.sessionId, withdrawalInput(80, 'a'), 'admin'),
    f.db.registerCashWithdrawal(f.sessionId, withdrawalInput(80, 'b'), 'admin'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await f.db.getCashSummary(f.sessionId)).expectedCash, 20);
});
void regression('fallo de auditoría revierte la extracción', async () => {
  const f = await fixture();
  await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
  f.failWritesContaining('INSERT INTO audit_log');
  await assert.rejects(
    f.db.registerCashWithdrawal(f.sessionId, withdrawalInput(20), 'admin'),
    /Injected/,
  );
  assert.equal((await f.db.getCashSummary(f.sessionId)).expectedCash, 100);
});
void regression(
  'diferencias de extracciones no reemplazan retiros reales y requieren aprobación',
  async () => {
    const f = await fixture();
    const input = { ...(await f.closure()), withdrawalCount: 500 };
    await assert.rejects(f.db.closeCashSession(f.sessionId, input), /autorización/);
    const approval = await f.db.authorizeCashDifference(f.sessionId, {
      ...adminCredentials,
      kind: 'withdrawals',
      counted: 500,
      reason: 'Comprobantes de otro turno incluidos por error',
    });
    await f.db.closeCashSession(f.sessionId, { ...input, approvalIds: [approval.id] });
    const detail = z
      .object({
        withdrawalTotal: z.number(),
        withdrawalDifference: z.number(),
        approvals: z.array(z.object({ reason: z.string() })),
      })
      .parse(JSON.parse((await f.db.listCashClosures())[0].detail));
    assert.equal(detail.withdrawalTotal, 0);
    assert.equal(detail.withdrawalDifference, 500);
    assert.equal(detail.approvals[0]?.reason, 'Comprobantes de otro turno incluidos por error');
  },
);
void regression(
  'cierre admite diferencias monetarias e inventario autorizadas sin alterar stock',
  async () => {
    const f = await fixture();
    await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin');
    const input = await f.closure();
    input.transferCount = 90;
    input.products[0].physicalStock = 8;
    const money = await f.db.authorizeCashDifference(f.sessionId, {
      ...adminCredentials,
      kind: 'money',
      counted: 0,
      transferCount: 90,
      reason: 'Transferencia pendiente de acreditar',
    });
    const inventory = await f.db.authorizeCashDifference(f.sessionId, {
      ...adminCredentials,
      kind: 'inventory',
      productId: f.product.id,
      counted: 8,
      reason: 'Merma pendiente de ajuste',
    });
    await f.db.closeCashSession(f.sessionId, { ...input, approvalIds: [money.id, inventory.id] });
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 9);
    const detail = z
      .object({ approvals: z.array(z.unknown()) })
      .parse(JSON.parse((await f.db.listCashClosures())[0].detail));
    assert.equal(detail.approvals.length, 2);
  },
);
void regression('autorización no sirve para conteos editados ni nuevas ventas', async () => {
  const f = await fixture();
  await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin');
  const approval = await f.db.authorizeCashDifference(f.sessionId, {
    ...adminCredentials,
    kind: 'money',
    counted: 0,
    transferCount: 90,
    reason: 'Pendiente',
  });
  await assert.rejects(
    f.db.closeCashSession(f.sessionId, {
      ...(await f.closure()),
      transferCount: 80,
      approvalIds: [approval.id],
    }),
    /autorización/,
  );
  await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin');
  await assert.rejects(
    f.db.closeCashSession(f.sessionId, {
      ...(await f.closure()),
      transferCount: 90,
      approvalIds: [approval.id],
    }),
    /autorización/,
  );
});
void regression(
  'demo permite cinco ventas acumuladas, no seis; reintento conserva cuota',
  async () => {
    const f = await fixture();
    for (let index = 0; index < 5; index += 1)
      await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin', {
        commandId: `sale-${index}`,
        clientId: 'a',
      });
    assert.equal((await f.db.getDemoUsage()).sales, 5);
    await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin', {
      commandId: 'sale-4',
      clientId: 'a',
    });
    await assert.rejects(f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin'), /5 ventas/);
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 5);
    await f.db.closeCashSession(f.sessionId, await f.closure());
    await f.db.openCashSession(0, 'admin');
    await assert.rejects(f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin'), /5 ventas/);
    await f.db.setSetting('license_mode', 'pro');
    await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin');
  },
);
void regression(
  'demo conserva cuota de altas al borrar y permite actualizar productos',
  async () => {
    const f = await fixture();
    for (let index = 0; index < 4; index += 1) {
      const id = await f.db.saveProduct(
        { ...f.product, id: undefined, name: `Temporal ${index}`, stock: 0 },
        'admin',
      );
      await f.db.deleteProduct(id);
    }
    assert.equal((await f.db.getDemoUsage()).products, 5);
    await assert.rejects(
      f.db.saveProduct({ ...f.product, id: undefined, name: 'Sexto' }, 'admin'),
      /5 productos/,
    );
    await f.db.saveProduct({ ...f.product, name: 'Arroz actualizado' }, 'admin');
    await f.db.initializeDatabase();
    assert.equal((await f.db.getDemoUsage()).products, 5);
  },
);
void regression('importación sobre cuota revierte lote y contador completo', async () => {
  const f = await fixture();
  await assert.rejects(
    f.db.importProducts(
      Array.from({ length: 5 }, (_, i) => ({ name: `Importado ${i}`, stock: 0 })),
      'admin',
    ),
    /5 productos/,
  );
  assert.equal((await f.db.listProducts()).length, 1);
  assert.equal((await f.db.getDemoUsage()).products, 1);
  await f.db.importProducts([{ name: 'Importado', stock: 0 }], 'admin');
  assert.equal((await f.db.getDemoUsage()).products, 2);
});
void regression('ventas concurrentes respetan la última plaza demo', async () => {
  const f = await fixture();
  for (let i = 0; i < 4; i += 1)
    await f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin');
  const results = await Promise.allSettled([
    f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin'),
    f.db.registerSale(f.cart(1), 'transfer', f.pay(100), 'admin'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await f.db.getDemoUsage()).sales, 5);
});
void regression('QR seguro de hotspot conserva credenciales y rechaza versiones anteriores', () => {
  const qr = createHarness().load('@/lib/network/qr');
  const wifi = { ssid: 'MipyPOS-local', password: 'redlocal123' };
  assert.deepEqual(
    qr.parseLanConnection(qr.createLanQr('https://192.168.43.1:8787', wifi, securePin)),
    {
      hostUrl: 'https://192.168.43.1:8787',
      hostPin: securePin,
      wifi,
    },
  );
  assert.throws(
    () =>
      qr.parseLanConnection(
        JSON.stringify({
          app: 'MipyPOS',
          version: 4,
          hostUrl: 'https://192.168.43.1:8787',
          hostPin: securePin,
          wifi: { ssid: 'red', password: '123' },
        }),
      ),
    /credenciales/,
  );
});
void regression(
  'extracción pendiente sobrevive timeout y se reintenta con mismo UUID',
  async () => {
    class HostRejection extends Error {
      constructor(public code: string) {
        super(code);
      }
    }
    const h = createHarness({ '@/lib/network/client': { HostRejection } });
    const pending = h.load('@/lib/network/pending-withdrawal');
    const ids: string[] = [];
    const register = async (_session: number, input: { commandId: string }) => {
      ids.push(input.commandId);
      if (ids.length === 1) throw new Error('timeout');
      return 3;
    };
    const values = {
      authority: 'http://192.168.43.1:8787',
      username: 'admin',
      sessionId: 1,
      amount: 50,
      reason: 'Entrega',
    };
    await assert.rejects(pending.submitWithdrawal(values, adminCredentials, register), /timeout/);
    assert.ok(await pending.getPendingWithdrawal());
    await assert.rejects(
      pending.submitWithdrawal({ ...values, username: 'otro' }, adminCredentials, register),
      /mismo usuario/,
    );
    assert.equal(await pending.submitWithdrawal(values, adminCredentials, register), 3);
    assert.equal(ids[0], ids[1]);
    assert.equal(await pending.getPendingWithdrawal(), null);
  },
);
void regression('pagos y transferencias rechazan fracciones inferiores al centavo', async () => {
  const f = await fixture();
  await assert.rejects(
    f.db.registerSale(
      f.cart(1),
      'mixed',
      [
        { type: 'cash', amount: 49.997 },
        { type: 'transfer', amount: 50.003 },
      ],
      'admin',
    ),
    /pagos/,
  );
  await assert.rejects(
    f.db.closeCashSession(f.sessionId, { ...(await f.closure()), transferCount: 0.003 }),
    /transferencias/,
  );
});
void regression(
  'autorización de inventario respeta precisión configurada de unidades personalizadas',
  async () => {
    const f = await fixture();
    await f.db.saveProduct({ ...f.product, unit: 'medida', quantity_decimals: 3 }, 'admin');
    const product = await f.db.getProduct(f.product.id);
    assert.ok(product);
    await f.db.registerSale(f.cart(1, undefined, product), 'transfer', f.pay(100), 'admin');
    const approval = await f.db.authorizeCashDifference(f.sessionId, {
      ...adminCredentials,
      kind: 'inventory',
      productId: product.id,
      counted: 8.997,
      reason: 'Variación de medida',
    });
    const input = await f.closure();
    const count = input.products[0];
    assert.ok(count);
    count.physicalStock = 8.997;
    await f.db.closeCashSession(f.sessionId, { ...input, approvalIds: [approval.id] });
  },
);

const sampleReceipt = (amount = 100, reference = 'OPERACION-123'): TransferReceipt => ({
  ci: '90010112345',
  fullName: 'Cliente de prueba',
  address: 'Dirección de prueba',
  amount,
  rawText: `Monto: ${amount} CUP`,
  reference,
  receiptDate: '14/10/2026',
  imageBase64: '/9j/AA==',
  reviewed: true,
});
void regression('efectivo recibido calcula vuelto y no infla el efectivo de caja', async () => {
  const f = await fixture();
  const id = await f.db.registerSale(
    f.cart(1),
    'cash',
    [{ type: 'cash', amount: 100 }],
    'admin',
    undefined,
    f.sessionId,
    { cashReceived: 150, transferReceipt: null },
  );
  const data = await f.db.getSale(id);
  assert.equal(data?.sale.settlement?.changeDue, 50);
  assert.equal((await f.db.getCashClosurePreview(f.sessionId)).cashSales, 100);
  assert.equal((await f.db.getExportRows('sales'))[0].cash_received, 150);
});
void regression(
  'efectivo insuficiente, ausente o con precisión inválida no consume stock ni cuota',
  async () => {
    const f = await fixture();
    for (const cashReceived of [null, 99, 100.001, NaN])
      await assert.rejects(
        f.db.registerSale(
          f.cart(1),
          'cash',
          [{ type: 'cash', amount: 100 }],
          'admin',
          undefined,
          f.sessionId,
          { cashReceived, transferReceipt: null },
        ),
        /efectivo recibido/,
      );
    assert.equal((await f.db.getDemoUsage()).sales, 0);
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 10);
  },
);
void regression('mixto calcula vuelto solo sobre efectivo y conserva comprobante', async () => {
  const f = await fixture();
  const receipt = sampleReceipt(60);
  const id = await f.db.registerSale(
    f.cart(1),
    'mixed',
    [
      { type: 'cash', amount: 40 },
      { type: 'transfer', amount: 60 },
    ],
    'admin',
    undefined,
    f.sessionId,
    { cashReceived: 50, transferReceipt: receipt },
  );
  const sale = await f.db.getSale(id);
  assert.equal(sale?.sale.settlement?.changeDue, 10);
  assert.deepEqual(sale?.sale.settlement?.transferReceipt, receipt);
});
void regression(
  'transferencia permite datos personales vacíos y exige revisión, foto e importe exacto',
  () => {
    for (const change of [
      { ci: '123' },
      { fullName: 'X'.repeat(241) },
      { address: 'X'.repeat(241) },
      { reviewed: false },
      { imageBase64: '' },
      { amount: 101 },
    ])
      assert.throws(() =>
        validateSettlement(pay(100), {
          cashReceived: null,
          transferReceipt: { ...sampleReceipt(), ...change },
        }),
      );
    assert.equal(
      validateSettlement(pay(100), { cashReceived: null, transferReceipt: sampleReceipt() })
        ?.changeDue,
      0,
    );
  },
);
void regression(
  'lectura del importe ignora saldo y teléfonos, soporta separadores y exige monto único',
  () => {
    assert.equal(receiptAmount('Monto: 1.250,50 CUP\nSaldo: 5000\nTeléfono: 55551234'), 1250.5);
    assert.equal(receiptAmount('Transferencia de 1,250.50 CUP'), 1250.5);
    assert.equal(receiptAmount('Monto: 100 CUP\nImporte: 200 CUP'), null);
    assert.equal(receiptAmount('Saldo: 1000\nTarjeta: 1234567890'), null);
  },
);
// Text transcribed from the supplied photos; these tests do not run native OCR.
const metropolitanReceipt = (second = false) => `Banco Metropolitano: La
Transferencia fue
completada.
Fecha: 13/10/2026
Beneficiario:
${second ? '9238XXXXXXXX2816' : '9227XXXXXXXX2365'}
Ordenante: CUP
Monto: ${second ? '3230.00' : '1500.00'} CUP
Nro. Transacción:
${second ? 'MM6058MEY3987' : 'MM6058OQ6W987'}${second ? '' : '\nSaldo restante: CR 2184.19\nCUP'}`;

void regression('comprobante de fotos 1 y 3 extrae monto, cuenta, fecha y saldo separado', () => {
  assert.deepEqual(receiptDetails(metropolitanReceipt()), {
    amount: 1500,
    reference: 'MM6058OQ6W987',
    receiptDate: '13/10/2026',
    bank: 'Banco Metropolitano',
    beneficiary: '9227XXXXXXXX2365',
    orderer: 'CUP',
    currency: 'CUP',
    remainingBalance: 'CR 2184.19 CUP',
    status: 'completada',
  });
});
void regression('comprobante de foto 2 extrae 3230 y no inventa saldo ni identidad', () => {
  const details = receiptDetails(metropolitanReceipt(true));
  assert.equal(details.amount, 3230);
  assert.equal(details.reference, 'MM6058MEY3987');
  assert.equal(details.beneficiary, '9238XXXXXXXX2816');
  assert.equal(details.remainingBalance, '');
  assert.equal(details.orderer, 'CUP');
});
void regression('comprobante sin monto o ambiguo no reutiliza saldo como importe', () => {
  assert.equal(receiptDetails('Saldo restante: CR 2184.19 CUP').amount, null);
  assert.equal(receiptDetails(`${metropolitanReceipt()}\nImporte: 3230 CUP`).amount, null);
  assert.deepEqual(receiptPaymentAmounts(4000, 0), { cash: '4000', transfer: '0' });
  assert.deepEqual(receiptPaymentAmounts(4000, 1500), { cash: '2500', transfer: '1500' });
});
void regression(
  'datos del comprobante persisten tanto en transferencia como en mixto y exportación',
  async () => {
    for (const method of ['transfer', 'mixed'] as const) {
      const f = await fixture();
      const total = method === 'mixed' ? 4000 : 1500;
      await f.db.saveProduct({ ...f.product, price_cash: total, price_transfer: total }, 'admin');
      const product = await f.db.getProduct(f.product.id);
      assert.ok(product);
      const rawText = metropolitanReceipt();
      const details = receiptDetails(rawText);
      const receipt: TransferReceipt = {
        ...sampleReceipt(1500),
        ...details,
        amount: 1500,
        rawText,
      };
      const amounts = receiptPaymentAmounts(total, receipt.amount);
      const payments =
        method === 'mixed'
          ? [
              { type: 'cash' as const, amount: Number(amounts.cash) },
              { type: 'transfer' as const, amount: Number(amounts.transfer) },
            ]
          : pay(receipt.amount);
      const id = await f.db.registerSale(
        f.cart(1, undefined, product),
        method,
        payments,
        'admin',
        undefined,
        f.sessionId,
        {
          cashReceived: method === 'mixed' ? 3000 : null,
          transferReceipt: receipt,
        },
      );
      const sale = await f.db.getSale(id);
      assert.deepEqual(sale?.sale.settlement?.transferReceipt, receipt);
      assert.equal(sale?.sale.settlement?.changeDue, method === 'mixed' ? 500 : 0);
      const rows = await f.db.getExportRows('sales');
      assert.equal(rows[0].receipt_bank, 'Banco Metropolitano');
      assert.equal(rows[0].receipt_beneficiary, receipt.beneficiary);
      assert.equal(rows[0].transfer_amount, 1500);
      assert.equal(rows[0].receipt_remaining_balance, 'CR 2184.19 CUP');
      await assert.rejects(
        f.db.registerSale(
          f.cart(1, undefined, product),
          method,
          payments,
          'admin',
          undefined,
          f.sessionId,
          {
            cashReceived: method === 'mixed' ? 3000 : null,
            transferReceipt: { ...receipt, imageBase64: 'ZG90' },
          },
        ),
        /ya se usó/,
      );
    }
  },
);
void regression(
  'moneda ajena a CUP y campos bancarios demasiado largos requieren corrección',
  () => {
    for (const change of [{ currency: 'USD' }, { beneficiary: 'X'.repeat(241) }])
      assert.throws(() =>
        validateSettlement(pay(100), {
          cashReceived: null,
          transferReceipt: { ...sampleReceipt(), ...change },
        }),
      );
  },
);

void regression(
  'comprobante repetido se bloquea; reintento de venta confirmada conserva UUID',
  async () => {
    const f = await fixture();
    const input = { cashReceived: null, transferReceipt: sampleReceipt() };
    const identity = { commandId: 'sale-receipt', clientId: 'a' };
    const id = await f.db.registerSale(
      f.cart(1),
      'transfer',
      pay(100),
      'admin',
      identity,
      f.sessionId,
      input,
    );
    assert.equal(
      await f.db.registerSale(
        f.cart(1),
        'transfer',
        pay(100),
        'admin',
        identity,
        f.sessionId,
        input,
      ),
      id,
    );
    await assert.rejects(
      f.db.registerSale(f.cart(1), 'transfer', pay(100), 'admin', undefined, f.sessionId, input),
      /ya se usó/,
    );
    assert.equal((await f.db.getDemoUsage()).sales, 1);
  },
);
void regression(
  'consulta anticipada identifica transacciones únicas y conserva protección al cobrar',
  async () => {
    for (const method of ['transfer', 'mixed'] as const) {
      const f = await fixture();
      const amount = method === 'mixed' ? 60 : 100;
      const receipt = {
        ...sampleReceipt(amount, '  Operacion-123  '),
        ci: '',
        fullName: '',
        address: '',
      };
      const payments =
        method === 'mixed'
          ? [
              { type: 'cash' as const, amount: 40 },
              { type: 'transfer' as const, amount: 60 },
            ]
          : pay(100);
      const settlement = { cashReceived: method === 'mixed' ? 50 : null, transferReceipt: receipt };
      assert.equal(await f.db.findTransferTransaction('OPERACION-123'), null);
      const id = await f.db.registerSale(
        f.cart(1),
        method,
        payments,
        'admin',
        undefined,
        f.sessionId,
        settlement,
      );
      assert.deepEqual(await f.db.findTransferTransaction('operacion-123'), { id });
      assert.deepEqual(await f.db.findTransferTransaction('  OPERACION-123 '), { id });
      assert.equal(await f.db.findTransferTransaction(''), null);
      assert.equal(await f.db.findTransferTransaction('  '), null);
      assert.equal(await f.db.findTransferTransaction('OPERACION-124'), null);
      assert.equal((await f.db.getSale(id))?.sale.settlement?.transferReceipt?.ci, '');
      await assert.rejects(
        f.db.registerSale(f.cart(1), method, payments, 'admin', undefined, f.sessionId, {
          ...settlement,
          transferReceipt: { ...receipt, reference: 'operacion-123', imageBase64: 'ZG90' },
        }),
        /ya se usó/,
      );
      assert.equal((await f.db.getDemoUsage()).sales, 1);
      assert.equal((await f.db.getProduct(f.product.id))?.stock, 9);
    }
  },
);
void regression('cada dato personal puede omitirse independientemente', () => {
  for (const change of [
    { ci: '' },
    { fullName: '' },
    { address: '' },
    { ci: '', fullName: '', address: '' },
  ]) {
    assert.doesNotThrow(() =>
      validateSettlement(pay(100), {
        cashReceived: null,
        transferReceipt: { ...sampleReceipt(), ...change },
      }),
    );
  }
});

void regression('archivo exige cierre previo y permisos de administrador', async () => {
  const f = await fixture();
  await assert.rejects(f.db.createBusinessArchive('admin'), /Cierra la caja/);
  await f.db.closeCashSession(f.sessionId, await f.closure());
  await f.db.saveUser({ username: 'auditor', role: 'auditor', password: 'auditor123' });
  await assert.rejects(f.db.createBusinessArchive('auditor'), /administrador/);
});
async function closedArchive() {
  const f = await fixture();
  await f.db.saveUser({ username: 'auditor', role: 'auditor', password: 'auditor123' });
  await f.db.registerSale(f.cart(1), 'transfer', pay(100), 'admin', undefined, f.sessionId, {
    cashReceived: null,
    transferReceipt: sampleReceipt(),
  });
  await f.db.closeCashSession(f.sessionId, await f.closure());
  return { source: f, archive: await f.db.createBusinessArchive('admin') };
}
void regression(
  'traslado sin credenciales restaura historia, stock e imágenes y conserva licencia del destino',
  async () => {
    const { source, archive } = await closedArchive();
    const target = createHarness();
    const db = target.load('@/lib/database');
    await db.initializeDatabase();
    await db.setSetting('license_mode', 'pro');
    await db.setSetting('license_key', 'destination-only');
    await db.setSetting('usage_sales', '4');
    assert.equal(await db.restoreBusinessArchive(archive, 'admin'), archive.openingFund);
    assert.equal(await db.getSetting('license_key'), 'destination-only');
    assert.equal(await db.getSetting('license_mode'), 'pro');
    assert.equal((await db.getProduct(source.product.id))?.stock, 9);
    assert.equal((await db.listCashClosures()).length, 1);
    assert.equal(
      (await db.getSale(1))?.sale.settlement?.transferReceipt?.imageBase64,
      sampleReceipt().imageBase64,
    );
    assert.equal(await db.authenticate('auditor', 'auditor123'), null);
    assert.equal(archive.version, 2);
    assert.ok(archive.tables.users.every((row) => !Object.hasOwn(row, 'password_hash')));
    assert.equal((await db.authenticate('admin', 'admin123'))?.role, 'admin');
    assert.ok(await source.db.authenticate('auditor', 'auditor123'));
    const importedAuditor = (await db.listUsers()).find(
      (account) => account.username === 'auditor',
    );
    assert.ok(importedAuditor);
    await db.saveUser({
      id: importedAuditor.id,
      username: 'auditor',
      role: 'auditor',
      password: 'nueva-clave-auditor',
    });
    assert.equal((await db.authenticate('auditor', 'nueva-clave-auditor'))?.role, 'auditor');
    assert.equal((await db.getDemoUsage()).sales, 4);
    assert.equal(await db.getSetting('next_opening_fund'), String(archive.openingFund));
    const next = await db.openCashSession(archive.openingFund, 'admin');
    assert.ok(next > source.sessionId);
    assert.equal(await db.getSetting('next_opening_fund'), null);
  },
);
void regression('importación en destino con datos o repetida no mezcla negocios', async () => {
  const { source, archive } = await closedArchive();
  await assert.rejects(source.db.restoreBusinessArchive(archive, 'admin'), /No se mezclan/);
  const h = createHarness();
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  await db.restoreBusinessArchive(archive, 'admin');
  await assert.rejects(db.restoreBusinessArchive(archive, 'admin'), /No se mezclan/);
  assert.equal((await db.getAuditSnapshot()).sales.length, 1);
});
void regression(
  'archivo incompleto, versión incorrecta o stock inconsistente revierte toda importación',
  async () => {
    const { archive } = await closedArchive();
    for (const corrupt of [
      { ...archive, version: 999 },
      { ...archive, tables: { ...archive.tables, users: [] } },
      { ...archive, tables: { ...archive.tables, area_stock: [] } },
    ]) {
      const h = createHarness();
      const db = h.load('@/lib/database');
      await db.initializeDatabase();
      await assert.rejects(db.restoreBusinessArchive(corrupt, 'admin'));
      assert.equal((await db.listProducts()).length, 0);
      assert.equal((await db.listCashClosures()).length, 0);
      assert.ok(await db.authenticate('admin', 'admin123'));
    }
  },
);
void regression('fallo de escritura durante importación deja intacto el destino', async () => {
  const { archive } = await closedArchive();
  const h = createHarness();
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  h.failWritesContaining('INSERT INTO sales(');
  await assert.rejects(db.restoreBusinessArchive(archive, 'admin'));
  assert.equal((await db.listProducts()).length, 0);
  assert.equal(await db.getSetting('last_archive_id'), null);
});
void regression('precio mixto único y precios históricos con tarifas distintas', async () => {
  const f = await fixture();
  await f.db.saveProduct({ ...f.product, price_transfer: 125 }, 'admin');
  const product = await f.db.getProduct(f.product.id);
  assert.ok(product);
  const item = { product, areaId: f.cart(1)[0].areaId, quantity: 1, price: 100 };
  const mixed = await f.db.registerSale(
    [item],
    'mixed',
    [
      { type: 'cash', amount: 40 },
      { type: 'transfer', amount: 60 },
    ],
    'admin',
  );
  const transfer = await f.db.registerSale(
    [{ ...item, price: 125 }],
    'transfer',
    [{ type: 'transfer', amount: 125 }],
    'admin',
  );
  await assert.rejects(
    f.db.registerSale([item], 'transfer', [{ type: 'transfer', amount: 100 }], 'admin'),
    /precio/,
  );
  const current = await f.db.getProduct(product.id);
  assert.ok(current);
  await f.db.saveProduct({ ...current, price_cash: 150, price_transfer: 175 }, 'admin');
  assert.equal((await f.db.getSale(mixed))?.lines[0].price, 100);
  assert.equal((await f.db.getSale(mixed))?.sale.total, 100);
  assert.equal((await f.db.getSale(transfer))?.lines[0].price, 125);
});
void regression(
  'migración v7 conserva tarjeta histórica y bloquea nuevos inserts SQLite',
  async () => {
    const f = await fixture();
    stripRecoveryJournal(f.database);
    f.database.run(`DROP TRIGGER reject_new_card_sale; DROP TRIGGER reject_card_sale_edit;
    DROP TRIGGER sync_sales_insert; DROP TRIGGER sync_sales_delete; DROP TRIGGER sync_sales_update;
    ALTER TABLE sales DROP COLUMN legacy_card; ALTER TABLE sales DROP COLUMN pricing_basis; PRAGMA user_version=6;`);
    f.database.run(
      `INSERT INTO sales(session_id,user,date,total,method,payments) VALUES(?, 'admin', ?, 80, 'card', '[{"type":"card","amount":80}]')`,
      [f.sessionId, new Date().toISOString()],
    );
    const before = f.database.exec('SELECT id,total,method,payments FROM sales')[0].values;
    await f.db.initializeDatabase();
    assert.deepEqual(
      f.database.exec('SELECT id,total,method,payments FROM sales')[0].values,
      before,
    );
    assert.equal(f.database.exec('SELECT legacy_card FROM sales')[0].values[0][0], 1);
    assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 9);
    const backup = f.backups.get('mipypos.pre-v6.db');
    assert.ok(backup);
    assert.deepEqual(backup.exec('SELECT id,total,method,payments FROM sales')[0].values, before);
    assert.throws(
      () =>
        f.database.run(
          `INSERT INTO sales(session_id,user,date,total,method,payments) VALUES(?, 'admin', ?, 80, 'card', '[{"type":"card","amount":80}]')`,
          [f.sessionId, new Date().toISOString()],
        ),
      /tarjeta/,
    );
    const sale = await f.db.getSale(Number(before[0][0]));
    assert.equal(sale?.sale.method, 'card');
    assert.equal(sale?.sale.payments[0].type, 'card');
    await f.db.initializeDatabase();
    assert.equal(f.database.exec('SELECT COUNT(*) FROM sales')[0].values[0][0], 1);
  },
);
void regression(
  'si falla backup no migra; si falla migración revierte columnas y versión',
  async () => {
    for (const failure of ['BACKUP', 'INSERT OR IGNORE INTO sync_state']) {
      const f = await fixture();
      stripRecoveryJournal(f.database);
      f.database.run(`DROP TRIGGER reject_new_card_sale; DROP TRIGGER reject_card_sale_edit;
      DROP TRIGGER sync_sales_insert; DROP TRIGGER sync_sales_delete; DROP TRIGGER sync_sales_update;
      ALTER TABLE sales DROP COLUMN legacy_card; ALTER TABLE sales DROP COLUMN pricing_basis; PRAGMA user_version=6;`);
      f.failWritesContaining(failure);
      await assert.rejects(f.db.initializeDatabase());
      assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 6);
      assert.ok(
        !f.database
          .exec('PRAGMA table_info(sales)')[0]
          .values.some((row) => row[1] === 'legacy_card'),
      );
      assert.equal((await f.db.listProducts()).length, 1);
      f.failWritesContaining('');
      await f.db.initializeDatabase();
      assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 9);
    }
  },
);
void regression(
  'fallo de migracion revierte tambien las tablas e indices de arranque',
  async () => {
    const f = await fixture();
    f.database.run('DROP TABLE audit_log; PRAGMA user_version=6;');
    const metadata = () =>
      f.database.exec('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name');
    const before = metadata();
    const users = f.database.exec('SELECT * FROM users ORDER BY id');
    const products = f.database.exec('SELECT * FROM products ORDER BY id');
    f.failWritesContaining('INSERT OR IGNORE INTO sync_state');
    await assert.rejects(f.db.initializeDatabase());
    assert.deepEqual(metadata(), before);
    assert.deepEqual(f.database.exec('SELECT * FROM users ORDER BY id'), users);
    assert.deepEqual(f.database.exec('SELECT * FROM products ORDER BY id'), products);
    assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 6);
    assert.ok(f.backups.get('mipypos.pre-v6.db'));
    f.failWritesContaining('');
    await f.db.initializeDatabase();
    assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 9);
  },
);
void regression(
  'fallo de inicializacion no deja esquema ni version parcialmente confirmados',
  async () => {
    const h = createHarness();
    const db = h.load('@/lib/database');
    h.failWritesContaining('INSERT OR IGNORE INTO areas(name)');
    await assert.rejects(db.initializeDatabase());
    assert.equal(h.database.exec('PRAGMA user_version')[0].values[0][0], 0);
    assert.equal(h.database.exec("SELECT name FROM sqlite_master WHERE type='table'").length, 0);
    h.failWritesContaining('');
    await db.initializeDatabase();
    assert.equal((await db.listUsers()).length, 1);
    assert.equal(h.database.exec('PRAGMA foreign_key_check').length, 0);
  },
);

void regression(
  'reintento de migración conserva el respaldo original sin sobrescribirlo',
  async () => {
    const f = await fixture();
    f.database.run('PRAGMA user_version=6');
    const originalUsers = f.database.exec('SELECT * FROM users ORDER BY id');
    const originalProducts = f.database.exec('SELECT * FROM products ORDER BY id');
    const originalSettings = f.database.exec('SELECT * FROM settings ORDER BY key');
    f.failWritesContaining('INSERT OR IGNORE INTO sync_state');
    await assert.rejects(f.db.initializeDatabase());
    const backup = f.backups.get('mipypos.pre-v6.db');
    assert.ok(backup);
    f.database.run("UPDATE products SET name='Origen cambiado tras fallo' WHERE id=1");
    f.failWritesContaining('');
    await f.db.initializeDatabase();
    assert.equal(f.backups.get('mipypos.pre-v6.db'), backup);
    assert.deepEqual(backup.exec('SELECT * FROM users ORDER BY id'), originalUsers);
    assert.deepEqual(backup.exec('SELECT * FROM products ORDER BY id'), originalProducts);
    assert.deepEqual(backup.exec('SELECT * FROM settings ORDER BY key'), originalSettings);
    assert.equal(backup.exec('PRAGMA user_version')[0].values[0][0], 6);
    assert.equal((await f.db.getProduct(1))?.name, 'Origen cambiado tras fallo');
  },
);

void regression(
  'copia previa de versión incorrecta bloquea actualización sin destruir evidencia',
  async () => {
    const f = await fixture();
    f.database.run('PRAGMA user_version=6');
    f.failWritesContaining('INSERT OR IGNORE INTO sync_state');
    await assert.rejects(f.db.initializeDatabase());
    const backup = f.backups.get('mipypos.pre-v6.db');
    assert.ok(backup);
    backup.run('PRAGMA user_version=5');
    const original = backup.exec('SELECT * FROM users');
    f.failWritesContaining('');
    await assert.rejects(f.db.initializeDatabase(), /copia segura/);
    assert.equal(f.backups.get('mipypos.pre-v6.db'), backup);
    assert.deepEqual(backup.exec('SELECT * FROM users'), original);
    assert.equal(backup.exec('PRAGMA user_version')[0].values[0][0], 5);
    assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 6);
  },
);

void regression(
  'arranques concurrentes comparten una inicialización sin duplicar semillas',
  async () => {
    const h = createHarness();
    const db = h.load('@/lib/database');
    const first = db.initializeDatabase();
    const second = db.initializeDatabase();
    assert.equal(first, second);
    await Promise.all([first, second]);
    assert.equal((await db.listUsers()).length, 1);
    assert.equal((await db.listAreas()).length, 1);
    assert.equal(h.database.exec('PRAGMA foreign_key_check').length, 0);
  },
);

void regression('apertura SQLite rechazada no envenena los siguientes reintentos', async () => {
  const source = createHarness();
  const connection = await source.load('@/lib/database').getDatabase();
  let attempts = 0;
  const h = createHarness({
    'expo-sqlite': {
      defaultDatabaseDirectory: 'file:///private/SQLite',
      openDatabaseAsync: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Apertura interrumpida');
        return connection;
      },
    },
  });
  const db = h.load('@/lib/database');
  await assert.rejects(
    Promise.all([db.initializeDatabase(), db.initializeDatabase()]),
    /interrumpida/,
  );
  assert.equal(attempts, 1);
  await db.initializeDatabase();
  assert.equal(attempts, 2);
  assert.equal((await db.listUsers()).length, 1);
});

void regression(
  'copia privada conserva cuentas, licencia, cuotas, ventas y caja sin sobrescribir otras',
  async () => {
    const f = await fixture();
    await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
    const tables = [
      'users',
      'products',
      'area_stock',
      'sales',
      'sale_lines',
      'cash_sessions',
      'sync_state',
    ];
    const before = tables.map((table) => f.database.exec(`SELECT * FROM ${table}`));
    const first = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const copy = f.backups.get(first.fileName);
    assert.ok(copy);
    for (const [index, table] of tables.entries())
      assert.deepEqual(copy.exec(`SELECT * FROM ${table}`), before[index]);
    assert.deepEqual(
      copy.exec(
        "SELECT * FROM settings WHERE key IN ('license_mode','usage_products','usage_sales')",
      ),
      f.database.exec(
        "SELECT * FROM settings WHERE key IN ('license_mode','usage_products','usage_sales')",
      ),
    );
    assert.equal(copy.exec('PRAGMA user_version')[0].values[0][0], 9);
    assert.equal(copy.exec('PRAGMA foreign_key_check').length, 0);
    const original = copy.exec('SELECT * FROM products');
    const currentProduct = await f.db.getProduct(f.product.id);
    assert.ok(currentProduct);
    await f.db.saveProduct({ ...currentProduct, price_cash: 200 }, 'admin');
    const second = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    assert.notEqual(first.fileName, second.fileName);
    assert.deepEqual(copy.exec('SELECT * FROM products'), original);
    assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 2);
    assert.equal(
      f.database.exec("SELECT COUNT(*) FROM audit_log WHERE action='recovery.backup'")[0]
        .values[0][0],
      2,
    );
  },
);

void regression(
  'copia privada requiere administrador autenticado y limita contraseñas fallidas',
  async () => {
    const f = await fixture();
    await f.db.saveUser({ username: 'vendedor', password: 'pass1234', role: 'seller' });
    await assert.rejects(f.db.createPrivateRecoveryBackup('vendedor', 'pass1234'), /administrador/);
    await assert.rejects(f.db.listPrivateRecoveryBackups('vendedor'), /administrador/);
    for (let attempt = 0; attempt < 5; attempt++)
      await assert.rejects(f.db.createPrivateRecoveryBackup('admin', 'incorrecta'), /contraseña/);
    await assert.rejects(
      f.db.createPrivateRecoveryBackup('admin', 'admin123'),
      /Demasiados intentos/,
    );
    assert.equal(f.backups.size, 0);
    assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 0);
  },
);

void regression(
  'terminal cliente no respalda su base como si fuera la autoridad comercial',
  async () => {
    const f = await fixture();
    f.storage.set(
      'mipypos.network.config',
      JSON.stringify({
        mode: 'client',
        hostUrl: 'https://192.168.43.1:8787',
        clientId: 'terminal-a',
      }),
    );
    f.storage.set('secure:mipypos.network.pin', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    await assert.rejects(f.db.createPrivateRecoveryBackup('admin', 'admin123'), /administrador/);
    await assert.rejects(f.db.listPrivateRecoveryBackups('admin'), /administrador/);
    assert.equal(f.backups.size, 0);
  },
);

void regression('fallo de backup no anuncia éxito y conserva copias anteriores', async () => {
  const f = await fixture();
  const first = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
  const copy = f.backups.get(first.fileName);
  f.failWritesContaining('BACKUP');
  await assert.rejects(f.db.createPrivateRecoveryBackup('admin', 'admin123'), /backup failure/);
  assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 1);
  assert.equal(f.backups.get(first.fileName), copy);
  f.failWritesContaining('');
  await f.db.createPrivateRecoveryBackup('admin', 'admin123');
  assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 2);
});

void regression(
  'fallo de catálogo de respaldo conserva archivo pero revierte manifest y auditoría',
  async () => {
    const f = await fixture();
    f.failWritesContaining('INSERT INTO audit_log');
    await assert.rejects(f.db.createPrivateRecoveryBackup('admin', 'admin123'));
    assert.equal(f.backups.size, 1);
    assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 0);
    assert.equal(
      f.database.exec("SELECT COUNT(*) FROM audit_log WHERE action='recovery.backup'")[0]
        .values[0][0],
      0,
    );
    f.failWritesContaining('');
    await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    assert.equal(f.backups.size, 2);
    assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 1);
  },
);

void regression(
  'copias simultáneas y venta producen snapshots íntegros sin duplicar efectos',
  async () => {
    const f = await fixture();
    const [first, second, saleId] = await Promise.all([
      f.db.createPrivateRecoveryBackup('admin', 'admin123'),
      f.db.createPrivateRecoveryBackup('admin', 'admin123'),
      f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin'),
    ]);
    assert.notEqual(first.fileName, second.fileName);
    assert.ok(saleId > 0);
    for (const item of [first, second]) {
      const copy = f.backups.get(item.fileName);
      assert.ok(copy);
      const sales = Number(copy.exec('SELECT COUNT(*) FROM sales')[0].values[0][0]);
      const stock = Number(copy.exec('SELECT stock FROM products WHERE id=1')[0].values[0][0]);
      assert.equal(stock, 10 - sales);
      assert.equal(copy.exec('PRAGMA foreign_key_check').length, 0);
    }
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 9);
    assert.equal((await f.db.getDemoUsage()).sales, 1);
  },
);

void regression(
  'verificar copia privada lee historial original sin secretos ni modificar archivo',
  async () => {
    const f = await fixture();
    await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
    const backup = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const file = f.backups.get(backup.fileName);
    assert.ok(file);
    const before = file.export();
    await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
    const inspection = await f.db.inspectPrivateRecoveryBackup('admin', 'admin123', backup.id);
    assert.equal(inspection.sales, 1);
    assert.equal(inspection.products, 1);
    assert.equal(inspection.cashSessions, 1);
    assert.equal(inspection.commandReceipts, 0);
    assert.ok(inspection.verifiedAt);
    assert.deepEqual(file.export(), before);
    assert.equal((await f.db.getDemoUsage()).sales, 2);
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 8);
    assert.equal(JSON.stringify(inspection).includes('password_hash'), false);
    assert.equal(JSON.stringify(inspection).includes('admin123'), false);
  },
);

void regression(
  'verificar archivo ausente no crea SQLite ni elimina registro de respaldo',
  async () => {
    const f = await fixture();
    const backup = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    f.backups.delete(backup.fileName);
    await assert.rejects(
      f.db.inspectPrivateRecoveryBackup('admin', 'admin123', backup.id),
      /No se encontró/,
    );
    assert.equal(f.backups.size, 0);
    assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 1);
  },
);

void regression('verificar respaldo requiere rol contraseña y autoridad local', async () => {
  const f = await fixture();
  const backup = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
  await f.db.saveUser({ username: 'seller', password: 'pass1234', role: 'seller' });
  await assert.rejects(
    f.db.inspectPrivateRecoveryBackup('seller', 'pass1234', backup.id),
    /administrador/,
  );
  await assert.rejects(
    f.db.inspectPrivateRecoveryBackup('admin', 'incorrecta', backup.id),
    /contraseña/,
  );
  f.storage.set(
    'mipypos.network.config',
    JSON.stringify({
      mode: 'client',
      hostUrl: 'https://192.168.43.1:8787',
      clientId: 'terminal-a',
    }),
  );
  f.storage.set('secure:mipypos.network.pin', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  await assert.rejects(
    f.db.inspectPrivateRecoveryBackup('admin', 'admin123', backup.id),
    /administrador/,
  );
  assert.equal(f.backups.size, 1);
});

void regression(
  'verificar respaldo rechaza versión o identidad alterada y conserva evidencia',
  async () => {
    const f = await fixture();
    const backup = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const file = f.backups.get(backup.fileName);
    assert.ok(file);
    file.run('PRAGMA user_version=10');
    await assert.rejects(
      f.db.inspectPrivateRecoveryBackup('admin', 'admin123', backup.id),
      /No se pudo verificar/,
    );
    assert.equal(file.exec('PRAGMA user_version')[0].values[0][0], 10);
    file.run('PRAGMA user_version=9');
    file.run("UPDATE sync_state SET authority_id='otra-autoridad' WHERE id=1");
    await assert.rejects(
      f.db.inspectPrivateRecoveryBackup('admin', 'admin123', backup.id),
      /No se pudo verificar/,
    );
    assert.equal(
      file.exec('SELECT authority_id FROM sync_state')[0].values[0][0],
      'otra-autoridad',
    );
    assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 1);
  },
);

void regression(
  'catálogo de recuperación no permite intercambiar nombres de archivos',
  async () => {
    const f = await fixture();
    const first = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const second = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    f.database.run('UPDATE settings SET value=? WHERE key=?', [
      JSON.stringify({ ...first, fileName: second.fileName }),
      `private_backup:${first.id}`,
    ]);
    await assert.rejects(
      f.db.inspectPrivateRecoveryBackup('admin', 'admin123', first.id),
      /registro/,
    );
    await assert.rejects(f.db.listPrivateRecoveryBackups('admin'), /registro/);
    assert.equal(f.backups.size, 2);
  },
);

void regression(
  'verificar respaldo rechaza referencias rotas sin repararlas automáticamente',
  async () => {
    const f = await fixture();
    await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
    const backup = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const file = f.backups.get(backup.fileName);
    assert.ok(file);
    file.run('PRAGMA foreign_keys=OFF');
    file.run('UPDATE sale_lines SET sale_id=999999');
    const before = file.exec('SELECT * FROM sale_lines');
    await assert.rejects(
      f.db.inspectPrivateRecoveryBackup('admin', 'admin123', backup.id),
      /No se pudo verificar/,
    );
    assert.deepEqual(file.exec('SELECT * FROM sale_lines'), before);
    assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 1);
  },
);

void regression('permiso consumo persistente y usuarios no pueden autoautorizarse', async () => {
  const f = await fixture();
  const id = await f.db.saveUser({
    username: 'supervisor',
    password: 'supervisor123',
    role: 'supervisor',
  });
  await assert.rejects(f.db.setConsumptionPermission(id, true, 'supervisor'), /permiso/);
  await f.db.setConsumptionPermission(id, true, 'admin');
  await f.db.initializeDatabase();
  assert.equal((await f.db.listUsers()).find((u) => u.id === id)?.can_authorize_consumption, 1);
  assert.equal(
    (await f.db.authenticate('supervisor', 'supervisor123'))?.can_authorize_consumption,
    1,
  );
});
void regression('stock inconsistente se bloquea antes de modificar inventario', async () => {
  const f = await fixture();
  f.database.run('UPDATE area_stock SET quantity=3 WHERE product_id=?', [f.product.id]);
  const before = (await f.db.listMovements()).length;
  await assert.rejects(
    f.db.registerMovement({
      type: 'entrada',
      productId: f.product.id,
      quantity: 2,
      toArea: 'Almacén principal',
      username: 'admin',
    }),
    /no coinciden/,
  );
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 10);
  assert.equal((await f.db.listMovements()).length, before);
});
void regression(
  'archivo con formato v6 sin columnas v7 conserva ventas y permisos al importar',
  async () => {
    const f = await closedArchive();
    const archive = structuredClone(f.archive);
    archive.schemaVersion = 6;
    for (const sale of archive.tables.sales) {
      delete sale.legacy_card;
      delete sale.pricing_basis;
    }
    const target = createHarness();
    const db = target.load('@/lib/database');
    await db.initializeDatabase();
    await db.restoreBusinessArchive(archive, 'admin');
    assert.equal(
      target.database.exec('SELECT COUNT(*) FROM sales')[0].values[0][0],
      archive.tables.sales.length,
    );
    assert.equal(
      (await db.getSale(Number(archive.tables.sales[0].id)))?.sale.total,
      archive.tables.sales[0].total,
    );
    assert.equal(target.database.exec('PRAGMA foreign_key_check').length, 0);
  },
);
void regression('versión futura se rechaza antes de crear o modificar tablas', async () => {
  const h = createHarness();
  h.database.run('PRAGMA user_version=10');
  await assert.rejects(h.load('@/lib/database').initializeDatabase(), /más reciente/);
  assert.equal(h.database.exec('PRAGMA user_version')[0].values[0][0], 10);
  assert.equal(h.database.exec("SELECT name FROM sqlite_master WHERE type='table'").length, 0);
});
void regression(
  'importación protege usuarios y áreas preexistentes aunque no haya ventas',
  async () => {
    const f = await closedArchive();
    const h = createHarness();
    const db = h.load('@/lib/database');
    await db.initializeDatabase();
    const id = await db.saveUser({
      username: 'usuario-propio',
      password: 'secreto123',
      role: 'seller',
    });
    await assert.rejects(db.restoreBusinessArchive(f.archive, 'admin'), /historial propio/);
    assert.ok((await db.listUsers()).find((user) => user.id === id));
    assert.ok(await db.authenticate('usuario-propio', 'secreto123'));
    assert.equal((await db.listProducts()).length, 0);
  },
);
void regression(
  'archivo v2 rechaza hashes; archivo v1 conserva datos pero no reutiliza credenciales',
  async () => {
    const { archive } = await closedArchive();
    const withHashes = structuredClone(archive);
    for (const account of withHashes.tables.users) account.password_hash = 'a'.repeat(64);
    const h = createHarness();
    const db = h.load('@/lib/database');
    await db.initializeDatabase();
    await assert.rejects(db.restoreBusinessArchive(withHashes, 'admin'), /credenciales/);
    assert.ok(await db.authenticate('admin', 'admin123'));
    const legacy = { ...withHashes, version: 1 };
    await db.restoreBusinessArchive(legacy, 'admin');
    assert.ok(await db.authenticate('admin', 'admin123'));
    assert.equal((await db.getAuditSnapshot()).sales.length, archive.tables.sales.length);
  },
);
void regression(
  'administrador importado usa clave del receptor aunque su nombre sea diferente',
  async () => {
    const { archive } = await closedArchive();
    const h = createHarness();
    const db = h.load('@/lib/database');
    await db.initializeDatabase();
    await db.saveUser({
      id: 1,
      username: 'receptor',
      role: 'admin',
      password: 'clave-del-receptor',
    });
    // The destination must contain no audit entries when receiving a business.
    h.database.run('DELETE FROM audit_log');
    await db.restoreBusinessArchive(archive, 'receptor');
    assert.ok(await db.authenticate('admin', 'clave-del-receptor'));
    assert.equal(await db.authenticate('admin', 'admin123'), null);
    assert.equal(await db.authenticate('receptor', 'clave-del-receptor'), null);
  },
);

void regression('CSV dañado se rechaza antes de modificar catalogo o cuotas', async () => {
  const f = await fixture();
  const csv = f.load('@/lib/csv');
  const before = await f.db.listProducts();
  const usage = await f.db.getDemoUsage();
  for (const raw of [
    'name,stock,price_cash\n"Producto sin cierre,2,10',
    'name,stock,price_cash,stock\nProducto,2,10,3',
    'name,stock,price_cash\nProducto,2,10,celda perdida',
    'name,stock,price_cash\nProducto,2',
    'name,stock,price_cash\nPro"ducto,2,10',
    'name,stock,price_cash\n"Producto"otro,2,10',
  ]) {
    await assert.rejects(async () => f.db.importProducts(csv.parseCsv(raw), 'admin'), /CSV/);
    assert.deepEqual(await f.db.listProducts(), before);
    assert.deepEqual(await f.db.getDemoUsage(), usage);
  }
});
void regression('CSV valido conserva comas, comillas escapadas y campos multilinea', () => {
  const h = createHarness();
  const csv = h.load('@/lib/csv');
  const raw =
    '\uFEFFname,stock,price_cash,subcategory\r\n"Café, ""especial""\nTueste oscuro",2,10,\r\n';
  assert.deepEqual(csv.parseCsv(raw), [
    {
      name: 'Café, "especial"\nTueste oscuro',
      stock: '2',
      price_cash: '10',
      subcategory: '',
    },
  ]);
});

const recoveryHost = { '@/lib/network/host': { stopLanHostAndDrain: async () => undefined } };

void regression(
  'restauración conserva negocio, credenciales, licencia y recibos en otra generación',
  async () => {
    const f = await fixture(recoveryHost);
    await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const products = await f.db.listProducts();
    const sales = (await f.db.getAuditSnapshot()).sales;
    const retained = await f.db.getDatabase();
    const restored = await f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true);
    assert.equal(restored.reconciliation.canRestore, true);
    assert.deepEqual(await f.db.listProducts(), products);
    assert.deepEqual((await f.db.getAuditSnapshot()).sales, sales);
    assert.ok(await f.db.authenticate('admin', 'admin123'));
    assert.equal(await f.db.getLicenseMode(), 'demo');
    assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 2);
    const audit = await (
      await f.db.getDatabase()
    ).getAllAsync<{ action: string }>(
      "SELECT action FROM audit_log WHERE action='recovery.restore'",
    );
    assert.equal(audit.length, 1);
    assert.ok(f.backups.has(restored.safetyCopy.fileName));
    assert.throws(() => retained.getAllAsync('SELECT * FROM sales'), /recuperación/);
    const selector = await f.load('@/lib/recovery-selector').loadRecoverySelector();
    assert.equal(selector?.phase, 'committed');
    assert.equal(selector?.previous, 'mipypos.db');
    assert.ok(selector?.candidate.startsWith('mipypos.restored.'));
  },
);

void regression(
  'una copia antigua no elimina una venta posterior ni vuelve a ejecutar sus efectos',
  async () => {
    const f = await fixture(recoveryHost);
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
    const before = await f.db.getAuditSnapshot();
    const products = await f.db.listProducts();
    const restored = await f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true);
    assert.ok(restored.reconciliation.replayEntries > 0);
    assert.deepEqual((await f.db.getAuditSnapshot()).sales, before.sales);
    assert.deepEqual(await f.db.listProducts(), products);
    assert.equal(f.storage.has('mipypos.recovery.selector.v1'), true);
  },
);

void regression(
  'mismos conteos no ocultan cambios de precio, permisos o configuración',
  async () => {
    const f = await fixture(recoveryHost);
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const product = await f.db.getProduct(f.product.id);
    assert.ok(product);
    await f.db.saveProduct({ ...product, price_cash: 125 }, 'admin');
    const restored = await f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true);
    assert.ok(restored.reconciliation.replayEntries > 0);
    assert.equal((await f.db.getProduct(f.product.id))?.price_cash, 125);
  },
);

void regression('no se restaura sin confirmación, administrador o desde host/cliente', async () => {
  const f = await fixture(recoveryHost);
  const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
  await assert.rejects(
    f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, false),
    /Confirma/,
  );
  await assert.rejects(
    f.db.restorePrivateRecoveryBackup('admin', 'incorrecta', copy.id, true),
    /contraseña/,
  );
  await f
    .load('@/lib/network/config')
    .saveNetworkConfig({ mode: 'host', hostUrl: '', clientId: 'host-1', transport: 'wifi' });
  await assert.rejects(
    f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true),
    /terminales/,
  );
  assert.ok(await f.db.authenticate('admin', 'admin123'));
});

void regression(
  'recibos posteriores se preservan aunque no cambien ventas ni conteos',
  async () => {
    const f = await fixture(recoveryHost);
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    f.database.run(
      "INSERT INTO network_commands(command_id,client_id,action,response,created_at) VALUES('confirmed-after','terminal','action','{\"value\":42}','2026-10-31T10:00:00.000Z')",
    );
    const restored = await f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true);
    assert.ok(restored.reconciliation.replayEntries > 0);
    assert.equal(
      (
        await (
          await f.db.getDatabase()
        ).getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM network_commands')
      )?.count,
      1,
    );
  },
);

void regression(
  'fallo de copia de seguridad bloquea la restauración y conserva acceso original',
  async () => {
    const f = await fixture(recoveryHost);
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    f.failWritesContaining('BACKUP');
    await assert.rejects(
      f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true),
      /backup failure/,
    );
    f.failWritesContaining('');
    assert.ok(await f.db.getProduct(f.product.id));
    assert.equal(f.storage.has('mipypos.recovery.selector.v1'), false);
  },
);

void regression(
  'una generación preparada interrumpida selecciona el original, no el candidato',
  async () => {
    const f = await fixture();
    const selector = f.load('@/lib/recovery-selector');
    const id = 'd71bc2be-1d42-4b56-92b9-e32eec097a8b';
    const file = `mipypos.restored.${id}.db`;
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const fixtureCopy = f.backups.get(copy.fileName);
    assert.ok(fixtureCopy);
    // Presence of a corrupt/uncommitted candidate must not switch authority.
    f.backups.set(file, fixtureCopy);
    // The main file exists in the SQLite fixture, expose it to file existence checks.
    f.backups.set('mipypos.db', f.database);
    await selector.saveRecoverySelector({
      version: 1,
      phase: 'prepared',
      previous: 'mipypos.db',
      candidate: file,
      restoreId: id,
      authorityId: copy.authorityId,
      createdAt: copy.createdAt,
    });
    assert.equal((await selector.resolveDatabaseFile()).fileName, 'mipypos.db');
  },
);

void regression('registro corrupto o generación ausente no crea otra base vacía', async () => {
  const h = createHarness();
  const selector = h.load('@/lib/recovery-selector');
  h.storage.set('mipypos.recovery.selector.v1', 'not-json');
  await assert.rejects(selector.resolveDatabaseFile(), /registro/);
  const id = 'd71bc2be-1d42-4b56-92b9-e32eec097a8b';
  await selector.saveRecoverySelector({
    version: 1,
    phase: 'committed',
    previous: 'mipypos.db',
    candidate: `mipypos.restored.${id}.db`,
    restoreId: id,
    authorityId: 'authority',
    createdAt: '2026-10-31T10:00:00.000Z',
  });
  await assert.rejects(selector.resolveDatabaseFile(), /No se encontró/);
  assert.equal(h.backups.size, 0);
});

void regression(
  'barrera de mantenimiento bloquea nuevas operaciones sin borrar pendientes',
  async () => {
    const f = await fixture();
    const maintenance = f.load('@/lib/database-maintenance');
    maintenance.beginDatabaseMaintenance();
    await assert.rejects(f.db.listProducts(), /recuperación/);
    await assert.rejects(f.db.setSetting('license_mode', 'pro'), /recuperación/);
    maintenance.endDatabaseMaintenance();
    assert.equal(await f.db.getLicenseMode(), 'demo');
    assert.ok(await f.db.getProduct(f.product.id));
  },
);

void regression(
  'drenaje de conexión espera trabajo en vuelo e invalida manejadores retenidos',
  async () => {
    const f = await fixture();
    const { DatabaseConnectionGate } = f.load('@/lib/database-maintenance');
    const gate = new DatabaseConnectionGate(await f.db.getDatabase());
    let finish: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const work = gate.database.withTransactionAsync(async () => {
      await started;
    });
    let drained = false;
    const drain = gate.sealAndDrain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    assert.throws(() => gate.database.getAllAsync('SELECT * FROM users'), /recuperación/);
    finish?.();
    await work;
    await drain;
    assert.equal(drained, true);
  },
);

for (const stage of [
  'close-active',
  'candidate-copy',
  'candidate-reopen',
  'selector-prepared',
  'selector-committed',
  'selector-committed-readback',
] as const) {
  void regression(
    `fallo en ${stage} conserva datos y selecciona una generación comprobada`,
    async () => {
      const f = await fixture(recoveryHost);
      await f.db.registerSale(f.cart(1), 'cash', [{ type: 'cash', amount: 100 }], 'admin');
      const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
      const before = await f.db.getAuditSnapshot();
      const products = await f.db.listProducts();
      f.failRecoveryStageOnce(stage);
      await assert.rejects(
        f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true),
        /Injected recovery failure/,
      );
      assert.deepEqual(await f.db.getAuditSnapshot(), before);
      assert.deepEqual(await f.db.listProducts(), products);
      assert.ok(await f.db.authenticate('admin', 'admin123'));
      const record = await f.load('@/lib/recovery-selector').loadRecoverySelector();
      const selected = await f.load('@/lib/recovery-selector').resolveDatabaseFile();
      if (stage === 'selector-committed-readback') {
        assert.equal(record?.phase, 'committed');
        assert.equal(selected.fileName, record?.candidate);
      } else {
        assert.equal(selected.fileName, 'mipypos.db');
        assert.ok(record === null || record.phase === 'prepared');
      }
      assert.ok(f.backups.has(copy.fileName));
      assert.equal((await f.db.listPrivateRecoveryBackups('admin')).length, 2);
    },
  );
}

void regression(
  'restauración con journal pendiente conserva UUID y bloquea sustitución',
  async () => {
    const f = await fixture(recoveryHost);
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const pending = f.load('@/lib/network/pending-operation');
    const prepared = await pending.prepareOperation({
      hostUrl: 'https://192.168.1.2:8765',
      username: 'admin',
      clientId: 'terminal-pendiente',
      operation: 'addArea',
      args: ['Almacén auxiliar'],
    });
    const stored = new Map(f.storage);
    await assert.rejects(
      f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true),
      /operaciones pendientes/,
    );
    assert.equal((await pending.getPendingOperation())?.commandId, prepared.commandId);
    assert.deepEqual(f.storage, stored);
    assert.equal(await f.load('@/lib/recovery-selector').loadRecoverySelector(), null);
  },
);

void regression(
  'copia de otra autoridad y estructura alterada no sustituyen la base actual',
  async () => {
    const f = await fixture(recoveryHost);
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    const source = f.backups.get(copy.fileName);
    assert.ok(source);
    source.run("UPDATE sync_state SET authority_id='otra-autoridad' WHERE id=1");
    await assert.rejects(
      f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          'No se pudo verificar la copia. El archivo y su registro se conservan.',
        );
        assert.ok(error.cause instanceof Error);
        assert.equal(
          error.cause.message,
          'La copia no superó la comprobación. Se conserva sin modificar.',
        );
        return true;
      },
    );
    assert.ok(await f.db.getProduct(f.product.id));
    const next = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    f.backups.get(next.fileName)?.run('CREATE TABLE unexpected_scope(id INTEGER PRIMARY KEY)');
    await assert.rejects(
      f.db.restorePrivateRecoveryBackup('admin', 'admin123', next.id, true),
      /estructura/i,
    );
    assert.equal(await f.load('@/lib/recovery-selector').loadRecoverySelector(), null);
  },
);

void regression(
  'perder selector tras restaurar bloquea el retorno silencioso a la base original',
  async () => {
    const f = await fixture(recoveryHost);
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    await f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true);
    const active = await f.db.getDatabase();
    const count = (
      await active.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM sales')
    )?.total;
    f.storage.delete('mipypos.recovery.selector.v1');
    await assert.rejects(
      f.load('@/lib/recovery-selector').resolveDatabaseFile(),
      /Falta el registro/,
    );
    assert.equal(
      (await active.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM sales'))?.total,
      count,
    );
    assert.ok(f.backups.has(copy.fileName));
  },
);

void regression(
  'instalación sin generaciones recuperadas conserva apertura compatible',
  async () => {
    const f = await fixture();
    await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    assert.equal(
      (await f.load('@/lib/recovery-selector').resolveDatabaseFile()).fileName,
      'mipypos.db',
    );
  },
);

void regression(
  'evidencia WAL huérfana sin selector también impide regresar al original',
  async () => {
    const f = await fixture();
    const id = 'd71bc2be-1d42-4b56-92b9-e32eec097a8b';
    f.backups.set(`mipypos.restored.${id}.db-wal`, f.database);
    await assert.rejects(
      f.load('@/lib/recovery-selector').resolveDatabaseFile(),
      /Falta el registro/,
    );
    assert.ok(await f.db.getProduct(f.product.id));
  },
);

void regression('selector con candidato ajeno a su UUID se rechaza sin guardar', async () => {
  const f = await fixture();
  const id = 'd71bc2be-1d42-4b56-92b9-e32eec097a8b';
  const selector = f.load('@/lib/recovery-selector');
  await assert.rejects(
    selector.saveRecoverySelector({
      version: 1,
      phase: 'committed',
      previous: 'mipypos.db',
      candidate: 'mipypos.db',
      restoreId: id,
      authorityId: 'authority',
      createdAt: '2026-10-31T10:00:00.000Z',
    }),
    /generación/,
  );
  assert.equal(await selector.loadRecoverySelector(), null);
});

void regression(
  'registro preparado selecciona generación anterior restaurada, no base inicial',
  async () => {
    const f = await fixture(recoveryHost);
    const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
    await f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true);
    const selector = f.load('@/lib/recovery-selector');
    const active = await selector.loadRecoverySelector();
    assert.ok(active);
    const restoreId = 'd71bc2be-1d42-4b56-92b9-e32eec097a8b';
    await selector.saveRecoverySelector({
      ...active,
      phase: 'prepared',
      previous: active.candidate,
      candidate: `mipypos.restored.${restoreId}.db`,
      restoreId,
    });
    assert.equal((await selector.resolveDatabaseFile()).fileName, active.candidate);
  },
);

void regression('Expo carga el plugin LAN en Node sin un cargador TypeScript heredado', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--eval',
      `const assert = require('node:assert/strict');
       const { resolveConfigPluginFunction } = require('@expo/config-plugins/build/utils/plugin-resolver');
       const plugin = resolveConfigPluginFunction(process.cwd(), './lib/network/withLocalHotspot.ts');
       assert.equal(typeof plugin, 'function');
       const config = plugin({ name: 'MipyPOS', slug: 'mipypos' });
       for (const mod of ['manifest', 'appBuildGradle', 'mainApplication', 'dangerous']) {
         assert.equal(typeof config.mods.android[mod], 'function');
       }`,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

const backupExclude = z.object({ $: z.object({ domain: z.string(), path: z.literal('.') }) });
const backupBlock = z.object({
  exclude: z.array(backupExclude).min(1),
  include: z.never().optional(),
});
const backupDomains = ['root', 'file', 'database', 'sharedpref', 'external'];
const extractionBackupDomains = [
  ...backupDomains,
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
];

void regression('Android excluye todas las bases y preferencias del backup legado', async () => {
  const result = z
    .object({ 'full-backup-content': backupBlock })
    .parse(await XML.parseXMLAsync(androidLegacyBackupRules));
  assert.deepEqual(
    result['full-backup-content'].exclude.map((entry) => entry.$.domain).sort(),
    [...backupDomains].sort(),
  );
});

void regression(
  'Android moderno excluye datos privados de nube y traslado entre dispositivos',
  async () => {
    const result = z
      .object({
        'data-extraction-rules': z.object({
          'cloud-backup': z.array(backupBlock).length(1),
          'device-transfer': z.array(backupBlock).length(1),
        }),
      })
      .parse(await XML.parseXMLAsync(androidDataExtractionRules));
    for (const channel of ['cloud-backup', 'device-transfer'] as const) {
      const entries = result['data-extraction-rules'][channel][0].exclude;
      assert.deepEqual(
        entries.map((entry) => entry.$.domain).sort(),
        [...extractionBackupDomains].sort(),
      );
    }
  },
);

void regression(
  'política Android prevalece sobre backup previo sin cambiar atributos ajenos',
  () => {
    const previous = {
      'android:name': '.MainApplication',
      'android:allowBackup': 'true',
      'android:label': 'MipyPOS',
      'android:usesCleartextTraffic': 'false',
    };
    const updated = applyAndroidPrivateBackupPolicy(previous);
    assert.equal(updated['android:allowBackup'], 'false');
    assert.equal(updated['android:fullBackupContent'], '@xml/mipypos_private_backup_rules');
    assert.equal(
      updated['android:dataExtractionRules'],
      '@xml/mipypos_private_data_extraction_rules',
    );
    assert.equal(updated['android:name'], previous['android:name']);
    assert.equal(updated['android:usesCleartextTraffic'], 'false');
    assert.equal(previous['android:allowBackup'], 'true');
    assert.deepEqual(applyAndroidPrivateBackupPolicy(updated), updated);
  },
);

for (const version of [8, 10]) {
  void regression(
    `recuperación rechaza versión SQLite ${version} al verificar una generación`,
    async () => {
      const f = await fixture();
      const connection = await f.db.getDatabase();
      const identity = await connection.getFirstAsync<{ authority_id: string }>(
        'SELECT authority_id FROM sync_state WHERE id=1',
      );
      assert.ok(identity);
      f.database.run(`PRAGMA user_version=${version}`);
      const recovery = f.load('@/lib/recovery-reconciliation');
      await assert.rejects(
        recovery.verifyRecoveryDatabase(connection, identity.authority_id),
        /no superó la verificación/,
      );
      assert.equal((await f.db.getProduct(f.product.id))?.stock, f.product.stock);
    },
  );
}

for (const revision of [-1, 0.5]) {
  void regression(`recuperación rechaza revisión de autoridad inválida ${revision}`, async () => {
    const f = await fixture();
    const connection = await f.db.getDatabase();
    const identity = await connection.getFirstAsync<{ authority_id: string }>(
      'SELECT authority_id FROM sync_state WHERE id=1',
    );
    assert.ok(identity);
    // Simulate a corrupted database without weakening the production schema.
    f.database.run('PRAGMA ignore_check_constraints=ON');
    try {
      f.database.run('UPDATE sync_state SET revision=? WHERE id=1', [revision]);
    } finally {
      f.database.run('PRAGMA ignore_check_constraints=OFF');
    }
    const recovery = f.load('@/lib/recovery-reconciliation');
    await assert.rejects(
      recovery.verifyRecoveryDatabase(connection, identity.authority_id),
      /no superó la verificación/,
    );
    assert.equal((await f.db.getProduct(f.product.id))?.stock, f.product.stock);
  });
}

void regression('config Android deshabilita backup conservando identidad de publicación', () => {
  const config = appConfig({
    projectRoot: process.cwd(),
    staticConfigPath: null,
    packageJsonPath: null,
    config: { name: 'MipyPOS', slug: 'mipypos' },
  });
  assert.equal(config.android?.allowBackup, false);
  assert.equal(config.android?.package, process.env.BILT_ANDROID_PACKAGE ?? 'me.bilt.mipypos');
  assert.equal(config.ios?.bundleIdentifier, process.env.BILT_IOS_BUNDLE_ID ?? 'me.bilt.mipypos');
  assert.equal(config.version, process.env.BILT_APP_VERSION ?? '1.0.0');
  assert.equal(config.extra?.appStoreAppId, process.env.BILT_APP_STORE_APP_ID);
});
