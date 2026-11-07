import { z } from 'zod';

// Commands for the v10 enterprise modules. Every mutation is a single
// idempotent command (commandId) so LAN retries never duplicate effects.
const uuid = z.string().uuid();
const id = z.number().int().positive();
const name = z.string().trim().min(1, 'El nombre es obligatorio.').max(120);
const optionalText = z.string().trim().max(240).default('');
const reason = z.string().trim().min(3, 'Indica el motivo.').max(240);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa una fecha AAAA-MM-DD.')
  .refine((value) => Number.isFinite(Date.parse(value)), 'La fecha no es válida.');
export const money = z
  .number()
  .finite()
  .positive('El importe debe ser mayor que cero.')
  .max(1e12)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Usa como máximo dos decimales.',
  });
const moneyOrZero = z
  .number()
  .finite()
  .min(0)
  .max(1e12)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Usa como máximo dos decimales.',
  });
const quantity = z.number().finite().positive('La cantidad debe ser mayor que cero.').max(1e9);
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'El código de moneda tiene tres letras (USD, EUR, MLC).');
const rate = z.number().finite().positive('La tasa debe ser mayor que cero.').max(1e9);
const percent = z.number().finite().min(0).max(100);
export const paymentMethod = z.enum(['cash', 'transfer', 'other']);
export type PaymentMethod = z.infer<typeof paymentMethod>;

const base = { commandId: uuid };
export const businessCommandSchema = z.discriminatedUnion('action', [
  z.object({
    ...base,
    action: z.literal('branch.save'),
    id: id.optional(),
    name,
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{1,12}$/, 'El código usa hasta 12 letras, números o guiones.'),
    address: optionalText,
    ticketPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{0,8}$/, 'El prefijo usa hasta 8 letras o números.')
      .default(''),
    active: z.boolean().default(true),
  }),
  z.object({
    ...base,
    action: z.literal('branch.assignArea'),
    areaId: id,
    branchId: id.nullable(),
  }),
  z.object({
    ...base,
    action: z.literal('branch.setDevice'),
    branchId: id.nullable(),
  }),
  z.object({
    ...base,
    action: z.literal('transfer.send'),
    fromAreaId: id,
    toAreaId: id,
    note: optionalText,
    lines: z
      .array(z.object({ productId: id, quantity }))
      .min(1, 'Agrega al menos un producto.')
      .max(200),
  }),
  z.object({
    ...base,
    action: z.literal('transfer.receive'),
    transferId: uuid,
    note: optionalText,
    lines: z.array(z.object({ lineId: id, received: z.number().finite().min(0).max(1e9) })).min(1),
  }),
  z.object({
    ...base,
    action: z.literal('transfer.resolve'),
    transferId: uuid,
    lineId: id,
    resolution: z.enum(['return', 'loss']),
    reason,
  }),
  z.object({
    ...base,
    action: z.literal('transfer.cancel'),
    transferId: uuid,
    reason,
  }),
  z.object({
    ...base,
    action: z.literal('party.save'),
    id: id.optional(),
    kind: z.enum(['client', 'supplier', 'both']),
    name,
    document: optionalText,
    phone: optionalText,
    email: optionalText,
    address: optionalText,
    creditLimit: moneyOrZero.default(0),
    notes: optionalText,
    active: z.boolean().default(true),
  }),
  z.object({
    ...base,
    action: z.literal('ledger.charge'),
    partyId: id,
    side: z.enum(['receivable', 'payable']),
    amount: money,
    currency: currencyCode.optional(),
    reference: optionalText,
    dueDate: isoDate.optional(),
    note: optionalText,
  }),
  z.object({
    ...base,
    action: z.literal('ledger.payment'),
    partyId: id,
    side: z.enum(['receivable', 'payable']),
    amount: money,
    currency: currencyCode.optional(),
    method: paymentMethod,
    reference: optionalText,
    note: optionalText,
  }),
  z.object({
    ...base,
    action: z.literal('ledger.void'),
    entryId: uuid,
    reason,
  }),
  z.object({
    ...base,
    action: z.literal('currency.save'),
    code: currencyCode,
    name,
    symbol: z.string().trim().min(1).max(6),
    decimals: z.number().int().min(0).max(4).default(2),
  }),
  z.object({
    ...base,
    action: z.literal('currency.rate'),
    code: currencyCode,
    rate,
    effectiveDate: isoDate,
    source: optionalText,
  }),
  z.object({
    ...base,
    action: z.literal('currency.setBase'),
    code: currencyCode,
  }),
  z.object({
    ...base,
    action: z.literal('employee.save'),
    id: id.optional(),
    name,
    document: optionalText,
    position: optionalText,
    branchId: id.nullable().default(null),
    baseSalary: moneyOrZero,
    payPeriod: z.enum(['monthly', 'biweekly', 'weekly']).default('monthly'),
    startDate: isoDate,
    endDate: isoDate.nullable().default(null),
    active: z.boolean().default(true),
  }),
  z.object({
    ...base,
    action: z.literal('payroll.create'),
    periodStart: isoDate,
    periodEnd: isoDate,
    contributionRate: percent.default(0),
    note: optionalText,
    lines: z
      .array(
        z.object({
          employeeId: id,
          base: moneyOrZero,
          bonuses: moneyOrZero.default(0),
          deductions: moneyOrZero.default(0),
        }),
      )
      .min(1, 'Incluye al menos un trabajador.')
      .max(500),
  }),
  z.object({ ...base, action: z.literal('payroll.approve'), runId: uuid }),
  z.object({
    ...base,
    action: z.literal('payroll.pay'),
    runId: uuid,
    method: paymentMethod,
  }),
  z.object({ ...base, action: z.literal('payroll.void'), runId: uuid, reason }),
  z.object({
    ...base,
    action: z.literal('partner.save'),
    id: id.optional(),
    name,
    document: optionalText,
    sharePercent: percent,
    joinedAt: isoDate,
    active: z.boolean().default(true),
  }),
  z.object({
    ...base,
    action: z.literal('partner.movement'),
    partnerId: id,
    kind: z.enum(['contribution', 'withdrawal', 'dividend']),
    amount: money,
    currency: currencyCode.optional(),
    method: paymentMethod,
    note: optionalText,
  }),
  z.object({
    ...base,
    action: z.literal('partner.void'),
    movementId: uuid,
    reason,
  }),
]);
export type BusinessCommand = z.input<typeof businessCommandSchema>;
export type ParsedBusinessCommand = z.output<typeof businessCommandSchema>;
export type BusinessAction = ParsedBusinessCommand['action'];

