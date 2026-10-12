import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
let passed = 0;
let failed = 0;
function regression(name: string, action: () => void | Promise<void>) {
  return test(name, async () => {
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
    join(directory, 'pos-regression-results.json'),
    JSON.stringify(
      { ranAt: new Date().toISOString(), tests: passed + failed, passed, failed },
      null,
      2,
    ),
  );
});
import { createHarness, prepareHarness } from './pos-test-harness';
before(prepareHarness);
import type { CartItem, CashClosureInput, Producto } from '../lib/models';

const pay = (amount: number) => [{ type: 'transfer' as const, amount }];

async function fixture() {
  const harness = createHarness();
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
      f.db.registerSale(f.cart(1), 'card', [{ type: 'card', amount: 100 }], 'admin'),
      /métodos/,
    );
    await assert.rejects(
      f.db.registerSale(
        f.cart(1),
        'mixed',
        [
          { type: 'cash', amount: 50 },
          { type: 'card', amount: 50 },
        ],
        'admin',
      ),
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
