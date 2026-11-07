import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';

import {
  businessCommandSchema,
  businessFilterSchema,
  type AreaBranch,
  type Branch,
  type BranchConsolidation,
  type BusinessCommand,
  type BusinessData,
  type BusinessFilter,
  type CashEntry,
  type Consolidation,
  type Currency,
  type Employee,
  type ExchangeRate,
  type LedgerEntry,
  type ParsedBusinessCommand,
  type Party,
  type PartyBalance,
  type Partner,
  type PartnerMovement,
  type PaymentMethod,
  type PayrollLine,
  type PayrollRun,
  type StockTransfer,
  type StockTransferLine,
} from '@/lib/business-models';
import { financeCommand } from '@/lib/finance';
import type { Producto, Usuario } from '@/lib/models';
import { fractionalUnit, roundMoney, roundQuantity, validateQuantity } from '@/lib/units';

export const DEFAULT_BASE_CURRENCY = 'CUP';
export const PRINCIPAL_BRANCH_NAME = 'Sucursal principal';
const EPSILON = 0.0005;
const nowIso = () => new Date().toISOString();
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
type Action = ParsedBusinessCommand['action'];
type CommandOf<A extends Action> = Extract<ParsedBusinessCommand, { action: A }>;

// Storekeepers move goods between areas/branches; every other module is admin-only.
const STOREKEEPER_ACTIONS = new Set<Action>([
  'transfer.send',
  'transfer.receive',
  'transfer.resolve',
  'transfer.cancel',
]);

export async function businessActor(db: SQLiteDatabase, username: string, action?: Action) {
  const actor = await db.getFirstAsync<Usuario>(
    'SELECT * FROM users WHERE username=? COLLATE NOCASE',
    username,
  );
  const allowed =
    actor &&
    (actor.role === 'admin' ||
      (action === undefined && ['auditor', 'storekeeper'].includes(actor.role)) ||
      (action !== undefined && actor.role === 'storekeeper' && STOREKEEPER_ACTIONS.has(action)));
  if (!actor || !allowed) throw new Error('Tu usuario no tiene permiso para esta operación.');
  return actor;
}

async function audit(db: SQLiteDatabase, action: string, actor: Usuario, detail: unknown) {
  await db.runAsync(
    'INSERT INTO audit_log(action,username,date,detail) VALUES(?,?,?,?)',
    `business.${action}`,
    actor.username,
    nowIso(),
    JSON.stringify(detail),
  );
}

export async function baseCurrency(db: SQLiteDatabase) {
  return (
    (await db.getFirstAsync<{ code: string }>('SELECT code FROM currencies WHERE is_base=1'))
      ?.code ?? DEFAULT_BASE_CURRENCY
  );
}

// Rate = base-currency units per one unit of `code`, effective on `date`.
export async function rateFor(db: SQLiteDatabase, code: string, date = today()) {
  const base = await baseCurrency(db);
  if (code === base) return 1;
  if (!(await db.getFirstAsync('SELECT code FROM currencies WHERE code=?', code)))
    throw new Error(`La moneda ${code} no está registrada.`);
  const row = await db.getFirstAsync<{ rate: number }>(
    'SELECT rate FROM exchange_rates WHERE code=? AND effective_date<=? ORDER BY effective_date DESC,id DESC LIMIT 1',
    code,
    date,
  );
  if (!row) throw new Error(`Registra una tasa de cambio vigente para ${code}.`);
  return row.rate;
}
async function converted(db: SQLiteDatabase, amount: number, currency?: string) {
  const base = await baseCurrency(db);
  const code = currency ?? base;
  const rate = await rateFor(db, code);
  return { currency: code, rate, baseAmount: roundMoney(amount * rate) };
}

async function openSessionId(db: SQLiteDatabase) {
  const session = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM cash_sessions WHERE close_date IS NULL ORDER BY id DESC LIMIT 1',
  );
  if (!session) throw new Error('Abre la caja antes de registrar un movimiento en efectivo.');
  return session.id;
}
async function cashEntry(
  db: SQLiteDatabase,
  actor: Usuario,
  direction: 'in' | 'out',
  amount: number,
  currency: string,
  source: CashEntry['source'],
  sourceId: string,
  reason: string,
) {
  const id = Crypto.randomUUID();
  await db.runAsync(
    'INSERT INTO cash_entries(id,session_id,direction,amount,currency,source,source_id,reason,username,date) VALUES(?,?,?,?,?,?,?,?,?,?)',
    id,
    await openSessionId(db),
    direction,
    roundMoney(amount),
    currency,
    source,
    sourceId,
    reason,
    actor.username,
    nowIso(),
  );
  return id;
}

// Cash entries from credit, payroll and partner modules belong to the drawer:
// base-currency entries change expected cash, foreign currency is reported apart.
export async function sessionCashEntries(db: SQLiteDatabase, sessionId: number) {
  const base = await baseCurrency(db);
  const rows = await db.getAllAsync<{ currency: string; net: number }>(
    `SELECT currency,ROUND(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),2) AS net
     FROM cash_entries WHERE session_id=? GROUP BY currency ORDER BY currency`,
    sessionId,
  );
  return {
    net: roundMoney(rows.find((row) => row.currency === base)?.net ?? 0),
    foreign: rows
      .filter((row) => row.currency !== base)
      .map((row) => ({ currency: row.currency, net: roundMoney(row.net) })),
  };
}

// ---------- Branches and tickets ----------
async function branchOfArea(db: SQLiteDatabase, areaId: number) {
  return (
    (
      await db.getFirstAsync<{ branch_id: number }>(
        'SELECT branch_id FROM area_branches WHERE area_id=?',
        areaId,
      )
    )?.branch_id ?? null
  );
}
async function deviceBranchId(db: SQLiteDatabase) {
  const value = (
    await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key='device_branch_id'",
    )
  )?.value;
  const id = value ? Number(value) : NaN;
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await db.getFirstAsync('SELECT id FROM branches WHERE id=?', id)) ? id : null;
}

// Called inside registerSale after its lines are stored. Numbering is per branch
// and gap-free inside the same transaction; areas without a branch use key 0.
export async function assignSaleTicket(db: SQLiteDatabase, saleId: number, areaIds: number[]) {
  const branches = new Set<number>();
  for (const areaId of new Set(areaIds)) branches.add((await branchOfArea(db, areaId)) ?? 0);
  const key =
    branches.size === 1 ? [...branches][0] : ((await deviceBranchId(db)) ?? [...branches][0] ?? 0);
  const next =
    ((
      await db.getFirstAsync<{ last: number | null }>(
        'SELECT MAX(ticket_number) AS last FROM sale_tickets WHERE branch_key=?',
        key,
      )
    )?.last ?? 0) + 1;
  await db.runAsync(
    'INSERT INTO sale_tickets(sale_id,branch_key,ticket_number) VALUES(?,?,?)',
    saleId,
    key,
    next,
  );
  return next;
}
export interface SaleTicket {
  saleId: number;
  number: number;
  label: string;
  branchName: string;
}
export async function getSaleTicket(
  db: SQLiteDatabase,
  saleId: number,
): Promise<SaleTicket | null> {
  const row = await db.getFirstAsync<{
    branch_key: number;
    ticket_number: number;
    name: string | null;
    ticket_prefix: string | null;
    code: string | null;
  }>(
    `SELECT t.branch_key,t.ticket_number,b.name,b.ticket_prefix,b.code FROM sale_tickets t
     LEFT JOIN branches b ON b.id=t.branch_key WHERE t.sale_id=?`,
    saleId,
  );
  if (!row) return null;
  const prefix = row.ticket_prefix || row.code || '';
  return {
    saleId,
    number: row.ticket_number,
    label: `${prefix ? `${prefix}-` : ''}${String(row.ticket_number).padStart(6, '0')}`,
    branchName: row.name ?? PRINCIPAL_BRANCH_NAME,
  };
}

