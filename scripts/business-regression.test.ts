import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHarness, prepareHarness } from './pos-test-harness';
import type { BusinessCommand } from '../lib/business-models';
import { BUSINESS_V10_TABLES, BUSINESS_V11_TABLES } from '../lib/business-schema';
import type { CartItem } from '../lib/models';
import { canAccess } from '../lib/permissions';

let passed = 0,
  failed = 0;
const failures: { name: string; message: string; stack?: string }[] = [];
before(prepareHarness);
after(() => {
  mkdirSync('.expo', { recursive: true });
  writeFileSync(
    '.expo/business-regression-results.json',
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        passed,
        failed,
        tests: passed + failed,
        failures,
      },
      null,
      2,
    ),
  );
});
function check(name: string, action: () => Promise<void>) {
  void test(name, async () => {
    try {
      await action();
      passed++;
    } catch (e) {
      failed++;
      failures.push({
        name,
        message: e instanceof Error ? e.message : String(e),
        ...(e instanceof Error && e.stack ? { stack: e.stack } : {}),
      });
      throw e;
    }
  });
}
type Body<T> = T extends unknown ? Omit<T, 'commandId'> : never;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function fixture() {
  const h = createHarness();
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  const productId = await db.saveProduct(
    {
      name: 'Café molido',
      category: 'Alimentos',
      subcategory: '',
      stock: 50,
      price_cash: 200,
      price_transfer: 200,
      unit: 'u',
      quantity_decimals: 0,
      image_path: null,
    },
    'admin',
  );
  await db.setProductCost(
    { commandId: randomUUID(), productId, cost: 80, reason: 'Costo inicial' },
    'admin',
  );
  await db.addArea('Tienda Centro');
  const areas = await db.listAreas();
  const warehouse = areas.find((a) => a.name === 'Almacén principal')!;
  const store = areas.find((a) => a.name === 'Tienda Centro')!;
  const run = (body: Body<BusinessCommand>, user = 'admin', commandId = randomUUID()) =>
    db.executeBusinessCommand({ ...body, commandId }, user);
  const data = (user = 'admin') => db.getBusinessData({}, user);
  const stockAt = async (areaId: number) =>
    (await db.listAreaStock()).find((s) => s.area_id === areaId && s.product_id === productId)
      ?.quantity ?? 0;
  const product = async () => (await db.getProduct(productId))!;
  return { ...h, db, run, data, productId, warehouse, store, stockAt, product };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function sell(f: Fixture, areaId: number, quantity = 1) {
  const product = await f.product();
  const cart: CartItem[] = [{ product, quantity, price: 200, areaId }];
  return f.db.registerSale(cart, 'cash', [{ type: 'cash', amount: 200 * quantity }], 'admin');
}

check('migración v10 crea las tablas empresariales con protección de historial', async () => {
  const f = await fixture();
  assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 11);
  for (const table of [...BUSINESS_V10_TABLES, ...BUSINESS_V11_TABLES]) {
    const triggers = f.database.exec(
      `SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='${table}' AND name LIKE 'recovery_capture_%'`,
    )[0].values[0][0];
    assert.equal(triggers, 3, table);
  }
  // Re-running the migration is idempotent.
  await f.db.initializeDatabase();
  assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 11);
});

check('base v9 existente migra a v10 sin perder datos', async () => {
  const f = await fixture();
  await f.db.openCashSession(100, 'admin');
  await sell(f, f.warehouse.id);
  for (const table of [...BUSINESS_V10_TABLES, ...BUSINESS_V11_TABLES].toReversed())
    f.database.run(`DROP TABLE ${table}`);
  f.database.run('PRAGMA user_version=9');
  await f.db.initializeDatabase();
  assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 11);
  assert.equal(f.database.exec('SELECT COUNT(*) FROM sales')[0].values[0][0], 1);
  assert.equal(f.database.exec('SELECT COUNT(*) FROM sale_tickets')[0].values[0][0], 0);
  assert.equal(
    f.database.exec(
      "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='recovery_capture_branches_insert'",
    )[0].values[0][0],
    1,
  );
});

