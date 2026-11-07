import { z } from 'zod';
import {
  fiscalFilterSchema,
  onatCommandSchema,
  profileSchema,
  ruleSchema,
  storedObligationSchema,
  parseFiscalRecord,
} from '@/lib/onat-models';
import { snapshotSchema } from '@/lib/network/snapshot';
import {
  operationPermissions,
  mutationOperations,
  type OperationRequest,
  type PosOperation,
  type PosResult,
} from '@/lib/network/operations';
import type { NetworkSaleCommand } from '@/lib/network/types';

const id = z.number().int().positive();
const amount = z.number().finite().nonnegative();
const text = z.string().max(240);
const identity = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const date = z
  .string()
  .max(40)
  .refine((value) => Number.isFinite(Date.parse(value)));
const proof = z.union([
  z.object({ username: text, password: z.string().min(1).max(256) }).strict(),
  z.object({ username: text, passwordHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
const command = z
  .object({
    commandId: identity,
    clientId: identity,
    action: text,
    fingerprint: z.string().max(200),
    username: text,
  })
  .optional();
const auth = { adminUsername: text, adminPassword: z.string().max(1024) };
const filter = z
  .object({
    start: date,
    end: date,
    area: text.optional(),
    productId: id.optional(),
    user: text.optional(),
    sellerKey: text.optional(),
    category: text.optional(),
  })
  .partial();
const product = z.object({
  id: id.optional(),
  name: text,
  category: text,
  subcategory: text,
  unit: z.string().max(40),
  quantity_decimals: z.union([z.literal(0), z.literal(3)]),
  stock: amount,
  price_cash: amount,
  price_transfer: amount,
  image_path: z.string().max(400000).nullable(),
  unit_cost: amount.nullable().optional(),
});
const cost = z.object({
  commandId: identity,
  productId: id,
  cost: amount.nullable(),
  reason: text,
});
const purchase = z.object({
  commandId: identity,
  productId: id,
  areaId: id,
  quantity: z.number().finite().positive(),
  cost: amount,
  reason: text,
});
const consumption = z.object({
  commandId: identity,
  productId: id,
  areaId: id,
  quantity: z.number().finite().positive(),
  reason: text,
  notes: z.string().max(2000),
  authorization: proof,
  replacesId: identity.optional(),
  correctionReason: text.optional(),
});
const adjustment = z.object({
  commandId: identity,
  saleId: id,
  kind: z.enum(['devolucion', 'anulacion', 'descuento']),
  lineId: id.optional(),
  quantity: z.number().finite().positive().optional(),
  amount: amount.optional(),
  reason: text,
  authorization: proof,
});
const closure = z.object({
  ...auth,
  denominations: z
    .array(
      z.object({
        denomination: z.number().finite().positive(),
        quantity: z.number().int().nonnegative(),
      }),
    )
    .max(100),
  coinsCount: amount.optional(),
  transferCount: amount,
  withdrawalCount: amount,
  products: z.array(z.object({ productId: id, physicalStock: amount })).max(10000),
  approvalIds: z.array(id).max(10000).optional(),
});
const noArgs = z.tuple([]);
const actorRead = z.tuple([text.optional()]);
export const operationArgs = {
  getFiscalData: z.tuple([fiscalFilterSchema, text.optional()]),
  executeFiscalCommand: z.tuple([onatCommandSchema, text.optional(), command]),
  setFiscalPermission: z.tuple([id, z.boolean(), text.optional(), command]),
  getInvestmentData: actorRead,
  getConsumptionData: actorRead,
  setProductCost: z.tuple([cost, text.optional(), command]),
  receiveCostedStock: z.tuple([purchase, text.optional(), command]),
  getFinanceReport: z.tuple([filter.required({ start: true, end: true }), text.optional()]),
  registerConsumption: z.tuple([consumption, text.optional(), command]),
  cancelConsumption: z.tuple([
    z.object({ id: identity, commandId: identity, reason: text, authorization: proof }),
    text.optional(),
    command,
  ]),
  registerSaleAdjustment: z.tuple([adjustment, text.optional(), command]),
  setConsumptionPermission: z.tuple([id, z.boolean(), text.optional(), command]),
  getAuditSnapshot: noArgs,
  getDemoUsage: noArgs,
  listProducts: z.tuple([z.string().max(240).optional()]),
  listAreas: noArgs,
  listAreaStock: noArgs,
  saveProduct: z.tuple([product, text.optional(), command]),
  deleteProduct: z.tuple([id, command]),
  importProducts: z.tuple([
    z
      .array(
        z.record(
          z.string().max(100),
          z.union([z.string().max(400000), z.number().finite(), z.boolean(), z.null()]),
        ),
      )
      .max(10000),
    text.optional(),
    command,
  ]),
  registerMovement: z.tuple([
    z.object({
      type: z.enum(['entrada', 'salida', 'traslado']),
      productId: id,
      quantity: z.number().finite().positive(),
      fromArea: text.optional(),
      toArea: text.optional(),
      username: text,
    }),
    command,
  ]),
  addArea: z.tuple([text, command]),
  listMovements: z.tuple([filter.optional()]),
  listUsers: noArgs,
  saveUser: z.tuple([
    z.object({
      id: id.optional(),
      username: text,
      password: z.string().max(1024).optional(),
      role: z.enum(['admin', 'supervisor', 'seller', 'storekeeper', 'auditor']),
    }),
    command,
  ]),
  deleteUser: z.tuple([id, id.optional(), command]),
  getCashClosurePreview: z.tuple([id]),
  openCashSession: z.tuple([amount, text.optional(), command]),
  closeCashSession: z.tuple([id, closure, command]),
  registerCashWithdrawal: z.tuple([
    id,
    z.object({
      ...auth,
      commandId: identity,
      amount: z.number().finite().positive(),
      reason: text,
    }),
    text.optional(),
  ]),
  authorizeCashDifference: z.tuple([
    id,
    z.object({
      ...auth,
      kind: z.enum(['money', 'withdrawals', 'inventory']),
      counted: amount,
      transferCount: amount.optional(),
      productId: id.optional(),
      reason: text,
    }),
    command,
  ]),
  listCashClosures: noArgs,
  getDailyReport: z.tuple([date.optional()]),
  getHomeSummary: noArgs,
  getExportRows: z.tuple([z.enum(['sales', 'movements', 'inventory', 'sold', 'cash'])]),
  getSale: z.tuple([id]),
  findTransferTransaction: z.tuple([z.string().max(200)]),
} satisfies Record<PosOperation, z.ZodType>;
export class ProtocolError extends Error {
  constructor(
    public readonly code: 'UNKNOWN_OPERATION' | 'INVALID_ARGUMENTS',
    message: string,
  ) {
    super(message);
  }
}
const envelope = z.object({
  operation: z.string().max(100),
  args: z.array(z.unknown()).max(10),
  token: z.string().min(1).max(512),
  commandId: identity.optional(),
  clientId: identity.optional(),
});
export function assertOperationRequest(value: unknown): asserts value is OperationRequest {
  const parsed = envelope.safeParse(value);
  if (!parsed.success)
    throw new ProtocolError('INVALID_ARGUMENTS', 'Revisa los datos de la solicitud.');
  const input = parsed.data;
  if (!Object.hasOwn(operationPermissions, input.operation))
    throw new ProtocolError(
      'UNKNOWN_OPERATION',
      'Esta operación no está disponible. Actualiza MipyPOS en ambos dispositivos.',
    );
  // Narrow using the registered keys, not a caller-provided prototype property.
  const entry = Object.entries(operationArgs).find(([key]) => key === input.operation);
  if (!entry || !entry[1].safeParse(input.args).success)
    throw new ProtocolError(
      'INVALID_ARGUMENTS',
      'Los datos de la operación no son válidos. Revísalos y vuelve a intentarlo.',
    );
  const operation = Object.keys(operationPermissions).find(
    (key): key is PosOperation => key === input.operation,
  );
  if (operation && mutationOperations.has(operation) && (!input.commandId || !input.clientId))
    throw new ProtocolError(
      'INVALID_ARGUMENTS',
      'La operación no tiene una identidad válida. Actualiza la terminal.',
    );
}
const receipt = z.object({
  ci: text,
  fullName: text,
  address: text,
  amount,
  rawText: z.string().max(20000),
  reference: z.string().max(200),
  receiptDate: z.string().max(100),
  imageBase64: z.string().max(600000),
  reviewed: z.boolean(),
  bank: text.optional(),
  beneficiary: text.optional(),
  orderer: text.optional(),
  currency: text.optional(),
  remainingBalance: text.optional(),
  status: text.optional(),
});
const sale = z.object({
  commandId: identity,
  clientId: identity,
  token: z.string().min(1).max(512),
  method: z.enum(['cash', 'transfer', 'mixed']),
  sessionId: id,
  payments: z
    .array(z.object({ type: z.enum(['cash', 'transfer']), amount }))
    .min(1)
    .max(2),
  settlement: z
    .object({ cashReceived: amount.nullable(), transferReceipt: receipt.nullable() })
    .optional(),
  items: z
    .array(z.object({ productId: id, areaId: id, quantity: z.number().finite().positive() }))
    .min(1)
    .max(1000),
});
export function assertSaleCommand(value: unknown): asserts value is NetworkSaleCommand {
  if (!sale.safeParse(value).success)
    throw new ProtocolError(
      'INVALID_ARGUMENTS',
      'Los datos de la venta no son válidos. Actualiza el carrito y vuelve a intentarlo.',
    );
}

// Read models intentionally accept historical card payments. Command schemas above do not.
const finite = z.number().finite();
const count = finite.int().nonnegative();
export const mutationIdSchema = id;
export const mutationCountSchema = count;
export const mutationVoidSchema = z.null().transform(() => undefined);
export const storedSettlementSchema = z.object({
  cashReceived: amount.nullable(),
  transferReceipt: receipt.nullable(),
  changeDue: finite,
});
const string = z.string();
const flag = z.union([z.literal(0), z.literal(1)]);
const role = z.enum(['admin', 'supervisor', 'seller', 'storekeeper', 'auditor']);
const publicUser = z.object({
  id,
  username: string,
  role,
  can_authorize_consumption: flag,
  can_manage_fiscal: flag.optional(),
});
export const networkSessionSchema = z.object({
  token: z.string().min(1).max(512),
  user: publicUser,
});
const legacyMethod = z.enum(['cash', 'transfer', 'mixed', 'card']);
const movements = z.array(
  z.object({
    id,
    type: z.enum([
      'entrada',
      'salida',
      'traslado',
      'CONSUMO_INTERNO',
      'ANULACION_CONSUMO',
      'DEVOLUCION',
    ]),
    product_id: id,
    product_name: string,
    from_area: string.nullable(),
    to_area: string.nullable(),
    quantity: finite,
    user: string,
    date: string,
  }),
);
const closures = z.array(
  z.object({
    session_id: id,
    authorized_by: string,
    date: string,
    detail: string,
  }),
);
export const dailyReportSchema = z.object({
  totalSales: finite,
  salesCount: count,
  cash: finite,
  transfer: finite,
  card: finite,
  byUser: z.array(z.object({ user: string, total: finite, count })),
  byProduct: z.array(z.object({ product: string, unit: string, quantity: finite, total: finite })),
  movements,
  inventory: snapshotSchema.shape.products,
});
const closureProduct = z.object({
  productId: id,
  productName: string,
  unit: string,
  openingStock: finite,
  entries: finite,
  exits: finite,
  sold: finite,
  expectedStock: finite,
});
const withdrawal = z.object({
  id,
  session_id: id,
  command_id: string,
  amount,
  reason: string,
  username: string,
  authorized_by: string,
  date: string,
});
const saleDetail = z
  .object({
    sale: z.object({
      id,
      session_id: id,
      user: string,
      seller_id: id.nullable(),
      date: string,
      total: finite,
      method: legacyMethod,
      payments: z.array(z.object({ type: z.enum(['cash', 'transfer', 'card']), amount: finite })),
      settlement: storedSettlementSchema.nullable(),
    }),
    lines: z.array(
      z.object({
        id,
        sale_id: id,
        product_id: id,
        name: string,
        quantity: finite,
        price: finite,
        subtotal: finite,
        area_id: id.nullable(),
        unit: string,
        // The host omits costs for non-admins; normalize only this documented redaction.
        unit_cost: amount.nullable().default(null),
        category: string,
      }),
    ),
  })
  .nullable();
const totals = z.object({
  gross: finite,
  discounts: finite,
  returns: finite,
  net: finite,
  knownCost: finite,
  profit: finite.nullable(),
  margin: finite.nullable(),
  units: finite,
  operations: count,
  average: finite,
  missingCostLines: count,
});
const groups = z.array(totals.extend({ key: string, name: string }));
const financeReport = z.object({
  currency: z.literal('CUP'),
  filter: z.object({
    start: string,
    end: string,
    sellerKey: string.optional(),
    productId: id.optional(),
    category: string.optional(),
  }),
  totals,
  sellers: groups,
  products: groups,
  timeline: groups,
  consumption: z.object({ quantity: finite, value: finite, knownCost: finite, missingCost: count }),
  inventory: z.object({ knownValue: finite, missingCost: count, asOf: string }),
});
const consumptionRows = z.array(
  z.object({
    id: string,
    date: string,
    product_id: id,
    product_name: string,
    area_id: id,
    quantity: finite,
    price: finite,
    unit_cost: amount.nullable().default(null),
    value: finite,
    cost: amount.nullable().default(null),
    reason: string,
    notes: string,
    actor_id: id,
    actor_name: string,
    authorizer_id: id,
    authorizer_name: string,
    status: z.enum(['confirmado', 'anulado', 'rectificado']),
    replaces_id: string.nullable(),
  }),
);
const version = z.object({ id: string, date: string, actor: string });
const fiscalRecord = version
  .extend({ taxpayerId: string, kind: string, value: z.unknown() })
  .transform(({ kind, value, ...metadata }) => parseFiscalRecord(metadata, kind, value));
const fiscalData = z.object({
  profiles: z.array(version.extend({ value: profileSchema })),
  rules: z.array(version.extend({ replacesId: string.nullable(), value: ruleSchema })),
  records: z.array(fiscalRecord),
  economy: storedObligationSchema.shape.economy,
  previousIncome: finite,
  warnings: z.array(string),
});

// The mapped annotation checks every registered action against its actual DB return type.
// Parsing (not a cast) also supplies nullable fields omitted by cost redaction.
export const operationResultSchemas: { [K in PosOperation]: z.ZodType<PosResult<K>> } = {
  getFiscalData: fiscalData,
  executeFiscalCommand: z.string().uuid(),
  setFiscalPermission: id,
  getInvestmentData: z.object({
    products: snapshotSchema.shape.products,
    history: z.array(
      z.object({
        id,
        product_id: id,
        date: string,
        old_cost: amount.nullable(),
        new_cost: amount.nullable(),
        method: string,
        reason: string,
        actor_name: string,
        quantity: finite,
        purchase_cost: amount.nullable(),
      }),
    ),
  }),
  getConsumptionData: z.object({
    rows: consumptionRows,
    events: z.array(
      z.object({
        consumption_id: string,
        date: string,
        action: string,
        reason: string,
        actor_name: string,
        authorizer_name: string,
      }),
    ),
  }),
  setProductCost: id,
  receiveCostedStock: id,
  getFinanceReport: financeReport,
  registerConsumption: z.string().min(1).max(128),
  cancelConsumption: z.string().min(1).max(128),
  registerSaleAdjustment: id,
  setConsumptionPermission: id,
  getAuditSnapshot: z.object({
    sales: z.array(
      z.object({ id, user: string, date: string, total: finite, method: legacyMethod }),
    ),
    products: snapshotSchema.shape.products,
    areas: snapshotSchema.shape.areas,
    stocks: snapshotSchema.shape.areaStock,
    movements,
    closures,
  }),
  getDemoUsage: z.object({
    mode: z.enum(['demo', 'pro']),
    sales: count,
    products: count,
    limit: count,
  }),
  listProducts: snapshotSchema.shape.products,
  listAreas: snapshotSchema.shape.areas,
  listAreaStock: snapshotSchema.shape.areaStock,
  saveProduct: id,
  deleteProduct: z.null(),
  importProducts: count,
  registerMovement: z.null(),
  addArea: z.null(),
  listMovements: movements,
  listUsers: z.array(publicUser.extend({ password_hash: string })),
  saveUser: id,
  deleteUser: z.null(),
  getCashClosurePreview: z.object({
    sessionId: id,
    fund: finite,
    cashSales: finite,
    transferSales: finite,
    cardSales: finite,
    salesTotal: finite,
    withdrawalTotal: finite,
    withdrawals: z.array(withdrawal),
    products: z.array(closureProduct),
  }),
  openCashSession: id,
  closeCashSession: z.object({
    cashCount: finite,
    expectedCash: finite,
    cashDifference: finite,
    transferDifference: finite,
    withdrawalTotal: finite,
    withdrawalDifference: finite,
    totalDifference: finite,
    products: z.array(closureProduct.extend({ physicalStock: finite, difference: finite })),
  }),
  registerCashWithdrawal: id,
  authorizeCashDifference: z.object({
    id,
    detail: string,
    reason: string,
    authorized_by: string,
    date: string,
  }),
  listCashClosures: closures,
  getDailyReport: dailyReportSchema,
  getHomeSummary: z.object({ totalSales: finite, salesCount: count }),
  getExportRows: z.array(z.record(string, z.union([string, finite, z.boolean(), z.null()]))),
  getSale: saleDetail,
  findTransferTransaction: z.object({ id }).nullable(),
};
export function parseOperationResult<K extends PosOperation>(
  operation: K,
  value: unknown,
): PosResult<K> {
  return operationResultSchemas[operation].parse(value);
}