async function saveBranch(db: SQLiteDatabase, input: CommandOf<'branch.save'>, actor: Usuario) {
  const duplicate = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM branches WHERE (name=? COLLATE NOCASE OR code=?) AND id<>?',
    input.name,
    input.code,
    input.id ?? 0,
  );
  if (duplicate) throw new Error('Ya existe una sucursal con ese nombre o código.');
  let id = input.id;
  if (id) {
    const result = await db.runAsync(
      'UPDATE branches SET name=?,code=?,address=?,ticket_prefix=?,active=? WHERE id=?',
      input.name,
      input.code,
      input.address,
      input.ticketPrefix,
      input.active ? 1 : 0,
      id,
    );
    if (!result.changes) throw new Error('Sucursal no encontrada.');
  } else {
    id = (
      await db.runAsync(
        'INSERT INTO branches(name,code,address,ticket_prefix,active,created_at) VALUES(?,?,?,?,?,?)',
        input.name,
        input.code,
        input.address,
        input.ticketPrefix,
        input.active ? 1 : 0,
        nowIso(),
      )
    ).lastInsertRowId;
  }
  await audit(db, 'branch.saved', actor, {
    id,
    name: input.name,
    code: input.code,
  });
  return String(id);
}
async function assignArea(
  db: SQLiteDatabase,
  input: CommandOf<'branch.assignArea'>,
  actor: Usuario,
) {
  if (!(await db.getFirstAsync('SELECT id FROM areas WHERE id=?', input.areaId)))
    throw new Error('Área no encontrada.');
  if (input.branchId === null)
    await db.runAsync('DELETE FROM area_branches WHERE area_id=?', input.areaId);
  else {
    const branch = await db.getFirstAsync<{ active: number }>(
      'SELECT active FROM branches WHERE id=?',
      input.branchId,
    );
    if (!branch?.active) throw new Error('La sucursal no existe o está inactiva.');
    await db.runAsync(
      'INSERT INTO area_branches(area_id,branch_id) VALUES(?,?) ON CONFLICT(area_id) DO UPDATE SET branch_id=excluded.branch_id',
      input.areaId,
      input.branchId,
    );
  }
  await audit(db, 'branch.area_assigned', actor, input);
  return String(input.areaId);
}
async function setDeviceBranch(
  db: SQLiteDatabase,
  input: CommandOf<'branch.setDevice'>,
  actor: Usuario,
) {
  if (input.branchId !== null) {
    const branch = await db.getFirstAsync<{ active: number }>(
      'SELECT active FROM branches WHERE id=?',
      input.branchId,
    );
    if (!branch?.active) throw new Error('La sucursal no existe o está inactiva.');
  }
  await db.runAsync(
    "INSERT INTO settings(key,value) VALUES('device_branch_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    input.branchId === null ? '' : String(input.branchId),
  );
  await audit(db, 'branch.device_set', actor, input);
  return String(input.branchId ?? 0);
}

// ---------- Stock transfers ----------
async function areaName(db: SQLiteDatabase, id: number) {
  const area = await db.getFirstAsync<{ name: string }>('SELECT name FROM areas WHERE id=?', id);
  if (!area) throw new Error('Área no encontrada.');
  return area.name;
}
async function moveStock(db: SQLiteDatabase, productId: number, areaId: number, delta: number) {
  if (delta < 0) {
    const a = await db.runAsync(
      'UPDATE area_stock SET quantity=ROUND(quantity+?,3) WHERE area_id=? AND product_id=? AND quantity+?>=-0.000001',
      delta,
      areaId,
      productId,
      delta,
    );
    const p = await db.runAsync(
      'UPDATE products SET stock=ROUND(stock+?,3) WHERE id=? AND stock+?>=-0.000001',
      delta,
      productId,
      delta,
    );
    if (!a.changes || !p.changes) throw new Error('Stock insuficiente en el área de origen.');
  } else {
    await db.runAsync('UPDATE products SET stock=ROUND(stock+?,3) WHERE id=?', delta, productId);
    await db.runAsync(
      'INSERT INTO area_stock(area_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(area_id,product_id) DO UPDATE SET quantity=ROUND(quantity+excluded.quantity,3)',
      areaId,
      productId,
      delta,
    );
  }
}
async function movement(
  db: SQLiteDatabase,
  type: 'entrada' | 'salida',
  line: Pick<StockTransferLine, 'product_id' | 'product_name'>,
  from: string | null,
  to: string | null,
  quantity: number,
  actor: Usuario,
) {
  // Closure inventory counts entries/exits from movements; transit is an exit.
  await db.runAsync(
    'INSERT INTO movements(type,product_id,product_name,from_area,to_area,quantity,user,date) VALUES(?,?,?,?,?,?,?,?)',
    type,
    line.product_id,
    line.product_name,
    from,
    to,
    roundQuantity(quantity),
    actor.username,
    nowIso(),
  );
}
async function transferOf(db: SQLiteDatabase, id: string) {
  const transfer = await db.getFirstAsync<StockTransfer>(
    'SELECT * FROM stock_transfers WHERE id=?',
    id,
  );
  if (!transfer) throw new Error('Traslado no encontrado.');
  const lines = await db.getAllAsync<StockTransferLine>(
    'SELECT * FROM stock_transfer_lines WHERE transfer_id=? ORDER BY id',
    id,
  );
  return { transfer, lines };
}
const pendingOf = (line: StockTransferLine) =>
  roundQuantity(
    line.quantity_sent - line.quantity_received - line.quantity_returned - line.quantity_lost,
  );