check('sucursales: tickets numerados por sucursal con prefijo', async () => {
  const f = await fixture();
  const branchId = Number(
    await f.run({
      action: 'branch.save',
      name: 'Centro',
      code: 'CEN',
      address: 'Calle 1',
      ticketPrefix: 'C',
      active: true,
    }),
  );
  await f.run({ action: 'branch.assignArea', areaId: f.store.id, branchId });
  // Move stock to the store with a transfer so it can sell there.
  const transferId = await f.run({
    action: 'transfer.send',
    fromAreaId: f.warehouse.id,
    toAreaId: f.store.id,
    note: '',
    lines: [{ productId: f.productId, quantity: 10 }],
  });
  const line = (await f.data()).transferLines.find((l) => l.transfer_id === transferId)!;
  await f.run({
    action: 'transfer.receive',
    transferId,
    note: '',
    lines: [{ lineId: line.id, received: 10 }],
  });
  await f.db.openCashSession(0, 'admin');
  const a = await sell(f, f.store.id);
  const b = await sell(f, f.store.id);
  const c = await sell(f, f.warehouse.id);
  assert.deepEqual(
    [(await f.db.getSaleTicket(a))?.label, (await f.db.getSaleTicket(b))?.label],
    ['C-000001', 'C-000002'],
  );
  const principal = await f.db.getSaleTicket(c);
  assert.equal(principal?.label, '000001');
  assert.equal(principal?.branchName, 'Sucursal principal');
  await assert.rejects(
    f.run({
      action: 'branch.save',
      name: 'centro',
      code: 'X',
      address: '',
      ticketPrefix: '',
      active: true,
    }),
    /Ya existe/,
  );
  assert.throws(() => f.database.run('UPDATE sale_tickets SET ticket_number=99'), /no se modifica/);
});

check(
  'traslados: tránsito, recepción parcial, devolución y merma conservan inventario',
  async () => {
    const f = await fixture();
    const initial = (await f.product()).stock;
    const id = await f.run({
      action: 'transfer.send',
      fromAreaId: f.warehouse.id,
      toAreaId: f.store.id,
      note: 'Reposición',
      lines: [{ productId: f.productId, quantity: 10 }],
    });
    assert.equal(await f.stockAt(f.warehouse.id), 40);
    assert.equal((await f.product()).stock, initial - 10);
    let snapshot = await f.data();
    assert.equal(snapshot.consolidation?.totals.inTransitValue, 800);
    const line = snapshot.transferLines.find((l) => l.transfer_id === id)!;
    await assert.rejects(
      f.run({
        action: 'transfer.receive',
        transferId: id,
        note: '',
        lines: [{ lineId: line.id, received: 11 }],
      }),
      /más de lo pendiente/,
    );
    await f.run({
      action: 'transfer.receive',
      transferId: id,
      note: '',
      lines: [{ lineId: line.id, received: 6 }],
    });
    assert.equal(await f.stockAt(f.store.id), 6);
    snapshot = await f.data();
    assert.equal(snapshot.transfers.find((t) => t.id === id)?.status, 'partial');
    await assert.rejects(
      f.run({ action: 'transfer.cancel', transferId: id, reason: 'Ya no' }),
      /sin recepciones/,
    );
    await f.run({
      action: 'transfer.resolve',
      transferId: id,
      lineId: line.id,
      resolution: 'loss',
      reason: 'Roto en el camino',
    });
    snapshot = await f.data();
    assert.equal(snapshot.transfers.find((t) => t.id === id)?.status, 'received');
    assert.equal(snapshot.consolidation?.totals.inTransitValue, 0);
    assert.equal((await f.product()).stock, initial - 4);
    // area_stock and products.stock stay consistent.
    const sum = f.database.exec(
      `SELECT ABS(p.stock-(SELECT SUM(quantity) FROM area_stock WHERE product_id=p.id)) FROM products p`,
    )[0].values[0][0];
    assert.ok(Number(sum) < 0.001);
    // Closed transfers cannot be altered.
    await assert.rejects(
      f.run({
        action: 'transfer.resolve',
        transferId: id,
        lineId: line.id,
        resolution: 'return',
        reason: 'Otra vez',
      }),
      /cerrado/,
    );
    // Cancel returns everything to origin.
    const second = await f.run({
      action: 'transfer.send',
      fromAreaId: f.warehouse.id,
      toAreaId: f.store.id,
      note: '',
      lines: [{ productId: f.productId, quantity: 5 }],
    });
    await f.run({
      action: 'transfer.cancel',
      transferId: second,
      reason: 'Error de carga',
    });
    assert.equal(await f.stockAt(f.warehouse.id), 40);
    await assert.rejects(
      f.run({
        action: 'transfer.send',
        fromAreaId: f.warehouse.id,
        toAreaId: f.store.id,
        note: '',
        lines: [{ productId: f.productId, quantity: 999 }],
      }),
      /Stock insuficiente/,
    );
  },
);

