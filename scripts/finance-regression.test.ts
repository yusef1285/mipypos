import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHarness, prepareHarness } from './pos-test-harness';
import type { CartItem } from '../lib/models';
import type { FinanceFilter } from '../lib/finance-models';
import { periodRange } from '../lib/finance-periods';
import { canAccess } from '../lib/permissions';
import { inventoryByCategory } from '../lib/finance-calculations';
import * as saleDraft from '../lib/sale-draft';
const testModules: { '@/lib/sale-draft': typeof import('../lib/sale-draft') } = {
  '@/lib/sale-draft': saleDraft,
};
let passed = 0,
  failed = 0;
before(prepareHarness);
after(() => {
  mkdirSync('.expo', { recursive: true });
  writeFileSync(
    join('.expo', 'finance-regression-results.json'),
    JSON.stringify(
      { ranAt: new Date().toISOString(), tests: passed + failed, passed, failed },
      null,
      2,
    ),
  );
});
function check(name: string, action: () => Promise<void> | void) {
  void test(name, async () => {
    try {
      await action();
      passed++;
    } catch (e) {
      failed++;
      throw e;
    }
  });
}
const all: FinanceFilter = { start: '2000-01-01T00:00:00.000Z', end: '2099-12-31T23:59:59.999Z' };
async function fixture(cost: number | null = 40, modules: Record<string, unknown> = {}) {
  const h = createHarness(modules);
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  const id = await db.saveProduct(
    {
      name: 'Arroz de grano largo',
      category: 'Alimentos',
      subcategory: '',
      stock: 20,
      price_cash: 100,
      price_transfer: 100,
      unit: 'kg',
      quantity_decimals: 3,
      image_path: null,
    },
    'admin',
  );
  const p = await db.getProduct(id);
  assert.ok(p);
  const area = (await db.listAreas())[0];
  await db.openCashSession(500, 'admin');
  const authorization = { username: 'admin', passwordHash: await db.hashPassword('admin123') };
  if (cost !== null)
    await db.setProductCost(
      { commandId: randomUUID(), productId: id, cost, reason: 'Costo inicial' },
      'admin',
    );
  const cart = (q: number): CartItem[] => [
    { product: p, quantity: q, price: 100, areaId: area.id },
  ];
  const sale = async (q = 2, user = 'admin') =>
    db.registerSale(cart(q), 'transfer', [{ type: 'transfer', amount: q * 100 }], user);
  const consume = (q = 2) => ({
    commandId: randomUUID(),
    productId: id,
    areaId: area.id,
    quantity: q,
    reason: 'Uso interno',
    notes: 'Prueba',
    authorization,
  });
  return { ...h, db, p, id, area, authorization, cart, sale, consume };
}
check('consumo descuenta stock sin ventas ni efectivo esperado', async () => {
  const f = await fixture();
  const initialCash = await f.db.getCashSummary(1);
  await f.db.registerConsumption(f.consume(), 'admin');
  assert.equal((await f.db.getProduct(f.id))?.stock, 18);
  const closurePreview = await f.db.getCashClosurePreview(1);
  assert.equal((await f.db.getCashSummary(1)).expectedCash, initialCash.expectedCash);
  assert.equal((await f.db.getHomeSummary()).totalSales, 0);
  assert.equal((await f.db.listMovements()).filter((m) => m.type === 'CONSUMO_INTERNO').length, 1);
  const report = await f.db.getFinanceReport(all, 'admin');
  assert.equal(report.totals.net, 0);
  assert.equal(report.consumption.value, 200);
  assert.equal(report.consumption.knownCost, 80);
  assert.equal(closurePreview.products[0].expectedStock, 18);
});
check('anulación revierte stock y conserva registro y eventos', async () => {
  const f = await fixture();
  const input = f.consume();
  await f.db.registerConsumption(input, 'admin');
  await f.db.cancelConsumption(
    {
      id: input.commandId,
      commandId: randomUUID(),
      reason: 'Error de registro',
      authorization: f.authorization,
    },
    'admin',
  );
  assert.equal((await f.db.getProduct(f.id))?.stock, 20);
  const data = await f.db.getConsumptionData('admin');
  assert.equal(data.rows[0].status, 'anulado');
  assert.equal(data.events.length, 2);
  assert.equal((await f.db.getFinanceReport(all, 'admin')).consumption.value, 0);
  await assert.rejects(
    f.db.cancelConsumption(
      {
        id: input.commandId,
        commandId: randomUUID(),
        reason: 'Otra vez',
        authorization: f.authorization,
      },
      'admin',
    ),
  );
});
check('rectificación reemplaza retiro de forma atómica y auditable', async () => {
  const f = await fixture();
  const old = f.consume(2);
  await f.db.registerConsumption(old, 'admin');
  const replacement = {
    ...f.consume(3),
    replacesId: old.commandId,
    correctionReason: 'Cantidad correcta',
  };
  await f.db.registerConsumption(replacement, 'admin');
  assert.equal((await f.db.getProduct(f.id))?.stock, 17);
  const data = await f.db.getConsumptionData('admin');
  assert.equal(data.rows.find((r) => r.id === old.commandId)?.status, 'rectificado');
  assert.equal(data.rows.find((r) => r.id === replacement.commandId)?.replaces_id, old.commandId);
  assert.equal((await f.db.getFinanceReport(all, 'admin')).consumption.quantity, 3);
});
check('rectificación fallida no revierte retiro anterior', async () => {
  const f = await fixture();
  const old = f.consume();
  await f.db.registerConsumption(old, 'admin');
  await assert.rejects(
    f.db.registerConsumption(
      { ...f.consume(100), replacesId: old.commandId, correctionReason: 'Prueba' },
      'admin',
    ),
  );
  assert.equal((await f.db.getProduct(f.id))?.stock, 18);
  assert.equal((await f.db.getConsumptionData('admin')).rows[0].status, 'confirmado');
});
check('idempotencia persiste tras reinicializar sin duplicar stock ni historial', async () => {
  const f = await fixture();
  const input = f.consume();
  await f.db.registerConsumption(input, 'admin');
  await f.db.initializeDatabase();
  await f.db.registerConsumption(input, 'admin');
  assert.equal((await f.db.getProduct(f.id))?.stock, 18);
  assert.equal((await f.db.getConsumptionData('admin')).rows.length, 1);
  await assert.rejects(f.db.registerConsumption({ ...input, quantity: 3 }, 'admin'));
});
check('cambiar costo actual nunca cambia costo y ganancia de venta anterior', async () => {
  const f = await fixture();
  const id = await f.sale();
  await f.db.setProductCost(
    { commandId: randomUUID(), productId: f.id, cost: 75, reason: 'Nueva compra' },
    'admin',
  );
  const r = await f.db.getFinanceReport(all, 'admin');
  assert.equal(r.totals.knownCost, 80);
  assert.equal(r.totals.profit, 120);
  assert.equal((await f.db.getSale(id))?.lines[0].unit_cost, 40);
  assert.equal((await f.db.getInvestmentData('admin')).history.length, 2);
});
check('costos desconocidos siguen pendientes tras registrar costo actual', async () => {
  const f = await fixture(null);
  await f.sale();
  await f.db.setProductCost(
    { commandId: randomUUID(), productId: f.id, cost: 40, reason: 'Costo actual' },
    'admin',
  );
  const r = await f.db.getFinanceReport(all, 'admin');
  assert.equal(r.totals.profit, null);
  assert.equal(r.totals.margin, null);
  assert.equal(r.totals.missingCostLines, 1);
});
check('entrada aplica promedio ponderado y actualiza área única', async () => {
  const f = await fixture();
  const input = {
    commandId: randomUUID(),
    productId: f.id,
    areaId: f.area.id,
    quantity: 10,
    cost: 70,
    reason: 'Compra',
  };
  await f.db.receiveCostedStock(input, 'admin');
  await f.db.receiveCostedStock(input, 'admin');
  assert.equal((await f.db.getProduct(f.id))?.unit_cost, 50);
  assert.equal((await f.db.getProduct(f.id))?.stock, 30);
  assert.equal((await f.db.listAreaStock())[0].quantity, 30);
  assert.equal((await f.db.getFinanceReport(all, 'admin')).inventory.knownValue, 1500);
});
check('promedio ponderado bloqueado si stock antiguo tiene costo desconocido', async () => {
  const f = await fixture(null);
  await assert.rejects(
    f.db.receiveCostedStock(
      {
        commandId: randomUUID(),
        productId: f.id,
        areaId: f.area.id,
        quantity: 5,
        cost: 50,
        reason: 'Compra',
      },
      'admin',
    ),
  );
  assert.equal((await f.db.getProduct(f.id))?.stock, 20);
});
check('descuento devolución y anulación no inflan ventas ni ganancia', async () => {
  const f = await fixture();
  const saleId = await f.sale(4);
  const lineId = (await f.db.getSale(saleId))!.lines[0].id;
  await f.db.registerSaleAdjustment(
    {
      commandId: randomUUID(),
      saleId,
      lineId,
      kind: 'descuento',
      amount: 40,
      reason: 'Descuento',
      authorization: f.authorization,
    },
    'admin',
  );
  await f.db.registerSaleAdjustment(
    {
      commandId: randomUUID(),
      saleId,
      lineId,
      kind: 'devolucion',
      quantity: 1,
      reason: 'Devuelto',
      authorization: f.authorization,
    },
    'admin',
  );
  let r = await f.db.getFinanceReport(all, 'admin');
  assert.equal(r.totals.net, 270);
  assert.equal(r.totals.knownCost, 120);
  assert.equal(r.totals.profit, 150);
  assert.equal(r.totals.units, 3);
  await f.db.registerSaleAdjustment(
    {
      commandId: randomUUID(),
      saleId,
      kind: 'anulacion',
      reason: 'Anular restante',
      authorization: f.authorization,
    },
    'admin',
  );
  r = await f.db.getFinanceReport(all, 'admin');
  assert.equal(r.totals.net, 0);
  assert.equal(r.totals.knownCost, 0);
  assert.equal(r.totals.profit, 0);
  assert.equal(r.totals.units, 0);
  assert.equal((await f.db.getProduct(f.id))?.stock, 20);
  await assert.rejects(
    f.db.registerSaleAdjustment(
      {
        commandId: randomUUID(),
        saleId,
        lineId,
        kind: 'devolucion',
        quantity: 1,
        reason: 'Duplicado',
        authorization: f.authorization,
      },
      'admin',
    ),
  );
});
check(
  'devolver venta sin costo completamente elimina costo pendiente del período neto',
  async () => {
    const f = await fixture(null);
    const saleId = await f.sale();
    await f.db.registerSaleAdjustment(
      {
        commandId: randomUUID(),
        saleId,
        kind: 'anulacion',
        reason: 'Anulación',
        authorization: f.authorization,
      },
      'admin',
    );
    const r = await f.db.getFinanceReport(all, 'admin');
    assert.equal(r.totals.net, 0);
    assert.equal(r.totals.missingCostLines, 0);
    assert.equal(r.totals.profit, 0);
  },
);
check('venta mixta y devolución conservan ganancia y reembolso proporcional', async () => {
  const f = await fixture();
  const id = await f.db.registerSale(
    f.cart(2),
    'mixed',
    [
      { type: 'cash', amount: 50 },
      { type: 'transfer', amount: 150 },
    ],
    'admin',
    undefined,
    1,
    {
      cashReceived: 100,
      transferReceipt: {
        ci: '',
        fullName: '',
        address: '',
        amount: 150,
        reference: 'FINANCE-MIXED-001',
        receiptDate: '',
        rawText: 'Importe: 150 CUP',
        imageBase64: 'YWJj',
        reviewed: true,
      },
    },
  );
  const lineId = (await f.db.getSale(id))!.lines[0].id;
  await f.db.registerSaleAdjustment(
    {
      commandId: randomUUID(),
      saleId: id,
      lineId,
      kind: 'devolucion',
      quantity: 1,
      reason: 'Devuelto',
      authorization: f.authorization,
    },
    'admin',
  );
  const r = await f.db.getFinanceReport(all, 'admin');
  assert.equal(r.totals.net, 100);
  assert.equal(r.totals.profit, 60);
  const cash = await f.db.getCashClosurePreview(1);
  assert.equal((await f.db.getCashSummary(1)).expectedCash, 525);
  assert.equal(cash.transferSales, 75);
});
check('filtros incluyen exactamente inicio y final excluyendo el exterior', async () => {
  const f = await fixture();
  const a = await f.sale(1),
    b = await f.sale(1),
    c = await f.sale(1);
  f.database.run('UPDATE sales SET date=? WHERE id=?', ['2026-10-01T00:00:00.000Z', a]);
  f.database.run('UPDATE sales SET date=? WHERE id=?', ['2026-10-01T23:59:59.999Z', b]);
  f.database.run('UPDATE sales SET date=? WHERE id=?', ['2026-10-02T00:00:00.000Z', c]);
  const r = await f.db.getFinanceReport(
    { start: '2026-10-01T00:00:00.000Z', end: '2026-10-01T23:59:59.999Z' },
    'admin',
  );
  assert.equal(r.totals.net, 200);
  assert.equal(r.totals.operations, 2);
  await assert.rejects(f.db.getFinanceReport({ start: all.end, end: all.start }, 'admin'));
});
check('vendedor estable tras cambio de nombre y filtros producto categoría', async () => {
  const f = await fixture();
  const uid = await f.db.saveUser({ username: 'ana', password: 'ana123', role: 'seller' });
  await f.sale(2, 'ana');
  await f.db.saveUser({ id: uid, username: 'ana.nueva', role: 'seller' });
  await f.sale(1, 'ana.nueva');
  const r = await f.db.getFinanceReport(
    { ...all, sellerKey: `user:${uid}`, productId: f.id, category: 'Alimentos' },
    'admin',
  );
  assert.equal(r.sellers.length, 1);
  assert.equal(r.sellers[0].name, 'ana.nueva');
  assert.equal(r.sellers[0].net, 300);
  assert.equal(r.sellers[0].profit, 180);
  assert.equal(r.sellers[0].average, 150);
  const empty = await f.db.getFinanceReport({ ...all, category: 'Otra' }, 'admin');
  assert.equal(empty.totals.net, 0);
});
check(
  'costos y paneles están restringidos a admin y autorización de supervisor configurable',
  async () => {
    const f = await fixture();
    await f.db.saveUser({ username: 'vendedor', password: 'venta123', role: 'seller' });
    const sup = await f.db.saveUser({
      username: 'super',
      password: 'super123',
      role: 'supervisor',
    });
    await assert.rejects(f.db.getFinanceReport(all, 'vendedor'));
    await assert.rejects(f.db.getInvestmentData('super'));
    await assert.rejects(
      f.db.setProductCost(
        { commandId: randomUUID(), productId: f.id, cost: 1, reason: 'No autorizado' },
        'vendedor',
      ),
    );
    const input = {
      ...f.consume(),
      authorization: { username: 'super', passwordHash: await f.db.hashPassword('super123') },
    };
    await assert.rejects(f.db.registerConsumption(input, 'vendedor'));
    await f.db.setConsumptionPermission(sup, true, 'admin');
    await f.db.registerConsumption(input, 'vendedor');
    assert.equal((await f.db.getConsumptionData('vendedor')).rows[0].cost, null);
    assert.equal((await f.db.getConsumptionData('admin')).rows[0].authorizer_id, sup);
    for (const role of ['seller', 'supervisor', 'storekeeper', 'auditor'] as const) {
      assert.equal(canAccess(role, 'profitability'), false);
      assert.equal(canAccess(role, 'seller-performance'), false);
    }
  },
);
check('autorización incorrecta y fallo de escritura no dejan stock parcial', async () => {
  const f = await fixture();
  await assert.rejects(
    f.db.registerConsumption(
      { ...f.consume(), authorization: { username: 'admin', passwordHash: 'incorrecto' } },
      'admin',
    ),
  );
  f.failWritesContaining('INSERT INTO internal_consumptions');
  await assert.rejects(f.db.registerConsumption(f.consume(), 'admin'));
  assert.equal((await f.db.getProduct(f.id))?.stock, 20);
  assert.equal((await f.db.listAreaStock())[0].quantity, 20);
  assert.equal((await f.db.getConsumptionData('admin')).rows.length, 0);
});
check('descuentos subcentavo rechazados sin alterar informes', async () => {
  const f = await fixture();
  const saleId = await f.sale();
  const lineId = (await f.db.getSale(saleId))!.lines[0].id;
  await assert.rejects(
    f.db.registerSaleAdjustment(
      {
        commandId: randomUUID(),
        saleId,
        lineId,
        kind: 'descuento',
        amount: 1.001,
        reason: 'Prueba',
        authorization: f.authorization,
      },
      'admin',
    ),
  );
  assert.equal((await f.db.getFinanceReport(all, 'admin')).totals.net, 200);
});
check('retiro bloquea productos del carrito sin cobrar sin tocar stock ni caja', async () => {
  const f = await fixture(40, testModules);
  const tracker = testModules['@/lib/sale-draft'];
  tracker.trackSaleDraft('terminal:admin', [{ productId: f.id }]);
  const input = f.consume();
  const initialCash = (await f.db.getCashSummary(1)).expectedCash;
  await assert.rejects(f.db.registerConsumption(input, 'admin'), /venta sin cobrar/);
  assert.equal((await f.db.getProduct(f.id))?.stock, 20);
  assert.equal((await f.db.getConsumptionData('admin')).rows.length, 0);
  assert.equal((await f.db.getCashSummary(1)).expectedCash, initialCash);
  tracker.clearSaleDraft('terminal:admin');
  await f.db.registerConsumption(input, 'admin');
  assert.equal((await f.db.getProduct(f.id))?.stock, 18);
  // A confirmed command remains replayable even when a new cart contains the product.
  tracker.trackSaleDraft('terminal:admin', [{ productId: f.id }]);
  await f.db.registerConsumption(input, 'admin');
  assert.equal((await f.db.getProduct(f.id))?.stock, 18);
  tracker.clearSaleDraft('terminal:admin');
});
check('categorías marcan costos incompletos sin valorar desconocidos a cero', () => {
  const categories = inventoryByCategory([
    { category: 'Alimentos', stock: 5, unit_cost: 20 },
    { category: 'Alimentos', stock: 3, unit_cost: null },
    { category: 'Alimentos', stock: 0, unit_cost: null },
    { category: 'Bebidas', stock: 2, unit_cost: 10 },
    { category: 'Uso interno', stock: 4, unit_cost: 0 },
  ]);
  assert.deepEqual(categories, [
    { category: 'Alimentos', value: 100, missingCostProducts: 1 },
    { category: 'Bebidas', value: 20, missingCostProducts: 0 },
    { category: 'Uso interno', value: 0, missingCostProducts: 0 },
  ]);
});
async function closeFinanceFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const preview = await f.db.getCashClosurePreview(1);
  await f.db.closeCashSession(1, {
    denominations: [{ denomination: 500, quantity: 1 }],
    withdrawalCount: preview.withdrawalTotal,
    transferCount: preview.transferSales,
    products: preview.products.map((p) => ({
      productId: p.productId,
      physicalStock: p.expectedStock,
    })),
    adminUsername: 'admin',
    adminPassword: 'admin123',
  });
  return f.db.createBusinessArchive('admin');
}
check('traslado v6 conserva costos históricos ajustes consumo e idempotencia', async () => {
  const f = await fixture();
  const saleId = await f.sale();
  const lineId = (await f.db.getSale(saleId))!.lines[0].id;
  const consumption = f.consume(1);
  await f.db.registerConsumption(consumption, 'admin');
  await f.db.registerSaleAdjustment(
    {
      commandId: randomUUID(),
      saleId,
      lineId,
      kind: 'descuento',
      amount: 50,
      reason: 'Descuento acordado',
      authorization: f.authorization,
    },
    'admin',
  );
  await f.db.setProductCost(
    { commandId: randomUUID(), productId: f.id, cost: 60, reason: 'Nuevo costo' },
    'admin',
  );
  const reportBeforeArchive = await f.db.getFinanceReport(all, 'admin');
  const archive = await closeFinanceFixture(f);
  const target = createHarness();
  const db = target.load('@/lib/database');
  await db.initializeDatabase();
  await db.restoreBusinessArchive(archive, 'admin');
  const restored = await db.getFinanceReport(all, 'admin');
  assert.deepEqual(restored.totals, reportBeforeArchive.totals);
  assert.deepEqual(restored.consumption, reportBeforeArchive.consumption);
  assert.equal(restored.inventory.knownValue, reportBeforeArchive.inventory.knownValue);
  assert.equal((await db.getSale(saleId))!.lines[0].unit_cost, 40);
  assert.equal((await db.getInvestmentData('admin')).history.length, 2);
  await db.registerConsumption(consumption, 'admin');
  assert.equal((await db.getProduct(f.id))!.stock, 17);
  assert.equal((await db.getConsumptionData('admin')).rows.length, 1);
  await assert.rejects(db.restoreBusinessArchive(archive, 'admin'));
});
check('archivo legado v5 migra sin inventar costos ni identidad de vendedor', async () => {
  const f = await fixture(null);
  await f.sale();
  const archive = await closeFinanceFixture(f);
  const legacy = structuredClone(archive);
  legacy.schemaVersion = 5;
  const omitted = [
    { rows: legacy.tables.users, columns: ['can_authorize_consumption'] },
    { rows: legacy.tables.products, columns: ['unit_cost'] },
    { rows: legacy.tables.sales, columns: ['seller_id'] },
    { rows: legacy.tables.sale_lines, columns: ['unit_cost', 'category'] },
  ];
  for (const { rows, columns } of Object.values(omitted))
    for (const row of rows) for (const column of columns) delete row[column];
  const tables: Record<string, unknown> = legacy.tables;
  for (const table of [
    'cost_history',
    'internal_consumptions',
    'consumption_events',
    'sale_adjustments',
    'finance_commands',
  ])
    delete tables[table];
  const target = createHarness();
  const db = target.load('@/lib/database');
  await db.initializeDatabase();
  await db.restoreBusinessArchive(legacy, 'admin');
  const report = await db.getFinanceReport(all, 'admin');
  assert.equal(report.totals.net, 200);
  assert.equal(report.totals.profit, null);
  assert.equal(report.totals.missingCostLines, 1);
  assert.equal((await db.getSale(1))!.lines[0].unit_cost, null);
  assert.equal((await db.getSale(1))!.sale.seller_id, null);
  assert.equal((await db.getInvestmentData('admin')).history.length, 0);
});
const financeMutationCommand = (action: string) => ({
  commandId: randomUUID(),
  clientId: 'terminal-finance',
  action,
  username: 'admin',
  fingerprint: 'finance-cache-test',
});
check(
  'recibos LAN financieros validan número y string sin repetir acción ni tocar caja',
  async () => {
    const f = await fixture();
    const cost = { commandId: randomUUID(), productId: f.id, cost: 45, reason: 'Costo cacheado' };
    const numericCommand = financeMutationCommand('setProductCost');
    const id = await f.db.setProductCost(cost, 'admin', numericCommand);
    const consumption = f.consume(1);
    const recordCommand = financeMutationCommand('registerConsumption');
    const record = await f.db.registerConsumption(consumption, 'admin', recordCommand);
    const initial = f.database.export();
    assert.equal(await f.db.setProductCost(cost, 'admin', numericCommand), id);
    assert.equal(await f.db.registerConsumption(consumption, 'admin', recordCommand), record);
    assert.deepEqual(f.database.export(), initial);
    for (const value of [null, {}, '1', 0, -1]) {
      f.database.run('UPDATE network_commands SET response=? WHERE command_id=?', [
        JSON.stringify({ value }),
        numericCommand.commandId,
      ]);
      const bytesBefore = f.database.export();
      await assert.rejects(f.db.setProductCost(cost, 'admin', numericCommand));
      assert.deepEqual(f.database.export(), bytesBefore);
    }
    for (const value of [null, {}, 1, '']) {
      f.database.run('UPDATE network_commands SET response=? WHERE command_id=?', [
        JSON.stringify({ value }),
        recordCommand.commandId,
      ]);
      const bytesBefore = f.database.export();
      await assert.rejects(f.db.registerConsumption(consumption, 'admin', recordCommand));
      assert.deepEqual(f.database.export(), bytesBefore);
    }
  },
);
check(
  'settlement histórico usa schema shared y corrupción no escribe ni borra tarjeta',
  async () => {
    const f = await fixture();
    const saleId = await f.sale();
    const settlement = { cashReceived: null, transferReceipt: null, changeDue: 0 };
    // Seed a migrated historical row; ordinary card edits remain prohibited by the trigger.
    f.database.run('UPDATE sales SET legacy_card=1 WHERE id=?', [saleId]);
    f.database.run('UPDATE sales SET method=?,payments=?,settlement=? WHERE id=?', [
      'card',
      JSON.stringify([{ type: 'card', amount: 200 }]),
      JSON.stringify(settlement),
      saleId,
    ]);
    const initial = f.database.export();
    const sale = await f.db.getSale(saleId);
    assert.equal(sale?.sale.method, 'card');
    assert.deepEqual(sale?.sale.payments, [{ type: 'card', amount: 200 }]);
    assert.deepEqual(sale?.sale.settlement, settlement);
    assert.deepEqual(f.database.export(), initial);
    for (const corrupted of [
      '{broken',
      '{}',
      'null',
      '[]',
      JSON.stringify({ ...settlement, changeDue: '0' }),
      JSON.stringify({ ...settlement, transferReceipt: {} }),
    ]) {
      f.database.run('UPDATE sales SET settlement=? WHERE id=?', [corrupted, saleId]);
      const bytesBefore = f.database.export();
      await assert.rejects(f.db.getSale(saleId));
      assert.deepEqual(f.database.export(), bytesBefore);
    }
    f.database.run('UPDATE sales SET settlement=NULL WHERE id=?', [saleId]);
    assert.equal((await f.db.getSale(saleId))?.sale.settlement, null);
  },
);
check('períodos calendario usan lunes y límites completos inclusivos', () => {
  const date = new Date(2026, 9, 15, 12);
  const week = periodRange('Semana actual', date, date, date);
  assert.equal(new Date(week.start).getDay(), 1);
  assert.equal(new Date(week.end).getDay(), 0);
  assert.equal(new Date(week.end).getHours(), 23);
  const month = periodRange('Mes anterior', date, date, date);
  assert.equal(new Date(month.start).getMonth(), 8);
  assert.equal(new Date(month.end).getDate(), 30);
});