async function refreshTransferStatus(db: SQLiteDatabase, id: string, actor: Usuario) {
  const { lines } = await transferOf(db, id);
  const pending = lines.some((line) => pendingOf(line) > EPSILON);
  const anyReceived = lines.some((line) => line.quantity_received > EPSILON);
  const status = pending ? 'partial' : anyReceived ? 'received' : 'cancelled';
  await db.runAsync(
    "UPDATE stock_transfers SET status=?,received_by=COALESCE(received_by,?),received_at=COALESCE(received_at,?) WHERE id=? AND status IN ('sent','partial')",
    status,
    actor.username,
    nowIso(),
    id,
  );
}
async function sendTransfer(db: SQLiteDatabase, input: CommandOf<'transfer.send'>, actor: Usuario) {
  if (input.fromAreaId === input.toAreaId)
    throw new Error('El origen y el destino deben ser diferentes.');
  const from = await areaName(db, input.fromAreaId);
  const to = await areaName(db, input.toAreaId);
  if (new Set(input.lines.map((line) => line.productId)).size !== input.lines.length)
    throw new Error('Cada producto debe aparecer una sola vez en el traslado.');
  const id = Crypto.randomUUID();
  await db.runAsync(
    "INSERT INTO stock_transfers(id,from_area_id,to_area_id,from_area,to_area,from_branch_id,to_branch_id,status,note,sent_by,sent_at) VALUES(?,?,?,?,?,?,?,'sent',?,?,?)",
    id,
    input.fromAreaId,
    input.toAreaId,
    from,
    to,
    await branchOfArea(db, input.fromAreaId),
    await branchOfArea(db, input.toAreaId),
    input.note,
    actor.username,
    nowIso(),
  );
  for (const item of input.lines) {
    const product = await db.getFirstAsync<Producto>(
      'SELECT * FROM products WHERE id=?',
      item.productId,
    );
    if (!product) throw new Error('Producto no encontrado.');
    validateQuantity(item.quantity, fractionalUnit(product.unit) ? 3 : 0);
    await moveStock(db, product.id, input.fromAreaId, -item.quantity);
    await db.runAsync(
      'INSERT INTO stock_transfer_lines(transfer_id,product_id,product_name,unit,quantity_sent,unit_cost) VALUES(?,?,?,?,?,?)',
      id,
      product.id,
      product.name,
      product.unit,
      roundQuantity(item.quantity),
      product.unit_cost ?? null,
    );
    await movement(
      db,
      'salida',
      { product_id: product.id, product_name: product.name },
      from,
      `En tránsito → ${to}`,
      item.quantity,
      actor,
    );
  }
  await audit(db, 'transfer.sent', actor, { id, from, to, lines: input.lines });
  return id;
}
async function receiveTransfer(
  db: SQLiteDatabase,
  input: CommandOf<'transfer.receive'>,
  actor: Usuario,
) {
  const { transfer, lines } = await transferOf(db, input.transferId);
  if (!['sent', 'partial'].includes(transfer.status))
    throw new Error('Este traslado ya está cerrado.');
  if (new Set(input.lines.map((line) => line.lineId)).size !== input.lines.length)
    throw new Error('Cada línea debe aparecer una sola vez.');
  let total = 0;
  for (const item of input.lines) {
    const line = lines.find((candidate) => candidate.id === item.lineId);
    if (!line) throw new Error('La línea no pertenece a este traslado.');
    if (item.received === 0) continue;
    validateQuantity(item.received, fractionalUnit(line.unit) ? 3 : 0);
    if (item.received > pendingOf(line) + EPSILON)
      throw new Error(`No puedes recibir más de lo pendiente de ${line.product_name}.`);
    await moveStock(db, line.product_id, transfer.to_area_id, item.received);
    await db.runAsync(
      'UPDATE stock_transfer_lines SET quantity_received=ROUND(quantity_received+?,3) WHERE id=?',
      item.received,
      line.id,
    );
    await movement(
      db,
      'entrada',
      line,
      `Traslado desde ${transfer.from_area}`,
      transfer.to_area,
      item.received,
      actor,
    );
    total += item.received;
  }
  if (total <= 0) throw new Error('Indica al menos una cantidad recibida.');
  await refreshTransferStatus(db, transfer.id, actor);
  await audit(db, 'transfer.received', actor, {
    id: transfer.id,
    lines: input.lines,
    note: input.note,
  });
  return transfer.id;
}
async function resolveTransfer(
  db: SQLiteDatabase,
  input: CommandOf<'transfer.resolve'>,
  actor: Usuario,
) {
  const { transfer, lines } = await transferOf(db, input.transferId);
  if (!['sent', 'partial'].includes(transfer.status))
    throw new Error('Este traslado ya está cerrado.');
  const line = lines.find((candidate) => candidate.id === input.lineId);
  if (!line) throw new Error('La línea no pertenece a este traslado.');
  const pending = pendingOf(line);
  if (pending <= EPSILON) throw new Error('Esta línea no tiene cantidades pendientes.');
  if (input.resolution === 'return') {
    await moveStock(db, line.product_id, transfer.from_area_id, pending);
    await db.runAsync(
      'UPDATE stock_transfer_lines SET quantity_returned=ROUND(quantity_returned+?,3) WHERE id=?',
      pending,
      line.id,
    );
    await movement(
      db,
      'entrada',
      line,
      `Devolución de tránsito`,
      transfer.from_area,
      pending,
      actor,
    );
  } else {
    // Already removed from stock when sent: the loss is recorded, not moved again.
    await db.runAsync(
      'UPDATE stock_transfer_lines SET quantity_lost=ROUND(quantity_lost+?,3) WHERE id=?',
      pending,
      line.id,
    );
  }
  await refreshTransferStatus(db, transfer.id, actor);
  await audit(db, `transfer.${input.resolution === 'return' ? 'returned' : 'lost'}`, actor, {
    id: transfer.id,
    lineId: line.id,
    product: line.product_name,
    quantity: pending,
    unitCost: line.unit_cost,
    reason: input.reason,
  });
  return transfer.id;
}
async function cancelTransfer(
  db: SQLiteDatabase,
  input: CommandOf<'transfer.cancel'>,
  actor: Usuario,
) {
  const { transfer, lines } = await transferOf(db, input.transferId);
  if (transfer.status !== 'sent' || lines.some((line) => line.quantity_received > 0))
    throw new Error('Solo se cancela un traslado enviado sin recepciones.');
  for (const line of lines) {
    const pending = pendingOf(line);
    if (pending <= EPSILON) continue;
    await moveStock(db, line.product_id, transfer.from_area_id, pending);
    await db.runAsync(
      'UPDATE stock_transfer_lines SET quantity_returned=ROUND(quantity_returned+?,3) WHERE id=?',
      pending,
      line.id,
    );
    await movement(db, 'entrada', line, 'Traslado cancelado', transfer.from_area, pending, actor);
  }
  await db.runAsync(
    "UPDATE stock_transfers SET status='cancelled',cancel_reason=? WHERE id=?",
    input.reason,
    transfer.id,
  );
  await audit(db, 'transfer.cancelled', actor, {
    id: transfer.id,
    reason: input.reason,
  });
  return transfer.id;
}