check('traslados aparecen en el cierre como salidas y entradas de inventario', async () => {
  const f = await fixture();
  const session = await f.db.openCashSession(0, 'admin');
  const id = await f.run({
    action: 'transfer.send',
    fromAreaId: f.warehouse.id,
    toAreaId: f.store.id,
    note: '',
    lines: [{ productId: f.productId, quantity: 4 }],
  });
  const line = (await f.data()).transferLines.find((l) => l.transfer_id === id)!;
  await f.run({
    action: 'transfer.receive',
    transferId: id,
    note: '',
    lines: [{ lineId: line.id, received: 3 }],
  });
  const movements = await f.db.listMovements();
  assert.ok(movements.some((m) => m.type === 'salida' && m.quantity === 4));
  assert.ok(movements.some((m) => m.type === 'entrada' && m.quantity === 3));
  const preview = await f.db.getCashClosurePreview(session);
  assert.equal(preview.otherCashNet, 0);
});

check('crédito: límite, cobros en efectivo, anulación y caja esperada', async () => {
  const f = await fixture();
  const session = await f.db.openCashSession(100, 'admin');
  const partyId = Number(
    await f.run({
      action: 'party.save',
      kind: 'client',
      name: 'Bodega La Esquina',
      document: '',
      phone: '',
      email: '',
      address: '',
      creditLimit: 1000,
      notes: '',
      active: true,
    }),
  );
  await f.run({
    action: 'ledger.charge',
    partyId,
    side: 'receivable',
    amount: 600,
    reference: 'Factura 1',
    note: '',
  });
  await assert.rejects(
    f.run({
      action: 'ledger.charge',
      partyId,
      side: 'receivable',
      amount: 500,
      reference: '',
      note: '',
    }),
    /límite de crédito/,
  );
  await assert.rejects(
    f.run({
      action: 'ledger.charge',
      partyId,
      side: 'payable',
      amount: 10,
      reference: '',
      note: '',
    }),
    /proveedores/,
  );
  await assert.rejects(
    f.run({
      action: 'ledger.payment',
      partyId,
      side: 'receivable',
      amount: 700,
      method: 'cash',
      reference: '',
      note: '',
    }),
    /supera el saldo/,
  );
  const payment = await f.run({
    action: 'ledger.payment',
    partyId,
    side: 'receivable',
    amount: 250,
    method: 'cash',
    reference: '',
    note: '',
  });
  let data = await f.data();
  assert.equal(data.balances.find((b) => b.partyId === partyId)?.receivable, 350);
  let summary = await f.db.getCashSummary(session);
  assert.equal(summary.otherCashNet, 250);
  assert.equal(summary.expectedCash, 350);
  await f.run({
    action: 'ledger.void',
    entryId: payment,
    reason: 'Pago duplicado',
  });
  await assert.rejects(
    f.run({ action: 'ledger.void', entryId: payment, reason: 'Otra vez' }),
    /ya fue anulado/,
  );
  data = await f.data();
  assert.equal(data.balances.find((b) => b.partyId === partyId)?.receivable, 600);
  summary = await f.db.getCashSummary(session);
  assert.equal(summary.expectedCash, 100);
  assert.throws(() => f.database.run('DELETE FROM party_ledger'), /inalterable/);
  assert.throws(() => f.database.run('UPDATE cash_entries SET amount=1'), /inalterable/);
});

check('cobro en efectivo exige caja abierta y el cierre lo incluye', async () => {
  const f = await fixture();
  const partyId = Number(
    await f.run({
      action: 'party.save',
      kind: 'both',
      name: 'Proveedor y cliente',
      document: '',
      phone: '',
      email: '',
      address: '',
      creditLimit: 0,
      notes: '',
      active: true,
    }),
  );
  await f.run({
    action: 'ledger.charge',
    partyId,
    side: 'receivable',
    amount: 300,
    reference: '',
    note: '',
  });
  await assert.rejects(
    f.run({
      action: 'ledger.payment',
      partyId,
      side: 'receivable',
      amount: 100,
      method: 'cash',
      reference: '',
      note: '',
    }),
    /Abre la caja/,
  );
  const session = await f.db.openCashSession(50, 'admin');
  await f.run({
    action: 'ledger.payment',
    partyId,
    side: 'receivable',
    amount: 100,
    method: 'cash',
    reference: '',
    note: '',
  });
  const result = await f.db.closeCashSession(session, {
    denominations: [
      { denomination: 100, quantity: 1 },
      { denomination: 50, quantity: 1 },
    ],
    withdrawalCount: 0,
    transferCount: 0,
    products: [],
    adminUsername: 'admin',
    adminPassword: 'admin123',
  });
  assert.equal(result.expectedCash, 150);
  assert.equal(result.cashDifference, 0);
  assert.equal(result.totalDifference, 0);
});

