import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHarness, prepareHarness } from './pos-test-harness';
import {
  calculateTax,
  dueDate,
  fiscalStatus,
  ruleWarnings,
  validateFiscalPeriod,
} from '../lib/onat-engine';
import {
  ruleSchema,
  storedObligationSchema,
  type FiscalProfile,
  type FiscalRule,
  type FiscalEconomy,
  type FiscalRecordInput,
  type OnatCommand,
} from '../lib/onat-models';
import { canAccess } from '../lib/permissions';
let passed = 0,
  failed = 0;
const failures: { name: string; message: string; stack?: string }[] = [];
before(prepareHarness);
after(() => {
  mkdirSync('.expo', { recursive: true });
  writeFileSync(
    '.expo/onat-regression-results.json',
    JSON.stringify({
      ranAt: new Date().toISOString(),
      passed,
      failed,
      tests: passed + failed,
      failures,
    }),
  );
});
function check(name: string, action: () => void | Promise<void>) {
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
// Synthetic fixture parameters only: these are not legal rates or active product defaults.
const profile: FiscalProfile = {
  taxpayerId: 'default',
  name: 'Negocio de prueba',
  nit: 'TEST-01',
  category: 'TCP',
  province: 'La Habana',
  municipality: 'Plaza',
  address: 'Dirección de prueba',
  activity: 'Comercio',
  secondaryActivities: '',
  regime: 'Prueba',
  startDate: '2020-01-01',
  fiscalPeriod: 'Año',
  registration: '',
  accountant: 'Contador de prueba',
  source: 'POS',
  reservePercent: 10,
  reserveBase: 'Ingresos',
  effectiveFrom: '2020-01-01',
};
const rule: FiscalRule = {
  ruleKey: 'fixture',
  name: 'Impuesto sintético',
  categories: ['TCP'],
  activities: [],
  municipalities: [],
  scope: 'Empresa',
  base: 'Ingresos',
  method: 'Porcentaje',
  rate: 10,
  fixed: 100,
  bands: [],
  exempt: 100,
  bonusPercent: 5,
  allowCost: false,
  frequency: 'Mensual',
  dueDay: 31,
  dueMonths: 1,
  effectiveFrom: '2020-01-01',
  effectiveTo: null,
  sourceUrl: 'https://www.mfp.gob.cu/',
  disposition: 'Norma ficticia SOLO PRUEBAS',
  article: 'Caso de prueba',
  verifiedOn: '2026-01-01',
  verificationNote: 'Evidencia sintética de la fixture; no vigente',
  notes: 'Solo prueba',
};
const economy: FiscalEconomy = {
  income: 1100,
  knownCost: 100,
  missingCost: 0,
  deductions: 200,
  payroll: 300,
  dividends: 400,
  manualBase: 500,
};
const filter = { taxpayerId: 'default', start: '2026-01-01', end: '2026-01-31' };
async function fixture() {
  const h = createHarness();
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  const exec = (value: OnatCommand) => db.executeFiscalCommand(value, 'admin');
  await exec({ action: 'profile', commandId: randomUUID(), value: profile });
  const ruleId = await exec({
    action: 'rule',
    commandId: randomUUID(),
    replacesId: null,
    value: rule,
  });
  return { ...h, db, exec, ruleId };
}
const input = (
  obligationId: string | null,
  kind: FiscalRecordInput['kind'] = 'payment',
): FiscalRecordInput => ({
  taxpayerId: 'default',
  kind,
  date: '2026-02-01',
  amount: 12,
  reference: randomUUID(),
  operationCode: '',
  account: '',
  method: 'Transferencia',
  notes: 'Caso de prueba',
  obligationId,
  beneficiary: '',
  deductionRuleId: null,
  attachment: null,
  attachmentName: '',
});
const estimate = (ruleId: string): Extract<OnatCommand, { action: 'estimate' }> => ({
  action: 'estimate',
  commandId: randomUUID(),
  filter,
  ruleId,
  beneficiary: '',
  manualBase: 0,
});
check('porcentaje con exención y bonificación', () =>
  assert.equal(calculateTax(rule, economy).tax, 95),
);
check('escala marginal y último tramo sin límite', () =>
  assert.equal(
    calculateTax(
      {
        ...rule,
        method: 'Escala',
        exempt: 0,
        bonusPercent: 0,
        bands: [
          { upTo: 1000, rate: 10 },
          { upTo: null, rate: 20 },
        ],
      },
      economy,
    ).tax,
    120,
  ),
);
check('cuota fija y bonificación', () =>
  assert.equal(calculateTax({ ...rule, method: 'Cuota fija' }, economy).tax, 95),
);
check('utilidad no convierte caja en ingreso ni deduce todo gasto', () =>
  assert.equal(
    calculateTax(
      { ...rule, base: 'Utilidad fiscal', allowCost: true, bonusPercent: 0, exempt: 0 },
      economy,
    ).base,
    800,
  ),
);
check('faltan costos históricos: impide utilidad con costo deducible', () =>
  assert.throws(() =>
    calculateTax(
      { ...rule, base: 'Utilidad fiscal', allowCost: true },
      { ...economy, missingCost: 1 },
    ),
  ),
);
check('importes no finitos se rechazan', () =>
  assert.throws(() => calculateTax(rule, { ...economy, income: NaN })),
);
check('escalas fuera de orden se rechazan', () =>
  assert.equal(
    ruleSchema.safeParse({
      ...rule,
      method: 'Escala',
      bands: [
        { upTo: 100, rate: 5 },
        { upTo: 50, rate: 10 },
        { upTo: null, rate: 20 },
      ],
    }).success,
    false,
  ),
);
check('sin verificar y regla vencida advierten', () =>
  assert.equal(
    ruleWarnings({ ...rule, verifiedOn: null, effectiveTo: '2025-01-01' }, filter, profile).length,
    2,
  ),
);
check('municipio, actividad y categoría se comprueban', () =>
  assert.equal(
    ruleWarnings(
      {
        ...rule,
        categories: ['Microempresa'],
        activities: ['Transporte'],
        municipalities: ['Cárdenas'],
      },
      filter,
      profile,
    ).length,
    3,
  ),
);
check('vencimiento ajusta febrero sin inventar días hábiles', () =>
  assert.equal(dueDate(rule, '2026-01-31'), '2026-02-28'),
);
check('frecuencias trimestral y anual requieren períodos completos', () => {
  assert.doesNotThrow(() =>
    validateFiscalPeriod({ ...rule, frequency: 'Trimestral' }, { ...filter, end: '2026-03-31' }),
  );
  assert.throws(() => validateFiscalPeriod({ ...rule, frequency: 'Anual' }, filter));
});
check('indicadores de cumplimiento, próximos y vencidos', () => {
  assert.equal(fiscalStatus('2026-02-01', false, '2026-02-02'), 'Vencida');
  assert.equal(fiscalStatus('2026-02-01', true, '2026-02-02'), 'Cumplida');
  assert.equal(fiscalStatus('2026-02-05', false, '2026-02-02'), 'Próxima');
});
check('migraciones fiscales y v9 aditivas e idempotentes', async () => {
  const f = await fixture();
  await f.db.initializeDatabase();
  const d = await f.db.getDatabase();
  assert.equal(
    (await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version,
    9,
  );
  assert.equal((await f.db.getFiscalData(filter, 'admin')).profiles.length, 1);
});
check('perfil histórico conserva configuración anterior', async () => {
  const f = await fixture();
  await f.exec({
    action: 'profile',
    commandId: randomUUID(),
    value: { ...profile, effectiveFrom: '2026-02-01', address: 'Nueva dirección' },
  });
  const data = await f.db.getFiscalData(filter, 'admin');
  assert.equal(data.profiles.length, 2);
  assert.equal(data.profiles[1].value.address, 'Dirección de prueba');
});
check('no duplica ventas en varios contribuyentes', async () => {
  const f = await fixture();
  await assert.rejects(
    f.exec({
      action: 'profile',
      commandId: randomUUID(),
      value: { ...profile, taxpayerId: 'otro', nit: 'TEST-02' },
    }),
    /otro contribuyente/,
  );
});
check('sin permiso fiscal no puede consultar ni mutar', async () => {
  const f = await fixture();
  await f.db.saveUser({ username: 'vendedor', password: 'abc12345', role: 'seller' });
  await assert.rejects(f.db.getFiscalData(filter, 'vendedor'), /autorización fiscal/);
  await assert.rejects(
    f.db.executeFiscalCommand(estimate(f.ruleId), 'vendedor'),
    /autorización fiscal/,
  );
  assert.equal(canAccess('seller', 'onat'), false);
  assert.equal(canAccess('seller', 'onat', 1), true);
});
check('permiso expreso es revocable y auditable', async () => {
  const f = await fixture();
  const id = await f.db.saveUser({ username: 'contador', password: 'abc12345', role: 'auditor' });
  await f.db.setFiscalPermission(id, true, 'admin');
  assert.ok(await f.db.getFiscalData(filter, 'contador'));
  await f.db.setFiscalPermission(id, false, 'admin');
  await assert.rejects(f.db.getFiscalData(filter, 'contador'));
  const d = await f.db.getDatabase();
  assert.equal(
    (await d.getAllAsync("SELECT * FROM audit_log WHERE action='onat.permission'")).length,
    2,
  );
});
check('regla no verificada bloquea confirmación', async () => {
  const f = await fixture();
  const id = await f.exec({
    action: 'rule',
    commandId: randomUUID(),
    replacesId: null,
    value: { ...rule, ruleKey: 'unverified', verifiedOn: null },
  });
  await assert.rejects(f.exec(estimate(id)), /sin verificación/);
});
check('confirmaciones no se duplican ante reintento', async () => {
  const f = await fixture();
  const cmd = estimate(f.ruleId);
  const id = await f.exec(cmd);
  assert.equal(await f.exec(cmd), id);
  await assert.rejects(f.exec(estimate(f.ruleId)), /Ya existe una obligación/);
});
check('pagos, reservas y gastos no modifican caja comercial', async () => {
  const f = await fixture();
  const id = await f.exec(estimate(f.ruleId));
  await f.exec({ action: 'record', commandId: randomUUID(), value: input(id) });
  await f.exec({ action: 'record', commandId: randomUUID(), value: input(null, 'provision') });
  const d = await f.db.getDatabase();
  assert.equal((await d.getAllAsync('SELECT * FROM cash_withdrawals')).length, 0);
  assert.equal((await d.getAllAsync('SELECT * FROM sales')).length, 0);
});
check('anulación conserva pago y exige motivo', async () => {
  const f = await fixture();
  const id = await f.exec(estimate(f.ruleId));
  const p = await f.exec({ action: 'record', commandId: randomUUID(), value: input(id) });
  await assert.rejects(
    f.exec({ action: 'void', commandId: randomUUID(), recordId: p, reason: '' }),
  );
  await f.exec({
    action: 'void',
    commandId: randomUUID(),
    recordId: p,
    reason: 'Referencia incorrecta',
  });
  const data = await f.db.getFiscalData(filter, 'admin');
  assert.equal(data.records.filter((r) => r.kind === 'payment').length, 1);
  assert.equal(data.records.filter((r) => r.kind === 'void').length, 1);
});
check('no borra ni edita registros confirmados', async () => {
  const f = await fixture();
  await f.exec(estimate(f.ruleId));
  const d = await f.db.getDatabase();
  await assert.rejects(d.execAsync('DELETE FROM fiscal_records'));
  await assert.rejects(d.execAsync("UPDATE fiscal_rules SET actor='otro'"));
});
check('referencia de pago repetida se rechaza', async () => {
  const f = await fixture();
  const id = await f.exec(estimate(f.ruleId));
  const v = input(id);
  await f.exec({ action: 'record', commandId: randomUUID(), value: v });
  await assert.rejects(
    f.exec({ action: 'record', commandId: randomUUID(), value: v }),
    /Ya existe un pago/,
  );
});
check('no anula obligación con pagos activos', async () => {
  const f = await fixture();
  const id = await f.exec(estimate(f.ruleId));
  await f.exec({ action: 'record', commandId: randomUUID(), value: input(id) });
  await assert.rejects(
    f.exec({ action: 'void', commandId: randomUUID(), recordId: id, reason: 'Corregir' }),
    /Anula primero/,
  );
});
check('separa obligaciones personales por socio', async () => {
  const f = await fixture();
  const r = await f.exec({
    action: 'rule',
    commandId: randomUUID(),
    replacesId: null,
    value: {
      ...rule,
      ruleKey: 'socios',
      scope: 'Socio',
      base: 'Dividendos',
      exempt: 0,
      bonusPercent: 0,
    },
  });
  await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: { ...input(null, 'dividend'), date: '2026-01-15', amount: 100, beneficiary: 'SOCIO-A' },
  });
  await f.exec({
    ...estimate(r),
    action: 'estimate',
    beneficiary: 'SOCIO-A',
    filter,
    ruleId: r,
    manualBase: 0,
    commandId: randomUUID(),
  });
  await f.exec({
    ...estimate(r),
    action: 'estimate',
    beneficiary: 'SOCIO-B',
    filter,
    ruleId: r,
    manualBase: 0,
    commandId: randomUUID(),
  });
  const data = await f.db.getFiscalData(filter, 'admin');
  const rows = data.records.filter((x) => x.kind === 'obligation');
  assert.equal(rows.length, 2);
});
check('nueva vigencia no altera snapshots confirmados', async () => {
  const f = await fixture();
  await f.exec(estimate(f.ruleId));
  await f.exec({
    action: 'rule',
    commandId: randomUUID(),
    replacesId: f.ruleId,
    value: { ...rule, effectiveFrom: '2026-02-01', rate: 25 },
  });
  const data = await f.db.getFiscalData(filter, 'admin');
  const value = data.records.find((r) => r.kind === 'obligation')?.value;
  assert.ok(value && 'rule' in value);
  assert.equal(value.rule.rate, 10);
});
check('fallo transaccional revierte registro y auditoría', async () => {
  const f = await fixture();
  f.failWritesContaining('INSERT INTO audit_log');
  await assert.rejects(f.exec(estimate(f.ruleId)));
  const d = await f.db.getDatabase();
  assert.equal((await d.getAllAsync('SELECT * FROM fiscal_records')).length, 0);
});
check('anticipos reducen el pago pendiente sin generar devolución automática', () => {
  const c = calculateTax(rule, economy, 40);
  assert.equal(c.credits, 40);
  assert.equal(c.tax, 55);
  assert.equal(calculateTax(rule, economy, 500).tax, 0);
});
check('traslado v8 preserva datos fiscales y adjuntos sin credenciales', async () => {
  const f = await fixture();
  const obligation = await f.exec(estimate(f.ruleId));
  await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: {
      ...input(obligation),
      attachment: 'data:application/pdf;base64,JVBERi0=',
      attachmentName: 'comprobante.pdf',
    },
  });
  const session = await f.db.openCashSession(0, 'admin');
  await f.db.closeCashSession(session, {
    denominations: [],
    withdrawalCount: 0,
    transferCount: 0,
    products: [],
    adminUsername: 'admin',
    adminPassword: 'admin123',
  });
  const archive = await f.db.createBusinessArchive('admin');
  assert.equal(archive.schemaVersion, 8);
  assert.equal('password_hash' in archive.tables.users[0], false);
  const snapshot = archive.tables.fiscal_records.find((r) => r.kind === 'obligation');
  assert.ok(snapshot && typeof snapshot.payload === 'string');
  const value = storedObligationSchema.parse(JSON.parse(snapshot.payload));
  // Reordering members must not change the meaning or invalidate the archive.
  snapshot.payload = JSON.stringify({
    ...value,
    rule: Object.fromEntries(Object.entries(value.rule).toReversed()),
    profile: Object.fromEntries(Object.entries(value.profile).toReversed()),
    calculation: Object.fromEntries(Object.entries(value.calculation).toReversed()),
  });
  const h = createHarness();
  const destination = h.load('@/lib/database');
  await destination.initializeDatabase();
  await destination.restoreBusinessArchive(archive, 'admin');
  const data = await destination.getFiscalData(filter, 'admin');
  assert.equal(data.profiles.length, 1);
  assert.equal(data.records.filter((r) => r.kind === 'payment').length, 1);
});
check('traslado fiscal inconsistente se rechaza y revierte', async () => {
  const f = await fixture();
  await f.exec(estimate(f.ruleId));
  const session = await f.db.openCashSession(0, 'admin');
  await f.db.closeCashSession(session, {
    denominations: [],
    withdrawalCount: 0,
    transferCount: 0,
    products: [],
    adminUsername: 'admin',
    adminPassword: 'admin123',
  });
  const archive = await f.db.createBusinessArchive('admin');
  const row = archive.tables.fiscal_records.find((r) => r.kind === 'obligation');
  assert.ok(row && typeof row.payload === 'string');
  const payload = JSON.parse(row.payload);
  payload.calculation.tax = 999;
  row.payload = JSON.stringify(payload);
  const h = createHarness();
  const destination = h.load('@/lib/database');
  await destination.initializeDatabase();
  await assert.rejects(destination.restoreBusinessArchive(archive, 'admin'), /coherente/);
  assert.equal((await destination.getFiscalData(filter, 'admin')).profiles.length, 0);
});

