import { z } from 'zod';

const text = z.string().trim().max(2000);
const required = text.min(1);
export const fiscalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T12:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Selecciona una fecha válida.');
const amount = z.number().finite().nonnegative().max(1e12);
const percent = z.number().finite().min(0).max(100);
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const FISCAL_CATEGORIES = [
  'TCP',
  'Microempresa',
  'Pequeña empresa',
  'Mediana empresa',
  'Otro',
] as const;
export const TAX_NAMES = [
  'Ingresos personales',
  'Ventas o servicios',
  'Seguridad social',
  'Fuerza de trabajo',
  'Utilidades',
  'Contribución territorial',
  'Retenciones de dividendos',
  'Pago anticipado',
  'Liquidación anual',
  'Declaración jurada',
  'Otro tributo',
] as const;
export const BASE_NAMES = [
  'Ingresos',
  'Ingresos menos deducciones',
  'Utilidad fiscal',
  'Salarios',
  'Dividendos',
  'Base manual',
] as const;
export const profileSchema = z
  .object({
    taxpayerId: id,
    name: required,
    nit: required,
    category: z.enum(FISCAL_CATEGORIES),
    province: required,
    municipality: required,
    address: required,
    activity: required,
    secondaryActivities: text,
    regime: required,
    startDate: fiscalDate,
    fiscalPeriod: required,
    registration: text,
    accountant: required,
    source: z.enum(['POS', 'Manual']),
    reservePercent: percent,
    reserveBase: z.enum(['Ingresos', 'Utilidad fiscal']),
    effectiveFrom: fiscalDate,
  })
  .strict();
export const ruleSchema = z
  .object({
    ruleKey: id,
    name: required,
    categories: z.array(z.enum(FISCAL_CATEGORIES)).min(1),
    activities: z.array(required),
    municipalities: z.array(required),
    scope: z.enum(['Empresa', 'Socio']),
    base: z.enum(BASE_NAMES),
    method: z.enum(['Porcentaje', 'Escala', 'Cuota fija']),
    rate: percent,
    fixed: amount,
    bands: z.array(z.object({ upTo: amount.nullable(), rate: percent }).strict()).max(30),
    exempt: amount,
    bonusPercent: percent,
    allowCost: z.boolean(),
    advanceRuleKeys: z.array(id).max(30).optional(),
    frequency: z.enum(['Diaria', 'Mensual', 'Trimestral', 'Anual', 'Personalizada']),
    dueDay: z.number().int().min(1).max(31),
    dueMonths: z.number().int().min(0).max(24),
    effectiveFrom: fiscalDate,
    effectiveTo: fiscalDate.nullable(),
    sourceUrl: required.url(),
    disposition: required,
    article: required,
    verifiedOn: fiscalDate.nullable(),
    verificationNote: text,
    notes: text,
  })
  .strict()
  .superRefine((v, c) => {
    if (v.effectiveTo && v.effectiveTo < v.effectiveFrom)
      c.addIssue({ code: 'custom', message: 'La vigencia final precede al inicio.' });
    if (v.verifiedOn && !v.verificationNote)
      c.addIssue({
        code: 'custom',
        message: 'Documenta la comprobación legal y su aplicabilidad.',
      });
    if (v.verifiedOn && !/^https?:\/\/[^/]+\.gob\.cu(?:\/|$)/i.test(v.sourceUrl))
      c.addIssue({
        code: 'custom',
        message: 'La verificación necesita una fuente oficial cubana .gob.cu.',
      });
    if (v.method === 'Escala') {
      let last = 0;
      if (!v.bands.length || v.bands.at(-1)?.upTo !== null)
        c.addIssue({ code: 'custom', message: 'La escala necesita un último tramo sin límite.' });
      for (const [index, b] of v.bands.entries()) {
        if (
          (b.upTo === null && index !== v.bands.length - 1) ||
          (b.upTo !== null && b.upTo <= last)
        )
          c.addIssue({ code: 'custom', message: 'Los límites de la escala deben ser crecientes.' });
        if (b.upTo !== null) last = b.upTo;
      }
    }
  });
export const fiscalFilterSchema = z
  .object({ taxpayerId: id, start: fiscalDate, end: fiscalDate })
  .strict()
  .refine((v) => v.start <= v.end, 'Selecciona un período válido.');
export const recordSchema = z
  .object({
    taxpayerId: id,
    kind: z.enum(['payment', 'provision', 'expense', 'payroll', 'dividend', 'declaration']),
    date: fiscalDate,
    amount,
    reference: text,
    operationCode: text,
    account: text,
    method: z.enum(['Efectivo', 'Transfermóvil', 'Banca electrónica', 'Transferencia', 'Otro']),
    notes: required,
    obligationId: id.nullable(),
    beneficiary: text,
    deductionRuleId: id.nullable(),
    attachment: z.string().max(1000000).nullable(),
    attachmentName: text,
  })
  .strict();