// ---------- Clients, suppliers and credit ----------
async function saveParty(db: SQLiteDatabase, input: CommandOf<'party.save'>, actor: Usuario) {
  let id = input.id;
  const values = [
    input.kind,
    input.name,
    input.document,
    input.phone,
    input.email,
    input.address,
    input.creditLimit,
    input.notes,
    input.active ? 1 : 0,
  ];
  if (id) {
    const current = await db.getFirstAsync<Party>('SELECT * FROM parties WHERE id=?', id);
    if (!current) throw new Error('Cliente o proveedor no encontrado.');
    const balance = (await partyBalances(db, id))[0];
    if (
      balance &&
      ((input.kind === 'supplier' && balance.receivable > 0.005) ||
        (input.kind === 'client' && balance.payable > 0.005))
    )
      throw new Error('Tiene saldos pendientes en el otro tipo. Liquídalos antes de cambiarlo.');
    await db.runAsync(
      'UPDATE parties SET kind=?,name=?,document=?,phone=?,email=?,address=?,credit_limit=?,notes=?,active=? WHERE id=?',
      ...values,
      id,
    );
  } else
    id = (
      await db.runAsync(
        'INSERT INTO parties(kind,name,document,phone,email,address,credit_limit,notes,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        ...values,
        nowIso(),
      )
    ).lastInsertRowId;
  await audit(db, 'party.saved', actor, {
    id,
    kind: input.kind,
    name: input.name,
  });
  return String(id);
}
const effect = (entry: Pick<LedgerEntry, 'kind' | 'base_amount'>) =>
  entry.kind === 'charge' ? entry.base_amount : -entry.base_amount;
export async function partyBalances(db: SQLiteDatabase, partyId?: number): Promise<PartyBalance[]> {
  const entries = await db.getAllAsync<LedgerEntry>(
    `SELECT * FROM party_ledger ${partyId ? 'WHERE party_id=?' : ''} ORDER BY date,id`,
    ...(partyId ? [partyId] : []),
  );
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const reversed = new Set(
    entries.flatMap((entry) => (entry.reverses_id ? [entry.reverses_id] : [])),
  );
  const balances = new Map<number, PartyBalance & { duePayments: number; dueCharges: number }>();
  const date = today();
  for (const entry of entries) {
    const balance = balances.get(entry.party_id) ?? {
      partyId: entry.party_id,
      receivable: 0,
      payable: 0,
      overdue: 0,
      duePayments: 0,
      dueCharges: 0,
    };
    const signed =
      entry.kind === 'reversal' ? -effect(byId.get(entry.reverses_id!)!) : effect(entry);
    balance[entry.side] = roundMoney(balance[entry.side] + signed);
    if (entry.side === 'receivable' && !reversed.has(entry.id) && entry.kind !== 'reversal') {
      if (entry.kind === 'charge' && entry.due_date && entry.due_date < date)
        balance.dueCharges += entry.base_amount;
      if (entry.kind === 'payment') balance.duePayments += entry.base_amount;
    }
    balances.set(entry.party_id, balance);
  }
  return [...balances.values()].map(({ duePayments, dueCharges, ...balance }) => ({
    ...balance,
    overdue: roundMoney(Math.max(0, Math.min(balance.receivable, dueCharges - duePayments))),
  }));
}
async function activeParty(db: SQLiteDatabase, id: number, side: LedgerEntry['side']) {
  const party = await db.getFirstAsync<Party>('SELECT * FROM parties WHERE id=?', id);
  if (!party?.active) throw new Error('Cliente o proveedor no encontrado o inactivo.');
  if (
    (side === 'receivable' && party.kind === 'supplier') ||
    (side === 'payable' && party.kind === 'client')
  )
    throw new Error(
      side === 'receivable'
        ? 'Las cuentas por cobrar son de clientes.'
        : 'Las cuentas por pagar son de proveedores.',
    );
  return party;
}
async function insertLedger(
  db: SQLiteDatabase,
  actor: Usuario,
  entry: Omit<LedgerEntry, 'id' | 'username' | 'date'>,
) {
  const id = Crypto.randomUUID();
  await db.runAsync(
    'INSERT INTO party_ledger(id,party_id,side,kind,amount,currency,rate,base_amount,method,reference,due_date,note,reverses_id,cash_entry_id,username,date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id,
    entry.party_id,
    entry.side,
    entry.kind,
    entry.amount,
    entry.currency,
    entry.rate,
    entry.base_amount,
    entry.method,
    entry.reference,
    entry.due_date,
    entry.note,
    entry.reverses_id,
    entry.cash_entry_id,
    actor.username,
    nowIso(),
  );
  return id;
}
async function ledgerCharge(db: SQLiteDatabase, input: CommandOf<'ledger.charge'>, actor: Usuario) {
  const party = await activeParty(db, input.partyId, input.side);
  const value = await converted(db, input.amount, input.currency);
  if (input.side === 'receivable' && party.credit_limit > 0) {
    const balance = (await partyBalances(db, party.id))[0]?.receivable ?? 0;
    if (balance + value.baseAmount > party.credit_limit + 0.005)
      throw new Error('El cargo supera el límite de crédito del cliente.');
  }
  const id = await insertLedger(db, actor, {
    party_id: party.id,
    side: input.side,
    kind: 'charge',
    amount: roundMoney(input.amount),
    currency: value.currency,
    rate: value.rate,
    base_amount: value.baseAmount,
    method: null,
    reference: input.reference,
    due_date: input.dueDate ?? null,
    note: input.note,
    reverses_id: null,
    cash_entry_id: null,
  });
  await audit(db, 'ledger.charge', actor, {
    id,
    partyId: party.id,
    side: input.side,
    ...value,
  });
  return id;
}
async function ledgerPayment(
  db: SQLiteDatabase,
  input: CommandOf<'ledger.payment'>,
  actor: Usuario,
) {
  const party = await activeParty(db, input.partyId, input.side);
  const value = await converted(db, input.amount, input.currency);
  const balance = (await partyBalances(db, party.id))[0]?.[input.side] ?? 0;
  if (value.baseAmount > balance + 0.005) throw new Error('El pago supera el saldo pendiente.');
  const id = Crypto.randomUUID();
  const cash =
    input.method === 'cash'
      ? await cashEntry(
          db,
          actor,
          input.side === 'receivable' ? 'in' : 'out',
          input.amount,
          value.currency,
          'ledger',
          id,
          `${input.side === 'receivable' ? 'Cobro a' : 'Pago a'} ${party.name}`,
        )
      : null;
  await db.runAsync(
    'INSERT INTO party_ledger(id,party_id,side,kind,amount,currency,rate,base_amount,method,reference,due_date,note,reverses_id,cash_entry_id,username,date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id,
    party.id,
    input.side,
    'payment',
    roundMoney(input.amount),
    value.currency,
    value.rate,
    value.baseAmount,
    input.method,
    input.reference,
    null,
    input.note,
    null,
    cash,
    actor.username,
    nowIso(),
  );
  await audit(db, 'ledger.payment', actor, {
    id,
    partyId: party.id,
    side: input.side,
    ...value,
  });
  return id;
}
async function voidLedger(db: SQLiteDatabase, input: CommandOf<'ledger.void'>, actor: Usuario) {
  const entry = await db.getFirstAsync<LedgerEntry>(
    'SELECT * FROM party_ledger WHERE id=?',
    input.entryId,
  );
  if (!entry || entry.kind === 'reversal') throw new Error('Movimiento no encontrado.');
  if (await db.getFirstAsync('SELECT id FROM party_ledger WHERE reverses_id=?', entry.id))
    throw new Error('Este movimiento ya fue anulado.');
  if (entry.kind === 'charge') {
    const balance = (await partyBalances(db, entry.party_id))[0]?.[entry.side] ?? 0;
    if (balance - entry.base_amount < -0.005)
      throw new Error('Anula primero los pagos aplicados a este cargo.');
  }
  const party = await db.getFirstAsync<Party>('SELECT * FROM parties WHERE id=?', entry.party_id);
  const cash = entry.cash_entry_id
    ? await cashEntry(
        db,
        actor,
        entry.side === 'receivable' ? 'out' : 'in',
        entry.amount,
        entry.currency,
        'ledger',
        entry.id,
        `Anulación de pago (${party?.name ?? entry.party_id})`,
      )
    : null;
  const id = await insertLedger(db, actor, {
    ...entry,
    kind: 'reversal',
    method: entry.method,
    reference: entry.reference,
    due_date: null,
    note: input.reason,
    reverses_id: entry.id,
    cash_entry_id: cash,
  });
  await audit(db, 'ledger.void', actor, {
    id,
    reverses: entry.id,
    reason: input.reason,
  });
  return id;
}

