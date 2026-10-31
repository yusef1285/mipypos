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
] as const;
export type BusinessTable = (typeof BUSINESS_TABLES)[number];
export type ArchiveRow = Record<string, string | number | null>;
const row = z.record(z.string(), z.union([z.string(), z.number().finite(), z.null()]));
export const archiveSchema = z
  .object({
    app: z.literal('MipyPOS'),
    format: z.literal('business-close'),
    version: z.union([z.literal(1), z.literal(2)]),
    schemaVersion: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
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