async function advanceFixture() {
  const f = await fixture();
  const advance = await f.exec(estimate(f.ruleId));
  const payment = await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: input(advance),
  });
  const annualRule = await f.exec({
    action: 'rule',
    commandId: randomUUID(),
    replacesId: null,
    value: {
      ...rule,
      ruleKey: 'annual',
      method: 'Cuota fija',
      fixed: 100,
      bonusPercent: 0,
      frequency: 'Anual',
      advanceRuleKeys: [rule.ruleKey],
    },
  });
  const annualFilter = { ...filter, end: '2026-12-31' };
  const command: OnatCommand = {
    action: 'estimate',
    commandId: randomUUID(),
    filter: annualFilter,
    ruleId: annualRule,
    beneficiary: '',
    manualBase: 0,
  };
  const settlement = await f.exec(command);
  const session = await f.db.openCashSession(0, 'admin');
  await f.db.closeCashSession(session, {
    denominations: [],
    withdrawalCount: 0,
    transferCount: 0,
    products: [],
    adminUsername: 'admin',
    adminPassword: 'admin123',
  });
  return { ...f, advance, payment, settlement, command, annualFilter };
}
check('anticipo conserva IDs y cálculo al importar el snapshot', async () => {
  const f = await advanceFixture();
  const archive = await f.db.createBusinessArchive('admin');
  const destination = createHarness().load('@/lib/database');
  await destination.initializeDatabase();
  await destination.restoreBusinessArchive(archive, 'admin');
  const data = await destination.getFiscalData(f.annualFilter, 'admin');
  const record = data.records.find((r) => r.id === f.settlement);
  assert.ok(record && 'calculation' in record.value);
  assert.deepEqual(record.value.advancePaymentIds, [f.payment]);
  assert.equal(record.value.calculation.credits, 12);
  assert.equal(record.value.calculation.tax, 88);
  const payment = data.records.find((r) => r.id === f.payment);
  assert.ok(payment && 'obligationId' in payment.value);
  assert.equal(payment.value.obligationId, f.advance);
  await assert.rejects(
    f.exec({
      action: 'void',
      commandId: randomUUID(),
      recordId: f.payment,
      reason: 'Corregir anticipo',
    }),
    /Anula primero esa liquidación/,
  );
});
for (const corruption of ['duplicate', 'unrelated', 'reused'] as const) {
  check(`traslado rechaza anticipo ${corruption} y revierte`, async () => {
    const f = await advanceFixture();
    const archive = await f.db.createBusinessArchive('admin');
    const row = archive.tables.fiscal_records.find((r) => r.id === f.settlement);
    assert.ok(row && typeof row.payload === 'string');
    const value = storedObligationSchema.parse(JSON.parse(row.payload));
    if (corruption === 'duplicate') {
      value.advancePaymentIds.push(f.payment);
      value.calculation = calculateTax(value.rule, value.economy, 24);
    } else if (corruption === 'unrelated') {
      // Same amount and taxpayer, but a payment to the settlement itself is not an advance.
      const payment = archive.tables.fiscal_records.find((r) => r.id === f.payment);
      assert.ok(payment && typeof payment.payload === 'string');
      payment.payload = JSON.stringify({ ...input(f.settlement), reference: 'unrelated' });
    } else {
      archive.tables.fiscal_records.push({ ...row, id: randomUUID() });
    }
    row.payload = JSON.stringify(value);
    const destination = createHarness().load('@/lib/database');
    await destination.initializeDatabase();
    await assert.rejects(destination.restoreBusinessArchive(archive, 'admin'), /anticipo/i);
    assert.equal((await destination.getFiscalData(filter, 'admin')).records.length, 0);
  });
}
check('anular liquidación libera anticipo y conserva ambos snapshots al importar', async () => {
  const f = await advanceFixture();
  await f.exec({
    action: 'void',
    commandId: randomUUID(),
    recordId: f.settlement,
    reason: 'Recalcular liquidación anual',
  });
  const replacement = await f.exec({ ...f.command, commandId: randomUUID() });
  const archive = await f.db.createBusinessArchive('admin');
  const destination = createHarness().load('@/lib/database');
  await destination.initializeDatabase();
  await destination.restoreBusinessArchive(archive, 'admin');
  const data = await destination.getFiscalData(f.annualFilter, 'admin');
  for (const id of [f.settlement, replacement]) {
    const record = data.records.find((r) => r.id === id);
    assert.ok(record && 'calculation' in record.value);
    assert.deepEqual(record.value.advancePaymentIds, [f.payment]);
    assert.equal(record.value.calculation.tax, 88);
  }
  assert.equal(data.records.filter((r) => r.kind === 'void').length, 1);
});