// ---------- Currencies ----------
async function saveCurrency(db: SQLiteDatabase, input: CommandOf<'currency.save'>, actor: Usuario) {
  await db.runAsync(
    'INSERT INTO currencies(code,name,symbol,decimals) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,decimals=excluded.decimals',
    input.code,
    input.name,
    input.symbol,
    input.decimals,
  );
  await audit(db, 'currency.saved', actor, input);
  return input.code;
}
async function saveRate(db: SQLiteDatabase, input: CommandOf<'currency.rate'>, actor: Usuario) {
  if (!(await db.getFirstAsync('SELECT code FROM currencies WHERE code=?', input.code)))
    throw new Error('Registra la moneda antes de su tasa.');
  if (input.code === (await baseCurrency(db))) throw new Error('La moneda base siempre vale 1.');
  if (input.effectiveDate > today()) throw new Error('No registres tasas con fecha futura.');
  const id = (
    await db.runAsync(
      'INSERT INTO exchange_rates(code,rate,effective_date,source,username,recorded_at) VALUES(?,?,?,?,?,?)',
      input.code,
      input.rate,
      input.effectiveDate,
      input.source,
      actor.username,
      nowIso(),
    )
  ).lastInsertRowId;
  await audit(db, 'currency.rate', actor, input);
  return String(id);
}
async function setBaseCurrency(
  db: SQLiteDatabase,
  input: CommandOf<'currency.setBase'>,
  actor: Usuario,
) {
  if (!(await db.getFirstAsync('SELECT code FROM currencies WHERE code=?', input.code)))
    throw new Error('Registra la moneda antes de usarla como base.');
  const used = await db.getFirstAsync(
    `SELECT 1 FROM party_ledger UNION ALL SELECT 1 FROM partner_movements
     UNION ALL SELECT 1 FROM payroll_runs UNION ALL SELECT 1 FROM cash_entries
     UNION ALL SELECT 1 FROM exchange_rates LIMIT 1`,
  );
  if (used) throw new Error('La moneda base no se cambia después de registrar tasas o importes.');
  await db.runAsync('UPDATE currencies SET is_base=0 WHERE is_base=1');
  await db.runAsync('UPDATE currencies SET is_base=1 WHERE code=?', input.code);
  await audit(db, 'currency.base', actor, input);
  return input.code;
}

