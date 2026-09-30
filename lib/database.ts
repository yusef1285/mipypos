import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

import { dayRange } from '@/lib/format';
import { CASH_DENOMINATIONS } from '@/lib/models';
import type {
  Area,
  CartItem,
  CashClosureInput,
  CashClosurePreview,
  CashClosureProductCount,
  CashClosureReconciliation,
  CashSummary,
  DailyReport,
  LineaVenta,
  LicenseMode,
  Movimiento,
  MovementType,
  Payment,
  Producto,
  SaleMethod,
  SesionCaja,
  Usuario,
  UserRole,
  Venta,
} from '@/lib/models';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parseJson = (value: string | null): unknown => {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const parseProductSnapshot = (value: string | null): Record<string, number> => {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
};
const parsePayments = (value: string | null): Payment[] => {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is Payment =>
      isRecord(item) &&
      (item.type === 'cash' || item.type === 'transfer' || item.type === 'card') &&
      typeof item.amount === 'number',
  );
};

export async function hashPassword(password: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `MipyPOS:${password}`);
}

export async function getDatabase() {
  databasePromise ??= SQLite.openDatabaseAsync('mipypos.db');
  return databasePromise;
}

export async function initializeDatabase() {
  const db = await getDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','supervisor','seller','storekeeper'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      stock REAL NOT NULL DEFAULT 0 CHECK(stock >= 0),
      price_cash REAL NOT NULL CHECK(price_cash >= 0),
      price_transfer REAL NOT NULL CHECK(price_transfer >= 0),
      image_path TEXT
    );
    CREATE TABLE IF NOT EXISTS cash_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      open_date TEXT NOT NULL,
      close_date TEXT,
      fund REAL NOT NULL CHECK(fund >= 0),
      final_cash REAL,
      expected_cash REAL,
      transfer_total REAL,
      products_start TEXT NOT NULL,
      products_end TEXT,
      cash_count REAL,
      transfer_count REAL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS only_one_open_session ON cash_sessions((1)) WHERE close_date IS NULL;
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
      user TEXT NOT NULL,
      date TEXT NOT NULL,
      total REAL NOT NULL CHECK(total >= 0),
      method TEXT NOT NULL CHECK(method IN ('cash','transfer','card','mixed')),
      payments TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sale_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      name TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      price REAL NOT NULL CHECK(price >= 0),
      subtotal REAL NOT NULL CHECK(subtotal >= 0)
    );
    CREATE TABLE IF NOT EXISTS areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE
    );
    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('entrada','salida','traslado')),
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      from_area TEXT,
      to_area TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      user TEXT NOT NULL,
      date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS area_stock (
      area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      PRIMARY KEY(area_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS network_commands (
      command_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      action TEXT NOT NULL,
      response TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS network_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      entity_id INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      username TEXT NOT NULL,
      entity_id INTEGER,
      date TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS sales_date_idx ON sales(date);
    CREATE INDEX IF NOT EXISTS movements_date_idx ON movements(date);
    CREATE INDEX IF NOT EXISTS movement_filters_idx ON movements(product_id, user, from_area, to_area);
  `);
  const count = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM users');
  if (!count?.count) {
    await db.runAsync(
      'INSERT INTO users(username,password_hash,role) VALUES(?,?,?)',
      'admin',
      await hashPassword('admin123'),
      'admin',
    );
  }
  const administratorCount = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM users WHERE role='admin'",
  );
  if (!administratorCount?.count) {
    const existingDefaultAdmin = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM users WHERE username='admin' COLLATE NOCASE",
    );
    if (existingDefaultAdmin)
      await db.runAsync("UPDATE users SET role='admin' WHERE id=?", existingDefaultAdmin.id);
    else
      await db.runAsync(
        'INSERT INTO users(username,password_hash,role) VALUES(?,?,?)',
        'admin',
        await hashPassword('admin123'),
        'admin',
      );
  }
  await db.runAsync("INSERT OR IGNORE INTO areas(name) VALUES('Almacén principal')");
  await db.execAsync(`
    INSERT OR IGNORE INTO area_stock(area_id,product_id,quantity)
    SELECT a.id,p.id,p.stock FROM products p
    CROSS JOIN areas a
    WHERE a.name='Almacén principal' COLLATE NOCASE
      AND p.stock>0
      AND NOT EXISTS (SELECT 1 FROM area_stock s WHERE s.product_id=p.id);
  `);
  await db.runAsync("INSERT OR IGNORE INTO settings(key,value) VALUES('license_mode','demo')");
  return db;
}

export async function getSetting(key: string) {
  const db = await getDatabase();
  return (
    (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key))
      ?.value ?? null
  );
}
export async function setSetting(key: string, value: string) {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key,
    value,
  );
}
export async function getLicenseMode(): Promise<LicenseMode> {
  return (await getSetting('license_mode')) === 'pro' ? 'pro' : 'demo';
}

export async function authenticate(username: string, password: string) {
  const db = await getDatabase();
  const user = await db.getFirstAsync<Usuario>(
    'SELECT * FROM users WHERE username=? COLLATE NOCASE',
    username.trim(),
  );
  if (!user || user.password_hash !== (await hashPassword(password))) return null;
  return user;
}

export async function listUsers() {
  return (await getDatabase()).getAllAsync<Usuario>('SELECT * FROM users ORDER BY username');
}
export async function saveUser(input: {
  id?: number;
  username: string;
  password?: string;
  role: UserRole;
}) {
  const db = await getDatabase();
  const name = input.username.trim();
  if (!name) throw new Error('El usuario es obligatorio.');
  if (input.id) {
    const existingUser = await db.getFirstAsync<Usuario>(
      'SELECT * FROM users WHERE id=?',
      input.id,
    );
    if (!existingUser) throw new Error('Usuario no encontrado.');
    if (existingUser.role === 'admin' && input.role !== 'admin') {
      const administrators = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM users WHERE role='admin'",
      );
      if ((administrators?.count ?? 0) <= 1)
        throw new Error('Debe existir al menos un administrador.');
    }
    if (input.password && input.password.length < 6)
      throw new Error('La contraseña debe tener al menos 6 caracteres.');
    if (input.password)
      await db.runAsync(
        'UPDATE users SET username=?, password_hash=?, role=? WHERE id=?',
        name,
        await hashPassword(input.password),
        input.role,
        input.id,
      );
    else
      await db.runAsync(
        'UPDATE users SET username=?, role=? WHERE id=?',
        name,
        input.role,
        input.id,
      );
    return input.id;
  }
  if (!input.password || input.password.length < 6)
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  const result = await db.runAsync(
    'INSERT INTO users(username,password_hash,role) VALUES(?,?,?)',
    name,
    await hashPassword(input.password),
    input.role,
  );
  return result.lastInsertRowId;
}
export async function deleteUser(id: number, currentId: number) {
  if (id === currentId) throw new Error('No puedes eliminar tu propio usuario.');
  const db = await getDatabase();
  const user = await db.getFirstAsync<Usuario>('SELECT * FROM users WHERE id=?', id);
  if (user?.role === 'admin') {
    const admins = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE role='admin'",
    );
    if ((admins?.count ?? 0) <= 1) throw new Error('Debe existir al menos un administrador.');
  }
  await db.runAsync('DELETE FROM users WHERE id=?', id);
}

export async function listProducts(search = '') {
  const db = await getDatabase();
  return db.getAllAsync<Producto>(
    'SELECT * FROM products WHERE name LIKE ? OR category LIKE ? ORDER BY name',
    `%${search}%`,
    `%${search}%`,
  );
}
export async function getProduct(id: number) {
  return (await getDatabase()).getFirstAsync<Producto>('SELECT * FROM products WHERE id=?', id);
}
export async function saveProduct(
  product: Omit<Producto, 'id'> & { id?: number },
  username: string,
) {
  const db = await getDatabase();
  if (!product.name.trim()) throw new Error('El nombre es obligatorio.');
  if (product.stock < 0 || product.price_cash < 0 || product.price_transfer < 0)
    throw new Error('Stock y precios no pueden ser negativos.');
  try {
    let productId = product.id ?? 0;
    await db.withTransactionAsync(async () => {
      if (product.id) {
        const current = await db.getFirstAsync<Producto>(
          'SELECT * FROM products WHERE id=?',
          product.id,
        );
        if (!current) throw new Error('Producto no encontrado.');
        if (Math.abs(current.stock - product.stock) > 0.0001)
          throw new Error('Ajusta el stock desde el módulo Inventario.');
        await db.runAsync(
          'UPDATE products SET name=?,category=?,subcategory=?,price_cash=?,price_transfer=?,image_path=? WHERE id=?',
          product.name.trim(),
          product.category.trim(),
          product.subcategory.trim(),
          product.price_cash,
          product.price_transfer,
          product.image_path,
          product.id,
        );
        return;
      }
      const result = await db.runAsync(
        'INSERT INTO products(name,category,subcategory,stock,price_cash,price_transfer,image_path) VALUES(?,?,?,?,?,?,?)',
        product.name.trim(),
        product.category.trim(),
        product.subcategory.trim(),
        product.stock,
        product.price_cash,
        product.price_transfer,
        product.image_path,
      );
      productId = result.lastInsertRowId;
      const mainArea = await db.getFirstAsync<{ id: number; name: string }>(
        "SELECT id,name FROM areas WHERE name='Almacén principal' COLLATE NOCASE",
      );
      if (mainArea && product.stock > 0) {
        await db.runAsync(
          'INSERT INTO area_stock(area_id,product_id,quantity) VALUES(?,?,?)',
          mainArea.id,
          productId,
          product.stock,
        );
        await db.runAsync(
          `INSERT INTO movements(type,product_id,product_name,from_area,to_area,quantity,user,date)
           VALUES('entrada',?,?,NULL,?,?,?,?)`,
          productId,
          product.name.trim(),
          mainArea.name,
          product.stock,
          username,
          now(),
        );
      }
    });
    return productId;
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new Error('Ya existe un producto con ese nombre.', { cause: error });
    throw error;
  }
}
export async function deleteProduct(id: number) {
  const db = await getDatabase();
  const used = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM sale_lines WHERE product_id=?',
    id,
  );
  if (used?.count) throw new Error('No se puede eliminar un producto con ventas registradas.');
  await db.runAsync('DELETE FROM products WHERE id=?', id);
}

const mapSession = (
  row: Omit<SesionCaja, 'products_start' | 'products_end'> & {
    products_start: string;
    products_end: string | null;
  },
): SesionCaja => ({
  ...row,
  products_start: parseProductSnapshot(row.products_start),
  products_end: row.products_end ? parseProductSnapshot(row.products_end) : null,
});
export async function getOpenSession() {
  const row = await (
    await getDatabase()
  ).getFirstAsync<
    Omit<SesionCaja, 'products_start' | 'products_end'> & {
      products_start: string;
      products_end: string | null;
    }
  >('SELECT * FROM cash_sessions WHERE close_date IS NULL LIMIT 1');
  return row ? mapSession(row) : null;
}
export async function openCashSession(fund: number, username: string) {
  if (fund < 0) throw new Error('El fondo inicial no puede ser negativo.');
  const db = await getDatabase();
  const stock = await db.getAllAsync<{ id: number; stock: number }>(
    'SELECT id,stock FROM products',
  );
  try {
    const result = await db.runAsync(
      'INSERT INTO cash_sessions(open_date,fund,products_start) VALUES(?,?,?)',
      now(),
      fund,
      json(Object.fromEntries(stock.map((p) => [p.id, p.stock]))),
    );
    await db.runAsync(
      'INSERT INTO audit_log(action,username,entity_id,date) VALUES(?,?,?,?)',
      'cash_open',
      username,
      result.lastInsertRowId,
      now(),
    );
    return result.lastInsertRowId;
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new Error('Ya existe una caja abierta.', { cause: error });
    throw error;
  }
}
export async function getCashSummary(sessionId: number): Promise<CashSummary> {
  const db = await getDatabase();
  const session = await db.getFirstAsync<{ fund: number }>(
    'SELECT fund FROM cash_sessions WHERE id=?',
    sessionId,
  );
  const rows = await db.getAllAsync<{ type: string; amount: number }>(
    "SELECT json_extract(value,'$.type') AS type, SUM(json_extract(value,'$.amount')) AS amount FROM sales,json_each(sales.payments) WHERE session_id=? GROUP BY type",
    sessionId,
  );
  const amount = (type: string) => rows.find((row) => row.type === type)?.amount ?? 0;
  const cashSales = amount('cash');
  return {
    salesTotal: rows.reduce((sum, row) => sum + row.amount, 0),
    cashSales,
    transferSales: amount('transfer'),
    cardSales: amount('card'),
    expectedCash: (session?.fund ?? 0) + cashSales,
  };
}
export async function getCashClosurePreview(sessionId: number): Promise<CashClosurePreview> {
  const db = await getDatabase();
  const session = await db.getFirstAsync<{
    id: number;
    fund: number;
    open_date: string;
    products_start: string;
  }>(
    'SELECT id,fund,open_date,products_start FROM cash_sessions WHERE id=? AND close_date IS NULL',
    sessionId,
  );
  if (!session) throw new Error('La sesión de caja ya está cerrada.');

  const [summary, products, movements, sold] = await Promise.all([
    getCashSummary(sessionId),
    db.getAllAsync<{ id: number; name: string }>('SELECT id,name FROM products ORDER BY name'),
    db.getAllAsync<{ product_id: number; entries: number; exits: number }>(
      `SELECT product_id,
        SUM(CASE WHEN type='entrada' THEN quantity ELSE 0 END) AS entries,
        SUM(CASE WHEN type='salida' THEN quantity ELSE 0 END) AS exits
       FROM movements WHERE date>=? GROUP BY product_id`,
      session.open_date,
    ),
    db.getAllAsync<{ product_id: number; quantity: number }>(
      `SELECT sl.product_id,SUM(sl.quantity) AS quantity
       FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id
       WHERE s.session_id=? GROUP BY sl.product_id`,
      sessionId,
    ),
  ]);
  const opening = parseProductSnapshot(session.products_start);
  const movementByProduct = new Map(movements.map((item) => [item.product_id, item]));
  const soldByProduct = new Map(sold.map((item) => [item.product_id, item.quantity]));

  return {
    sessionId,
    fund: session.fund,
    cashSales: summary.cashSales,
    transferSales: summary.transferSales,
    cardSales: summary.cardSales,
    salesTotal: summary.salesTotal,
    products: products.map((product) => {
      const movement = movementByProduct.get(product.id);
      const openingStock = opening[String(product.id)] ?? 0;
      const entries = movement?.entries ?? 0;
      const exits = movement?.exits ?? 0;
      const soldQuantity = soldByProduct.get(product.id) ?? 0;
      return {
        productId: product.id,
        productName: product.name,
        openingStock,
        entries,
        exits,
        sold: soldQuantity,
        expectedStock: openingStock + entries - exits - soldQuantity,
      };
    }),
  };
}

function reconcileCashClosure(
  preview: CashClosurePreview,
  input: CashClosureInput,
): CashClosureReconciliation {
  const allowedDenominations = new Set<number>(CASH_DENOMINATIONS);
  const suppliedDenominations = new Set<number>();
  let cashCount = 0;
  for (const item of input.denominations) {
    if (
      !allowedDenominations.has(item.denomination) ||
      suppliedDenominations.has(item.denomination) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 0
    )
      throw new Error('El conteo de billetes contiene valores no válidos.');
    suppliedDenominations.add(item.denomination);
    cashCount += item.denomination * item.quantity;
  }
  if (!Number.isFinite(input.transferCount) || input.transferCount < 0)
    throw new Error('El conteo de transferencias no es válido.');

  const physicalByProduct = new Map<number, number>();
  for (const item of input.products) {
    if (
      physicalByProduct.has(item.productId) ||
      !Number.isFinite(item.physicalStock) ||
      item.physicalStock < 0
    )
      throw new Error('El conteo físico contiene valores no válidos.');
    physicalByProduct.set(item.productId, item.physicalStock);
  }
  const reconciledProducts: CashClosureProductCount[] = preview.products.map((product) => {
    const physicalStock = physicalByProduct.get(product.productId);
    if (physicalStock === undefined)
      throw new Error(`Falta contar el producto ${product.productName}.`);
    return {
      ...product,
      physicalStock,
      difference: physicalStock - product.expectedStock,
    };
  });
  if (physicalByProduct.size !== preview.products.length)
    throw new Error('El conteo físico contiene productos que no pertenecen al cierre.');

  const expectedCash = preview.fund + preview.cashSales;
  return {
    cashCount,
    expectedCash,
    cashDifference: cashCount - expectedCash,
    transferDifference: input.transferCount - preview.transferSales,
    totalDifference:
      cashCount - preview.fund + input.transferCount + preview.cardSales - preview.salesTotal,
    products: reconciledProducts,
  };
}

export async function closeCashSession(sessionId: number, input: CashClosureInput) {
  const administrator = await authenticate(input.adminUsername, input.adminPassword);
  if (!administrator || administrator.role !== 'admin')
    throw new Error('Las credenciales del administrador no son válidas.');

  const db = await getDatabase();
  let result: CashClosureReconciliation | null = null;
  await db.withTransactionAsync(async () => {
    const preview = await getCashClosurePreview(sessionId);
    const reconciliation = reconcileCashClosure(preview, input);
    if (
      Math.abs(reconciliation.cashDifference) > 0.005 ||
      Math.abs(reconciliation.transferDifference) > 0.005 ||
      Math.abs(reconciliation.totalDifference) > 0.005
    )
      throw new Error('El efectivo y las transferencias deben coincidir antes de cerrar.');
    const productDifference = reconciliation.products.find(
      (product) => Math.abs(product.difference) > 0.0001,
    );
    if (productDifference)
      throw new Error(
        `El conteo de ${productDifference.productName} no coincide con el inventario esperado.`,
      );

    const closeDate = now();
    await db.runAsync(
      'UPDATE cash_sessions SET close_date=?,final_cash=?,expected_cash=?,transfer_total=?,products_end=?,cash_count=?,transfer_count=? WHERE id=? AND close_date IS NULL',
      closeDate,
      reconciliation.cashCount,
      reconciliation.expectedCash,
      preview.transferSales,
      json(
        Object.fromEntries(
          reconciliation.products.map((product) => [product.productId, product.physicalStock]),
        ),
      ),
      reconciliation.cashCount,
      input.transferCount,
      sessionId,
    );
    await db.runAsync(
      'INSERT INTO audit_log(action,username,entity_id,date,detail) VALUES(?,?,?,?,?)',
      'cash_close',
      administrator.username,
      sessionId,
      closeDate,
      json({
        denominations: input.denominations,
        cashDifference: reconciliation.cashDifference,
        transferDifference: reconciliation.transferDifference,
        totalDifference: reconciliation.totalDifference,
        inventory: reconciliation.products,
      }),
    );
    result = reconciliation;
  });
  if (!result) throw new Error('No se pudo completar el cierre de caja.');
  return result;
}

function validatePayments(total: number, method: SaleMethod, payments: Payment[]) {
  const positive = payments.filter((p) => p.amount > 0);
  if (!positive.length || payments.some((p) => !Number.isFinite(p.amount) || p.amount < 0))
    throw new Error('Los pagos no son válidos.');
  const sum = positive.reduce((value, p) => value + p.amount, 0);
  if (Math.abs(sum - total) > 0.005)
    throw new Error('La suma de pagos debe coincidir exactamente con el total.');
  if (method === 'mixed' && positive.length < 2)
    throw new Error('El pago mixto requiere al menos dos métodos.');
  if (method !== 'mixed' && (positive.length !== 1 || positive[0].type !== method))
    throw new Error('El método no coincide con el pago registrado.');
  return positive;
}
export async function registerSale(
  items: CartItem[],
  method: SaleMethod,
  payments: Payment[],
  username: string,
  networkCommand?: { commandId: string; clientId: string },
) {
  if (!items.length) throw new Error('El carrito está vacío.');
  const db = await getDatabase();
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const validPayments = validatePayments(total, method, payments);
  let saleId = 0;
  await db.withTransactionAsync(async () => {
    if (networkCommand) {
      const reservation = await db.runAsync(
        `INSERT OR IGNORE INTO network_commands(command_id,client_id,action,response,created_at)
         VALUES(?,?,?,?,?)`,
        networkCommand.commandId,
        networkCommand.clientId,
        'register_sale',
        null,
        now(),
      );
      if (!reservation.changes) {
        const previous = await db.getFirstAsync<{ response: string | null }>(
          'SELECT response FROM network_commands WHERE command_id=? AND client_id=?',
          networkCommand.commandId,
          networkCommand.clientId,
        );
        const parsed = parseJson(previous?.response ?? null);
        if (isRecord(parsed) && typeof parsed.saleId === 'number') {
          saleId = parsed.saleId;
          return;
        }
        throw new Error('La venta ya se está procesando.');
      }
    }
    const session = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM cash_sessions WHERE close_date IS NULL LIMIT 1',
    );
    if (!session) throw new Error('Debes abrir una sesión de caja antes de vender.');
    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0)
        throw new Error(`Cantidad inválida para ${item.product.name}.`);
      const current = await db.getFirstAsync<Producto>(
        'SELECT * FROM products WHERE id=?',
        item.product.id,
      );
      if (!current || current.stock < item.quantity)
        throw new Error(`Stock insuficiente para ${item.product.name}.`);
    }
    const sale = await db.runAsync(
      'INSERT INTO sales(session_id,user,date,total,method,payments) VALUES(?,?,?,?,?,?)',
      session.id,
      username,
      now(),
      total,
      method,
      json(validPayments),
    );
    saleId = sale.lastInsertRowId;
    for (const item of items) {
      const subtotal = item.price * item.quantity;
      await db.runAsync(
        'INSERT INTO sale_lines(sale_id,product_id,name,quantity,price,subtotal) VALUES(?,?,?,?,?,?)',
        saleId,
        item.product.id,
        item.product.name,
        item.quantity,
        item.price,
        subtotal,
      );
      const update = await db.runAsync(
        'UPDATE products SET stock=stock-? WHERE id=? AND stock>=?',
        item.quantity,
        item.product.id,
        item.quantity,
      );
      if (!update.changes) throw new Error(`Stock insuficiente para ${item.product.name}.`);
      let remaining = item.quantity;
      const areaRows = await db.getAllAsync<{ area_id: number; quantity: number }>(
        `SELECT area_id,quantity FROM area_stock WHERE product_id=? AND quantity>0
         ORDER BY CASE WHEN area_id=(SELECT id FROM areas WHERE name='Almacén principal' COLLATE NOCASE) THEN 0 ELSE 1 END, area_id`,
        item.product.id,
      );
      for (const areaRow of areaRows) {
        if (remaining <= 0) break;
        const deducted = Math.min(remaining, areaRow.quantity);
        await db.runAsync(
          'UPDATE area_stock SET quantity=quantity-? WHERE area_id=? AND product_id=?',
          deducted,
          areaRow.area_id,
          item.product.id,
        );
        remaining -= deducted;
      }
      if (remaining > 0.0001)
        throw new Error(`La distribución de stock de ${item.product.name} es inconsistente.`);
    }
    await db.runAsync(
      'INSERT INTO network_events(type,entity_id,created_at) VALUES(?,?,?)',
      'sale.created',
      saleId,
      now(),
    );
    if (networkCommand) {
      await db.runAsync(
        'UPDATE network_commands SET response=? WHERE command_id=? AND client_id=?',
        json({ saleId }),
        networkCommand.commandId,
        networkCommand.clientId,
      );
    }
  });
  return saleId;
}
export async function getSale(id: number) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Omit<Venta, 'payments'> & { payments: string }>(
    'SELECT * FROM sales WHERE id=?',
    id,
  );
  if (!row) return null;
  const lines = await db.getAllAsync<LineaVenta>(
    'SELECT * FROM sale_lines WHERE sale_id=? ORDER BY id',
    id,
  );
  return { sale: { ...row, payments: parsePayments(row.payments) }, lines };
}

export async function listAreas() {
  return (await getDatabase()).getAllAsync<Area>('SELECT * FROM areas ORDER BY name');
}
export async function addArea(name: string) {
  if (!name.trim()) throw new Error('El nombre del área es obligatorio.');
  await (await getDatabase()).runAsync('INSERT INTO areas(name) VALUES(?)', name.trim());
}
export async function registerMovement(input: {
  type: MovementType;
  productId: number;
  quantity: number;
  fromArea?: string;
  toArea?: string;
  username: string;
}) {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0)
    throw new Error('La cantidad debe ser mayor que cero.');
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    const product = await db.getFirstAsync<Producto>(
      'SELECT * FROM products WHERE id=?',
      input.productId,
    );
    if (!product) throw new Error('Producto no encontrado.');
    const areaId = async (name: string) => {
      const area = await db.getFirstAsync<{ id: number }>(
        'SELECT id FROM areas WHERE name=? COLLATE NOCASE',
        name,
      );
      if (!area) throw new Error(`El área ${name} no existe.`);
      return area.id;
    };
    const assigned = await db.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(quantity),0) AS total FROM area_stock WHERE product_id=?',
      product.id,
    );
    if ((assigned?.total ?? 0) === 0 && product.stock > 0) {
      const main = await areaId('Almacén principal');
      await db.runAsync(
        'INSERT OR REPLACE INTO area_stock(area_id,product_id,quantity) VALUES(?,?,?)',
        main,
        product.id,
        product.stock,
      );
    }
    if (input.type === 'entrada') {
      if (!input.toArea) throw new Error('Selecciona un área de destino.');
      const target = await areaId(input.toArea);
      await db.runAsync('UPDATE products SET stock=stock+? WHERE id=?', input.quantity, product.id);
      await db.runAsync(
        `INSERT INTO area_stock(area_id,product_id,quantity) VALUES(?,?,?)
         ON CONFLICT(area_id,product_id) DO UPDATE SET quantity=quantity+excluded.quantity`,
        target,
        product.id,
        input.quantity,
      );
    } else if (input.type === 'salida') {
      if (!input.fromArea) throw new Error('Selecciona un área de origen.');
      const source = await areaId(input.fromArea);
      const areaChanged = await db.runAsync(
        'UPDATE area_stock SET quantity=quantity-? WHERE area_id=? AND product_id=? AND quantity>=?',
        input.quantity,
        source,
        product.id,
        input.quantity,
      );
      if (!areaChanged.changes) throw new Error('Stock insuficiente en el área de origen.');
      const changed = await db.runAsync(
        'UPDATE products SET stock=stock-? WHERE id=? AND stock>=?',
        input.quantity,
        product.id,
        input.quantity,
      );
      if (!changed.changes) throw new Error('Stock insuficiente.');
    } else {
      if (!input.fromArea || !input.toArea || input.fromArea === input.toArea)
        throw new Error('El traslado requiere áreas de origen y destino diferentes.');
      const source = await areaId(input.fromArea);
      const target = await areaId(input.toArea);
      const changed = await db.runAsync(
        'UPDATE area_stock SET quantity=quantity-? WHERE area_id=? AND product_id=? AND quantity>=?',
        input.quantity,
        source,
        product.id,
        input.quantity,
      );
      if (!changed.changes) throw new Error('Stock insuficiente en el área de origen.');
      await db.runAsync(
        `INSERT INTO area_stock(area_id,product_id,quantity) VALUES(?,?,?)
         ON CONFLICT(area_id,product_id) DO UPDATE SET quantity=quantity+excluded.quantity`,
        target,
        product.id,
        input.quantity,
      );
    }
    await db.runAsync(
      'INSERT INTO movements(type,product_id,product_name,from_area,to_area,quantity,user,date) VALUES(?,?,?,?,?,?,?,?)',
      input.type,
      product.id,
      product.name,
      input.fromArea ?? null,
      input.toArea ?? null,
      input.quantity,
      input.username,
      now(),
    );
  });
}
export async function listMovements(
  filters: { start?: string; end?: string; area?: string; productId?: number; user?: string } = {},
) {
  const db = await getDatabase();
  const clauses: string[] = ['1=1'];
  const args: SQLite.SQLiteBindValue[] = [];
  if (filters.start) {
    clauses.push('date>=?');
    args.push(filters.start);
  }
  if (filters.end) {
    clauses.push('date<=?');
    args.push(filters.end);
  }
  if (filters.area) {
    clauses.push('(from_area=? OR to_area=?)');
    args.push(filters.area, filters.area);
  }
  if (filters.productId) {
    clauses.push('product_id=?');
    args.push(filters.productId);
  }
  if (filters.user) {
    clauses.push('user=?');
    args.push(filters.user);
  }
  return db.getAllAsync<Movimiento>(
    `SELECT * FROM movements WHERE ${clauses.join(' AND ')} ORDER BY date DESC`,
    args,
  );
}

export async function getDailyReport(date = new Date()): Promise<DailyReport> {
  const db = await getDatabase();
  const { start, end } = dayRange(date);
  const totals = await db.getFirstAsync<{ total: number; count: number }>(
    'SELECT COALESCE(SUM(total),0) AS total,COUNT(*) AS count FROM sales WHERE date BETWEEN ? AND ?',
    start,
    end,
  );
  const paymentRows = await db.getAllAsync<{ type: string; amount: number }>(
    "SELECT json_extract(value,'$.type') AS type,SUM(json_extract(value,'$.amount')) AS amount FROM sales,json_each(sales.payments) WHERE date BETWEEN ? AND ? GROUP BY type",
    start,
    end,
  );
  const byUser = await db.getAllAsync<{ user: string; total: number; count: number }>(
    'SELECT user,SUM(total) AS total,COUNT(*) AS count FROM sales WHERE date BETWEEN ? AND ? GROUP BY user ORDER BY total DESC',
    start,
    end,
  );
  const byProduct = await db.getAllAsync<{ product: string; quantity: number; total: number }>(
    'SELECT l.name AS product,SUM(l.quantity) AS quantity,SUM(l.subtotal) AS total FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.date BETWEEN ? AND ? GROUP BY l.product_id,l.name ORDER BY quantity DESC',
    start,
    end,
  );
  const amount = (type: string) => paymentRows.find((row) => row.type === type)?.amount ?? 0;
  return {
    totalSales: totals?.total ?? 0,
    salesCount: totals?.count ?? 0,
    cash: amount('cash'),
    transfer: amount('transfer'),
    card: amount('card'),
    byUser,
    byProduct,
    movements: await listMovements({ start, end }),
    inventory: await listProducts(),
  };
}

export async function getExportRows(
  type: 'sales' | 'movements' | 'inventory' | 'sold' | 'cash',
): Promise<Array<Record<string, SQLite.SQLiteBindValue>>> {
  const db = await getDatabase();
  const { start, end } = dayRange();
  if (type === 'sales')
    return db.getAllAsync<Record<string, SQLite.SQLiteBindValue>>(
      'SELECT id,session_id,user,date,total,method FROM sales WHERE date BETWEEN ? AND ? ORDER BY date',
      start,
      end,
    );
  if (type === 'movements')
    return db.getAllAsync<Record<string, SQLite.SQLiteBindValue>>(
      'SELECT * FROM movements WHERE date BETWEEN ? AND ? ORDER BY date',
      start,
      end,
    );
  if (type === 'inventory')
    return db.getAllAsync<Record<string, SQLite.SQLiteBindValue>>(
      'SELECT id,name,category,subcategory,stock,price_cash,price_transfer FROM products ORDER BY name',
    );
  if (type === 'sold')
    return db.getAllAsync<Record<string, SQLite.SQLiteBindValue>>(
      'SELECT l.product_id,l.name,SUM(l.quantity) AS quantity,SUM(l.subtotal) AS total FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.date BETWEEN ? AND ? GROUP BY l.product_id,l.name',
      start,
      end,
    );
  return db.getAllAsync<Record<string, SQLite.SQLiteBindValue>>(
    'SELECT * FROM cash_sessions ORDER BY id DESC',
  );
}

export async function importProducts(rows: Array<Record<string, unknown>>, username: string) {
  const db = await getDatabase();
  let imported = 0;
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!name) continue;
      const exists = await db.getFirstAsync(
        'SELECT id FROM products WHERE name=? COLLATE NOCASE',
        name,
      );
      if (exists) continue;
      const stock = Number(row.stock ?? 0),
        cash = Number(row.price_cash ?? 0),
        transfer = Number(row.price_transfer ?? cash);
      if (![stock, cash, transfer].every(Number.isFinite) || stock < 0 || cash < 0 || transfer < 0)
        throw new Error(`Valores inválidos para ${name}.`);
      const result = await db.runAsync(
        'INSERT INTO products(name,category,subcategory,stock,price_cash,price_transfer,image_path) VALUES(?,?,?,?,?,?,NULL)',
        name,
        typeof row.category === 'string' ? row.category : '',
        typeof row.subcategory === 'string' ? row.subcategory : '',
        stock,
        cash,
        transfer,
      );
      if (stock > 0) {
        const mainArea = await db.getFirstAsync<{ id: number; name: string }>(
          "SELECT id,name FROM areas WHERE name='Almacén principal' COLLATE NOCASE",
        );
        if (mainArea) {
          await db.runAsync(
            'INSERT INTO area_stock(area_id,product_id,quantity) VALUES(?,?,?)',
            mainArea.id,
            result.lastInsertRowId,
            stock,
          );
          await db.runAsync(
            `INSERT INTO movements(type,product_id,product_name,from_area,to_area,quantity,user,date)
             VALUES('entrada',?,?,NULL,?,?,?,?)`,
            result.lastInsertRowId,
            name,
            mainArea.name,
            stock,
            username,
            now(),
          );
        }
      }
      imported++;
    }
  });
  return imported;
}