check(
  'identidad de reintento conserva UUID hasta confirmación y cambia con contenido nuevo',
  () => {
    const h = createHarness();
    const identity = h.load('@/lib/use-finance-command').createFinanceCommandIdentity();
    const value = input(null, 'provision');
    const first = identity.idFor(value);
    assert.equal(identity.idFor({ ...value }), first);
    assert.notEqual(identity.idFor({ ...value, amount: 25 }), first);
    identity.clear();
    assert.notEqual(identity.idFor(value), first);
  },
);

check('formulario fiscal reintenta respuesta perdida sin duplicar reserva', async () => {
  const f = await fixture();
  let responseLost = true;
  const submitted: OnatCommand[] = [];
  const h = createHarness({
    react: {
      useState: (initial: unknown) => [
        typeof initial === 'function' ? initial() : initial,
        () => undefined,
      ],
      useRef: (current: unknown) => ({ current }),
      useCallback: (callback: unknown) => callback,
      useEffect: () => undefined,
    },
    '@/lib/app-context': { useApp: () => ({ user: { username: 'admin', role: 'admin' } }) },
    '@/components/FinanceControls': { financeFailure: (error: Error) => error.message },
    '@/lib/onat-notifications': { reconcileFiscalReminders: async () => undefined },
    'expo-haptics': {
      NotificationFeedbackType: { Success: 'success', Error: 'error' },
      notificationAsync: async () => undefined,
    },
    '@/lib/use-pos-repository': {
      usePosRepository: () => ({
        getFiscalData: () => f.db.getFiscalData(filter, 'admin'),
        executeFiscalCommand: async (command: OnatCommand) => {
          submitted.push(command);
          const id = await f.exec(command);
          if (responseLost) {
            responseLost = false;
            throw new Error('Respuesta perdida después de confirmar');
          }
          return id;
        },
      }),
    },
  });
  const model = h.load('@/lib/use-onat').useOnat(filter);
  const value = input(null, 'provision');
  await assert.rejects(
    model.save({ action: 'record', commandId: randomUUID(), value }),
    /Respuesta perdida/,
  );
  const id = await model.save({ action: 'record', commandId: randomUUID(), value: { ...value } });
  assert.equal(submitted[0].commandId, submitted[1].commandId);
  const records = (await f.db.getFiscalData(filter, 'admin')).records.filter(
    (r) => r.kind === 'provision',
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].id, id);
});