// ---------- Payroll ----------
async function saveEmployee(db: SQLiteDatabase, input: CommandOf<'employee.save'>, actor: Usuario) {
  if (
    input.branchId &&
    !(await db.getFirstAsync('SELECT id FROM branches WHERE id=?', input.branchId))
  )
    throw new Error('Sucursal no encontrada.');
  if (input.endDate && input.endDate < input.startDate)
    throw new Error('La fecha de baja no puede ser anterior al alta.');
  const values = [
    input.name,
    input.document,
    input.position,
    input.branchId,
    input.baseSalary,
    input.payPeriod,
    input.startDate,
    input.endDate,
    input.active ? 1 : 0,
  ];
  let id = input.id;
  if (id) {
    const result = await db.runAsync(
      'UPDATE employees SET name=?,document=?,position=?,branch_id=?,base_salary=?,pay_period=?,start_date=?,end_date=?,active=? WHERE id=?',
      ...values,
      id,
    );
    if (!result.changes) throw new Error('Trabajador no encontrado.');
  } else
    id = (
      await db.runAsync(
        'INSERT INTO employees(name,document,position,branch_id,base_salary,pay_period,start_date,end_date,active) VALUES(?,?,?,?,?,?,?,?,?)',
        ...values,
      )
    ).lastInsertRowId;
  await audit(db, 'employee.saved', actor, { id, name: input.name });
  return String(id);
}
async function createPayroll(
  db: SQLiteDatabase,
  input: CommandOf<'payroll.create'>,
  actor: Usuario,
) {
  if (input.periodEnd < input.periodStart)
    throw new Error('El fin del periodo no puede ser anterior al inicio.');
  if (new Set(input.lines.map((line) => line.employeeId)).size !== input.lines.length)
    throw new Error('Cada trabajador debe aparecer una sola vez.');
  const id = Crypto.randomUUID();
  const lines: Array<Omit<PayrollLine, 'id' | 'run_id'>> = [];
  for (const line of input.lines) {
    const employee = await db.getFirstAsync<Employee>(
      'SELECT * FROM employees WHERE id=?',
      line.employeeId,
    );
    if (!employee?.active) throw new Error('Un trabajador no existe o está inactivo.');
    const overlap = await db.getFirstAsync(
      `SELECT 1 FROM payroll_lines l JOIN payroll_runs r ON r.id=l.run_id
       WHERE l.employee_id=? AND r.status<>'void' AND r.period_start<=? AND r.period_end>=? LIMIT 1`,
      employee.id,
      input.periodEnd,
      input.periodStart,
    );
    if (overlap) throw new Error(`${employee.name} ya tiene una nómina en ese periodo.`);
    const gross = roundMoney(line.base + line.bonuses);
    if (line.deductions > gross + 0.005)
      throw new Error(`Las deducciones de ${employee.name} superan el bruto.`);
    lines.push({
      employee_id: employee.id,
      employee_name: employee.name,
      base: roundMoney(line.base),
      bonuses: roundMoney(line.bonuses),
      deductions: roundMoney(line.deductions),
      gross,
      net: roundMoney(gross - line.deductions),
      contribution: roundMoney((gross * input.contributionRate) / 100),
    });
  }
  const sum = (key: 'gross' | 'deductions' | 'net' | 'contribution') =>
    roundMoney(lines.reduce((total, line) => total + line[key], 0));
  await db.runAsync(
    "INSERT INTO payroll_runs(id,period_start,period_end,status,contribution_rate,gross_total,deductions_total,net_total,contribution_total,note,created_by,created_at) VALUES(?,?,?,'draft',?,?,?,?,?,?,?,?)",
    id,
    input.periodStart,
    input.periodEnd,
    input.contributionRate,
    sum('gross'),
    sum('deductions'),
    sum('net'),
    sum('contribution'),
    input.note,
    actor.username,
    nowIso(),
  );
  for (const line of lines)
    await db.runAsync(
      'INSERT INTO payroll_lines(run_id,employee_id,employee_name,base,bonuses,deductions,gross,net,contribution) VALUES(?,?,?,?,?,?,?,?,?)',
      id,
      line.employee_id,
      line.employee_name,
      line.base,
      line.bonuses,
      line.deductions,
      line.gross,
      line.net,
      line.contribution,
    );
  await audit(db, 'payroll.created', actor, {
    id,
    net: sum('net'),
    lines: lines.length,
  });
  return id;
}
async function payrollRun(db: SQLiteDatabase, id: string) {
  const run = await db.getFirstAsync<PayrollRun & { cash_entry_id: string | null }>(
    'SELECT * FROM payroll_runs WHERE id=?',
    id,
  );
  if (!run) throw new Error('Nómina no encontrada.');
  return run;
}
async function approvePayroll(
  db: SQLiteDatabase,
  input: CommandOf<'payroll.approve'>,
  actor: Usuario,
) {
  const run = await payrollRun(db, input.runId);
  if (run.status !== 'draft') throw new Error('Solo se aprueba una nómina en borrador.');
  await db.runAsync(
    "UPDATE payroll_runs SET status='approved',approved_by=?,approved_at=? WHERE id=?",
    actor.username,
    nowIso(),
    run.id,
  );
  await audit(db, 'payroll.approved', actor, { id: run.id });
  return run.id;
}
async function payPayroll(db: SQLiteDatabase, input: CommandOf<'payroll.pay'>, actor: Usuario) {
  const run = await payrollRun(db, input.runId);
  if (run.status !== 'approved') throw new Error('Aprueba la nómina antes de pagarla.');
  const cash =
    input.method === 'cash' && run.net_total > 0
      ? await cashEntry(
          db,
          actor,
          'out',
          run.net_total,
          await baseCurrency(db),
          'payroll',
          run.id,
          `Nómina ${run.period_start} a ${run.period_end}`,
        )
      : null;
  await db.runAsync(
    "UPDATE payroll_runs SET status='paid',paid_by=?,paid_at=?,method=?,cash_entry_id=? WHERE id=?",
    actor.username,
    nowIso(),
    input.method,
    cash,
    run.id,
  );
  await audit(db, 'payroll.paid', actor, {
    id: run.id,
    method: input.method,
    net: run.net_total,
  });
  return run.id;
}
async function voidPayroll(db: SQLiteDatabase, input: CommandOf<'payroll.void'>, actor: Usuario) {
  const run = await payrollRun(db, input.runId);
  if (run.status === 'void') throw new Error('La nómina ya está anulada.');
  if (run.cash_entry_id)
    await cashEntry(
      db,
      actor,
      'in',
      run.net_total,
      await baseCurrency(db),
      'payroll',
      run.id,
      `Anulación de nómina ${run.period_start}`,
    );
  await db.runAsync(
    "UPDATE payroll_runs SET status='void',void_reason=? WHERE id=?",
    input.reason,
    run.id,
  );
  await audit(db, 'payroll.void', actor, { id: run.id, reason: input.reason });
  return run.id;
}

// ---------- Partners ----------
async function savePartner(db: SQLiteDatabase, input: CommandOf<'partner.save'>, actor: Usuario) {
  const others =
    (
      await db.getFirstAsync<{ total: number | null }>(
        'SELECT SUM(share_percent) AS total FROM partners WHERE active=1 AND id<>?',
        input.id ?? 0,
      )
    )?.total ?? 0;
  if (input.active && others + input.sharePercent > 100.0001)
    throw new Error('La suma de participaciones activas no puede superar el 100 %.');
  const values = [
    input.name,
    input.document,
    input.sharePercent,
    input.joinedAt,
    input.active ? 1 : 0,
  ];
  let id = input.id;
  if (id) {
    const result = await db.runAsync(
      'UPDATE partners SET name=?,document=?,share_percent=?,joined_at=?,active=? WHERE id=?',
      ...values,
      id,
    );
    if (!result.changes) throw new Error('Socio no encontrado.');
  } else
    id = (
      await db.runAsync(
        'INSERT INTO partners(name,document,share_percent,joined_at,active) VALUES(?,?,?,?,?)',
        ...values,
      )
    ).lastInsertRowId;
  await audit(db, 'partner.saved', actor, {
    id,
    name: input.name,
    share: input.sharePercent,
  });
  return String(id);
}
async function insertPartnerMovement(
  db: SQLiteDatabase,
  actor: Usuario,
  row: Omit<PartnerMovement, 'id' | 'username' | 'date'>,
  id = Crypto.randomUUID(),
) {
  await db.runAsync(
    'INSERT INTO partner_movements(id,partner_id,kind,amount,currency,rate,base_amount,method,note,reverses_id,cash_entry_id,username,date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id,
    row.partner_id,
    row.kind,
    row.amount,
    row.currency,
    row.rate,
    row.base_amount,
    row.method,
    row.note,
    row.reverses_id,
    row.cash_entry_id,
    actor.username,
    nowIso(),
  );
  return id;
}
async function partnerMovement(
  db: SQLiteDatabase,
  input: CommandOf<'partner.movement'>,
  actor: Usuario,
) {
  const partner = await db.getFirstAsync<Partner>(
    'SELECT * FROM partners WHERE id=?',
    input.partnerId,
  );
  if (!partner?.active) throw new Error('Socio no encontrado o inactivo.');
  const value = await converted(db, input.amount, input.currency);
  const id = Crypto.randomUUID();
  const labels = {
    contribution: 'Aporte',
    withdrawal: 'Retiro',
    dividend: 'Dividendo',
  } as const;
  const cash =
    input.method === 'cash'
      ? await cashEntry(
          db,
          actor,
          input.kind === 'contribution' ? 'in' : 'out',
          input.amount,
          value.currency,
          'partner',
          id,
          `${labels[input.kind]} de ${partner.name}`,
        )
      : null;
  await insertPartnerMovement(
    db,
    actor,
    {
      partner_id: partner.id,
      kind: input.kind,
      amount: roundMoney(input.amount),
      currency: value.currency,
      rate: value.rate,
      base_amount: value.baseAmount,
      method: input.method,
      note: input.note,
      reverses_id: null,
      cash_entry_id: cash,
    },
    id,
  );
  await audit(db, 'partner.movement', actor, {
    id,
    partnerId: partner.id,
    kind: input.kind,
    ...value,
  });
  return id;
}
async function voidPartnerMovement(
  db: SQLiteDatabase,
  input: CommandOf<'partner.void'>,
  actor: Usuario,
) {
  const entry = await db.getFirstAsync<PartnerMovement>(
    'SELECT * FROM partner_movements WHERE id=?',
    input.movementId,
  );
  if (!entry || entry.kind === 'reversal') throw new Error('Movimiento no encontrado.');
  if (await db.getFirstAsync('SELECT id FROM partner_movements WHERE reverses_id=?', entry.id))
    throw new Error('Este movimiento ya fue anulado.');
  const cash = entry.cash_entry_id
    ? await cashEntry(
        db,
        actor,
        entry.kind === 'contribution' ? 'out' : 'in',
        entry.amount,
        entry.currency,
        'partner',
        entry.id,
        'Anulación de movimiento de socio',
      )
    : null;
  const id = await insertPartnerMovement(db, actor, {
    ...entry,
    kind: 'reversal',
    note: input.reason,
    reverses_id: entry.id,
    cash_entry_id: cash,
  });
  await audit(db, 'partner.void', actor, {
    id,
    reverses: entry.id,
    reason: input.reason,
  });
  return id;
}