export const onatCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('profile'), commandId: id, value: profileSchema }).strict(),
  z
    .object({
      action: z.literal('rule'),
      commandId: id,
      value: ruleSchema,
      replacesId: id.nullable(),
    })
    .strict(),
  z.object({ action: z.literal('record'), commandId: id, value: recordSchema }).strict(),
  z.object({ action: z.literal('void'), commandId: id, recordId: id, reason: required }).strict(),
  z
    .object({
      action: z.literal('estimate'),
      commandId: id,
      filter: fiscalFilterSchema,
      ruleId: id,
      beneficiary: text,
      manualBase: amount,
    })
    .strict(),
  z
    .object({
      action: z.literal('export'),
      commandId: id,
      filter: fiscalFilterSchema,
      format: z.enum(['PDF', 'Excel', 'Impresión']),
    })
    .strict(),
]);
export type FiscalProfile = z.infer<typeof profileSchema>;
export type FiscalRule = z.infer<typeof ruleSchema>;
export type FiscalFilter = z.infer<typeof fiscalFilterSchema>;
export type FiscalRecordInput = z.infer<typeof recordSchema>;
export type OnatCommand = z.infer<typeof onatCommandSchema>;
export interface ProfileVersion {
  id: string;
  date: string;
  actor: string;
  value: FiscalProfile;
}
export interface RuleVersion {
  id: string;
  date: string;
  actor: string;
  replacesId: string | null;
  value: FiscalRule;
}
export interface FiscalEconomy {
  income: number;
  knownCost: number;
  missingCost: number;
  deductions: number;
  payroll: number;
  dividends: number;
  manualBase: number;
}
export interface TaxCalculation {
  base: number;
  taxable: number;
  gross: number;
  tax: number;
  credits: number;
  explanation: string;
}
export interface FiscalRecord {
  id: string;
  date: string;
  actor: string;
  kind: string;
  taxpayerId: string;
  value:
    | FiscalRecordInput
    | Obligation
    | { recordId: string; reason: string }
    | { filter: FiscalFilter; format: string };
}
export interface Obligation {
  ruleId: string;
  profileId: string;
  taxpayerId: string;
  start: string;
  end: string;
  due: string;
  beneficiary: string;
  scope: 'Empresa' | 'Socio';
  name: string;
  economy: FiscalEconomy;
  calculation: TaxCalculation;
  advancePaymentIds: string[];
  rule: FiscalRule;
  profile: FiscalProfile;
}
export interface FiscalData {
  profiles: ProfileVersion[];
  rules: RuleVersion[];
  records: FiscalRecord[];
  economy: FiscalEconomy;
  previousIncome: number;
  warnings: string[];
}
export const storedObligationSchema = z
  .object({
    ruleId: id,
    profileId: id,
    taxpayerId: id,
    start: fiscalDate,
    end: fiscalDate,
    due: fiscalDate,
    beneficiary: text,
    scope: z.enum(['Empresa', 'Socio']),
    name: required,
    economy: z
      .object({
        income: amount,
        knownCost: amount,
        missingCost: z.number().int().nonnegative(),
        deductions: amount,
        payroll: amount,
        dividends: amount,
        manualBase: amount,
      })
      .strict(),
    calculation: z
      .object({
        base: amount,
        taxable: amount,
        gross: amount,
        tax: amount,
        credits: amount,
        explanation: required,
      })
      .strict(),
    rule: ruleSchema,
    profile: profileSchema,
    advancePaymentIds: z.array(id),
  })
  .strict();
export function parseFiscalRecordValue(kind: string, value: unknown): FiscalRecord['value'] {
  if (kind === 'obligation') return storedObligationSchema.parse(value);
  if (kind === 'void') return z.object({ recordId: id, reason: required }).strict().parse(value);
  if (kind === 'export')
    return z
      .object({ filter: fiscalFilterSchema, format: z.enum(['PDF', 'Excel', 'Impresión']) })
      .strict()
      .parse(value);
  const record = recordSchema.parse(value);
  if (record.kind !== kind) throw new Error('El tipo del registro fiscal no coincide.');
  return record;
}
export const LEGAL_REFERENCE = {
  title: 'Ley 113/2012 concordada · Gaceta Oficial especial n.º 1, 12 de enero de 2026',
  url: 'https://www.parlamentocubano.gob.cu/sites/default/files/documento/2026-02/goc-2026-es1.pdf',
  checked: '2026-10-31',
  note: 'Documento consultado. No acredita por sí solo las tasas aplicables ni cambios posteriores. Verifica presupuesto anual, normas complementarias, actividad y municipio con tu contador.',
};
export const ONAT_DISCLAIMER =
  'Reporte de preparación y control de MipyPOS. No es una declaración oficial presentada ante la ONAT ni acredita un pago ejecutado por la aplicación.';
