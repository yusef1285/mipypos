import {
  fiscalFilterSchema,
  ruleSchema,
  type FiscalEconomy,
  type FiscalFilter,
  type FiscalProfile,
  type FiscalRule,
  type TaxCalculation,
} from '@/lib/onat-models';
import { roundMoney } from '@/lib/units';

export function ruleWarnings(rule: FiscalRule, filter: FiscalFilter, profile: FiscalProfile) {
  const warnings: string[] = [];
  if (!rule.verifiedOn) warnings.push('Regla sin verificación legal registrada.');
  if (rule.verifiedOn && rule.verifiedOn > new Date().toISOString().slice(0, 10))
    warnings.push('La verificación no puede tener fecha futura.');
  if (rule.effectiveFrom > filter.start || (rule.effectiveTo && rule.effectiveTo < filter.end))
    warnings.push('La regla no cubre todo el período. Divide el cálculo por vigencia.');
  if (!rule.categories.includes(profile.category))
    warnings.push('La regla no corresponde al tipo de contribuyente.');
  if (rule.activities.length && !rule.activities.includes(profile.activity))
    warnings.push('La regla no corresponde a la actividad principal.');
  if (rule.municipalities.length && !rule.municipalities.includes(profile.municipality))
    warnings.push('La regla no corresponde al municipio.');
  return warnings;
}
export function calculateTax(
  input: FiscalRule,
  economy: FiscalEconomy,
  credits = 0,
): TaxCalculation {
  if (!Number.isFinite(credits) || credits < 0) throw new Error('Revisa los anticipos.');
  const rule = ruleSchema.parse(input);
  for (const v of Object.values(economy))
    if (!Number.isFinite(v) || v < 0) throw new Error('Revisa los importes económicos.');
  if (rule.base === 'Utilidad fiscal' && rule.allowCost && economy.missingCost)
    throw new Error('Completa los costos históricos faltantes antes de estimar utilidades.');
  const bases = {
    Ingresos: economy.income,
    'Ingresos menos deducciones': economy.income - economy.deductions,
    'Utilidad fiscal':
      economy.income - economy.deductions - (rule.allowCost ? economy.knownCost : 0),
    Salarios: economy.payroll,
    Dividendos: economy.dividends,
    'Base manual': economy.manualBase,
  };
  const base = roundMoney(Math.max(0, bases[rule.base]));
  const taxable = roundMoney(Math.max(0, base - rule.exempt));
  let gross = rule.method === 'Cuota fija' ? rule.fixed : (taxable * rule.rate) / 100;
  if (rule.method === 'Escala') {
    gross = 0;
    let lower = 0;
    for (const band of rule.bands) {
      const upper = band.upTo ?? taxable;
      gross += (Math.max(0, Math.min(taxable, upper) - lower) * band.rate) / 100;
      lower = upper;
    }
  }
  return {
    base,
    taxable,
    gross: roundMoney(gross),
    tax: roundMoney(Math.max(0, gross * (1 - rule.bonusPercent / 100) - credits)),
    credits: roundMoney(credits),
    explanation: `${rule.base}; ${rule.method}; exento ${rule.exempt}; bonificación ${rule.bonusPercent} %; anticipos acreditados ${roundMoney(credits)} CUP. ${rule.disposition}, ${rule.article}.`,
  };
}
export function dueDate(rule: FiscalRule, end: string) {
  const date = new Date(`${end}T12:00:00Z`);
  const first = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + rule.dueMonths, 1, 12),
  );
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(last, rule.dueDay));
  return first.toISOString().slice(0, 10);
}
export function validateFiscalPeriod(rule: FiscalRule, filter: FiscalFilter) {
  fiscalFilterSchema.parse(filter);
  const s = new Date(`${filter.start}T12:00:00Z`),
    e = new Date(`${filter.end}T12:00:00Z`);
  const last = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate();
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const valid =
    rule.frequency === 'Personalizada' ||
    (rule.frequency === 'Diaria' && filter.start === filter.end) ||
    (rule.frequency === 'Mensual' &&
      sameYear &&
      s.getUTCMonth() === e.getUTCMonth() &&
      s.getUTCDate() === 1 &&
      e.getUTCDate() === last) ||
    (rule.frequency === 'Trimestral' &&
      sameYear &&
      s.getUTCMonth() % 3 === 0 &&
      e.getUTCMonth() === s.getUTCMonth() + 2 &&
      s.getUTCDate() === 1 &&
      e.getUTCDate() === last) ||
    (rule.frequency === 'Anual' &&
      sameYear &&
      s.getUTCMonth() === 0 &&
      s.getUTCDate() === 1 &&
      e.getUTCMonth() === 11 &&
      e.getUTCDate() === 31);
  if (!valid)
    throw new Error(
      `Selecciona un período completo para la frecuencia ${rule.frequency.toLowerCase()}.`,
    );
}
export function fiscalStatus(
  due: string,
  fulfilled: boolean,
  today = new Date().toISOString().slice(0, 10),
) {
  if (fulfilled) return 'Cumplida';
  if (due < today) return 'Vencida';
  const days = (Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000;
  return days <= 7 ? 'Próxima' : 'Futura';
}