// ---------- Command dispatcher ----------
export const parseBusinessResult = (value: unknown) => z.string().min(1).max(128).parse(value);
export async function executeBusinessCommand(
  db: SQLiteDatabase,
  raw: BusinessCommand,
  username: string,
): Promise<string> {
  const parsed = businessCommandSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? 'Revisa los datos de la operación.');
  const input = parsed.data;
  const actor = await businessActor(db, username, input.action);
  return financeCommand(
    db,
    input.commandId,
    JSON.stringify(['business', actor.username, input]),
    async () => {
      switch (input.action) {
        case 'branch.save':
          return saveBranch(db, input, actor);
        case 'branch.assignArea':
          return assignArea(db, input, actor);
        case 'branch.setDevice':
          return setDeviceBranch(db, input, actor);
        case 'transfer.send':
          return sendTransfer(db, input, actor);
        case 'transfer.receive':
          return receiveTransfer(db, input, actor);
        case 'transfer.resolve':
          return resolveTransfer(db, input, actor);
        case 'transfer.cancel':
          return cancelTransfer(db, input, actor);
        case 'party.save':
          return saveParty(db, input, actor);
        case 'ledger.charge':
          return ledgerCharge(db, input, actor);
        case 'ledger.payment':
          return ledgerPayment(db, input, actor);
        case 'ledger.void':
          return voidLedger(db, input, actor);
        case 'currency.save':
          return saveCurrency(db, input, actor);
        case 'currency.rate':
          return saveRate(db, input, actor);
        case 'currency.setBase':
          return setBaseCurrency(db, input, actor);
        case 'employee.save':
          return saveEmployee(db, input, actor);
        case 'payroll.create':
          return createPayroll(db, input, actor);
        case 'payroll.approve':
          return approvePayroll(db, input, actor);
        case 'payroll.pay':
          return payPayroll(db, input, actor);
        case 'payroll.void':
          return voidPayroll(db, input, actor);
        case 'partner.save':
          return savePartner(db, input, actor);
        case 'partner.movement':
          return partnerMovement(db, input, actor);
        case 'partner.void':
          return voidPartnerMovement(db, input, actor);
        default:
          throw new Error('Operación empresarial no soportada.');
      }
    },
    parseBusinessResult,
  );
}

// ---------- Reads and consolidation ----------
function period(filter: BusinessFilter) {
  const parsed = businessFilterSchema.parse(filter ?? {});
  const now = today();
  const start = parsed.start ?? `${now.slice(0, 8)}01`;
  const end = parsed.end ?? now;
  if (end < start) throw new Error('El fin del periodo no puede ser anterior al inicio.');
  return { start, end };
}
export async function consolidate(
  db: SQLiteDatabase,
  filter: BusinessFilter = {},
): Promise<Consolidation> {
  const { start, end } = period(filter);
  // Timestamps are UTC ISO strings; periods are the device's local calendar days.
  const branches = await db.getAllAsync<Branch>('SELECT * FROM branches ORDER BY name');
  const rows = new Map<number, BranchConsolidation>([
    [
      0,
      {
        branchId: null,
        name: PRINCIPAL_BRANCH_NAME,
        sales: 0,
        tickets: 0,
        inventoryValue: 0,
        inventoryUnknownCost: 0,
        payroll: 0,
      },
    ],
  ]);
  for (const branch of branches)
    rows.set(branch.id, {
      branchId: branch.id,
      name: branch.name,
      sales: 0,
      tickets: 0,
      inventoryValue: 0,
      inventoryUnknownCost: 0,
      payroll: 0,
    });
  const at = (key: number | null) => rows.get(key ?? 0) ?? rows.get(0)!;
  for (const row of await db.getAllAsync<{ key: number | null; total: number }>(
    `SELECT ab.branch_id AS key,SUM(l.subtotal) AS total FROM sale_lines l
     JOIN sales s ON s.id=l.sale_id LEFT JOIN area_branches ab ON ab.area_id=l.area_id
     WHERE date(s.date,'localtime') BETWEEN ? AND ? GROUP BY ab.branch_id`,
    start,
    end,
  ))
    at(row.key).sales = roundMoney(at(row.key).sales + row.total);
  for (const row of await db.getAllAsync<{ key: number; count: number }>(
    `SELECT t.branch_key AS key,COUNT(*) AS count FROM sale_tickets t JOIN sales s ON s.id=t.sale_id
     WHERE date(s.date,'localtime') BETWEEN ? AND ? GROUP BY t.branch_key`,
    start,
    end,
  ))
    at(row.key || null).tickets += row.count;
  for (const row of await db.getAllAsync<{
    key: number | null;
    value: number;
    unknown: number;
  }>(
    `SELECT ab.branch_id AS key,
       SUM(CASE WHEN p.unit_cost IS NULL THEN 0 ELSE st.quantity*p.unit_cost END) AS value,
       SUM(CASE WHEN p.unit_cost IS NULL AND st.quantity>0 THEN 1 ELSE 0 END) AS unknown
     FROM area_stock st JOIN products p ON p.id=st.product_id
     LEFT JOIN area_branches ab ON ab.area_id=st.area_id GROUP BY ab.branch_id`,
  )) {
    at(row.key).inventoryValue = roundMoney(at(row.key).inventoryValue + row.value);
    at(row.key).inventoryUnknownCost += row.unknown;
  }
  for (const row of await db.getAllAsync<{ key: number | null; total: number }>(
    `SELECT e.branch_id AS key,SUM(l.gross) AS total FROM payroll_lines l
     JOIN payroll_runs r ON r.id=l.run_id JOIN employees e ON e.id=l.employee_id
     WHERE r.status IN ('approved','paid') AND r.period_end>=? AND r.period_end<=? GROUP BY e.branch_id`,
    start,
    end,
  ))
    at(row.key).payroll = roundMoney(at(row.key).payroll + row.total);
  // Transit stock is valued at the unit cost captured when it was sent.
  const transit = await db.getFirstAsync<{ value: number | null }>(
    `SELECT SUM((l.quantity_sent-l.quantity_received-l.quantity_returned-l.quantity_lost)*COALESCE(l.unit_cost,0)) AS value
     FROM stock_transfer_lines l JOIN stock_transfers t ON t.id=l.transfer_id WHERE t.status IN ('sent','partial')`,
  );
  const balances = await partyBalances(db);
  const capital = await db.getAllAsync<PartnerMovement>('SELECT * FROM partner_movements');
  const byId = new Map(capital.map((row) => [row.id, row]));
  const capitalEffect = (row: PartnerMovement): number =>
    row.kind === 'contribution'
      ? row.base_amount
      : row.kind === 'withdrawal'
        ? -row.base_amount
        : row.kind === 'reversal'
          ? -capitalEffect(byId.get(row.reverses_id!)!)
          : 0;
  const base = await baseCurrency(db);
  const cash = await db.getFirstAsync<{ net: number | null }>(
    `SELECT SUM(CASE WHEN direction='in' THEN amount ELSE -amount END) AS net FROM cash_entries
     WHERE currency=? AND date(date,'localtime') BETWEEN ? AND ?`,
    base,
    start,
    end,
  );
  const list = [...rows.values()];
  const total = (key: 'sales' | 'tickets' | 'inventoryValue' | 'payroll') =>
    roundMoney(list.reduce((sum, row) => sum + row[key], 0));
  return {
    start,
    end,
    baseCurrency: base,
    branches: list,
    totals: {
      sales: total('sales'),
      tickets: list.reduce((sum, row) => sum + row.tickets, 0),
      inventoryValue: total('inventoryValue'),
      inTransitValue: roundMoney(transit?.value ?? 0),
      receivables: roundMoney(balances.reduce((sum, row) => sum + row.receivable, 0)),
      payables: roundMoney(balances.reduce((sum, row) => sum + row.payable, 0)),
      payroll: total('payroll'),
      partnerCapital: roundMoney(capital.reduce((sum, row) => sum + capitalEffect(row), 0)),
      cashEntriesNet: roundMoney(cash?.net ?? 0),
    },
  };
}