check('monedas: tasa vigente, conversión y moneda extranjera fuera del arqueo', async () => {
  const f = await fixture();
  await f.run({
    action: 'currency.save',
    code: 'CUP',
    name: 'Peso cubano',
    symbol: '$',
    decimals: 2,
  });
  await f.run({ action: 'currency.setBase', code: 'CUP' });
  await f.run({
    action: 'currency.save',
    code: 'USD',
    name: 'Dólar',
    symbol: 'US$',
    decimals: 2,
  });
  const partyId = Number(
    await f.run({
      action: 'party.save',
      kind: 'supplier',
      name: 'Importadora',
      document: '',
      phone: '',
      email: '',
      address: '',
      creditLimit: 0,
      notes: '',
      active: true,
    }),
  );
  await assert.rejects(
    f.run({
      action: 'ledger.charge',
      partyId,
      side: 'payable',
      amount: 10,
      currency: 'USD',
      reference: '',
      note: '',
    }),
    /tasa de cambio vigente/,
  );
  await f.run({
    action: 'currency.rate',
    code: 'USD',
    rate: 320,
    effectiveDate: today(),
    source: 'Mercado',
  });
  await assert.rejects(
    f.run({
      action: 'currency.rate',
      code: 'CUP',
      rate: 2,
      effectiveDate: today(),
      source: '',
    }),
    /siempre vale 1/,
  );
  await f.run({
    action: 'ledger.charge',
    partyId,
    side: 'payable',
    amount: 10,
    currency: 'USD',
    reference: '',
    note: '',
  });
  const session = await f.db.openCashSession(0, 'admin');
  await f.run({
    action: 'ledger.payment',
    partyId,
    side: 'payable',
    amount: 5,
    currency: 'USD',
    method: 'cash',
    reference: '',
    note: '',
  });
  const data = await f.data();
  assert.equal(data.balances.find((b) => b.partyId === partyId)?.payable, 1600);
  const summary = await f.db.getCashSummary(session);
  assert.equal(summary.otherCashNet, 0);
  assert.deepEqual(summary.foreignCash, [{ currency: 'USD', net: -5 }]);
  await assert.rejects(f.run({ action: 'currency.setBase', code: 'USD' }), /no se cambia/);
});

check('nómina: borrador, aprobación, pago en efectivo, anulación y solapes', async () => {
  const f = await fixture();
  const employeeId = Number(
    await f.run({
      action: 'employee.save',
      name: 'Ana Pérez',
      document: '',
      position: 'Dependienta',
      branchId: null,
      baseSalary: 3000,
      payPeriod: 'monthly',
      startDate: '2026-01-01',
      endDate: null,
      active: true,
    }),
  );
  const runId = await f.run({
    action: 'payroll.create',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    contributionRate: 12.5,
    note: '',
    lines: [{ employeeId, base: 3000, bonuses: 500, deductions: 200 }],
  });
  await assert.rejects(
    f.run({
      action: 'payroll.create',
      periodStart: '2026-10-15',
      periodEnd: '2026-11-14',
      contributionRate: 0,
      note: '',
      lines: [{ employeeId, base: 3000, bonuses: 0, deductions: 0 }],
    }),
    /ya tiene una nómina/,
  );
  await assert.rejects(f.run({ action: 'payroll.pay', runId, method: 'cash' }), /Aprueba/);
  await f.run({ action: 'payroll.approve', runId });
  const session = await f.db.openCashSession(5000, 'admin');
  await f.run({ action: 'payroll.pay', runId, method: 'cash' });
  let data = await f.data();
  const run = data.payrollRuns.find((r) => r.id === runId)!;
  assert.deepEqual(
    [run.status, run.gross_total, run.net_total, run.contribution_total],
    ['paid', 3500, 3300, 437.5],
  );
  assert.equal((await f.db.getCashSummary(session)).expectedCash, 1700);
  assert.throws(
    () => f.database.run(`UPDATE payroll_runs SET net_total=1 WHERE id='${runId}'`),
    /no se modifican/,
  );
  assert.throws(
    () => f.database.run(`UPDATE payroll_runs SET status='draft' WHERE id='${runId}'`),
    /no permitido/,
  );
  await f.run({ action: 'payroll.void', runId, reason: 'Error en horas' });
  data = await f.data();
  assert.equal(data.payrollRuns.find((r) => r.id === runId)?.status, 'void');
  assert.equal((await f.db.getCashSummary(session)).expectedCash, 5000);
  // A voided period can be issued again.
  await f.run({
    action: 'payroll.create',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    contributionRate: 0,
    note: '',
    lines: [{ employeeId, base: 3000, bonuses: 0, deductions: 0 }],
  });
});

