import { z } from 'zod';
import { fiscalFilterSchema, onatCommandSchema } from '@/lib/onat-models';
import {
  operationPermissions,
  mutationOperations,
  type OperationRequest,
  type PosOperation,
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
const proof = z.object({ username: text, passwordHash: z.string().regex(/^[a-f0-9]{64}$/) });
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