async function scopeFixture() {
  const f = await fixture();
  await f.exec(estimate(f.ruleId));
  const partnerRule = await f.exec({
    action: 'rule',
    commandId: randomUUID(),
    replacesId: null,
    value: {
      ...rule,
      ruleKey: 'partner-fixture',
      name: 'Obligación socio de prueba',
      scope: 'Socio',
      base: 'Base manual',
    },
  });
  await f.exec({ ...estimate(partnerRule), beneficiary: 'Socio de prueba', manualBase: 1200 });
  return { ...f, data: await f.db.getFiscalData(filter, 'admin') };
}

for (const scope of ['Empresa', 'Socio'] as const) {
  check(`exportación respeta ámbito ${scope} en filas y documento`, async () => {
    const f = await scopeFixture();
    const report = f.load('@/lib/onat-report');
    const rows = report.fiscalExportRows(f.data, filter, scope);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Ámbito, scope);
    const html = report.fiscalReportHtml(f.data, filter, scope);
    assert.equal(html.includes('Obligación socio de prueba'), scope === 'Socio');
    assert.equal(html.includes('Impuesto sintético'), scope === 'Empresa');
  });
}

check('ámbito exportado permanece en traslado y admite exportaciones antiguas', async () => {
  const f = await scopeFixture();
  for (const scope of ['Empresa', 'Socio', undefined] as const) {
    await f.exec({
      action: 'export',
      commandId: randomUUID(),
      filter,
      format: 'PDF',
      ...(scope ? { scope } : {}),
    });
  }
  const session = await f.db.openCashSession(0, 'admin');
  await f.db.closeCashSession(session, {
    denominations: [],
    withdrawalCount: 0,
    transferCount: 0,
    products: [],
    adminUsername: 'admin',
    adminPassword: 'admin123',
  });
  const archive = await f.db.createBusinessArchive('admin');
  const destination = createHarness().load('@/lib/database');
  await destination.initializeDatabase();
  await destination.restoreBusinessArchive(archive, 'admin');
  const data = await destination.getFiscalData(filter, 'admin');
  const exports = data.records.filter((r) => r.kind === 'export');
  assert.equal(exports.length, 3);
  assert.deepEqual(
    exports
      .map((r) => ('scope' in r.value ? r.value.scope : undefined))
      .sort((a, b) => (a ?? '').localeCompare(b ?? '')),
    ['Empresa', 'Socio', undefined],
  );
});