check('socios: participaciones hasta 100 %, aportes, retiros y capital', async () => {
  const f = await fixture();
  const a = Number(
    await f.run({
      action: 'partner.save',
      name: 'Socio A',
      document: '',
      sharePercent: 60,
      joinedAt: '2025-01-01',
      active: true,
    }),
  );
  await assert.rejects(
    f.run({
      action: 'partner.save',
      name: 'Socio B',
      document: '',
      sharePercent: 50,
      joinedAt: '2025-01-01',
      active: true,
    }),
    /100 %/,
  );
  await f.run({
    action: 'partner.save',
    name: 'Socio B',
    document: '',
    sharePercent: 40,
    joinedAt: '2025-01-01',
    active: true,
  });
  await f.run({
    action: 'partner.movement',
    partnerId: a,
    kind: 'contribution',
    amount: 10000,
    method: 'transfer',
    note: '',
  });
  const withdrawal = await f.run({
    action: 'partner.movement',
    partnerId: a,
    kind: 'withdrawal',
    amount: 2500,
    method: 'transfer',
    note: '',
  });
  await f.run({
    action: 'partner.movement',
    partnerId: a,
    kind: 'dividend',
    amount: 1000,
    method: 'transfer',
    note: '',
  });
  let data = await f.data();
  assert.equal(data.consolidation?.totals.partnerCapital, 7500);
  await f.run({
    action: 'partner.void',
    movementId: withdrawal,
    reason: 'No procede',
  });
  data = await f.data();
  assert.equal(data.consolidation?.totals.partnerCapital, 10000);
});

check('consolidado por sucursal: ventas, tickets, inventario valorado y saldos', async () => {
  const f = await fixture();
  const branchId = Number(
    await f.run({
      action: 'branch.save',
      name: 'Centro',
      code: 'CEN',
      address: '',
      ticketPrefix: '',
      active: true,
    }),
  );
  await f.run({ action: 'branch.assignArea', areaId: f.store.id, branchId });
  const id = await f.run({
    action: 'transfer.send',
    fromAreaId: f.warehouse.id,
    toAreaId: f.store.id,
    note: '',
    lines: [{ productId: f.productId, quantity: 10 }],
  });
  const line = (await f.data()).transferLines.find((l) => l.transfer_id === id)!;
  await f.run({
    action: 'transfer.receive',
    transferId: id,
    note: '',
    lines: [{ lineId: line.id, received: 10 }],
  });
  await f.db.openCashSession(0, 'admin');
  await sell(f, f.store.id, 2);
  await sell(f, f.warehouse.id, 1);
  const c = (await f.data()).consolidation!;
  const centro = c.branches.find((b) => b.branchId === branchId)!;
  const principal = c.branches.find((b) => b.branchId === null)!;
  assert.deepEqual([centro.sales, centro.tickets, centro.inventoryValue], [400, 1, 640]);
  assert.deepEqual([principal.sales, principal.tickets, principal.inventoryValue], [200, 1, 3120]);
  assert.equal(c.totals.sales, 600);
  assert.equal(c.totals.inventoryValue, 3760);
});