export async function getBusinessData(
  db: SQLiteDatabase,
  username: string,
  filter: BusinessFilter = {},
): Promise<BusinessData> {
  const actor = await businessActor(db, username);
  const full = actor.role !== 'storekeeper';
  const transfers = await db.getAllAsync<StockTransfer>(
    'SELECT id,from_area_id,to_area_id,from_area,to_area,from_branch_id,to_branch_id,status,note,sent_by,sent_at,received_by,received_at FROM stock_transfers ORDER BY sent_at DESC LIMIT 200',
  );
  const transferLines = transfers.length
    ? await db.getAllAsync<StockTransferLine>(
        `SELECT * FROM stock_transfer_lines WHERE transfer_id IN (${transfers.map(() => '?').join(',')}) ORDER BY id`,
        ...transfers.map((transfer) => transfer.id),
      )
    : [];
  const deviceBranch = await deviceBranchId(db);
  const common = {
    baseCurrency: await baseCurrency(db),
    deviceBranchId: deviceBranch,
    branches: await db.getAllAsync<Branch>('SELECT * FROM branches ORDER BY name'),
    areas: await db.getAllAsync<AreaBranch>(
      'SELECT a.id AS area_id,a.name AS area_name,ab.branch_id FROM areas a LEFT JOIN area_branches ab ON ab.area_id=a.id ORDER BY a.name',
    ),
    transfers,
    transferLines,
  };
  if (!full)
    return {
      ...common,
      parties: [],
      ledger: [],
      balances: [],
      currencies: [],
      rates: [],
      employees: [],
      payrollRuns: [],
      payrollLines: [],
      partners: [],
      partnerMovements: [],
      consolidation: null,
    };
  const payrollRuns = await db.getAllAsync<PayrollRun>(
    'SELECT id,period_start,period_end,status,contribution_rate,gross_total,deductions_total,net_total,contribution_total,note,created_by,created_at,approved_by,paid_by,paid_at,method,void_reason FROM payroll_runs ORDER BY period_start DESC,created_at DESC LIMIT 100',
  );
  return {
    ...common,
    parties: await db.getAllAsync<Party>('SELECT * FROM parties ORDER BY name'),
    ledger: await db.getAllAsync<LedgerEntry>(
      'SELECT * FROM party_ledger ORDER BY date DESC LIMIT 500',
    ),
    balances: await partyBalances(db),
    currencies: await db.getAllAsync<Currency>(
      'SELECT code,name,symbol,decimals FROM currencies ORDER BY is_base DESC,code',
    ),
    rates: await db.getAllAsync<ExchangeRate>(
      'SELECT * FROM exchange_rates ORDER BY effective_date DESC,id DESC LIMIT 200',
    ),
    employees: await db.getAllAsync<Employee>('SELECT * FROM employees ORDER BY name'),
    payrollRuns,
    payrollLines: payrollRuns.length
      ? await db.getAllAsync<PayrollLine>(
          `SELECT * FROM payroll_lines WHERE run_id IN (${payrollRuns.map(() => '?').join(',')}) ORDER BY id`,
          ...payrollRuns.map((run) => run.id),
        )
      : [],
    partners: await db.getAllAsync<Partner>('SELECT * FROM partners ORDER BY name'),
    partnerMovements: await db.getAllAsync<PartnerMovement>(
      'SELECT * FROM partner_movements ORDER BY date DESC LIMIT 500',
    ),
    consolidation: await consolidate(db, filter),
  };
}

// Business-archive and recovery check: transfer lines and transit stock must agree.
export async function validateBusinessStorage(db: SQLiteDatabase) {
  const broken = await db.getFirstAsync(
    `SELECT l.id FROM stock_transfer_lines l JOIN stock_transfers t ON t.id=l.transfer_id
     WHERE (t.status IN ('received','cancelled') AND ABS(l.quantity_sent-l.quantity_received-l.quantity_returned-l.quantity_lost)>0.0005)
       OR l.quantity_received+l.quantity_returned+l.quantity_lost>l.quantity_sent+0.0005 LIMIT 1`,
  );
  if (broken) throw new Error('Los traslados del archivo no son coherentes.');
  const shares = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(share_percent) AS total FROM partners WHERE active=1',
  );
  if ((shares?.total ?? 0) > 100.0001)
    throw new Error('Las participaciones de los socios superan el 100 %.');
}

export type { PaymentMethod };