check('reporte excluye anulados y otros contribuyentes y períodos', async () => {
  const f = await fixture();
  const obligation = await f.exec(estimate(f.ruleId));
  const payment = await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: input(obligation),
  });
  await f.exec({
    action: 'void',
    commandId: randomUUID(),
    recordId: payment,
    reason: 'Comprobante corregido',
  });
  const report = f.load('@/lib/onat-report');
  const data = await f.db.getFiscalData(filter, 'admin');
  assert.equal(report.fiscalExportRows(data, filter, 'Empresa')[0].Pagado, 0);
  assert.equal(report.fiscalExportRows(data, { ...filter, taxpayerId: 'other' }).length, 0);
  assert.equal(
    report.fiscalExportRows(data, { ...filter, start: '2027-01-01', end: '2027-01-31' }).length,
    0,
  );
  await f.exec({
    action: 'void',
    commandId: randomUUID(),
    recordId: obligation,
    reason: 'Recalcular obligación',
  });
  assert.equal(
    report.fiscalExportRows(await f.db.getFiscalData(filter, 'admin'), filter).length,
    0,
  );
});

async function reminderFixture(name = rule.name) {
  const f = await fixture();
  // No POS sales exist in this fixture. Use a synthetic base yielding 95 in tax.
  const id = await f.exec({
    action: 'rule',
    commandId: randomUUID(),
    replacesId: null,
    value: { ...rule, ruleKey: 'reminder-fixture', name, base: 'Base manual' },
  });
  const obligation = await f.exec({ ...estimate(id), manualBase: 1100 });
  const data = await f.db.getFiscalData(filter, 'admin');
  const record = data.records.find((r) => r.id === obligation);
  assert.ok(record && 'calculation' in record.value);
  assert.equal(record.value.calculation.tax, 95);
  return { ...f, obligation, inactive: f.load('@/lib/onat-report').inactiveFiscalObligationIds };
}