check(
  'permisos: almacenero traslada, auditor consulta y no ejecuta, vendedor sin acceso',
  async () => {
    const f = await fixture();
    await f.db.saveUser({
      username: 'almacen',
      password: 'almacen-123',
      role: 'storekeeper',
    });
    await f.db.saveUser({
      username: 'auditor',
      password: 'auditor-123',
      role: 'auditor',
    });
    await f.db.saveUser({
      username: 'vendedor',
      password: 'vendedor-123',
      role: 'seller',
    });
    await f.run(
      {
        action: 'transfer.send',
        fromAreaId: f.warehouse.id,
        toAreaId: f.store.id,
        note: '',
        lines: [{ productId: f.productId, quantity: 1 }],
      },
      'almacen',
    );
    await assert.rejects(
      f.run(
        {
          action: 'branch.save',
          name: 'X',
          code: 'X',
          address: '',
          ticketPrefix: '',
          active: true,
        },
        'almacen',
      ),
      /permiso/,
    );
    const storekeeperView = await f.data('almacen');
    assert.equal(storekeeperView.transfers.length, 1);
    assert.equal(storekeeperView.consolidation, null);
    assert.equal(storekeeperView.parties.length, 0);
    assert.ok((await f.data('auditor')).consolidation);
    await assert.rejects(
      f.run(
        {
          action: 'currency.save',
          code: 'USD',
          name: 'Dólar',
          symbol: '$',
          decimals: 2,
        },
        'auditor',
      ),
      /permiso/,
    );
    await assert.rejects(f.data('vendedor'), /permiso/);
    assert.equal(canAccess('storekeeper', 'transfers'), true);
    assert.equal(canAccess('storekeeper', 'business'), false);
    assert.equal(canAccess('auditor', 'business'), true);
    assert.equal(canAccess('seller', 'transfers'), false);
  },
);

const partyBody = (kind: 'client' | 'supplier' | 'both', name: string, creditLimit = 0) => ({
  action: 'party.save' as const,
  kind,
  name,
  document: '',
  phone: '',
  email: '',
  address: '',
  creditLimit,
  notes: '',
  active: true,
});

check(
  'v11 venta a crédito: cuenta por cobrar, sin efectivo en caja y sin anulación directa',
  async () => {
    const f = await fixture();
    const client = Number(await f.run(partyBody('client', 'Ana', 300)));
    const supplier = Number(await f.run(partyBody('supplier', 'Mayorista')));
    const session = await f.db.openCashSession(100, 'admin');
    const saleId = await sell(f, f.warehouse.id, 1);
    const credit = (partyId: number, user = 'admin') =>
      f.db.executeSaleCommand(
        { commandId: randomUUID(), action: 'sale.credit', saleId, partyId },
        user,
      );
    await assert.rejects(credit(supplier), /clientes/);
    const ledgerId = await credit(client);
    await assert.rejects(credit(client), /ya tiene un cobro/);
    const preview = await f.db.getCashClosurePreview(session);
    assert.equal(preview.cashSales, 200);
    assert.equal(preview.otherCashNet, -200);
    const balances = (await f.data()).balances.find((b) => b.partyId === client);
    assert.equal(balances?.receivable, 200);
    await assert.rejects(
      f.run({ action: 'ledger.void', entryId: ledgerId, reason: 'Error de cliente' }),
      /venta a crédito/,
    );
    // Credit limit is enforced on the second sale (200 + 200 > 300).
    const second = await sell(f, f.warehouse.id, 1);
    await assert.rejects(
      f.db.executeSaleCommand(
        { commandId: randomUUID(), action: 'sale.credit', saleId: second, partyId: client },
        'admin',
      ),
      /límite de crédito/,
    );
    // A seller only settles their own sales.
    await f.db.saveUser({ username: 'vendedor', password: 'Vende-1234', role: 'seller' });
    await assert.rejects(
      f.db.executeSaleCommand(
        { commandId: randomUUID(), action: 'sale.credit', saleId: second, partyId: client },
        'vendedor',
      ),
      /tus propias ventas/,
    );
  },
);

check('v11 cobro en divisa: vuelto en moneda base y arqueo separado', async () => {
  const f = await fixture();
  await f.run({ action: 'currency.save', code: 'USD', name: 'Dólar', symbol: 'US$', decimals: 2 });
  await f.run({
    action: 'currency.rate',
    code: 'USD',
    rate: 300,
    effectiveDate: today(),
    source: 'Mercado',
  });
  const session = await f.db.openCashSession(1000, 'admin');
  const saleId = await sell(f, f.warehouse.id, 2); // 400 CUP
  const fx = (amount: number, currency = 'USD') =>
    f.db.executeSaleCommand(
      { commandId: randomUUID(), action: 'sale.fx', saleId, currency, amount },
      'admin',
    );
  await assert.rejects(fx(1), /no cubre/);
  await assert.rejects(fx(5, 'CUP'), /distinta/);
  await fx(2); // 600 CUP equivalent, 200 CUP change
  const preview = await f.db.getCashClosurePreview(session);
  // Drawer: 1000 fund + 400 sale - 600 equivalent = 800 CUP (1000 - 200 change) and 2 USD.
  assert.equal(preview.fund + preview.cashSales + preview.otherCashNet, 800);
  assert.deepEqual(preview.foreignCash, [{ currency: 'USD', net: 2 }]);
});

