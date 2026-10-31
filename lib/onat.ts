import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import type { Usuario } from '@/lib/models';
import { reportFinance, financeCommand } from '@/lib/finance';
import { roundMoney } from '@/lib/units';
import { calculateTax, dueDate, ruleWarnings, validateFiscalPeriod } from '@/lib/onat-engine';
import {
  fiscalFilterSchema,
  parseFiscalRecordValue,
  onatCommandSchema,
  profileSchema,
  ruleSchema,
  type FiscalData,
  type FiscalEconomy,
  type FiscalFilter,
  type FiscalRecord,
  type FiscalRecordInput,
  type Obligation,
  type OnatCommand,
  type ProfileVersion,
  type RuleVersion,
} from '@/lib/onat-models';

export async function migrateOnat(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
  if (!columns.some((c) => c.name === 'can_manage_fiscal'))
    await db.execAsync(
      'ALTER TABLE users ADD COLUMN can_manage_fiscal INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_fiscal IN (0,1))',
    );
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS fiscal_profiles (id TEXT PRIMARY KEY, taxpayer_id TEXT NOT NULL, date TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE TABLE IF NOT EXISTS fiscal_rules (id TEXT PRIMARY KEY, rule_key TEXT NOT NULL, date TEXT NOT NULL, actor TEXT NOT NULL, replaces_id TEXT REFERENCES fiscal_rules(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE UNIQUE INDEX IF NOT EXISTS fiscal_rule_successor ON fiscal_rules(replaces_id) WHERE replaces_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS fiscal_records (id TEXT PRIMARY KEY, taxpayer_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('obligation','payment','provision','expense','payroll','dividend','declaration','void','export')), date TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE INDEX IF NOT EXISTS fiscal_profile_idx ON fiscal_profiles(taxpayer_id,date);
    CREATE INDEX IF NOT EXISTS fiscal_record_idx ON fiscal_records(taxpayer_id,kind,date);
    CREATE TRIGGER IF NOT EXISTS fiscal_profiles_no_delete BEFORE DELETE ON fiscal_profiles BEGIN SELECT RAISE(ABORT,'No se borran perfiles fiscales.'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_rules_no_delete BEFORE DELETE ON fiscal_rules BEGIN SELECT RAISE(ABORT,'No se borran reglas fiscales.'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_records_no_delete BEFORE DELETE ON fiscal_records BEGIN SELECT RAISE(ABORT,'No se borran registros fiscales confirmados.'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_profiles_immutable BEFORE UPDATE ON fiscal_profiles BEGIN SELECT RAISE(ABORT,'El perfil fiscal conserva su historial.'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_rules_immutable BEFORE UPDATE ON fiscal_rules BEGIN SELECT RAISE(ABORT,'La regla fiscal conserva su historial.'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_records_immutable BEFORE UPDATE ON fiscal_records BEGIN SELECT RAISE(ABORT,'Utiliza una anulación fiscal justificada.'); END;
  `);
}
export async function fiscalActor(db: SQLiteDatabase, username: string, adminOnly = false) {
  const user = await db.getFirstAsync<Usuario>(
    'SELECT * FROM users WHERE username=? COLLATE NOCASE',
    username,
  );
  if (
    !user ||
    (adminOnly ? user.role !== 'admin' : user.role !== 'admin' && user.can_manage_fiscal !== 1)
  )
    throw new Error('Necesitas autorización fiscal expresa del administrador.');
  return user;
}
async function versions(db: SQLiteDatabase) {
  const profiles = (
    await db.getAllAsync<{ id: string; date: string; actor: string; payload: string }>(
      'SELECT * FROM fiscal_profiles ORDER BY rowid DESC',
    )
  ).map((r) => ({
    id: r.id,
    date: r.date,
    actor: r.actor,
    value: profileSchema.parse(JSON.parse(r.payload)),
  }));
  const rules = (
    await db.getAllAsync<{
      id: string;
      date: string;
      actor: string;
      replaces_id: string | null;
      payload: string;
    }>('SELECT * FROM fiscal_rules ORDER BY rowid DESC')
  ).map((r) => ({
    id: r.id,
    date: r.date,
    actor: r.actor,
    replacesId: r.replaces_id,
    value: ruleSchema.parse(JSON.parse(r.payload)),
  }));
  const records = (
    await db.getAllAsync<{
      id: string;
      date: string;
      actor: string;
      taxpayer_id: string;
      kind: string;
      payload: string;
    }>('SELECT * FROM fiscal_records ORDER BY rowid DESC')
  ).map((r) => ({
    id: r.id,
    date: r.date,
    actor: r.actor,
    taxpayerId: r.taxpayer_id,
    kind: r.kind,
    value: parseFiscalRecordValue(r.kind, JSON.parse(r.payload)),
  }));
  return { profiles, rules, records };
}
// JSON object member order is not meaningful; array order and every value are.
function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value: unknown, index: number) => sameJsonValue(value, right[index]))
    );
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftEntries = Object.entries(left),
    rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) =>
      rightEntries.some(
        ([otherKey, otherValue]) => key === otherKey && sameJsonValue(value, otherValue),
      ),
    )
  );
}
export async function validateFiscalStorage(db: SQLiteDatabase) {
  const data = await versions(db);
  const activeIds = new Set(activeRecords(data.records).map((record) => record.id));
  const usedAdvanceIds = new Set<string>();
  for (const record of data.records) {
    if (!data.profiles.some((p) => p.value.taxpayerId === record.taxpayerId))
      throw new Error('El registro fiscal pertenece a un contribuyente inexistente.');
    if (record.kind === 'obligation' && 'calculation' in record.value) {
      const o = record.value;
      const rule = data.rules.find((r) => r.id === o.ruleId),
        profile = data.profiles.find((p) => p.id === o.profileId);
      if (
        !rule ||
        !profile ||
        record.taxpayerId !== o.taxpayerId ||
        profile.value.taxpayerId !== o.taxpayerId ||
        !sameJsonValue(rule.value, o.rule) ||
        !sameJsonValue(profile.value, o.profile)
      )
        throw new Error('El cálculo fiscal perdió su perfil o regla histórica.');
      const credited = o.advancePaymentIds.map((id) =>
        data.records.find(
          (r) => r.id === id && r.kind === 'payment' && r.taxpayerId === o.taxpayerId,
        ),
      );
      if (
        credited.some((r) => !r) ||
        Math.abs(
          credited.reduce((sum, r) => sum + (r && 'amount' in r.value ? r.value.amount : 0), 0) -
            o.calculation.credits,
        ) > 0.005
      )
        throw new Error('Los anticipos fiscales no coinciden con sus pagos históricos.');
      if (new Set(o.advancePaymentIds).size !== o.advancePaymentIds.length)
        throw new Error('Los anticipos fiscales contienen pagos duplicados.');
      for (const payment of credited) {
        if (!payment || !('obligationId' in payment.value))
          throw new Error('El anticipo fiscal perdió su pago histórico.');
        const obligationId = payment.value.obligationId;
        const advance = data.records.find((r) => r.id === obligationId);
        if (
          !advance ||
          advance.kind !== 'obligation' ||
          !('rule' in advance.value) ||
          advance.taxpayerId !== o.taxpayerId ||
          !(o.rule.advanceRuleKeys ?? []).includes(advance.value.rule.ruleKey) ||
          advance.value.scope !== o.scope ||
          advance.value.beneficiary !== o.beneficiary ||
          advance.value.start < o.start ||
          advance.value.end > o.end
        )
          throw new Error('El anticipo fiscal no corresponde a la liquidación.');
        if (activeIds.has(record.id)) {
          if (
            !activeIds.has(payment.id) ||
            !activeIds.has(advance.id) ||
            usedAdvanceIds.has(payment.id)
          )
            throw new Error('El anticipo fiscal está anulado o acreditado más de una vez.');
          usedAdvanceIds.add(payment.id);
        }
      }
      const result = calculateTax(o.rule, o.economy, o.calculation.credits);
      if (
        !sameJsonValue(result, o.calculation) ||
        dueDate(o.rule, o.end) !== o.due ||
        o.start > o.end
      )
        throw new Error('El cálculo fiscal importado no es coherente.');
    } else if (record.kind === 'void' && 'recordId' in record.value) {
      const value = record.value;
      const original = data.records.find((r) => r.id === value.recordId);
      if (
        !original ||
        original.taxpayerId !== record.taxpayerId ||
        ['void', 'export'].includes(original.kind)
      )
        throw new Error('La anulación fiscal no tiene registro de origen.');
    } else if ('obligationId' in record.value) {
      const v = record.value;
      if (
        v.taxpayerId !== record.taxpayerId ||
        (['payment', 'declaration'].includes(record.kind) &&
          !data.records.some(
            (r) =>
              r.kind === 'obligation' &&
              r.id === v.obligationId &&
              r.taxpayerId === record.taxpayerId,
          ))
      )
        throw new Error('El pago fiscal perdió su obligación de origen.');
      if (v.deductionRuleId && !data.rules.some((r) => r.id === v.deductionRuleId))
        throw new Error('El gasto fiscal perdió su regla de deducción.');
    }
  }
}
export function activeRecords(records: FiscalRecord[]) {
  const voided = new Set(
    records.filter((r) => r.kind === 'void').map((r) => (r.value as { recordId: string }).recordId),
  );
  return records.filter((r) => r.kind !== 'void' && !voided.has(r.id));
}
function profileFor(profiles: ProfileVersion[], filter: FiscalFilter) {
  const p = profiles
    .filter(
      (p) => p.value.taxpayerId === filter.taxpayerId && p.value.effectiveFrom <= filter.start,
    )
    .sort(
      (a, b) =>
        b.value.effectiveFrom.localeCompare(a.value.effectiveFrom) || b.date.localeCompare(a.date),
    )[0];
  if (!p) throw new Error('Configura un perfil vigente al inicio del período.');
  if (
    profiles.some(
      (p) =>
        p.value.taxpayerId === filter.taxpayerId &&
        p.value.effectiveFrom > filter.start &&
        p.value.effectiveFrom <= filter.end,
    )
  )
    throw new Error('El perfil cambió durante el período. Consulta cada tramo por separado.');
  return p;
}
async function economyFor(
  db: SQLiteDatabase,
  profile: ProfileVersion,
  records: FiscalRecord[],
  rules: RuleVersion[],
  filter: FiscalFilter,
  ruleId?: string,
  beneficiary = '',
): Promise<FiscalEconomy> {
  const e: FiscalEconomy = {
    income: 0,
    knownCost: 0,
    missingCost: 0,
    deductions: 0,
    payroll: 0,
    dividends: 0,
    manualBase: 0,
  };
  if (profile.value.source === 'POS') {
    const report = await reportFinance(db, {
      start: new Date(`${filter.start}T00:00:00`).toISOString(),
      end: new Date(`${filter.end}T23:59:59.999`).toISOString(),
    });
    e.income = Math.max(0, report.totals.net);
    e.knownCost = Math.max(0, report.totals.knownCost);
    e.missingCost = report.totals.missingCostLines;
  }
  for (const record of activeRecords(records)) {
    if (
      !['expense', 'payroll', 'dividend'].includes(record.kind) ||
      record.taxpayerId !== filter.taxpayerId
    )
      continue;
    const v = record.value as FiscalRecordInput;
    if (v.date < filter.start || v.date > filter.end) continue;
    if (record.kind === 'payroll') e.payroll += v.amount;
    if (record.kind === 'dividend' && (!beneficiary || v.beneficiary === beneficiary))
      e.dividends += v.amount;
    if (record.kind === 'expense' && ruleId && v.deductionRuleId === ruleId) {
      const rule = rules.find((r) => r.id === ruleId);
      if (
        rule &&
        !ruleWarnings(rule.value, { ...filter, start: v.date, end: v.date }, profile.value).length
      )
        e.deductions += v.amount;
    }
  }
  return {
    ...e,
    deductions: roundMoney(e.deductions),
    payroll: roundMoney(e.payroll),
    dividends: roundMoney(e.dividends),
  };
}
export async function readFiscalData(
  db: SQLiteDatabase,
  filter: FiscalFilter,
  username: string,
): Promise<FiscalData> {
  await fiscalActor(db, username);
  fiscalFilterSchema.parse(filter);
  const data = await versions(db);
  if (!data.profiles.length)
    return {
      ...data,
      economy: {
        income: 0,
        knownCost: 0,
        missingCost: 0,
        deductions: 0,
        payroll: 0,
        dividends: 0,
        manualBase: 0,
      },
      previousIncome: 0,
      warnings: [],
    };
  let profile: ProfileVersion;
  try {
    profile = profileFor(data.profiles, filter);
  } catch (failure) {
    return {
      ...data,
      economy: {
        income: 0,
        knownCost: 0,
        missingCost: 0,
        deductions: 0,
        payroll: 0,
        dividends: 0,
        manualBase: 0,
      },
      previousIncome: 0,
      warnings: [failure instanceof Error ? failure.message : 'Selecciona un perfil vigente.'],
    };
  }
  const economy = await economyFor(db, profile, data.records, data.rules, filter);
  const days =
    Date.parse(`${filter.end}T00:00:00Z`) - Date.parse(`${filter.start}T00:00:00Z`) + 86400000;
  const priorEnd = new Date(Date.parse(`${filter.start}T00:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
  const priorStart = new Date(Date.parse(`${filter.start}T00:00:00Z`) - days)
    .toISOString()
    .slice(0, 10);
  const prior =
    profile.value.source === 'POS'
      ? await reportFinance(db, {
          start: new Date(`${priorStart}T00:00:00`).toISOString(),
          end: new Date(`${priorEnd}T23:59:59.999`).toISOString(),
        })
      : null;
  return {
    ...data,
    economy,
    previousIncome: prior?.totals.net ?? 0,
    warnings: [
      'Los retiros de caja no se consideran gastos deducibles. Las reservas no mueven dinero real.',
      'Nómina, gastos y dividendos complementarios requieren registro fiscal; no hay consolidación multisucursal disponible.',
      ...(economy.missingCost
        ? ['Hay ventas sin costo histórico: no se puede estimar utilidad deduciendo esos costos.']
        : []),
      ...(profile.value.source === 'Manual'
        ? [
            'Este contribuyente no reutiliza las ventas del POS; utiliza una base manual comprobada.',
          ]
        : []),
    ],
  };
}
async function log(db: SQLiteDatabase, actor: Usuario, action: string, detail: unknown) {
  await db.runAsync(
    'INSERT INTO audit_log(action,username,date,detail) VALUES(?,?,?,?)',
    `onat.${action}`,
    actor.username,
    new Date().toISOString(),
    JSON.stringify(detail),
  );
}
export async function executeFiscalCommand(db: SQLiteDatabase, raw: OnatCommand, username: string) {
  const parsed = onatCommandSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? 'Revisa los datos fiscales.');
  const input = parsed.data;
  const actor = await fiscalActor(db, username);
  return financeCommand(db, input.commandId, JSON.stringify([username, input]), async () => {
    const data = await versions(db);
    const date = new Date().toISOString();
    const recordId = Crypto.randomUUID();
    let taxpayerId = '',
      kind = input.action === 'estimate' ? 'obligation' : input.action;
    let payload: unknown = input;
    if (input.action === 'profile') {
      const v = input.value;
      const latest = data.profiles.find((p) => p.value.taxpayerId === v.taxpayerId);
      if (latest && v.effectiveFrom < latest.value.effectiveFrom)
        throw new Error('No puedes alterar perfiles anteriores. Crea una versión posterior.');
      if (latest && v.nit !== latest.value.nit)
        throw new Error('Un NIT diferente requiere un contribuyente independiente.');
      const current = data.profiles.filter(
        (p, i, list) => list.findIndex((x) => x.value.taxpayerId === p.value.taxpayerId) === i,
      );
      if (
        v.source === 'POS' &&
        current.some((p) => p.value.source === 'POS' && p.value.taxpayerId !== v.taxpayerId)
      )
        throw new Error(
          'Las ventas del POS ya pertenecen a otro contribuyente. No se duplican ingresos.',
        );
      if (
        data.records.some(
          (r) =>
            r.kind === 'obligation' &&
            r.taxpayerId === v.taxpayerId &&
            (r.value as Obligation).end >= v.effectiveFrom,
        )
      )
        throw new Error(
          'La configuración afectaría cálculos confirmados. Usa una vigencia posterior.',
        );
      await db.runAsync(
        'INSERT INTO fiscal_profiles VALUES(?,?,?,?,?)',
        recordId,
        v.taxpayerId,
        date,
        actor.username,
        JSON.stringify(v),
      );
    } else if (input.action === 'rule') {
      if ((input.value.advanceRuleKeys ?? []).includes(input.value.ruleKey))
        throw new Error('Una regla no puede descontar sus propios pagos como anticipos.');
      for (const key of input.value.advanceRuleKeys ?? [])
        if (!data.rules.some((r) => r.value.ruleKey === key))
          throw new Error('Selecciona un impuesto anticipado existente.');
      const prior = input.replacesId ? data.rules.find((r) => r.id === input.replacesId) : null;
      if (input.replacesId && !prior) throw new Error('La regla anterior no existe.');
      if (
        prior &&
        (prior.value.ruleKey !== input.value.ruleKey ||
          input.value.effectiveFrom <= prior.value.effectiveFrom)
      )
        throw new Error('Una actualización necesita el mismo impuesto y una vigencia posterior.');
      if (
        data.rules.some(
          (r) =>
            r.value.ruleKey === input.value.ruleKey &&
            (!prior || r.value.effectiveFrom >= input.value.effectiveFrom),
        )
      )
        throw new Error(
          'Ya existe una versión de este impuesto. Selecciona la regla que actualizarás.',
        );
      if (
        data.records.some(
          (r) =>
            r.kind === 'obligation' &&
            (r.value as Obligation).rule.ruleKey === input.value.ruleKey &&
            (r.value as Obligation).end >= input.value.effectiveFrom,
        )
      )
        throw new Error(
          'La nueva regla afectaría períodos confirmados. Usa una vigencia posterior.',
        );
      await db.runAsync(
        'INSERT INTO fiscal_rules VALUES(?,?,?,?,?,?)',
        recordId,
        input.value.ruleKey,
        date,
        actor.username,
        input.replacesId,
        JSON.stringify(input.value),
      );
    } else {
      if (input.action === 'estimate') {
        const p = profileFor(data.profiles, input.filter);
        const rule = data.rules.find((r) => r.id === input.ruleId);
        if (!rule) throw new Error('Selecciona una regla fiscal.');
        const warnings = ruleWarnings(rule.value, input.filter, p.value);
        if (warnings.length) throw new Error(warnings.join(' '));
        if (
          data.rules.some(
            (r) =>
              r.value.ruleKey === rule.value.ruleKey &&
              r.value.effectiveFrom > rule.value.effectiveFrom &&
              r.value.effectiveFrom <= input.filter.end,
          )
        )
          throw new Error('Hay otra versión aplicable. Divide el período por vigencia.');
        validateFiscalPeriod(rule.value, input.filter);
        if (rule.value.scope === 'Socio' && !input.beneficiary)
          throw new Error('Identifica al socio: sus obligaciones son independientes.');
        if (
          p.value.source === 'Manual' &&
          !['Dividendos', 'Salarios', 'Base manual'].includes(rule.value.base)
        )
          throw new Error('Este contribuyente necesita una regla con base manual.');
        if (
          activeRecords(data.records).some(
            (r) =>
              r.kind === 'obligation' &&
              r.taxpayerId === input.filter.taxpayerId &&
              (r.value as Obligation).rule.ruleKey === rule.value.ruleKey &&
              (r.value as Obligation).beneficiary === input.beneficiary &&
              (r.value as Obligation).start <= input.filter.end &&
              (r.value as Obligation).end >= input.filter.start,
          )
        )
          throw new Error(
            'Ya existe una obligación para este impuesto y período. Anúlala con motivo antes de corregirla.',
          );
        const economy = await economyFor(
          db,
          p,
          data.records,
          data.rules,
          input.filter,
          rule.id,
          input.beneficiary,
        );
        economy.manualBase = input.manualBase;
        const advanceObligations = activeRecords(data.records).filter(
          (r) =>
            r.kind === 'obligation' &&
            'rule' in r.value &&
            r.taxpayerId === input.filter.taxpayerId &&
            (rule.value.advanceRuleKeys ?? []).includes(r.value.rule.ruleKey) &&
            r.value.scope === rule.value.scope &&
            r.value.beneficiary === input.beneficiary &&
            r.value.start >= input.filter.start &&
            r.value.end <= input.filter.end,
        );
        const advanceIds = new Set(advanceObligations.map((r) => r.id));
        const usedAdvanceIds = new Set(
          activeRecords(data.records)
            .filter((r) => r.kind === 'obligation' && 'advancePaymentIds' in r.value)
            .flatMap((r) => ('advancePaymentIds' in r.value ? r.value.advancePaymentIds : [])),
        );
        const advancePayments = activeRecords(data.records).filter(
          (r) =>
            !usedAdvanceIds.has(r.id) &&
            r.kind === 'payment' &&
            'obligationId' in r.value &&
            r.value.obligationId !== null &&
            advanceIds.has(r.value.obligationId),
        );
        const credits = advancePayments.reduce(
          (sum, r) => sum + ('amount' in r.value ? r.value.amount : 0),
          0,
        );
        const calculation = calculateTax(rule.value, economy, credits);
        const due = dueDate(rule.value, input.filter.end);
        if (due < input.filter.end)
          throw new Error('El vencimiento configurado precede al fin del período.');
        payload = {
          ruleId: rule.id,
          profileId: p.id,
          taxpayerId: p.value.taxpayerId,
          start: input.filter.start,
          end: input.filter.end,
          due,
          beneficiary: input.beneficiary,
          scope: rule.value.scope,
          name: rule.value.name,
          economy,
          calculation,
          advancePaymentIds: advancePayments.map((r) => r.id),
          rule: rule.value,
          profile: p.value,
        } satisfies Obligation;
        taxpayerId = p.value.taxpayerId;
      } else if (input.action === 'record') {
        const v = input.value;
        if (!data.profiles.some((p) => p.value.taxpayerId === v.taxpayerId))
          throw new Error('El contribuyente no existe.');
        if (v.amount <= 0 && v.kind !== 'declaration')
          throw new Error('El importe debe ser mayor que cero.');
        const obligation = activeRecords(data.records).find(
          (r) =>
            r.id === v.obligationId && r.kind === 'obligation' && r.taxpayerId === v.taxpayerId,
        );
        if (['payment', 'declaration'].includes(v.kind) && !obligation)
          throw new Error('Selecciona una obligación vigente de este contribuyente.');
        if (v.kind === 'payment' && !v.reference && !v.operationCode)
          throw new Error('Registra una referencia o código de operación.');
        if (
          v.kind === 'payment' &&
          activeRecords(data.records).some(
            (r) =>
              r.kind === 'payment' &&
              r.taxpayerId === v.taxpayerId &&
              (r.value as FiscalRecordInput).reference === v.reference &&
              (r.value as FiscalRecordInput).operationCode === v.operationCode &&
              (r.value as FiscalRecordInput).method === v.method,
          )
        )
          throw new Error('Ya existe un pago con esta referencia y código.');
        if (v.kind === 'dividend' && !v.beneficiary)
          throw new Error('Identifica al socio receptor.');
        if (v.deductionRuleId && !data.rules.some((r) => r.id === v.deductionRuleId))
          throw new Error('La regla de deducibilidad no existe.');
        if (
          v.attachment &&
          !/^data:(image\/(jpeg|png)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(v.attachment)
        )
          throw new Error('Adjunta una imagen PNG/JPEG o un PDF válido.');
        taxpayerId = v.taxpayerId;
        kind = v.kind;
        payload = v;
      } else if (input.action === 'void') {
        const record = activeRecords(data.records).find((r) => r.id === input.recordId);
        if (!record || ['export'].includes(record.kind))
          throw new Error('El registro no se puede anular o ya está anulado.');
        if (
          record.kind === 'payment' &&
          activeRecords(data.records).some(
            (r) =>
              r.kind === 'obligation' &&
              'advancePaymentIds' in r.value &&
              r.value.advancePaymentIds.includes(record.id),
          )
        )
          throw new Error(
            'Este anticipo forma parte de una liquidación confirmada. Anula primero esa liquidación.',
          );
        if (
          record.kind === 'obligation' &&
          activeRecords(data.records).some(
            (r) =>
              ['payment', 'declaration'].includes(r.kind) &&
              (r.value as FiscalRecordInput).obligationId === record.id,
          )
        )
          throw new Error('Anula primero los pagos y constancias asociados.');
        taxpayerId = record.taxpayerId;
        payload = { recordId: record.id, reason: input.reason };
      } else if (input.action === 'export') {
        profileFor(data.profiles, input.filter);
        taxpayerId = input.filter.taxpayerId;
        payload = { filter: input.filter, format: input.format };
      }
      await db.runAsync(
        'INSERT INTO fiscal_records VALUES(?,?,?,?,?,?)',
        recordId,
        taxpayerId,
        kind,
        date,
        actor.username,
        JSON.stringify(payload),
      );
    }
    await log(db, actor, input.action, {
      id: recordId,
      commandId: input.commandId,
      taxpayerId,
      ...(input.action === 'void' ? { reason: input.reason, recordId: input.recordId } : {}),
    });
    return recordId;
  });
}
export async function grantFiscalPermission(
  db: SQLiteDatabase,
  userId: number,
  allowed: boolean,
  username: string,
) {
  const actor = await fiscalActor(db, username, true);
  const target = await db.getFirstAsync<Usuario>('SELECT * FROM users WHERE id=?', userId);
  if (!target || target.role === 'admin')
    throw new Error('Selecciona un usuario no administrador.');
  await db.runAsync('UPDATE users SET can_manage_fiscal=? WHERE id=?', allowed ? 1 : 0, userId);
  await log(db, actor, 'permission', { userId, allowed });
  return userId;
}