check('pago parcial mantiene recordatorio y pago completo lo cancela', async () => {
  const f = await reminderFixture();
  assert.deepEqual(f.inactive((await f.db.getFiscalData(filter, 'admin')).records), []);
  await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: { ...input(f.obligation), amount: 30 },
  });
  assert.deepEqual(f.inactive((await f.db.getFiscalData(filter, 'admin')).records), []);
  await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: { ...input(f.obligation), amount: 65 },
  });
  assert.deepEqual(f.inactive((await f.db.getFiscalData(filter, 'admin')).records), [f.obligation]);
});

check('constancia cumple declaración jurada y anulación la deja pendiente', async () => {
  const f = await reminderFixture('Declaración jurada');
  const declaration = await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: { ...input(f.obligation, 'declaration'), amount: 0 },
  });
  assert.deepEqual(f.inactive((await f.db.getFiscalData(filter, 'admin')).records), [f.obligation]);
  await f.exec({
    action: 'void',
    commandId: randomUUID(),
    recordId: declaration,
    reason: 'Corregir constancia',
  });
  assert.deepEqual(f.inactive((await f.db.getFiscalData(filter, 'admin')).records), []);
});

check('constancia sola no cumple impuesto y anular obligación cancela recordatorio', async () => {
  const f = await reminderFixture();
  const declaration = await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: { ...input(f.obligation, 'declaration'), amount: 0 },
  });
  assert.deepEqual(f.inactive((await f.db.getFiscalData(filter, 'admin')).records), []);
  await f.exec({
    action: 'void',
    commandId: randomUUID(),
    recordId: declaration,
    reason: 'Retirar constancia',
  });
  await f.exec({
    action: 'void',
    commandId: randomUUID(),
    recordId: f.obligation,
    reason: 'Recalcular obligación',
  });
  assert.deepEqual(f.inactive((await f.db.getFiscalData(filter, 'admin')).records), [f.obligation]);
});