check('v11 compra a proveedor: entrada valorada, cuenta por pagar o pago en caja', async () => {
  const f = await fixture();
  const supplier = Number(await f.run(partyBody('supplier', 'Distribuidora')));
  const client = Number(await f.run(partyBody('client', 'Solo cliente')));
  const initial = await f.stockAt(f.warehouse.id);
  const purchase = (payment: 'credit' | 'cash', partyId = supplier) =>
    f.run({
      action: 'purchase.receive',
      partyId,
      areaId: f.warehouse.id,
      lines: [{ productId: f.productId, quantity: 10, cost: 100 }],
      payment,
      reference: 'FAC-1',
    });
  await assert.rejects(purchase('credit', client), /proveedores/);
  await purchase('credit');
  assert.equal(await f.stockAt(f.warehouse.id), initial + 10);
  // Weighted average: 50 at 80 + 10 at 100 = 83.33.
  assert.equal(Math.round(((await f.product()).unit_cost ?? 0) * 100) / 100, 83.33);
  let balance = (await f.data()).balances.find((b) => b.partyId === supplier);
  assert.equal(balance?.payable, 1000);
  await assert.rejects(purchase('cash'), /Abre la caja/);
  const session = await f.db.openCashSession(2000, 'admin');
  await purchase('cash');
  balance = (await f.data()).balances.find((b) => b.partyId === supplier);
  assert.equal(balance?.payable, 1000);
  assert.equal((await f.db.getCashClosurePreview(session)).otherCashNet, -1000);
});

check('v11 conteo físico ajusta existencias con motivo y respeta permisos', async () => {
  const f = await fixture();
  const start = await f.stockAt(f.warehouse.id);
  const count = (counted: number, user = 'admin') =>
    f.run(
      {
        action: 'inventory.count',
        areaId: f.warehouse.id,
        lines: [{ productId: f.productId, counted }],
        reason: 'Conteo mensual',
      },
      user,
    );
  await count(start - 3);
  assert.equal(await f.stockAt(f.warehouse.id), start - 3);
  assert.equal((await f.product()).stock, start - 3);
  await count(start + 1);
  assert.equal(await f.stockAt(f.warehouse.id), start + 1);
  await assert.rejects(count(1.5), /decimal|entera|cantidad/i);
  await f.db.saveUser({ username: 'almacen', password: 'Almacen-123', role: 'storekeeper' });
  await count(start, 'almacen');
  await f.db.saveUser({ username: 'vende', password: 'Vende-1234', role: 'seller' });
  await assert.rejects(count(start, 'vende'), /permiso/);
  const audit = f.database.exec(
    "SELECT COUNT(*) FROM audit_log WHERE action='business.inventory.count'",
  );
  assert.equal(audit[0].values[0][0], 3);
});

check(
  'v11 código de barras único, stock mínimo y precio mayorista validado en la venta',
  async () => {
    const f = await fixture();
    const other = await f.db.saveProduct(
      {
        name: 'Azúcar',
        category: 'Alimentos',
        subcategory: '',
        stock: 0,
        price_cash: 50,
        price_transfer: 50,
        unit: 'u',
        quantity_decimals: 0,
        image_path: null,
      },
      'admin',
    );
    const extras = (productId: number, barcode: string, more: Record<string, unknown> = {}) =>
      f.run({ action: 'product.extras', productId, barcode, minStock: 5, ...more });
    await extras(f.productId, '7501031311309', { wholesalePrice: 150, wholesaleMinQty: 6 });
    await assert.rejects(extras(other, '7501031311309'), /ya pertenece/);
    await assert.rejects(extras(other, '12'), /4 a 64/);
    await assert.rejects(extras(other, '1234', { wholesalePrice: 10 }), /ambos/);
    const list = await f.db.listProductExtras();
    assert.equal(list.length, 1);
    assert.equal(list[0].barcode, '7501031311309');
    await f.db.openCashSession(0, 'admin');
    const product = await f.product();
    // Below the minimum the regular tariff applies; at 6 units the wholesale tier is required.
    await assert.rejects(
      f.db.registerSale(
        [{ product, quantity: 6, price: 200, areaId: f.warehouse.id }],
        'cash',
        [{ type: 'cash', amount: 1200 }],
        'admin',
      ),
      /precio/,
    );
    await f.db.registerSale(
      [{ product, quantity: 6, price: 150, areaId: f.warehouse.id }],
      'cash',
      [{ type: 'cash', amount: 900 }],
      'admin',
    );
    await f.db.registerSale(
      [{ product, quantity: 1, price: 200, areaId: f.warehouse.id }],
      'cash',
      [{ type: 'cash', amount: 200 }],
      'admin',
    );
    // Clearing every extra removes the row.
    await f.run({ action: 'product.extras', productId: f.productId, barcode: '', minStock: 0 });
    assert.equal((await f.db.listProductExtras()).length, 0);
  },
);

