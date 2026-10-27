import type { SQLiteDatabase } from 'expo-sqlite';
import type { Producto, Usuario, LineaVenta, LegacyPayment } from '@/lib/models';
import type {
  AuthorizationProof,
  ConsumptionInput,
  ConsumptionRecord,
  ConsumptionVoidInput,
  CostInput,
  PurchaseInput,
  SaleAdjustmentInput,
  FinanceFilter,
  FinanceEntry,
  FinanceReport,
} from '@/lib/finance-models';
import { CONSUMPTION_REASONS } from '@/lib/finance-models';
import { aggregateFinance, groupFinance } from '@/lib/finance-calculations';
import { roundMoney, validateQuantity } from '@/lib/units';

export async function migrateFinance(db: SQLiteDatabase) {
  const add = async (table: string, column: string, definition: string) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some((c) => c.name === column))
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  await add('products', 'unit_cost', 'REAL CHECK(unit_cost IS NULL OR unit_cost>=0)');
  await add(
    'users',
    'can_authorize_consumption',
    'INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_consumption IN (0,1))',
  );
  await add('sales', 'seller_id', 'INTEGER');
  await add('sale_lines', 'unit_cost', 'REAL CHECK(unit_cost IS NULL OR unit_cost>=0)');
  await add('sale_lines', 'category', "TEXT NOT NULL DEFAULT ''");
  const schema = await db.getFirstAsync<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE name='movements'",
  );
  if (!schema?.sql.includes('CONSUMO_INTERNO')) {
    const seq = await db.getFirstAsync<{ seq: number }>(
      "SELECT seq FROM sqlite_sequence WHERE name='movements'",
    );
    await db.execAsync(`CREATE TABLE movements_upgrade (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL CHECK(type IN ('entrada','salida','traslado','CONSUMO_INTERNO','ANULACION_CONSUMO','DEVOLUCION')),
      product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
      from_area TEXT, to_area TEXT, quantity REAL NOT NULL CHECK(quantity>0), user TEXT NOT NULL, date TEXT NOT NULL);
      INSERT INTO movements_upgrade SELECT * FROM movements; DROP TABLE movements; ALTER TABLE movements_upgrade RENAME TO movements;
      CREATE INDEX movements_date_idx ON movements(date);
      CREATE INDEX movement_filters_idx ON movements(product_id,user,from_area,to_area);`);
    if (seq)
      await db.runAsync(
        "UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='movements'",
        seq.seq,
      );
  }
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS cost_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id),
      date TEXT NOT NULL, old_cost REAL, new_cost REAL, quantity REAL NOT NULL DEFAULT 0,
      purchase_cost REAL, method TEXT NOT NULL, reason TEXT NOT NULL, actor_id INTEGER NOT NULL, actor_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS internal_consumptions (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
      area_id INTEGER NOT NULL REFERENCES areas(id), quantity REAL NOT NULL CHECK(quantity>0), price REAL NOT NULL,
      unit_cost REAL, value REAL NOT NULL, cost REAL, reason TEXT NOT NULL, notes TEXT NOT NULL,
      actor_id INTEGER NOT NULL, actor_name TEXT NOT NULL, authorizer_id INTEGER NOT NULL, authorizer_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmado','anulado','rectificado')), replaces_id TEXT REFERENCES internal_consumptions(id));
    CREATE TABLE IF NOT EXISTS consumption_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, consumption_id TEXT NOT NULL REFERENCES internal_consumptions(id),
      date TEXT NOT NULL, quantity REAL NOT NULL, value REAL NOT NULL, cost REAL, action TEXT NOT NULL,
      reason TEXT NOT NULL, actor_id INTEGER NOT NULL, actor_name TEXT NOT NULL, authorizer_id INTEGER NOT NULL, authorizer_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sale_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, command_id TEXT NOT NULL, sale_id INTEGER NOT NULL REFERENCES sales(id),
      line_id INTEGER NOT NULL REFERENCES sale_lines(id), session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
      date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('devolucion','anulacion','descuento')),
      quantity REAL NOT NULL, amount REAL NOT NULL, cost REAL, payments TEXT NOT NULL,
      reason TEXT NOT NULL, actor_id INTEGER NOT NULL, actor_name TEXT NOT NULL, authorizer_id INTEGER NOT NULL, authorizer_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS consumption_date_idx ON consumption_events(date);
    CREATE INDEX IF NOT EXISTS adjustments_date_idx ON sale_adjustments(date);
  `);
}
export async function financeActor(
  db: SQLiteDatabase,
  username: string,
  adminOnly = true,
): Promise<Usuario> {
  const actor = await db.getFirstAsync<Usuario>(
    'SELECT * FROM users WHERE username=? COLLATE NOCASE',
    username,
  );
  if (
    !actor ||
    (adminOnly
      ? actor.role !== 'admin'
      : !['admin', 'supervisor', 'seller', 'storekeeper'].includes(actor.role))
  )
    throw new Error('Tu usuario no tiene permiso para esta operación.');
  return actor;
}
async function authorize(db: SQLiteDatabase, proof: AuthorizationProof, consumption = false) {
  const user = await db.getFirstAsync<Usuario>(
    'SELECT * FROM users WHERE username=? COLLATE NOCASE',
    proof.username,
  );
  if (
    !user ||
    !proof.passwordHash ||
    user.password_hash !== proof.passwordHash ||
    !(
      user.role === 'admin' ||
      (consumption && user.role === 'supervisor' && user.can_authorize_consumption === 1)
    )
  )
    throw new Error('La autorización no es válida. Revisa las credenciales y el permiso.');
  return user;
}
export async function financeCommand<T>(
  db: SQLiteDatabase,
  id: string,
  fingerprint: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!id || id.length > 128) throw new Error('La operación necesita un identificador válido.');
  const previous = await db.getFirstAsync<{ fingerprint: string; result: string }>(
    'SELECT * FROM finance_commands WHERE id=?',
    id,
  );
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new Error('El identificador pertenece a otra operación.');
    return JSON.parse(previous.result) as T;
  }
  const result = await action();
  await db.runAsync(
    'INSERT INTO finance_commands(id,fingerprint,result) VALUES(?,?,?)',
    id,
    fingerprint,
    JSON.stringify(result),
  );
  return result;
}
async function product(db: SQLiteDatabase, id: number) {
  const p = await db.getFirstAsync<Producto>('SELECT * FROM products WHERE id=?', id);
  if (!p) throw new Error('Producto no encontrado.');
  return p;
}
async function stock(db: SQLiteDatabase, productId: number, areaId: number, delta: number) {
  if (!(await db.getFirstAsync('SELECT id FROM areas WHERE id=?', areaId)))
    throw new Error('Área no encontrada.');
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
    if (!a.changes || !p.changes) throw new Error('Stock insuficiente en el área seleccionada.');
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
  p: Producto,
  areaId: number,
  quantity: number,
  type: string,
  actor: Usuario,
  date: string,
) {
  const area = await db.getFirstAsync<{ name: string }>(
    'SELECT name FROM areas WHERE id=?',
    areaId,
  );
  const incoming = ['entrada', 'ANULACION_CONSUMO', 'DEVOLUCION'].includes(type);
  await db.runAsync(
    'INSERT INTO movements(type,product_id,product_name,from_area,to_area,quantity,user,date) VALUES(?,?,?,?,?,?,?,?)',
    type,
    p.id,
    p.name,
    incoming ? null : area!.name,
    incoming ? area!.name : null,
    quantity,
    actor.username,
    date,
  );
}
async function audit(db: SQLiteDatabase, action: string, actor: Usuario, detail: unknown) {
  await db.runAsync(
    'INSERT INTO audit_log(action,username,date,detail) VALUES(?,?,?,?)',
    action,
    actor.username,
    new Date().toISOString(),
    JSON.stringify(detail),
  );
}
function validCost(cost: number | null) {
  if (cost !== null && (!Number.isFinite(cost) || cost < 0))
    throw new Error('Introduce un costo válido no negativo.');
}
export async function setCost(db: SQLiteDatabase, input: CostInput, actor: Usuario) {
  validCost(input.cost);
  if (!input.reason.trim()) throw new Error('Indica el motivo del cambio.');
  const p = await product(db, input.productId);
  await db.runAsync('UPDATE products SET unit_cost=? WHERE id=?', input.cost, p.id);
  await db.runAsync(
    'INSERT INTO cost_history(product_id,date,old_cost,new_cost,method,reason,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?)',
    p.id,
    new Date().toISOString(),
    p.unit_cost ?? null,
    input.cost,
    'manual',
    input.reason.trim(),
    actor.id,
    actor.username,
  );
  await audit(db, 'cost.changed', actor, {
    productId: p.id,
    oldCost: p.unit_cost ?? null,
    newCost: input.cost,
    reason: input.reason,
  });
  return p.id;
}
export async function receivePurchase(db: SQLiteDatabase, input: PurchaseInput, actor: Usuario) {
  validCost(input.cost);
  if (!input.reason.trim()) throw new Error('Indica el comprobante o motivo de entrada.');
  const p = await product(db, input.productId);
  validateQuantity(input.quantity, p.quantity_decimals);
  if (p.stock > 0 && p.unit_cost == null)
    throw new Error(
      'Registra el costo del stock existente antes de calcular el promedio ponderado.',
    );
  const nextCost =
    (p.stock * (p.unit_cost ?? 0) + input.quantity * input.cost) / (p.stock + input.quantity);
  const date = new Date().toISOString();
  await stock(db, p.id, input.areaId, input.quantity);
  await db.runAsync('UPDATE products SET unit_cost=? WHERE id=?', nextCost, p.id);
  await db.runAsync(
    'INSERT INTO cost_history(product_id,date,old_cost,new_cost,quantity,purchase_cost,method,reason,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?,?,?)',
    p.id,
    date,
    p.unit_cost ?? null,
    nextCost,
    input.quantity,
    input.cost,
    'promedio_ponderado',
    input.reason,
    actor.id,
    actor.username,
  );
  await movement(db, p, input.areaId, input.quantity, 'entrada', actor, date);
  await audit(db, 'purchase.received', actor, { ...input, newCost: nextCost });
  return p.id;
}
async function reverseConsumption(
  db: SQLiteDatabase,
  row: ConsumptionRecord,
  reason: string,
  actor: Usuario,
  authorizer: Usuario,
  status: 'anulado' | 'rectificado',
) {
  if (row.status !== 'confirmado') throw new Error('Este retiro ya fue anulado o rectificado.');
  const date = new Date().toISOString();
  const p = await product(db, row.product_id);
  await stock(db, p.id, row.area_id, row.quantity);
  await movement(db, p, row.area_id, row.quantity, 'ANULACION_CONSUMO', actor, date);
  await db.runAsync('UPDATE internal_consumptions SET status=? WHERE id=?', status, row.id);
  await db.runAsync(
    'INSERT INTO consumption_events(consumption_id,date,quantity,value,cost,action,reason,actor_id,actor_name,authorizer_id,authorizer_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    row.id,
    date,
    -row.quantity,
    -row.value,
    row.cost === null ? null : -row.cost,
    status,
    reason,
    actor.id,
    actor.username,
    authorizer.id,
    authorizer.username,
  );
  await audit(db, `consumption.${status}`, actor, {
    id: row.id,
    reason,
    authorizerId: authorizer.id,
  });
}
export async function consume(db: SQLiteDatabase, input: ConsumptionInput, actor: Usuario) {
  const authorizer = await authorize(db, input.authorization, true);
  if (!CONSUMPTION_REASONS.some((r) => r === input.reason))
    throw new Error('Selecciona un motivo de retiro.');
  const p = await product(db, input.productId);
  validateQuantity(input.quantity, p.quantity_decimals);
  if (input.replacesId) {
    if (!input.correctionReason?.trim()) throw new Error('Indica el motivo de rectificación.');
    const row = await db.getFirstAsync<ConsumptionRecord>(
      'SELECT * FROM internal_consumptions WHERE id=?',
      input.replacesId,
    );
    if (!row) throw new Error('Retiro no encontrado.');
    await reverseConsumption(db, row, input.correctionReason, actor, authorizer, 'rectificado');
  }
  await stock(db, p.id, input.areaId, -input.quantity);
  const date = new Date().toISOString();
  const value = roundMoney(p.price_cash * input.quantity);
  const cost = p.unit_cost == null ? null : roundMoney(p.unit_cost * input.quantity);
  await db.runAsync(
    'INSERT INTO internal_consumptions(id,date,product_id,product_name,area_id,quantity,price,unit_cost,value,cost,reason,notes,actor_id,actor_name,authorizer_id,authorizer_name,status,replaces_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    input.commandId,
    date,
    p.id,
    p.name,
    input.areaId,
    input.quantity,
    p.price_cash,
    p.unit_cost ?? null,
    value,
    cost,
    input.reason,
    input.notes,
    actor.id,
    actor.username,
    authorizer.id,
    authorizer.username,
    'confirmado',
    input.replacesId ?? null,
  );
  await db.runAsync(
    'INSERT INTO consumption_events(consumption_id,date,quantity,value,cost,action,reason,actor_id,actor_name,authorizer_id,authorizer_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    input.commandId,
    date,
    input.quantity,
    value,
    cost,
    'confirmado',
    input.reason,
    actor.id,
    actor.username,
    authorizer.id,
    authorizer.username,
  );
  await movement(db, p, input.areaId, input.quantity, 'CONSUMO_INTERNO', actor, date);
  await audit(db, 'consumption.confirmed', actor, {
    id: input.commandId,
    authorizerId: authorizer.id,
    replacesId: input.replacesId ?? null,
  });
  return input.commandId;
}
export async function voidConsumption(
  db: SQLiteDatabase,
  input: ConsumptionVoidInput,
  actor: Usuario,
) {
  const authorizer = await authorize(db, input.authorization, true);
  if (!input.reason.trim()) throw new Error('Indica el motivo de anulación.');
  const row = await db.getFirstAsync<ConsumptionRecord>(
    'SELECT * FROM internal_consumptions WHERE id=?',
    input.id,
  );
  if (!row) throw new Error('Retiro no encontrado.');
  await reverseConsumption(db, row, input.reason, actor, authorizer, 'anulado');
  return row.id;
}
interface AdjustmentRow {
  line_id: number;
  kind: string;
  quantity: number;
  amount: number;
  cost: number | null;
  date: string;
}
export async function adjustSale(db: SQLiteDatabase, input: SaleAdjustmentInput, actor: Usuario) {
  const authorizer = await authorize(db, input.authorization);
  if (!input.reason.trim() || !['anulacion', 'devolucion', 'descuento'].includes(input.kind))
    throw new Error('Revisa el motivo y tipo de ajuste.');
  const sale = await db.getFirstAsync<{
    id: number;
    session_id: number;
    total: number;
    payments: string;
  }>('SELECT * FROM sales WHERE id=?', input.saleId);
  if (!sale) throw new Error('Venta no encontrada.');
  // No cambiar cierres sellados: los ajustes se realizan con una caja abierta y quedan fechados en ella.
  const session = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM cash_sessions WHERE close_date IS NULL',
  );
  if (!session) throw new Error('Abre la caja para registrar el reembolso.');
  const lines = await db.getAllAsync<LineaVenta>(
    'SELECT * FROM sale_lines WHERE sale_id=?',
    sale.id,
  );
  const prior = await db.getAllAsync<AdjustmentRow>(
    'SELECT * FROM sale_adjustments WHERE sale_id=?',
    sale.id,
  );
  const selected = input.kind === 'anulacion' ? lines : lines.filter((l) => l.id === input.lineId);
  if (!selected.length) throw new Error('Selecciona una línea de venta.');
  const originalPayments = JSON.parse(sale.payments) as LegacyPayment[];
  let totalRefund = 0;
  const date = new Date().toISOString();
  for (const line of selected) {
    const history = prior.filter((a) => a.line_id === line.id);
    const returned = history.reduce((s, a) => s + a.quantity, 0);
    const remaining = Math.round((line.quantity - returned) * 1000) / 1000;
    if (remaining <= 0) {
      if (input.kind === 'anulacion') continue;
      throw new Error('La línea ya fue devuelta.');
    }
    const paid = roundMoney(line.subtotal - history.reduce((s, a) => s + a.amount, 0));
    const p = await product(db, line.product_id);
    const q =
      input.kind === 'descuento'
        ? 0
        : input.kind === 'anulacion'
          ? remaining
          : (input.quantity ?? 0);
    if (q) validateQuantity(q, p.quantity_decimals);
    if (input.kind !== 'descuento' && (!q || q > remaining + 0.000001))
      throw new Error('Cantidad superior a la pendiente de devolución.');
    const amount =
      input.kind === 'descuento'
        ? (input.amount ?? 0)
        : q === remaining
          ? paid
          : roundMoney((paid * q) / remaining);
    if (input.kind === 'descuento' && Math.abs(amount - roundMoney(amount)) > 0.000001)
      throw new Error('El descuento admite como máximo dos decimales.');
    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > paid + 0.005 ||
      (input.kind === 'descuento' && amount <= 0)
    )
      throw new Error('Importe de descuento inválido.');
    if (q) {
      if (line.area_id === null)
        throw new Error(
          'Esta venta antigua no conserva el área; no puede devolverse automáticamente.',
        );
      await stock(db, p.id, line.area_id, q);
      await movement(db, p, line.area_id, q, 'DEVOLUCION', actor, date);
    }
    const refunds: LegacyPayment[] = originalPayments.map((payment, i) => ({
      type: payment.type,
      amount:
        i === originalPayments.length - 1 ? 0 : roundMoney((amount * payment.amount) / sale.total),
    }));
    if (refunds.length)
      refunds[refunds.length - 1].amount = roundMoney(
        amount - refunds.reduce((s, pay) => s + pay.amount, 0),
      );
    const cost = q === 0 ? 0 : line.unit_cost == null ? null : q * line.unit_cost;
    await db.runAsync(
      'INSERT INTO sale_adjustments(command_id,sale_id,line_id,session_id,date,kind,quantity,amount,cost,payments,reason,actor_id,actor_name,authorizer_id,authorizer_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      input.commandId,
      sale.id,
      line.id,
      session.id,
      date,
      input.kind,
      q,
      amount,
      cost,
      JSON.stringify(refunds),
      input.reason,
      actor.id,
      actor.username,
      authorizer.id,
      authorizer.username,
    );
    totalRefund += amount;
  }
  if (totalRefund === 0 && !selected.some((l) => l.price === 0))
    throw new Error('La venta ya no tiene importe pendiente.');
  const summary = await db.getFirstAsync<{ amount: number }>(
    `SELECT COALESCE(SUM(json_extract(value,'$.amount')),0) AS amount FROM sales,json_each(sales.payments) WHERE session_id=? AND json_extract(value,'$.type')='cash'`,
    session.id,
  );
  const refunded = await db.getFirstAsync<{ amount: number }>(
    `SELECT COALESCE(SUM(json_extract(value,'$.amount')),0) AS amount FROM sale_adjustments,json_each(sale_adjustments.payments) WHERE session_id=? AND json_extract(value,'$.type')='cash'`,
    session.id,
  );
  const cash = await db.getFirstAsync<{ fund: number }>(
    'SELECT fund FROM cash_sessions WHERE id=?',
    session.id,
  );
  const withdrawals = await db.getFirstAsync<{ amount: number }>(
    'SELECT COALESCE(SUM(amount),0) AS amount FROM cash_withdrawals WHERE session_id=?',
    session.id,
  );
  if (
    (cash?.fund ?? 0) +
      (summary?.amount ?? 0) -
      (refunded?.amount ?? 0) -
      (withdrawals?.amount ?? 0) <
    -0.005
  )
    throw new Error('No hay suficiente efectivo para el reembolso.');
  await audit(db, 'sale.adjusted', actor, {
    saleId: sale.id,
    kind: input.kind,
    reason: input.reason,
    amount: totalRefund,
    authorizerId: authorizer.id,
  });
  return input.saleId;
}
export function validateFinanceFilter(filter: FinanceFilter) {
  if (
    !Number.isFinite(Date.parse(filter.start)) ||
    !Number.isFinite(Date.parse(filter.end)) ||
    filter.start > filter.end
  )
    throw new Error('Selecciona un período válido.');
}
export async function reportFinance(
  db: SQLiteDatabase,
  filter: FinanceFilter,
): Promise<FinanceReport> {
  validateFinanceFilter(filter);
  const lines = await db.getAllAsync<
    LineaVenta & { seller_id: number | null; user: string; date: string }
  >(
    'SELECT l.*,s.seller_id,s.user,s.date FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.date<=?',
    filter.end,
  );
  const adjustments = await db.getAllAsync<AdjustmentRow>(
    'SELECT * FROM sale_adjustments WHERE date>=? AND date<=?',
    filter.start,
    filter.end,
  );
  const entries: FinanceEntry[] = [];
  for (const line of lines) {
    const sellerKey = line.seller_id === null ? `legacy:${line.user}` : `user:${line.seller_id}`;
    if (
      (filter.sellerKey && sellerKey !== filter.sellerKey) ||
      (filter.productId && line.product_id !== filter.productId) ||
      (filter.category && line.category !== filter.category)
    )
      continue;
    const base = {
      key: String(line.id),
      sellerKey,
      seller: line.user,
      productId: line.product_id,
      product: line.name,
      category: line.category ?? '',
      saleId: line.sale_id,
    };
    if (line.date >= filter.start)
      entries.push({
        ...base,
        date: line.date,
        gross: line.subtotal,
        discounts: 0,
        returns: 0,
        quantity: line.quantity,
        cost: line.unit_cost == null ? null : line.unit_cost * line.quantity,
      });
    for (const adjustment of adjustments.filter((a) => a.line_id === line.id))
      entries.push({
        ...base,
        date: adjustment.date,
        gross: 0,
        discounts: adjustment.kind === 'descuento' ? adjustment.amount : 0,
        returns: adjustment.kind !== 'descuento' ? adjustment.amount : 0,
        quantity: -adjustment.quantity,
        cost: adjustment.cost === null ? null : -adjustment.cost,
      });
  }
  const consumptions = await db.getAllAsync<{
    quantity: number;
    value: number;
    cost: number | null;
  }>(
    `SELECT e.quantity,e.value,e.cost FROM consumption_events e JOIN internal_consumptions c ON c.id=e.consumption_id JOIN products p ON p.id=c.product_id WHERE e.date>=? AND e.date<=? AND (? IS NULL OR c.product_id=?) AND (? IS NULL OR p.category=?)`,
    filter.start,
    filter.end,
    filter.productId ?? null,
    filter.productId ?? null,
    filter.category ?? null,
    filter.category ?? null,
  );
  const inventory = await db.getAllAsync<Producto>(
    'SELECT * FROM products WHERE (? IS NULL OR id=?) AND (? IS NULL OR category=?)',
    filter.productId ?? null,
    filter.productId ?? null,
    filter.category ?? null,
    filter.category ?? null,
  );
  const users = await db.getAllAsync<{ id: number; username: string }>(
    'SELECT id,username FROM users',
  );
  const sellers = groupFinance(
    entries,
    (e) => e.sellerKey,
    (e) => e.seller,
  );
  for (const seller of sellers) {
    const current = users.find((u) => `user:${u.id}` === seller.key);
    if (current) seller.name = current.username;
    if (seller.key.startsWith('legacy:')) seller.name += ' (histórico sin ID)';
  }
  return {
    currency: 'CUP',
    filter,
    totals: aggregateFinance(entries),
    sellers,
    products: groupFinance(
      entries,
      (e) => String(e.productId),
      (e) => e.product,
    ),
    timeline: groupFinance(
      entries,
      (e) => {
        const d = new Date(e.date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      },
      (e) => e.date,
    ).sort((a, b) => a.key.localeCompare(b.key)),
    consumption: {
      quantity: consumptions.reduce((s, c) => s + c.quantity, 0),
      value: roundMoney(consumptions.reduce((s, c) => s + c.value, 0)),
      knownCost: roundMoney(consumptions.reduce((s, c) => s + (c.cost ?? 0), 0)),
      missingCost: consumptions.filter((c) => c.cost === null).length,
    },
    inventory: {
      knownValue: roundMoney(inventory.reduce((s, p) => s + p.stock * (p.unit_cost ?? 0), 0)),
      missingCost: inventory.filter((p) => p.stock > 0 && p.unit_cost == null).length,
      asOf: new Date().toISOString(),
    },
  };
}