export const businessFilterSchema = z
  .object({ start: isoDate.optional(), end: isoDate.optional() })
  .strict();
export type BusinessFilter = z.infer<typeof businessFilterSchema>;

export interface Branch {
  id: number;
  name: string;
  code: string;
  address: string;
  ticket_prefix: string;
  active: number;
  created_at: string;
}
export interface AreaBranch {
  area_id: number;
  area_name: string;
  branch_id: number | null;
}
export interface StockTransfer {
  id: string;
  from_area_id: number;
  to_area_id: number;
  from_area: string;
  to_area: string;
  from_branch_id: number | null;
  to_branch_id: number | null;
  status: 'sent' | 'partial' | 'received' | 'cancelled';
  note: string;
  sent_by: string;
  sent_at: string;
  received_by: string | null;
  received_at: string | null;
}
export interface StockTransferLine {
  id: number;
  transfer_id: string;
  product_id: number;
  product_name: string;
  unit: string;
  quantity_sent: number;
  quantity_received: number;
  quantity_returned: number;
  quantity_lost: number;
  unit_cost: number | null;
}
export interface Party {
  id: number;
  kind: 'client' | 'supplier' | 'both';
  name: string;
  document: string;
  phone: string;
  email: string;
  address: string;
  credit_limit: number;
  notes: string;
  active: number;
  created_at: string;
}
export interface LedgerEntry {
  id: string;
  party_id: number;
  side: 'receivable' | 'payable';
  kind: 'charge' | 'payment' | 'reversal';
  amount: number;
  currency: string;
  rate: number;
  base_amount: number;
  method: PaymentMethod | null;
  reference: string;
  due_date: string | null;
  note: string;
  reverses_id: string | null;
  cash_entry_id: string | null;
  username: string;
  date: string;
}
export interface PartyBalance {
  partyId: number;
  receivable: number;
  payable: number;
  overdue: number;
}
export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}
export interface ExchangeRate {
  id: number;
  code: string;
  rate: number;
  effective_date: string;
  source: string;
  username: string;
  recorded_at: string;
}
export interface Employee {
  id: number;
  name: string;
  document: string;
  position: string;
  branch_id: number | null;
  base_salary: number;
  pay_period: 'monthly' | 'biweekly' | 'weekly';
  start_date: string;
  end_date: string | null;
  active: number;
}
export interface PayrollRun {
  id: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'approved' | 'paid' | 'void';
  contribution_rate: number;
  gross_total: number;
  deductions_total: number;
  net_total: number;
  contribution_total: number;
  note: string;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  paid_by: string | null;
  paid_at: string | null;
  method: PaymentMethod | null;
  void_reason: string | null;
}
export interface PayrollLine {
  id: number;
  run_id: string;
  employee_id: number;
  employee_name: string;
  base: number;
  bonuses: number;
  deductions: number;
  gross: number;
  net: number;
  contribution: number;
}
export interface Partner {
  id: number;
  name: string;
  document: string;
  share_percent: number;
  joined_at: string;
  active: number;
}
export interface PartnerMovement {
  id: string;
  partner_id: number;
  kind: 'contribution' | 'withdrawal' | 'dividend' | 'reversal';
  amount: number;
  currency: string;
  rate: number;
  base_amount: number;
  method: PaymentMethod;
  note: string;
  reverses_id: string | null;
  cash_entry_id: string | null;
  username: string;
  date: string;
}
export interface CashEntry {
  id: string;
  session_id: number;
  direction: 'in' | 'out';
  amount: number;
  currency: string;
  source: 'ledger' | 'payroll' | 'partner';
  source_id: string;
  reason: string;
  username: string;
  date: string;
}
export interface BranchConsolidation {
  branchId: number | null;
  name: string;
  sales: number;
  tickets: number;
  inventoryValue: number;
  inventoryUnknownCost: number;
  payroll: number;
}
export interface Consolidation {
  start: string;
  end: string;
  baseCurrency: string;
  branches: BranchConsolidation[];
  totals: {
    sales: number;
    tickets: number;
    inventoryValue: number;
    inTransitValue: number;
    receivables: number;
    payables: number;
    payroll: number;
    partnerCapital: number;
    cashEntriesNet: number;
  };
}
export interface BusinessData {
  baseCurrency: string;
  deviceBranchId: number | null;
  branches: Branch[];
  areas: AreaBranch[];
  transfers: StockTransfer[];
  transferLines: StockTransferLine[];
  parties: Party[];
  ledger: LedgerEntry[];
  balances: PartyBalance[];
  currencies: Currency[];
  rates: ExchangeRate[];
  employees: Employee[];
  payrollRuns: PayrollRun[];
  payrollLines: PayrollLine[];
  partners: Partner[];
  partnerMovements: PartnerMovement[];
  consolidation: Consolidation | null;
}
