import { z } from 'zod';

export const BUSINESS_TABLES = [
  'users',
  'areas',
  'products',
  'cash_sessions',
  'sales',
  'sale_lines',
  'movements',
  'area_stock',
  'cash_withdrawals',
  'cash_difference_approvals',
  'cash_closures',
  'audit_log',
  'network_commands',
  'network_events',
  'cost_history',
  'internal_consumptions',
  'consumption_events',
  'sale_adjustments',
  'finance_commands',
  'fiscal_profiles',
  'fiscal_rules',
  'fiscal_records',
  // v10 enterprise modules (archive schema 9), in foreign-key order.
  'branches',
  'area_branches',
  'currencies',
  'exchange_rates',
  'cash_entries',
  'parties',
  'party_ledger',
  'stock_transfers',
  'stock_transfer_lines',
  'sale_tickets',
  'employees',
  'payroll_runs',
  'payroll_lines',
  'partners',
  'partner_movements',
  // v11 (archive schema 10).
  'product_extras',
  'sale_credits',
  'sale_fx',
] as const;
const V10_ARCHIVE_TABLES = BUSINESS_TABLES.slice(BUSINESS_TABLES.indexOf('branches'));
const V11_ARCHIVE_TABLES = BUSINESS_TABLES.slice(BUSINESS_TABLES.indexOf('product_extras'));
export type BusinessTable = (typeof BUSINESS_TABLES)[number];
export type ArchiveRow = Record<string, string | number | null>;
const row = z.record(z.string(), z.union([z.string(), z.number().finite(), z.null()]));
export const archiveSchema = z
  .object({
    app: z.literal('MipyPOS'),
    format: z.literal('business-close'),
    version: z.union([z.literal(1), z.literal(2)]),
    schemaVersion: z.union([
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
      z.literal(10),
    ]),
    archiveId: z.string().uuid(),
    createdAt: z.string().datetime(),
    sourceUser: z.string().min(1),
    tables: z.record(z.enum(BUSINESS_TABLES), z.array(row)),
    usage: z
      .object({ products: z.number().int().nonnegative(), sales: z.number().int().nonnegative() })
      .strict(),
    sequences: z.array(
      z.object({ name: z.enum(BUSINESS_TABLES), seq: z.number().int().nonnegative() }).strict(),
    ),
    openingFund: z.number().nonnegative(),
  })
  .strict();
export type BusinessArchive = z.infer<typeof archiveSchema>;
export function parseBusinessArchive(value: unknown): BusinessArchive {
  let normalized = value;
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === 5 &&
    'tables' in value &&
    value.tables &&
    typeof value.tables === 'object'
  ) {
    normalized = {
      ...value,
      tables: {
        cost_history: [],
        internal_consumptions: [],
        consumption_events: [],
        sale_adjustments: [],
        finance_commands: [],
        ...value.tables,
      },
    };
  }
  if (
    normalized &&
    typeof normalized === 'object' &&
    'schemaVersion' in normalized &&
    typeof normalized.schemaVersion === 'number' &&
    normalized.schemaVersion < 8 &&
    'tables' in normalized &&
    normalized.tables &&
    typeof normalized.tables === 'object'
  ) {
    normalized = {
      ...normalized,
      tables: { fiscal_profiles: [], fiscal_rules: [], fiscal_records: [], ...normalized.tables },
    };
  }
  if (
    normalized &&
    typeof normalized === 'object' &&
    'schemaVersion' in normalized &&
    typeof normalized.schemaVersion === 'number' &&
    normalized.schemaVersion < 9 &&
    'tables' in normalized &&
    normalized.tables &&
    typeof normalized.tables === 'object'
  ) {
    const tables: Record<string, unknown> = { ...normalized.tables };
    // Older archives predate these modules; a pre-v9 file may only carry them empty.
    if (
      V10_ARCHIVE_TABLES.some(
        (table) =>
          Object.hasOwn(tables, table) &&
          !(Array.isArray(tables[table]) && (tables[table] as unknown[]).length === 0),
      )
    )
      throw new Error(
        'El archivo no es un cierre completo compatible con esta versión de MipyPOS.',
      );
    normalized = {
      ...normalized,
      tables: {
        ...Object.fromEntries(V10_ARCHIVE_TABLES.map((table) => [table, []])),
        ...tables,
      },
    };
  }
  if (
    normalized &&
    typeof normalized === 'object' &&
    'schemaVersion' in normalized &&
    typeof normalized.schemaVersion === 'number' &&
    normalized.schemaVersion < 10 &&
    'tables' in normalized &&
    normalized.tables &&
    typeof normalized.tables === 'object'
  ) {
    const tables: Record<string, unknown> = { ...normalized.tables };
    if (
      V11_ARCHIVE_TABLES.some(
        (table) =>
          Object.hasOwn(tables, table) &&
          !(Array.isArray(tables[table]) && (tables[table] as unknown[]).length === 0),
      )
    )
      throw new Error(
        'El archivo no es un cierre completo compatible con esta versión de MipyPOS.',
      );
    normalized = {
      ...normalized,
      tables: {
        ...Object.fromEntries(V11_ARCHIVE_TABLES.map((table) => [table, []])),
        ...tables,
      },
    };
  }
  const parsed = archiveSchema.safeParse(normalized);
  if (!parsed.success)
    throw new Error('El archivo no es un cierre completo compatible con esta versión de MipyPOS.');
  const archive = parsed.data;
  if (
    archive.version === 2 &&
    archive.tables.users.some((user) => Object.hasOwn(user, 'password_hash'))
  )
    throw new Error('El archivo de traslado contiene credenciales que no deberían exportarse.');
  if (
    !archive.tables.users.some(
      (user) =>
        user.role === 'admin' &&
        typeof user.username === 'string' &&
        user.username.length > 0 &&
        (archive.version === 2 ||
          (typeof user.password_hash === 'string' && /^[0-9a-f]{64}$/.test(user.password_hash))),
    )
  )
    throw new Error('El archivo no contiene un administrador válido.');
  if (
    !archive.tables.cash_sessions.length ||
    archive.tables.cash_sessions.some((session) => session.close_date === null)
  )
    throw new Error('El archivo debe proceder de una caja cerrada.');
  if (
    archive.usage.sales < archive.tables.sales.length ||
    archive.usage.products < archive.tables.products.length
  )
    throw new Error('Los contadores del archivo no son válidos.');
  return archive;
}