check('comandos idempotentes: reintento no duplica y otro contenido se rechaza', async () => {
  const f = await fixture();
  const commandId = randomUUID();
  const body: Body<BusinessCommand> = {
    action: 'transfer.send',
    fromAreaId: f.warehouse.id,
    toAreaId: f.store.id,
    note: '',
    lines: [{ productId: f.productId, quantity: 2 }],
  };
  const first = await f.run(body, 'admin', commandId);
  const second = await f.run(body, 'admin', commandId);
  assert.equal(first, second);
  assert.equal(await f.stockAt(f.warehouse.id), 48);
  await assert.rejects(
    f.run({ ...body, lines: [{ productId: f.productId, quantity: 3 }] }, 'admin', commandId),
    /otra operación/,
  );
});

check('archivo de traslado v9 lleva los módulos y se importa en un destino vacío', async () => {
  const f = await fixture();
  const session = await f.db.openCashSession(0, 'admin');
  const partyId = Number(
    await f.run({
      action: 'party.save',
      kind: 'client',
      name: 'Cliente fiel',
      document: '',
      phone: '',
      email: '',
      address: '',
      creditLimit: 0,
      notes: '',
      active: true,
    }),
  );
  await f.run({
    action: 'ledger.charge',
    partyId,
    side: 'receivable',
    amount: 120,
    reference: '',
    note: '',
  });
  await f.run({
    action: 'ledger.payment',
    partyId,
    side: 'receivable',
    amount: 20,
    method: 'cash',
    reference: '',
    note: '',
  });
  await sell(f, f.warehouse.id);
  await f.db.closeCashSession(session, {
    denominations: [
      { denomination: 200, quantity: 1 },
      { denomination: 20, quantity: 1 },
    ],
    withdrawalCount: 0,
    transferCount: 0,
    products: [{ productId: f.productId, physicalStock: 49 }],
    adminUsername: 'admin',
    adminPassword: 'admin123',
  });
  const archive = await f.db.createBusinessArchive('admin');
  assert.equal(archive.schemaVersion, 10);
  assert.equal(archive.tables.party_ledger.length, 2);
  assert.equal(archive.tables.sale_tickets.length, 1);
  const target = createHarness();
  const db = target.load('@/lib/database');
  await db.initializeDatabase();
  await db.restoreBusinessArchive(archive, 'admin');
  const data = await db.getBusinessData({}, 'admin');
  assert.equal(data.balances.find((b) => b.partyId === partyId)?.receivable, 100);
  assert.equal(target.database.exec('SELECT COUNT(*) FROM cash_entries')[0].values[0][0], 1);
});

check('validación LAN de comandos rechaza acciones y datos inválidos', async () => {
  const f = await fixture();
  const { operationArgs } = f.load('@/lib/network/validation');
  assert.equal(
    operationArgs.executeBusinessCommand.safeParse([
      { action: 'payroll.drop', commandId: randomUUID() },
      'admin',
      undefined,
    ]).success,
    false,
  );
  await assert.rejects(
    f.run({
      action: 'ledger.charge',
      partyId: 1,
      side: 'receivable',
      amount: 10.005,
      reference: '',
      note: '',
    }),
    /dos decimales/,
  );
  await assert.rejects(
    f.run({
      action: 'currency.rate',
      code: 'usd1',
      rate: 1,
      effectiveDate: today(),
      source: '',
    }),
    /tres letras/,
  );
});