check('anular pago completo reabre cumplimiento sin reprogramar alerta', async () => {
  const f = await reminderFixture();
  const payment = await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: { ...input(f.obligation), amount: 95 },
  });
  assert.deepEqual(f.inactive((await f.db.getFiscalData(filter, 'admin')).records), [f.obligation]);
  await f.exec({
    action: 'void',
    commandId: randomUUID(),
    recordId: payment,
    reason: 'Pago equivocado',
  });
  assert.deepEqual(f.inactive((await f.db.getFiscalData(filter, 'admin')).records), []);
});

check('conciliación cancela solo recordatorios propios cumplidos y es repetible', async () => {
  const f = await reminderFixture();
  await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: { ...input(f.obligation), amount: 95 },
  });
  const scheduled = new Set([`onat-${f.obligation}`, 'onat-other', 'other-app-reminder']);
  const cancelled: string[] = [];
  const h = createHarness({
    'expo-notifications': {
      setNotificationHandler: () => undefined,
      getAllScheduledNotificationsAsync: async () =>
        Array.from(scheduled, (identifier) => ({ identifier })),
      cancelScheduledNotificationAsync: async (id: string) => {
        cancelled.push(id);
        scheduled.delete(id);
      },
    },
  });
  const notifications = h.load('@/lib/onat-notifications');
  const records = (await f.db.getFiscalData(filter, 'admin')).records;
  await notifications.reconcileFiscalReminders(records);
  await notifications.reconcileFiscalReminders(records);
  assert.deepEqual(cancelled, [`onat-${f.obligation}`]);
  assert.deepEqual([...scheduled], ['onat-other', 'other-app-reminder']);
});

check('fallo de cancelación de recordatorio se informa y permite reintento', async () => {
  const f = await reminderFixture();
  await f.exec({
    action: 'record',
    commandId: randomUUID(),
    value: { ...input(f.obligation), amount: 95 },
  });
  let failing = true;
  const h = createHarness({
    'expo-notifications': {
      setNotificationHandler: () => undefined,
      getAllScheduledNotificationsAsync: async () => [{ identifier: `onat-${f.obligation}` }],
      cancelScheduledNotificationAsync: async () => {
        if (failing) throw new Error('Permiso revocado');
      },
    },
  });
  const notifications = h.load('@/lib/onat-notifications');
  const records = (await f.db.getFiscalData(filter, 'admin')).records;
  await assert.rejects(notifications.reconcileFiscalReminders(records), /Permiso revocado/);
  failing = false;
  await notifications.reconcileFiscalReminders(records);
});
