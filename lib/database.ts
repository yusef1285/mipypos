import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import * as Finance from '@/lib/finance';
import * as Onat from '@/lib/onat';
import * as Business from '@/lib/business';
import type { BusinessCommand, BusinessFilter } from '@/lib/business-models';
import {
  DEFAULT_ADMIN_PASSWORD,
  assertNewPassword,
  createPasswordHash,
  needsPasswordUpgrade,
  verifyPassword,
  withoutSecrets,
} from '@/lib/password';
import type { FiscalFilter, OnatCommand } from '@/lib/onat-models';
import { assertProductNotInDraft } from '@/lib/sale-draft';
import type {
  ConsumptionInput,
  ConsumptionRecord,
  ConsumptionVoidInput,
  CostInput,
  PurchaseInput,
  SaleAdjustmentInput,
  FinanceFilter,
} from '@/lib/finance-models';

import { dayRange } from '@/lib/format';
import { fractionalUnit, validateQuantity, roundMoney, roundQuantity } from '@/lib/units';
import { CASH_DENOMINATIONS, type SaleSettlement } from '@/lib/models';
import { validateSettlement } from '@/lib/settlement';
import {
  mutationIdSchema,
  mutationCountSchema,
  mutationVoidSchema,
  storedSettlementSchema,
  parseOperationResult,
} from '@/lib/network/validation';
import { saleUnitPrice } from '@/lib/sale-pricing';
import { saleFingerprint } from '@/lib/sale-identity';
import { canAccess } from '@/lib/permissions';
import { prepareMigrationBackup, migrateHardening } from '@/lib/database-migrations';
import {
  createRecoverySnapshot,
  inspectRecoverySnapshot,
  recoveryBackupSchema,
  type RecoveryBackup,
  type RecoveryBackupInspection,
} from '@/lib/recovery-backup';
import { loadNetworkConfig } from '@/lib/network/config';
import {
  assertDatabaseAvailable,
  beginDatabaseMaintenance,
  endDatabaseMaintenance,
  DatabaseConnectionGate,
} from '@/lib/database-maintenance';
import {
  resolveDatabaseFile,
  saveRecoverySelector,
  type RecoverySelector,
} from '@/lib/recovery-selector';
import {
  reconcileRecoveryDatabases,
  preserveRecoveryRuntime,
  verifyRecoveryDatabase,
  type RecoveryReconciliation,
} from '@/lib/recovery-reconciliation';
import { DATABASE_VERSION } from '@/lib/database-migrations';
import {
  assertRecoveryJournalAvailable,
  installRecoveryJournal,
  migrateRecoveryJournal,
  reconcileRecoveryCandidate,
} from '@/lib/recovery-journal';
import { migrateBusiness } from '@/lib/business-schema';
import { assertDatabaseIdentity, confirmDatabaseIdentity } from '@/lib/recovery-anchor';
import { getPendingOperation } from '@/lib/network/pending-operation';
import { getPendingSale } from '@/lib/network/pending-sale';
import { getPendingWithdrawal } from '@/lib/network/pending-withdrawal';
import {
  BUSINESS_TABLES,
  archiveSchema,
  parseBusinessArchive,
  type BusinessArchive,
  type ArchiveRow,
} from '@/lib/business-archive';
import type {
  Area,
  AreaStock,
  CartItem,
  CashClosureInput,
  CashClosurePreview,
  CashClosureProductCount,
  CashClosureReconciliation,
  CashClosureRecord,
  CashDifferenceInput,
  CashDifferenceApproval,
  CashSummary,
  CashWithdrawal,
  CashWithdrawalInput,
  DailyReport,
  LineaVenta,
  LicenseMode,
  LegacyPayment,
  LegacySaleMethod,
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
let connectionGate: DatabaseConnectionGate | null = null;
let mutationQueue: Promise<void> = Promise.resolve();
export interface MutationCommand {
  commandId: string;
  clientId: string;
  action: string;
  fingerprint: string;
  username: string;
}
async function transaction<T>(
  db: SQLite.SQLiteDatabase,
  action: () => Promise<T>,
  command?: MutationCommand,
  parseResult?: (value: unknown) => T,
): Promise<T> {
  assertDatabaseAvailable();
  if (command && !parseResult) throw new Error('La operación no tiene un parser de recibo válido.');
  let result: T;
  const pending = mutationQueue.then(() =>
    db.withTransactionAsync(async () => {
      const identity = command
        ? JSON.stringify([command.action, command.username, command.fingerprint])
        : '';
      if (command) {
        const previous = await db.getFirstAsync<{
          client_id: string;
          action: string;
          response: string | null;
        }>(
          'SELECT client_id,action,response FROM network_commands WHERE command_id=?',
          command.commandId,
        );
        if (previous) {
          if (
            previous.client_id !== command.clientId ||
            previous.action !== identity ||
            !previous.response
          )
            throw new Error('El identificador ya pertenece a otra operación.');
          const cached: unknown = JSON.parse(previous.response);
          if (!isRecord(cached) || !Object.hasOwn(cached, 'value') || !parseResult)
            throw new Error('El recibo de la operación no es válido.');
          result = parseResult(cached.value);
          return;
        }
      }
      result = await action();
      if (command)
        await db.runAsync(
          'INSERT INTO network_commands(command_id,client_id,action,response,created_at) VALUES(?,?,?,?,?)',
          command.commandId,
          command.clientId,
          identity,
          JSON.stringify({ value: result ?? null }),
          new Date().toISOString(),
        );
      await db.runAsync(
        'INSERT INTO network_events(type,entity_id,created_at) VALUES(?,NULL,?)',
        'data.changed',
        new Date().toISOString(),
      );
    }),
  );
  mutationQueue = pending.catch(() => undefined);
  await pending;
  return result!;
}
export async function findMutationReceipt(
  command: MutationCommand,
): Promise<{ found: boolean; value?: unknown }> {
  await mutationQueue;
  const previous = await (
    await getDatabase()
  ).getFirstAsync<{ client_id: string; action: string; response: string | null }>(
    'SELECT client_id,action,response FROM network_commands WHERE command_id=?',
    command.commandId,
  );
  if (!previous) return { found: false };
  if (
    previous.client_id !== command.clientId ||
    previous.action !== JSON.stringify([command.action, command.username, command.fingerprint]) ||
    !previous.response
  )
    throw new Error('El identificador ya pertenece a otra operación.');
  const cached: unknown = JSON.parse(previous.response);
  if (!isRecord(cached) || !Object.hasOwn(cached, 'value'))
    throw new Error('El recibo de la operación no es válido.');
  return { found: true, value: cached.value };
}
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
const parsePayments = (value: string | null): LegacyPayment[] => {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is LegacyPayment =>
      isRecord(item) &&
      (item.type === 'cash' || item.type === 'transfer' || item.type === 'card') &&
      typeof item.amount === 'number',
  );
};

async function consistentRead<T>(action: () => Promise<T>): Promise<T> {
  const db = await getDatabase();
  let result: T;
  const pending = mutationQueue.then(() =>
    db.withTransactionAsync(async () => {
      result = await action();
    }),
  );
  mutationQueue = pending.catch(() => undefined);
  await pending;
  return result!;
}
export function getSharedRevision() {
  return consistentRead(async () => {
    const state = await (
      await getDatabase()
    ).getFirstAsync<{ revision: number; authority_id: string }>(
      'SELECT revision,authority_id FROM sync_state WHERE id=1',
    );
    if (!state) throw new Error('La base de datos necesita completar la actualización.');
    return { revision: state.revision, authorityId: state.authority_id };
  });
}
export function getNetworkReplica(cacheKey: string) {
  return consistentRead(async () =>
    (await getDatabase()).getFirstAsync<{ payload: string; confirmed_at: string }>(
      'SELECT payload,confirmed_at FROM network_replica WHERE cache_key=?',
      cacheKey,
    ),
  );
}
export function clearNetworkReplicas() {
  return consistentRead(async () => {
    await (await getDatabase()).runAsync('DELETE FROM network_replica');
  });
}
export function storeNetworkReplica(cacheKey: string, payload: string) {
  return consistentRead(async () => {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT INTO network_replica(cache_key,payload,confirmed_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,confirmed_at=excluded.confirmed_at',
      cacheKey,
      payload,
      now(),
    );
    await db.runAsync(
      'DELETE FROM network_replica WHERE cache_key NOT IN (SELECT cache_key FROM network_replica ORDER BY confirmed_at DESC LIMIT 16)',
    );
  });
}
export async function getSharedSnapshot() {
  return consistentRead(async () => {
    const db = await getDatabase();
    const state = await db.getFirstAsync<{ revision: number; authority_id: string }>(
      'SELECT revision,authority_id FROM sync_state WHERE id=1',
    );
    if (!state) throw new Error('La base de datos necesita completar la actualización.');
    return {
      revision: state.revision,
      authorityId: state.authority_id,
      licenseMode: await getLicenseMode(),
      products: await listProducts(),
      areas: await listAreas(),
      areaStock: await listAreaStock(),
      session: await getOpenSession(),
    };
  });
}
export async function getAuditSnapshot() {
  return consistentRead(async () => {
    const db = await getDatabase();
    const { start, end } = dayRange(new Date());
    return {
      sales: await db.getAllAsync<{
        id: number;
        user: string;
        date: string;
        total: number;
        method: LegacySaleMethod;
      }>(
        'SELECT id,user,date,total,method FROM sales WHERE date>=? AND date<=? ORDER BY id DESC',
        start,
        end,
      ),
      products: await listProducts(),
      areas: await listAreas(),
      stocks: await listAreaStock(),
      movements: await listMovements(),
      closures: await listCashClosures(),
    };
  });
}

export async function createBusinessArchive(username: string): Promise<BusinessArchive> {
  const db = await getDatabase();
  return transaction(db, async () => {
    const user = await db.getFirstAsync<Usuario>('SELECT * FROM users WHERE username=?', username);
    if (user?.role !== 'admin')
      throw new Error('Solo un administrador puede trasladar el negocio.');
    if (await db.getFirstAsync('SELECT id FROM cash_sessions WHERE close_date IS NULL'))
      throw new Error('Cierra la caja antes de crear el archivo de traslado.');
    const latest = await db.getFirstAsync<{ final_cash: number }>(
      'SELECT final_cash FROM cash_sessions WHERE close_date IS NOT NULL ORDER BY id DESC LIMIT 1',
    );
    if (!latest) throw new Error('Realiza un cierre de caja antes de trasladar el negocio.');
    const tables = archiveSchema.shape.tables.parse(
      Object.fromEntries(
        await Promise.all(
          BUSINESS_TABLES.map(async (table) => [
            table,
            await db.getAllAsync<ArchiveRow>(`SELECT * FROM ${table} ORDER BY rowid`),
          ]),
        ),
      ),
    );
    // Portable files never carry login credentials. The source DB and private backup are unchanged.
    for (const account of tables.users) delete account.password_hash;
    const usage = await getDemoUsage();
    const sequences = (
      await db.getAllAsync<{ name: string; seq: number }>('SELECT name,seq FROM sqlite_sequence')
    ).filter((row): row is BusinessArchive['sequences'][number] =>
      BUSINESS_TABLES.some((table) => table === row.name),
    );
    return {
      app: 'MipyPOS',
      format: 'business-close',
      version: 2,
      schemaVersion: 10,
      archiveId: Crypto.randomUUID(),
      createdAt: now(),
      sourceUser: username,
      tables,
      usage: { products: usage.products, sales: usage.sales },
      sequences,
      openingFund: latest.final_cash,
    };
  });
}

export async function restoreBusinessArchive(value: unknown, username: string) {
  const archive = parseBusinessArchive(value);
  const db = await getDatabase();
  return transaction(db, async () => {
    const user = await db.getFirstAsync<Usuario>('SELECT * FROM users WHERE username=?', username);
    if (user?.role !== 'admin') throw new Error('Solo un administrador puede recibir el negocio.');
    if (
      (await db.getFirstAsync('SELECT id FROM cash_sessions LIMIT 1')) ||
      (await db.getFirstAsync('SELECT id FROM sales LIMIT 1')) ||
      (await db.getFirstAsync('SELECT id FROM movements LIMIT 1')) ||
      (await db.getFirstAsync('SELECT id FROM products LIMIT 1'))
    )
      throw new Error(
        'Importa en un teléfono sin productos, ventas, movimientos ni turnos. No se mezclan negocios.',
      );
    const auxiliaryData = await db.getFirstAsync(
      `SELECT 1 FROM users WHERE username<>? COLLATE NOCASE
      UNION ALL SELECT 1 FROM areas WHERE name<>'Almacén principal' COLLATE NOCASE
      UNION ALL SELECT 1 FROM audit_log
      UNION ALL SELECT 1 FROM network_commands
      UNION ALL SELECT 1 FROM fiscal_profiles
      UNION ALL SELECT 1 FROM fiscal_rules
      UNION ALL SELECT 1 FROM fiscal_records
      UNION ALL SELECT 1 FROM branches
      UNION ALL SELECT 1 FROM currencies
      UNION ALL SELECT 1 FROM parties
      UNION ALL SELECT 1 FROM employees
      UNION ALL SELECT 1 FROM partners LIMIT 1`,
      username,
    );
    if (auxiliaryData)
      throw new Error(
        'El teléfono tiene usuarios o historial propio. Usa un destino vacío para conservar esa información.',
      );
    if (await getSetting('last_archive_id'))
      throw new Error(
        'Este teléfono ya recibió un negocio. No vuelvas a importar el mismo cierre.',
      );
    const usage = await getDemoUsage();
    const tables = archiveSchema.shape.tables.parse(
      Object.fromEntries(BUSINESS_TABLES.map((table) => [table, archive.tables[table] ?? []])),
    );
    // Re-enroll credentials without importing even the hashes in legacy v1 files.
    // The source administrator adopts the receiving administrator's existing password.
    const importedAdmin =
      tables.users.find(
        (account) => account.role === 'admin' && account.username === archive.sourceUser,
      ) ?? tables.users.find((account) => account.role === 'admin');
    if (!importedAdmin) throw new Error('El archivo no contiene un administrador válido.');
    for (const account of tables.users) {
      account.password_hash =
        account === importedAdmin
          ? user.password_hash
          : // A random 122-bit secret: nobody can sign in until an administrator resets it.
            await createPasswordHash(Crypto.randomUUID(), 1);
    }
    for (let index = BUSINESS_TABLES.length - 1; index >= 0; index -= 1)
      await db.execAsync(`DELETE FROM ${BUSINESS_TABLES[index]}`);
    for (const table of BUSINESS_TABLES) {
      const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
      const allowed = new Set(columns.map((column) => column.name));
      for (const row of tables[table]) {
        const legacyExtra: Record<string, ArchiveRow> = {
          users: { can_authorize_consumption: 0 },
          products: { unit_cost: null },
          sales: { seller_id: null },
          sale_lines: { unit_cost: null, category: '' },
        };
        if (archive.schemaVersion === 5) Object.assign(row, legacyExtra[table] ?? {});
        if (table === 'sales' && archive.schemaVersion < 7) {
          row.legacy_card =
            row.method === 'card' ||
            (typeof row.payments === 'string' &&
              parsePayments(row.payments).some((payment) => payment.type === 'card'))
              ? 1
              : 0;
          row.pricing_basis = null;
        }
        if (table === 'users' && archive.schemaVersion < 8) row.can_manage_fiscal = 0;
        const keys = Object.keys(row);
        if (keys.length !== columns.length || keys.some((key) => !allowed.has(key)))
          throw new Error('El archivo contiene columnas incompatibles.');
        await db.runAsync(
          `INSERT INTO ${table}(${keys.map((key) => `"${key}"`).join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
          keys.map((key) => row[key]),
        );
      }
    }
    await Onat.validateFiscalStorage(db);
    await Business.validateBusinessStorage(db);
    const foreignErrors = await db.getAllAsync('PRAGMA foreign_key_check');
    if (foreignErrors.length) throw new Error('El archivo contiene referencias incompletas.');
    const stockError = await db.getFirstAsync(
      `SELECT p.id FROM products p WHERE ABS(p.stock-COALESCE((SELECT SUM(quantity) FROM area_stock WHERE product_id=p.id),0))>0.001 LIMIT 1`,
    );
    if (stockError) throw new Error('Las existencias por área no coinciden con el inventario.');
    const saleError = await db.getFirstAsync(
      `SELECT s.id FROM sales s WHERE ABS(s.total-COALESCE((SELECT SUM(subtotal) FROM sale_lines WHERE sale_id=s.id),0))>0.005 LIMIT 1`,
    );
    if (saleError) throw new Error('Los totales de ventas no coinciden con sus líneas.');
    for (const sale of tables.sales) {
      if (typeof sale.payments !== 'string') throw new Error('Una venta no tiene pagos válidos.');
      const payments = parsePayments(sale.payments);
      if (
        Math.abs(payments.reduce((sum, payment) => sum + payment.amount, 0) - Number(sale.total)) >
        0.005
      )
        throw new Error('Los pagos no coinciden con sus ventas.');
    }
    const latest = await db.getFirstAsync<{ final_cash: number }>(
      'SELECT final_cash FROM cash_sessions ORDER BY id DESC LIMIT 1',
    );
    if (!latest || Math.abs(latest.final_cash - archive.openingFund) > 0.005)
      throw new Error('El fondo de apertura no coincide con el cierre.');
    for (const sequence of archive.sequences) {
      const current = await db.getFirstAsync<{ seq: number }>(
        'SELECT seq FROM sqlite_sequence WHERE name=?',
        sequence.name,
      );
      if (current && current.seq < sequence.seq)
        await db.runAsync(
          'UPDATE sqlite_sequence SET seq=? WHERE name=?',
          sequence.seq,
          sequence.name,
        );
      if (!current)
        await db.runAsync(
          'INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)',
          sequence.name,
          sequence.seq,
        );
    }
    for (const [key, val] of Object.entries({
      usage_sales: Math.max(usage.sales, archive.usage.sales),
      usage_products: Math.max(usage.products, archive.usage.products),
      next_opening_fund: archive.openingFund,
      last_archive_id: archive.archiveId,
    }))
      await db.runAsync(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        key,
        String(val),
      );
    await db.runAsync(
      'INSERT INTO audit_log(action,username,date,detail) VALUES(?,?,?,?)',
      'business.imported',
      username,
      now(),
      json({
        archiveId: archive.archiveId,
        sourceUser: archive.sourceUser,
        createdAt: archive.createdAt,
      }),
    );
    return archive.openingFund;
  });
}

/** Salted PBKDF2-SHA256 (see lib/password.ts). */
export function hashPassword(password: string) {
  return createPasswordHash(password);
}

/** True while an administrator still uses the published initial password. */
export async function hasDefaultAdministratorPassword() {
  const db = await getDatabase();
  const admins = await db.getAllAsync<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE role='admin'",
  );
  for (const admin of admins)
    if (await verifyPassword(DEFAULT_ADMIN_PASSWORD, admin.password_hash)) return true;
  return false;
}

export async function getDatabase() {
  assertDatabaseAvailable();
  if (!databasePromise) {
    const opening = (async () => {
      const selected = await resolveDatabaseFile();
      const raw = await SQLite.openDatabaseAsync(selected.fileName);
      try {
        await assertDatabaseIdentity(raw, selected.authorityId);
        await assertRecoveryJournalAvailable(raw);
        if (selected.authorityId) await verifyRecoveryDatabase(raw, selected.authorityId);
        const gate = new DatabaseConnectionGate(raw);
        connectionGate = gate;
        return gate.database;
      } catch (error) {
        await raw.closeAsync();
        throw error;
      }
    })();
    databasePromise = opening;
    void opening.catch(() => {
      if (databasePromise === opening) databasePromise = null;
    });
  }
  return databasePromise;
}

let initializationPromise: Promise<SQLite.SQLiteDatabase> | null = null;
export function initializeDatabase() {
  if (!initializationPromise) {
    const attempt = initializeDatabaseInternal();
    initializationPromise = attempt;
    void attempt
      .finally(() => {
        if (initializationPromise === attempt) initializationPromise = null;
      })
      .catch(() => undefined);
  }
  return initializationPromise;
}

async function initializeDatabaseInternal() {
  const db = await getDatabase();
  await assertDatabaseIdentity(db);
  await prepareMigrationBackup(db);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // Schema, upgrades and initial rows form one atomic operation. Keep connection
  // pragmas outside BEGIN: SQLite cannot enable foreign keys inside a transaction.
  await transaction(db, async () => {
    await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','supervisor','seller','storekeeper','auditor')),
      can_authorize_consumption INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize_consumption IN (0,1))
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
      type TEXT NOT NULL CHECK(type IN ('entrada','salida','traslado','CONSUMO_INTERNO','ANULACION_CONSUMO','DEVOLUCION')),
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
    CREATE TABLE IF NOT EXISTS login_attempts (account TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL);
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
    CREATE TABLE IF NOT EXISTS cash_withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
      command_id TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL CHECK(amount > 0),
      reason TEXT NOT NULL,
      username TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      date TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS withdrawals_session_idx ON cash_withdrawals(session_id);
    CREATE TABLE IF NOT EXISTS cash_difference_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
      detail TEXT NOT NULL,
      reason TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cash_closures (
      session_id INTEGER PRIMARY KEY REFERENCES cash_sessions(id),
      authorized_by TEXT NOT NULL,
      date TEXT NOT NULL,
      detail TEXT NOT NULL
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
    const userSchema = await db.getFirstAsync<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
    );
    if (userSchema && !userSchema.sql.includes("'auditor'")) {
      const sequence = await db.getFirstAsync<{ seq: number }>(
        "SELECT seq FROM sqlite_sequence WHERE name='users'",
      );
      await db.execAsync(`CREATE TABLE users_upgrade (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','supervisor','seller','storekeeper','auditor')));
        INSERT INTO users_upgrade SELECT * FROM users;
        DROP TABLE users;
        ALTER TABLE users_upgrade RENAME TO users;`);
      if (sequence)
        await db.runAsync(
          "UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='users'",
          sequence.seq,
        );
    }
    const saleColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(sales)');
    if (!saleColumns.some((column) => column.name === 'settlement'))
      await db.execAsync('ALTER TABLE sales ADD COLUMN settlement TEXT');
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(products)');
    if (!columns.some((column) => column.name === 'unit'))
      await db.execAsync("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'u'");
    if (!columns.some((column) => column.name === 'quantity_decimals'))
      await db.execAsync(
        'ALTER TABLE products ADD COLUMN quantity_decimals INTEGER NOT NULL DEFAULT 0',
      );
    const lineColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(sale_lines)');
    if (!lineColumns.some((column) => column.name === 'area_id'))
      await db.execAsync('ALTER TABLE sale_lines ADD COLUMN area_id INTEGER REFERENCES areas(id)');
    if (!lineColumns.some((column) => column.name === 'unit'))
      await db.execAsync("ALTER TABLE sale_lines ADD COLUMN unit TEXT NOT NULL DEFAULT 'u'");
    const sessionColumns = await db.getAllAsync<{ name: string }>(
      'PRAGMA table_info(cash_sessions)',
    );
    if (!sessionColumns.some((column) => column.name === 'movement_start_id'))
      await db.execAsync('ALTER TABLE cash_sessions ADD COLUMN movement_start_id INTEGER');
    await Finance.migrateFinance(db);
    await Onat.migrateOnat(db);
    await db.execAsync(`
      INSERT OR IGNORE INTO settings(key,value) SELECT 'usage_products',CAST(MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name='products'),0),(SELECT COUNT(*) FROM products)) AS TEXT);
      INSERT OR IGNORE INTO settings(key,value) SELECT 'usage_sales',CAST(MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name='sales'),0),(SELECT COUNT(*) FROM sales)) AS TEXT);
    `);
    await migrateHardening(db);
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
  });
  await confirmDatabaseIdentity(db);
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
  return transaction(db, async () => {
    await db.runAsync(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      value,
    );
  });
}
// Pro needs the cached mode plus an unexpired date; lib/license.ts refreshes both
// after verifying the signed license, so expiry applies even before a refresh.
function proActive(mode: string | null | undefined, expires: string | null | undefined) {
  if (mode !== 'pro') return false;
  if (!expires) return true;
  const end = Date.parse(expires);
  return Number.isFinite(end) && Date.now() < end;
}
export async function getLicenseMode(): Promise<LicenseMode> {
  return proActive(await getSetting('license_mode'), await getSetting('license_expires_at'))
    ? 'pro'
    : 'demo';
}

export async function getDemoUsage() {
  return {
    mode: await getLicenseMode(),
    sales: Number(await getSetting('usage_sales')) || 0,
    products: Number(await getSetting('usage_products')) || 0,
    limit: 5,
  };
}
// Called only inside the mutation transaction, so failed writes never consume a slot.
async function consumeDemoQuota(db: SQLite.SQLiteDatabase, resource: 'sales' | 'products') {
  const key = `usage_${resource}`;
  const used = Number(
    (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key))
      ?.value ?? 0,
  );
  const setting = async (name: string) =>
    (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', name))
      ?.value;
  const pro = proActive(await setting('license_mode'), await setting('license_expires_at'));
  if (!pro && used >= 5)
    throw new Error(
      resource === 'sales'
        ? 'Has alcanzado las 5 ventas de la demo. Activa una licencia Pro para seguir vendiendo.'
        : 'Has alcanzado los 5 productos de la demo. Activa una licencia Pro para agregar más.',
    );
  await db.runAsync(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key,
    String(used + 1),
  );
}

export async function authenticate(username: string, password: string) {
  const db = await getDatabase();
  const user = await db.getFirstAsync<Usuario>(
    'SELECT * FROM users WHERE username=? COLLATE NOCASE',
    username.trim(),
  );
  if (!user || !(await verifyPassword(password, user.password_hash))) return null;
  if (needsPasswordUpgrade(user.password_hash)) {
    // Transparent upgrade of legacy unsalted hashes after a verified login.
    const upgraded = await createPasswordHash(password);
    const changed = await transaction(db, async () => {
      const result = await db.runAsync(
        'UPDATE users SET password_hash=? WHERE id=? AND password_hash=?',
        upgraded,
        user.id,
        user.password_hash,
      );
      return result.changes === 1;
    });
    if (changed) user.password_hash = upgraded;
  }
  return user;
}

/** Mandatory change of the initial password before the first session starts. */
export async function changeOwnPassword(
  username: string,
  currentPassword: string,
  newPassword: string,
) {
  assertNewPassword(newPassword);
  if (newPassword === currentPassword)
    throw new Error('La nueva contraseña debe ser distinta de la actual.');
  const user = await authenticateForLogin(username, currentPassword);
  if (!user) throw new Error('Usuario o contraseña incorrectos.');
  const db = await getDatabase();
  const hash = await createPasswordHash(newPassword);
  await transaction(db, async () => {
    const result = await db.runAsync(
      'UPDATE users SET password_hash=? WHERE id=? AND password_hash=?',
      hash,
      user.id,
      user.password_hash,
    );
    if (result.changes !== 1) throw new Error('La cuenta cambió. Inicia sesión nuevamente.');
    await db.runAsync(
      'INSERT INTO audit_log(action,username,date,detail) VALUES(?,?,?,?)',
      'user.password_changed',
      user.username,
      now(),
      json({ userId: user.id, reason: 'initial-password' }),
    );
  });
  return { ...user, password_hash: hash };
}

// Separate from password hashing: persistent bounded login attempts, serialized with writes.
export async function authenticateForLogin(username: string, password: string) {
  const db = await getDatabase();
  const account = username.trim().toLowerCase();
  const allowed = await transaction(db, async () => {
    const time = Date.now();
    for (const [key, limit] of [
      [account, 5],
      ['*global*', 30],
    ] as const) {
      const previous = await db.getFirstAsync<{ attempts: number; window_start: number }>(
        'SELECT * FROM login_attempts WHERE account=?',
        key,
      );
      if (previous && time - previous.window_start < 60000 && previous.attempts >= limit)
        return false;
    }
    for (const key of [account, '*global*'])
      await db.runAsync(
        'INSERT INTO login_attempts(account,attempts,window_start) VALUES(?,1,?) ON CONFLICT(account) DO UPDATE SET attempts=CASE WHEN ?-window_start>=60000 THEN 1 ELSE attempts+1 END,window_start=CASE WHEN ?-window_start>=60000 THEN ? ELSE window_start END',
        key,
        time,
        time,
        time,
        time,
      );
    return true;
  });
  if (!allowed) throw new Error('Demasiados intentos. Espera un minuto e inténtalo de nuevo.');
  return authenticate(username, password);
}

export async function listPrivateRecoveryBackups(username: string): Promise<RecoveryBackup[]> {
  if ((await loadNetworkConfig()).mode === 'client')
    throw new Error('Crea y consulta las copias en el teléfono administrador.');
  return consistentRead(async () => {
    const db = await getDatabase();
    const user = await db.getFirstAsync<Usuario>(
      'SELECT * FROM users WHERE username=? COLLATE NOCASE',
      username,
    );
    if (user?.role !== 'admin')
      throw new Error('Solo un administrador puede consultar las copias.');
    const rows = await db.getAllAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key LIKE 'private_backup:%'",
    );
    return rows
      .map((row) => {
        const parsed = recoveryBackupSchema.safeParse(parseJson(row.value));
        if (!parsed.success)
          throw new Error('El registro de copias necesita revisión. Las copias se conservan.');
        return parsed.data;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function inspectPrivateRecoveryBackup(
  username: string,
  password: string,
  backupId: string,
): Promise<RecoveryBackupInspection> {
  if ((await loadNetworkConfig()).mode === 'client')
    throw new Error('Comprueba la copia en el teléfono administrador.');
  const authenticated = await authenticateForLogin(username, password);
  if (authenticated?.role !== 'admin')
    throw new Error('Confirma la contraseña de tu cuenta de administrador.');
  return consistentRead(async () => {
    const db = await getDatabase();
    const current = await db.getFirstAsync<Usuario>(
      'SELECT * FROM users WHERE id=?',
      authenticated.id,
    );
    if (current?.role !== 'admin' || current.password_hash !== authenticated.password_hash)
      throw new Error('La cuenta cambió. Inicia sesión de nuevo antes de comprobar la copia.');
    if ((await loadNetworkConfig()).mode === 'client')
      throw new Error('Comprueba la copia en el teléfono administrador.');
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key=?',
      `private_backup:${backupId}`,
    );
    const parsed = recoveryBackupSchema.safeParse(parseJson(row?.value ?? null));
    if (!parsed.success || parsed.data.id !== backupId)
      throw new Error('No se pudo verificar el registro de la copia. Se conserva sin modificar.');
    const identity = await db.getFirstAsync<{ authority_id: string }>(
      'SELECT authority_id FROM sync_state WHERE id=1',
    );
    if (!identity?.authority_id) throw new Error('No se pudo verificar la identidad de tus datos.');
    const inspection = await inspectRecoverySnapshot(parsed.data, identity.authority_id);
    const source = await SQLite.openDatabaseAsync(parsed.data.fileName, { useNewConnection: true });
    try {
      await source.execAsync('PRAGMA query_only=ON');
      await verifyRecoveryDatabase(db, identity.authority_id);
      const comparison = await reconcileRecoveryDatabases(db, source);
      return {
        ...inspection,
        recovery: {
          status: comparison.canRestore
            ? comparison.replayEntries
              ? 'forward'
              : 'equal'
            : 'blocked',
          replayEntries: comparison.replayEntries,
        },
      } satisfies RecoveryBackupInspection;
    } catch (error) {
      return {
        ...inspection,
        recovery: {
          status: 'blocked',
          replayEntries: 0,
          reason:
            error instanceof Error
              ? error.message
              : 'No se pudo confirmar la compatibilidad con los datos actuales.',
        },
      } satisfies RecoveryBackupInspection;
    } finally {
      await source.closeAsync();
    }
  });
}

export async function createPrivateRecoveryBackup(
  username: string,
  password: string,
): Promise<RecoveryBackup> {
  if ((await loadNetworkConfig()).mode === 'client')
    throw new Error('Crea la copia en el teléfono administrador, no en una terminal cliente.');
  const authenticated = await authenticateForLogin(username, password);
  if (authenticated?.role !== 'admin')
    throw new Error('Confirma la contraseña de tu cuenta de administrador.');
  const db = await getDatabase();
  const pending = mutationQueue.then(async () => {
    const current = await db.getFirstAsync<Usuario>(
      'SELECT * FROM users WHERE id=?',
      authenticated.id,
    );
    if (current?.role !== 'admin' || current.password_hash !== authenticated.password_hash)
      throw new Error('La cuenta cambió. Inicia sesión de nuevo antes de crear la copia.');
    if ((await loadNetworkConfig()).mode === 'client')
      throw new Error('Crea la copia en el teléfono administrador.');
    const copy = await createRecoverySnapshot(db);
    // The snapshot is verified before its metadata is advertised. A failed catalog
    // write leaves the file preserved, never a falsely confirmed recovery copy.
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'INSERT INTO settings(key,value) VALUES(?,?)',
        `private_backup:${copy.id}`,
        json(copy),
      );
      await db.runAsync(
        'INSERT INTO audit_log(action,username,date,detail) VALUES(?,?,?,?)',
        'recovery.backup',
        current.username,
        now(),
        json({ backupId: copy.id, schemaVersion: copy.schemaVersion }),
      );
      await db.runAsync(
        'INSERT INTO network_events(type,entity_id,created_at) VALUES(?,NULL,?)',
        'data.changed',
        now(),
      );
    });
    return copy;
  });
  mutationQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export interface PrivateRecoveryResult {
  restoreId: string;
  backupId: string;
  safetyCopy: RecoveryBackup;
  reconciliation: RecoveryReconciliation;
}

export async function restorePrivateRecoveryBackup(
  username: string,
  password: string,
  backupId: string,
  confirmed: boolean,
): Promise<PrivateRecoveryResult> {
  if (!confirmed)
    throw new Error('Confirma la conservación de los datos actuales antes de restaurar.');
  const config = await loadNetworkConfig();
  if (config.mode === 'client')
    throw new Error('La restauración solo se realiza en el teléfono administrador.');
  // Host restoration remains disabled until every remote terminal can prove its
  // pending queue has drained. Stopping the listener alone is not that proof.
  if (config.mode === 'host')
    throw new Error('Detén la red local y concilia las terminales antes de restaurar.');
  const authenticated = await authenticateForLogin(username, password);
  if (authenticated?.role !== 'admin')
    throw new Error('Confirma la contraseña de tu cuenta de administrador.');
  if (initializationPromise) await initializationPromise;
  await getDatabase();
  const gate = connectionGate;
  if (!gate) throw new Error('No se pudo preparar el acceso seguro a tus datos.');
  beginDatabaseMaintenance();
  let sealed = false;
  let closeStarted = false;
  let reopened = false;
  let source: SQLite.SQLiteDatabase | null = null;
  let candidate: SQLite.SQLiteDatabase | null = null;
  try {
    const { stopLanHostAndDrain } = await import('@/lib/network/host');
    await stopLanHostAndDrain();
    await mutationQueue;
    await gate.sealAndDrain();
    sealed = true;
    const current = gate.raw;
    if ((await loadNetworkConfig()).mode !== 'standalone')
      throw new Error('Detén la red local antes de restaurar.');
    if ((await getPendingOperation()) || (await getPendingSale()) || (await getPendingWithdrawal()))
      throw new Error(
        'Hay operaciones pendientes. Confirma su resultado antes de restaurar; no se borrarán.',
      );
    const administrator = await current.getFirstAsync<Usuario>(
      'SELECT * FROM users WHERE id=?',
      authenticated.id,
    );
    if (
      administrator?.role !== 'admin' ||
      administrator.password_hash !== authenticated.password_hash
    )
      throw new Error('La cuenta cambió. Inicia sesión de nuevo antes de restaurar.');
    const identity = await current.getFirstAsync<{ authority_id: string }>(
      'SELECT authority_id FROM sync_state WHERE id=1',
    );
    if (!identity?.authority_id) throw new Error('No se pudo comprobar la autoridad de tus datos.');
    await verifyRecoveryDatabase(current, identity.authority_id);
    const record = await current.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key=?',
      `private_backup:${backupId}`,
    );
    const backup = recoveryBackupSchema.parse(parseJson(record?.value ?? null));
    if (backup.id !== backupId) throw new Error('El registro no corresponde a la copia elegida.');
    await inspectRecoverySnapshot(backup, identity.authority_id);
    source = await SQLite.openDatabaseAsync(backup.fileName, { useNewConnection: true });
    await source.execAsync('PRAGMA query_only=ON');
    const reconciliation = await reconcileRecoveryDatabases(current, source);
    if (!reconciliation.canRestore) {
      const changed = reconciliation.tables
        .filter((table) => table.status === 'different')
        .map((table) => table.table);
      throw new Error(
        `La copia difiere de tus datos actuales (${changed.join(', ')}). No se restaurará ni se perderán operaciones. Conserva ambas versiones para conciliarlas.`,
      );
    }
    const safetyCopy = await createRecoverySnapshot(current);
    await current.withTransactionAsync(async () => {
      await current.runAsync(
        'INSERT INTO settings(key,value) VALUES(?,?)',
        `private_backup:${safetyCopy.id}`,
        json(safetyCopy),
      );
      await current.runAsync(
        'INSERT INTO audit_log(action,username,date,detail) VALUES(?,?,?,?)',
        'recovery.backup',
        administrator.username,
        now(),
        json({ backupId: safetyCopy.id, reason: 'pre-restore' }),
      );
    });
    const selected = await resolveDatabaseFile();
    const restoreId = Crypto.randomUUID();
    const selector: RecoverySelector = {
      version: 1,
      phase: 'prepared',
      previous: selected.fileName,
      candidate: `mipypos.restored.${restoreId}.db`,
      authorityId: identity.authority_id,
      restoreId,
      createdAt: now(),
    };
    // Persist intent before creating any generation. A crash during copying must
    // leave the previous generation authoritative, never an untracked candidate.
    await saveRecoverySelector(selector);
    candidate = await SQLite.openDatabaseAsync(selector.candidate, { useNewConnection: true });
    if (await candidate.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1"))
      throw new Error(
        'Ya existe un archivo de recuperación con ese identificador. No se sobrescribirá.',
      );
    await SQLite.backupDatabaseAsync({ sourceDatabase: source, destDatabase: candidate });
    if (backup.schemaVersion === 8) {
      // Upgrade only the isolated candidate; an unchanged v8 snapshot remains
      // recoverable, but cannot acquire missing historical evidence retroactively.
      await candidate.withTransactionAsync(async () => {
        await migrateRecoveryJournal(candidate!);
        await migrateBusiness(candidate!);
        await installRecoveryJournal(candidate!);
        await candidate!.execAsync(`PRAGMA user_version=${DATABASE_VERSION}`);
      });
    } else if (backup.schemaVersion === 9 || backup.schemaVersion === 10) {
      // v10 and v11 only add empty business tables: the verified journal prefix is kept.
      await candidate.withTransactionAsync(async () => {
        await assertRecoveryJournalAvailable(candidate!);
        await migrateBusiness(candidate!);
        await installRecoveryJournal(candidate!);
        await candidate!.execAsync(`PRAGMA user_version=${DATABASE_VERSION}`);
      });
    }
    await reconcileRecoveryCandidate(
      current,
      candidate,
      async () => {
        await preserveRecoveryRuntime(current, candidate!);
        await candidate!.runAsync(
          'INSERT INTO audit_log(action,username,date,detail) VALUES(?,?,?,?)',
          'recovery.restore',
          administrator.username,
          now(),
          json({
            restoreId,
            backupId,
            safetyBackupId: safetyCopy.id,
            policy: reconciliation.replayEntries
              ? 'verified-journal-forward-recovery'
              : 'equal-business-state',
            replayEntries: reconciliation.replayEntries,
            confirmedReceipts: reconciliation.confirmedReceipts,
          }),
        );
      },
      backup.schemaVersion === 8,
    );
    await verifyRecoveryDatabase(candidate, identity.authority_id);
    const verified = await reconcileRecoveryDatabases(current, candidate);
    if (verified.tables.some((table) => table.status !== 'equal'))
      throw new Error('La conciliación final no coincide. Se conserva la base original.');
    await candidate.closeAsync();
    candidate = null;
    await source.closeAsync();
    source = null;
    // Old files, committed WAL and SHM are retained as a generation. We never
    // replace/rename an open SQLite file or delete evidence after an interruption.
    closeStarted = true;
    await current.closeAsync();
    databasePromise = null;
    connectionGate = null;
    candidate = await SQLite.openDatabaseAsync(selector.candidate, { useNewConnection: true });
    await candidate.execAsync('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    await verifyRecoveryDatabase(candidate, identity.authority_id);
    await saveRecoverySelector({ ...selector, phase: 'committed' });
    const replacement = new DatabaseConnectionGate(candidate);
    connectionGate = replacement;
    databasePromise = Promise.resolve(replacement.database);
    candidate = null;
    reopened = true;
    return { restoreId, backupId, safetyCopy, reconciliation };
  } catch (error) {
    if (closeStarted) {
      // A failure after closure must reopen the generation selected by the durable
      // record. A corrupt/unreadable selector never falls back to an empty DB.
      if (candidate) {
        await candidate.closeAsync();
        candidate = null;
      }
      const selected = await resolveDatabaseFile();
      const restored = await SQLite.openDatabaseAsync(selected.fileName, {
        useNewConnection: true,
      });
      try {
        if (!selected.authorityId)
          throw new Error('Falta la identidad de la recuperación.', { cause: error });
        await verifyRecoveryDatabase(restored, selected.authorityId);
        await restored.execAsync('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
        const replacement = new DatabaseConnectionGate(restored);
        connectionGate = replacement;
        databasePromise = Promise.resolve(replacement.database);
        reopened = true;
      } catch (failure) {
        await restored.closeAsync();
        throw new Error(
          'No se pudo confirmar la recuperación. Reinicia MipyPOS; las bases se conservan y las operaciones siguen bloqueadas.',
          { cause: failure },
        );
      }
    }
    throw error;
  } finally {
    try {
      if (source) await source.closeAsync();
      if (candidate) await candidate.closeAsync();
    } finally {
      if (!closeStarted || reopened) {
        if (sealed && !closeStarted) gate.resume();
        endDatabaseMaintenance();
      }
    }
  }
}

export async function listUsers() {
  return (await getDatabase()).getAllAsync<Usuario>(
    "SELECT id,username,role,can_authorize_consumption,can_manage_fiscal,'' AS password_hash FROM users ORDER BY username",
  );
}
export async function saveUser(
  input: {
    id?: number;
    username: string;
    password?: string;
    role: UserRole;
  },
  command?: MutationCommand,
) {
  const db = await getDatabase();
  return transaction(
    db,
    async () => {
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
        if (input.password) assertNewPassword(input.password);
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
      if (!input.password) throw new Error('La contraseña es obligatoria.');
      assertNewPassword(input.password);
      const result = await db.runAsync(
        'INSERT INTO users(username,password_hash,role) VALUES(?,?,?)',
        name,
        await hashPassword(input.password),
        input.role,
      );
      return result.lastInsertRowId;
    },
    command,
    (value) => mutationIdSchema.parse(value),
  );
}
export async function deleteUser(id: number, currentId: number, command?: MutationCommand) {
  if (id === currentId) throw new Error('No puedes eliminar tu propio usuario.');
  const db = await getDatabase();
  return transaction(
    db,
    async () => {
      const user = await db.getFirstAsync<Usuario>('SELECT * FROM users WHERE id=?', id);
      if (user?.role === 'admin') {
        const admins = await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM users WHERE role='admin'",
        );
        if ((admins?.count ?? 0) <= 1) throw new Error('Debe existir al menos un administrador.');
      }
      await db.runAsync('DELETE FROM users WHERE id=?', id);
    },
    command,
    (value) => mutationVoidSchema.parse(value),
  );
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
  command?: MutationCommand,
) {
  const db = await getDatabase();
  if (!product.name.trim()) throw new Error('El nombre es obligatorio.');
  if (
    ![product.stock, product.price_cash, product.price_transfer].every(Number.isFinite) ||
    product.stock < 0 ||
    product.price_cash < 0 ||
    product.price_transfer < 0
  )
    throw new Error('Stock y precios deben ser números válidos no negativos.');
  if (!product.unit.trim() || ![0, 3].includes(product.quantity_decimals))
    throw new Error('Selecciona una unidad de medida válida.');
  validateQuantity(product.stock, product.quantity_decimals, true);
  try {
    return await transaction(
      db,
      async () => {
        let productId = product.id ?? 0;
        if (product.id) {
          const current = await db.getFirstAsync<Producto>(
            'SELECT * FROM products WHERE id=?',
            product.id,
          );
          if (!current) throw new Error('Producto no encontrado.');
          if (Math.abs(current.stock - product.stock) > 0.0001)
            throw new Error(
              'El stock cambió. Actualiza los datos; los ajustes se realizan en Inventario.',
            );
          const balances = await db.getAllAsync<{ quantity: number }>(
            'SELECT quantity FROM area_stock WHERE product_id=?',
            current.id,
          );
          balances.forEach((balance) =>
            validateQuantity(balance.quantity, product.quantity_decimals, true),
          );
          if (current.unit !== product.unit.trim().toLowerCase()) {
            const soldInOpenSession = await db.getFirstAsync<{ count: number }>(
              'SELECT COUNT(*) AS count FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN cash_sessions c ON c.id=s.session_id WHERE c.close_date IS NULL AND l.product_id=?',
              current.id,
            );
            if (soldInOpenSession?.count)
              throw new Error('Cierra la caja antes de cambiar la unidad de un producto vendido.');
          }
          await db.runAsync(
            'UPDATE products SET name=?,category=?,subcategory=?,unit=?,quantity_decimals=?,price_cash=?,price_transfer=?,image_path=? WHERE id=?',
            product.name.trim(),
            product.category.trim(),
            product.subcategory.trim(),
            product.unit.trim().toLowerCase(),
            product.quantity_decimals,
            product.price_cash,
            product.price_transfer,
            product.image_path,
            product.id,
          );
          return product.id;
        }
        await consumeDemoQuota(db, 'products');
        const result = await db.runAsync(
          'INSERT INTO products(name,category,subcategory,unit,quantity_decimals,stock,price_cash,price_transfer,image_path) VALUES(?,?,?,?,?,?,?,?,?)',
          product.name.trim(),
          product.category.trim(),
          product.subcategory.trim(),
          product.unit.trim().toLowerCase(),
          product.quantity_decimals,
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
        return productId;
      },
      command,
      (value) => mutationIdSchema.parse(value),
    );
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new Error('Ya existe un producto con ese nombre.', { cause: error });
    throw error;
  }
}
export async function deleteProduct(id: number, command?: MutationCommand) {
  const db = await getDatabase();
  return transaction(
    db,
    async () => {
      const used = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM sale_lines WHERE product_id=?',
        id,
      );
      if (used?.count) throw new Error('No se puede eliminar un producto con ventas registradas.');
      const moved = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM movements WHERE product_id=?',
        id,
      );
      if (moved?.count)
        throw new Error('No se puede eliminar un producto con movimientos registrados.');
      await db.runAsync('DELETE FROM products WHERE id=?', id);
    },
    command,
    (value) => mutationVoidSchema.parse(value),
  );
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
export async function openCashSession(fund: number, username: string, command?: MutationCommand) {
  if (!Number.isFinite(fund) || fund < 0)
    throw new Error('El fondo inicial debe ser un número válido no negativo.');
  const db = await getDatabase();
  try {
    return await transaction(
      db,
      async () => {
        const stock = await db.getAllAsync<{ id: number; stock: number }>(
          'SELECT id,stock FROM products',
        );
        const cursor = await db.getFirstAsync<{ id: number }>(
          'SELECT COALESCE(MAX(id),0) AS id FROM movements',
        );
        const result = await db.runAsync(
          'INSERT INTO cash_sessions(open_date,fund,products_start,movement_start_id) VALUES(?,?,?,?)',
          now(),
          roundMoney(fund),
          json(Object.fromEntries(stock.map((p) => [p.id, p.stock]))),
          cursor?.id ?? 0,
        );
        await db.runAsync(
          'INSERT INTO audit_log(action,username,entity_id,date) VALUES(?,?,?,?)',
          'cash_open',
          username,
          result.lastInsertRowId,
          now(),
        );
        await db.runAsync("DELETE FROM settings WHERE key='next_opening_fund'");
        return result.lastInsertRowId;
      },
      command,
      (value) => mutationIdSchema.parse(value),
    );
  } catch (error) {
    if (String(error).includes('UNIQUE'))
      throw new Error('Ya existe una caja abierta.', { cause: error });
    throw error;
  }
}
export function findCashWithdrawalReceipt(
  sessionId: number,
  input: Pick<CashWithdrawalInput, 'commandId' | 'amount' | 'reason'>,
  username: string,
) {
  return consistentRead(async () => {
    const previous = await (
      await getDatabase()
    ).getFirstAsync<CashWithdrawal>(
      'SELECT * FROM cash_withdrawals WHERE command_id=?',
      input.commandId,
    );
    if (!previous) return null;
    if (
      previous.session_id !== sessionId ||
      previous.amount !== input.amount ||
      previous.reason !== input.reason.trim() ||
      previous.username !== username
    )
      throw new Error('La extracción pendiente no coincide. Revisa el registro de caja.');
    return previous.id;
  });
}
export async function registerCashWithdrawal(
  sessionId: number,
  input: CashWithdrawalInput,
  username: string,
): Promise<number> {
  const db = await getDatabase();
  return transaction(db, async () => {
    const administrator = await authenticate(input.adminUsername, input.adminPassword);
    if (!administrator || administrator.role !== 'admin')
      throw new Error('Las credenciales del administrador no son válidas.');
    if (
      !input.commandId ||
      !input.reason.trim() ||
      !Number.isFinite(input.amount) ||
      input.amount <= 0 ||
      roundMoney(input.amount) !== input.amount
    )
      throw new Error('Introduce un importe positivo con hasta dos decimales y un motivo.');
    const previous = await db.getFirstAsync<CashWithdrawal>(
      'SELECT * FROM cash_withdrawals WHERE command_id=?',
      input.commandId,
    );
    if (previous) {
      if (
        previous.session_id !== sessionId ||
        previous.amount !== input.amount ||
        previous.reason !== input.reason.trim() ||
        previous.username !== username
      )
        throw new Error('La extracción pendiente no coincide. Revisa el registro de caja.');
      return previous.id;
    }
    const session = await getOpenSession();
    if (!session || session.id !== sessionId) throw new Error('La caja cambió o ya está cerrada.');
    const summary = await getCashSummary(sessionId);
    if (input.amount - summary.expectedCash > 0.005)
      throw new Error('La extracción supera el efectivo disponible en caja.');
    const date = now();
    const result = await db.runAsync(
      'INSERT INTO cash_withdrawals(session_id,command_id,amount,reason,username,authorized_by,date) VALUES(?,?,?,?,?,?,?)',
      sessionId,
      input.commandId,
      input.amount,
      input.reason.trim(),
      username,
      administrator.username,
      date,
    );
    await db.runAsync(
      'INSERT INTO audit_log(action,username,entity_id,date,detail) VALUES(?,?,?,?,?)',
      'cash_withdrawal',
      administrator.username,
      sessionId,
      date,
      json({
        withdrawalId: result.lastInsertRowId,
        amount: input.amount,
        reason: input.reason.trim(),
        recordedBy: username,
      }),
    );
    await db.runAsync(
      'INSERT INTO network_events(type,entity_id,created_at) VALUES(?,?,?)',
      'cash.withdrawal',
      result.lastInsertRowId,
      date,
    );
    return result.lastInsertRowId;
  });
}

export async function getCashSummary(sessionId: number): Promise<CashSummary> {
  const db = await getDatabase();
  const session = await db.getFirstAsync<{ fund: number }>(
    'SELECT fund FROM cash_sessions WHERE id=?',
    sessionId,
  );
  const rows = await db.getAllAsync<{ type: string; amount: number }>(
    "SELECT json_extract(value,'$.type') AS type, SUM(json_extract(value,'$.amount')) AS amount FROM sales,json_each(sales.payments) WHERE session_id=? GROUP BY json_extract(value,'$.type')",
    sessionId,
  );
  const amount = (type: string) => rows.find((row) => row.type === type)?.amount ?? 0;
  const refunds = await db.getAllAsync<{ type: string; amount: number }>(
    "SELECT json_extract(value,'$.type') AS type, SUM(json_extract(value,'$.amount')) AS amount FROM sale_adjustments,json_each(sale_adjustments.payments) WHERE session_id=? GROUP BY json_extract(value,'$.type')",
    sessionId,
  );
  for (const refund of refunds) {
    const row = rows.find((r) => r.type === refund.type);
    if (row) row.amount = roundMoney(row.amount - refund.amount);
    else rows.push({ type: refund.type, amount: -refund.amount });
  }
  const cashSales = amount('cash');
  const withdrawalTotal =
    (
      await db.getFirstAsync<{ total: number }>(
        'SELECT COALESCE(SUM(amount),0) AS total FROM cash_withdrawals WHERE session_id=?',
        sessionId,
      )
    )?.total ?? 0;
  const other = await Business.sessionCashEntries(db, sessionId);
  return {
    salesTotal: rows.reduce((sum, row) => sum + row.amount, 0),
    cashSales,
    transferSales: amount('transfer'),
    cardSales: amount('card'),
    withdrawalTotal,
    otherCashNet: other.net,
    foreignCash: other.foreign,
    expectedCash: roundMoney((session?.fund ?? 0) + cashSales - withdrawalTotal + other.net),
  };
}
export async function getCashClosurePreview(sessionId: number): Promise<CashClosurePreview> {
  const db = await getDatabase();
  const session = await db.getFirstAsync<{
    id: number;
    fund: number;
    open_date: string;
    products_start: string;
    movement_start_id: number | null;
  }>(
    'SELECT id,fund,open_date,products_start,movement_start_id FROM cash_sessions WHERE id=? AND close_date IS NULL',
    sessionId,
  );
  if (!session) throw new Error('La sesión de caja ya está cerrada.');

  const [summary, products, movements, sold] = await Promise.all([
    getCashSummary(sessionId),
    db.getAllAsync<{ id: number; name: string; unit: string }>(
      'SELECT id,name,unit FROM products ORDER BY name',
    ),
    db.getAllAsync<{ product_id: number; entries: number; exits: number; finance_events: number }>(
      `SELECT product_id,
        SUM(CASE WHEN type IN ('CONSUMO_INTERNO','ANULACION_CONSUMO','DEVOLUCION') THEN 1 ELSE 0 END) AS finance_events,
        SUM(CASE WHEN type IN ('entrada','ANULACION_CONSUMO','DEVOLUCION') THEN quantity ELSE 0 END) AS entries,
        SUM(CASE WHEN type IN ('salida','CONSUMO_INTERNO') THEN quantity ELSE 0 END) AS exits
       FROM movements WHERE ${session.movement_start_id === null ? 'date>?' : 'id>?'} GROUP BY product_id`,
      session.movement_start_id ?? session.open_date,
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
    withdrawalTotal: summary.withdrawalTotal,
    otherCashNet: summary.otherCashNet,
    foreignCash: summary.foreignCash,
    withdrawals: await db.getAllAsync<CashWithdrawal>(
      'SELECT * FROM cash_withdrawals WHERE session_id=? ORDER BY id',
      sessionId,
    ),
    products: products
      .filter(
        (product) =>
          (soldByProduct.get(product.id) ?? 0) > 0 ||
          (movementByProduct.get(product.id)?.finance_events ?? 0) > 0,
      )
      .map((product) => {
        const movement = movementByProduct.get(product.id);
        const openingStock = opening[String(product.id)] ?? 0;
        const entries = movement?.entries ?? 0;
        const exits = movement?.exits ?? 0;
        const soldQuantity = soldByProduct.get(product.id) ?? 0;
        return {
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          openingStock,
          entries,
          exits,
          sold: soldQuantity,
          expectedStock: roundQuantity(openingStock + entries - exits - soldQuantity),
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
  let cashCount = input.coinsCount ?? 0;
  if (
    !Number.isFinite(cashCount) ||
    cashCount < 0 ||
    Math.abs(cashCount * 100 - Math.round(cashCount * 100)) > 0.000001
  )
    throw new Error('El conteo de monedas no es válido.');
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
  if (
    !Number.isFinite(input.transferCount) ||
    input.transferCount < 0 ||
    Math.abs(roundMoney(input.transferCount) - input.transferCount) > 0.000001
  )
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

  const expectedCash = roundMoney(
    preview.fund + preview.cashSales - preview.withdrawalTotal + preview.otherCashNet,
  );
  if (
    !Number.isFinite(input.withdrawalCount) ||
    input.withdrawalCount < 0 ||
    roundMoney(input.withdrawalCount) !== input.withdrawalCount
  )
    throw new Error('El monto comprobado de extracciones no es válido.');
  return {
    cashCount,
    expectedCash,
    cashDifference: roundMoney(cashCount - expectedCash),
    transferDifference: roundMoney(input.transferCount - preview.transferSales),
    withdrawalTotal: preview.withdrawalTotal,
    withdrawalDifference: roundMoney(input.withdrawalCount - preview.withdrawalTotal),
    totalDifference: roundMoney(
      cashCount -
        preview.fund +
        preview.withdrawalTotal +
        input.transferCount +
        preview.cardSales -
        preview.salesTotal -
        preview.otherCashNet,
    ),
    products: reconciledProducts,
  };
}

function differenceDetail(
  preview: CashClosurePreview,
  input: Pick<CashDifferenceInput, 'kind' | 'counted' | 'transferCount' | 'productId'>,
): string {
  if (!Number.isFinite(input.counted) || input.counted < 0)
    throw new Error('Introduce un conteo válido.');
  switch (input.kind) {
    case 'money':
      if (
        !Number.isFinite(input.transferCount) ||
        input.transferCount! < 0 ||
        Math.abs(roundMoney(input.counted) - input.counted) > 0.000001 ||
        Math.abs(roundMoney(input.transferCount!) - input.transferCount!) > 0.000001
      )
        throw new Error('Introduce conteos monetarios con hasta dos decimales.');
      return json({
        kind: input.kind,
        expectedCash: roundMoney(
          preview.fund + preview.cashSales - preview.withdrawalTotal + preview.otherCashNet,
        ),
        cashCount: input.counted,
        expectedTransfer: preview.transferSales,
        transferCount: input.transferCount,
      });
    case 'withdrawals':
      if (Math.abs(roundMoney(input.counted) - input.counted) > 0.000001)
        throw new Error('Introduce un importe con hasta dos decimales.');
      return json({ kind: input.kind, expected: preview.withdrawalTotal, counted: input.counted });
    case 'inventory': {
      const product = preview.products.find((p) => p.productId === input.productId);
      if (!product) throw new Error('El producto no pertenece al cierre.');
      return json({
        kind: input.kind,
        productId: product.productId,
        expected: product.expectedStock,
        counted: input.counted,
      });
    }
    default:
      throw new Error('El paso del cierre no es válido.');
  }
}
export async function authorizeCashDifference(
  sessionId: number,
  input: CashDifferenceInput,
  command?: MutationCommand,
): Promise<CashDifferenceApproval> {
  const db = await getDatabase();
  return transaction(
    db,
    async () => {
      const administrator = await authenticate(input.adminUsername, input.adminPassword);
      if (!administrator || administrator.role !== 'admin')
        throw new Error('Las credenciales del administrador no son válidas.');
      if (!input.reason.trim()) throw new Error('Explica el motivo de la diferencia.');
      if (input.kind === 'inventory') {
        const product = await db.getFirstAsync<Producto>(
          'SELECT * FROM products WHERE id=?',
          input.productId ?? 0,
        );
        if (!product) throw new Error('El producto no pertenece al cierre.');
        validateQuantity(input.counted, product.quantity_decimals, true);
      }
      const detail = differenceDetail(await getCashClosurePreview(sessionId), input);
      const date = now();
      const result = await db.runAsync(
        'INSERT INTO cash_difference_approvals(session_id,detail,reason,authorized_by,date) VALUES(?,?,?,?,?)',
        sessionId,
        detail,
        input.reason.trim(),
        administrator.username,
        date,
      );
      await db.runAsync(
        'INSERT INTO audit_log(action,username,entity_id,date,detail) VALUES(?,?,?,?,?)',
        'cash_difference_approved',
        administrator.username,
        sessionId,
        date,
        json({
          approvalId: result.lastInsertRowId,
          reason: input.reason.trim(),
          values: parseJson(detail),
        }),
      );
      return {
        id: result.lastInsertRowId,
        detail,
        reason: input.reason.trim(),
        authorized_by: administrator.username,
        date,
      };
    },
    command,
    (value) => parseOperationResult('authorizeCashDifference', value),
  );
}
export async function listCashClosures(): Promise<CashClosureRecord[]> {
  return (await getDatabase()).getAllAsync<CashClosureRecord>(
    'SELECT * FROM cash_closures ORDER BY session_id DESC',
  );
}

export async function closeCashSession(
  sessionId: number,
  input: CashClosureInput,
  command?: MutationCommand,
): Promise<CashClosureReconciliation> {
  const db = await getDatabase();
  return transaction(
    db,
    async () => {
      const administrator = await authenticate(input.adminUsername, input.adminPassword);
      if (!administrator || administrator.role !== 'admin')
        throw new Error('Las credenciales del administrador no son válidas.');
      const preview = await getCashClosurePreview(sessionId);
      const reconciliation = reconcileCashClosure(preview, input);
      const approvals = await db.getAllAsync<CashDifferenceApproval>(
        'SELECT id,detail,reason,authorized_by,date FROM cash_difference_approvals WHERE session_id=?',
        sessionId,
      );
      const usedApprovals: CashDifferenceApproval[] = [];
      const requireApproval = (
        difference: Pick<CashDifferenceInput, 'kind' | 'counted' | 'transferCount' | 'productId'>,
      ) => {
        const detail = differenceDetail(preview, difference);
        const approved = approvals.find(
          (approval) => input.approvalIds?.includes(approval.id) && approval.detail === detail,
        );
        if (!approved)
          throw new Error(
            'Los conteos deben coincidir o tener una autorización administrativa vigente para esa diferencia.',
          );
        usedApprovals.push(approved);
      };
      if (
        Math.abs(reconciliation.cashDifference) > 0.005 ||
        Math.abs(reconciliation.transferDifference) > 0.005 ||
        Math.abs(reconciliation.totalDifference) > 0.005
      )
        requireApproval({
          kind: 'money',
          counted: reconciliation.cashCount,
          transferCount: input.transferCount,
        });
      if (Math.abs(reconciliation.withdrawalDifference) > 0.005)
        requireApproval({ kind: 'withdrawals', counted: input.withdrawalCount });
      for (const product of reconciliation.products) {
        const original = await db.getFirstAsync<Producto>(
          'SELECT * FROM products WHERE id=?',
          product.productId,
        );
        if (original) validateQuantity(product.physicalStock, original.quantity_decimals, true);
        if (Math.abs(product.difference) > 0.0001)
          requireApproval({
            kind: 'inventory',
            counted: product.physicalStock,
            productId: product.productId,
          });
      }

      const closeDate = now();
      const closureDetail = json({
        coinsCount: input.coinsCount ?? 0,
        denominations: input.denominations,
        cashCount: reconciliation.cashCount,
        expectedCash: reconciliation.expectedCash,
        transferCount: input.transferCount,
        expectedTransfer: preview.transferSales,
        salesTotal: preview.salesTotal,
        withdrawalCount: input.withdrawalCount,
        withdrawalTotal: preview.withdrawalTotal,
        withdrawals: preview.withdrawals,
        cashDifference: reconciliation.cashDifference,
        transferDifference: reconciliation.transferDifference,
        withdrawalDifference: reconciliation.withdrawalDifference,
        totalDifference: reconciliation.totalDifference,
        inventory: reconciliation.products,
        approvals: usedApprovals.map((approval) => ({
          ...approval,
          detail: parseJson(approval.detail),
        })),
      });
      await db.runAsync(
        'INSERT INTO cash_closures(session_id,authorized_by,date,detail) VALUES(?,?,?,?)',
        sessionId,
        administrator.username,
        closeDate,
        closureDetail,
      );
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
        closureDetail,
      );
      return reconciliation;
    },
    command,
    (value) => parseOperationResult('closeCashSession', value),
  );
}

function validatePayments(total: number, method: SaleMethod, payments: Payment[]) {
  if (
    !['cash', 'transfer', 'mixed'].includes(method) ||
    payments.some((p) => !['cash', 'transfer'].includes(p.type)) ||
    new Set(payments.map((p) => p.type)).size !== payments.length
  )
    throw new Error('Los métodos de pago no son válidos.');
  const positive = payments.filter((p) => p.amount > 0);
  if (
    !positive.length ||
    payments.some(
      (p) =>
        !Number.isFinite(p.amount) ||
        p.amount < 0 ||
        Math.abs(roundMoney(p.amount) - p.amount) > 0.000001,
    )
  )
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
export function getNetworkSaleReceipt(
  commandId: string,
  clientId: string,
  username: string,
  fingerprint: string,
) {
  return consistentRead(() => findNetworkSale(commandId, clientId, username, fingerprint));
}
export async function findNetworkSale(
  commandId: string,
  clientId: string,
  username: string,
  fingerprint?: string,
): Promise<number | null> {
  const previous = await (
    await getDatabase()
  ).getFirstAsync<{ response: string | null }>(
    'SELECT response FROM network_commands WHERE command_id=? AND client_id=?',
    commandId,
    clientId,
  );
  const parsed = parseJson(previous?.response ?? null);
  if (!isRecord(parsed) || typeof parsed.saleId !== 'number') return null;
  if (fingerprint && typeof parsed.fingerprint === 'string' && parsed.fingerprint !== fingerprint)
    throw new Error('El identificador ya pertenece a una venta con otros datos.');
  const sale = await (
    await getDatabase()
  ).getFirstAsync<{ user: string }>('SELECT user FROM sales WHERE id=?', parsed.saleId);
  if (sale?.user !== username) throw new Error('La venta pendiente pertenece a otro usuario.');
  return parsed.saleId;
}
export async function registerSale(
  items: CartItem[],
  method: SaleMethod,
  payments: Payment[],
  username: string,
  networkCommand?: { commandId: string; clientId: string },
  expectedSessionId?: number,
  settlement?: SaleSettlement,
) {
  if (!items.length) throw new Error('El carrito está vacío.');
  const fingerprint = networkCommand
    ? await saleFingerprint({
        items: items.map((item) => ({
          productId: item.product.id,
          areaId: item.areaId,
          quantity: item.quantity,
        })),
        method,
        payments,
        sessionId: expectedSessionId,
        settlement,
      })
    : undefined;
  const db = await getDatabase();
  const total = roundMoney(
    items.reduce((sum, item) => sum + roundMoney(item.price * item.quantity), 0),
  );
  const validPayments = validatePayments(total, method, payments);
  const validSettlement = validateSettlement(validPayments, settlement);
  let saleId = 0;
  await transaction(db, async () => {
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
          if (typeof parsed.fingerprint === 'string' && parsed.fingerprint !== fingerprint)
            throw new Error('El identificador ya pertenece a una venta con otros datos.');
          const sale = await db.getFirstAsync<{ user: string }>(
            'SELECT user FROM sales WHERE id=?',
            parsed.saleId,
          );
          if (sale?.user !== username)
            throw new Error('La venta pendiente pertenece a otro usuario.');
          saleId = parsed.saleId;
          return;
        }
        throw new Error('La venta ya se está procesando.');
      }
    }
    if (validSettlement?.transferReceipt) {
      const receipt = validSettlement.transferReceipt;
      const duplicate = await db.getFirstAsync<{ id: number }>(
        `SELECT id FROM sales WHERE json_extract(settlement,'$.transferReceipt.imageBase64')=? OR (?<>'' AND upper(trim(json_extract(settlement,'$.transferReceipt.reference')))=?) LIMIT 1`,
        receipt.imageBase64,
        receipt.reference.trim().toUpperCase(),
        receipt.reference.trim().toUpperCase(),
      );
      if (duplicate) throw new Error(`Este comprobante ya se usó en la venta #${duplicate.id}.`);
    }
    await consumeDemoQuota(db, 'sales');
    const session = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM cash_sessions WHERE close_date IS NULL LIMIT 1',
    );
    if (!session) throw new Error('Debes abrir una sesión de caja antes de vender.');
    if (expectedSessionId !== undefined && session.id !== expectedSessionId)
      throw new Error('La caja cambió. Actualiza el carrito antes de vender.');
    const currentProducts = new Map<number, Producto>();
    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0)
        throw new Error(`Cantidad inválida para ${item.product.name}.`);
      const current = await db.getFirstAsync<Producto>(
        'SELECT * FROM products WHERE id=?',
        item.product.id,
      );
      if (current) validateQuantity(item.quantity, current.quantity_decimals);
      if (!current || current.stock + 0.000001 < item.quantity)
        throw new Error(`Stock insuficiente para ${item.product.name}.`);
      if (
        current.unit !== item.product.unit ||
        current.quantity_decimals !== item.product.quantity_decimals
      )
        throw new Error(`La unidad de ${current.name} cambió. Actualiza el carrito.`);
      currentProducts.set(current.id, current);
      const price = saleUnitPrice(current, method);
      if (!Number.isFinite(item.price) || Math.abs(item.price - price) > 0.000001)
        throw new Error(`El precio de ${current.name} cambió. Actualiza el carrito.`);
      if (!Number.isInteger(item.areaId)) throw new Error('Selecciona el área de venta.');
      const available = await db.getFirstAsync<{ quantity: number }>(
        'SELECT quantity FROM area_stock WHERE area_id=? AND product_id=?',
        item.areaId,
        current.id,
      );
      if (!available || available.quantity + 0.000001 < item.quantity)
        throw new Error(`Stock insuficiente de ${current.name} en el área seleccionada.`);
    }
    const seller = await db.getFirstAsync<{ id: number; role: UserRole }>(
      'SELECT id,role FROM users WHERE username=? COLLATE NOCASE',
      username,
    );
    if (!seller || !canAccess(seller.role, 'sales'))
      throw new Error('Tu usuario no tiene permiso para registrar ventas.');
    const sale = await db.runAsync(
      'INSERT INTO sales(session_id,user,date,total,method,payments,settlement,seller_id,pricing_basis) VALUES(?,?,?,?,?,?,?,?,?)',
      session.id,
      username,
      now(),
      total,
      method,
      json(validPayments),
      validSettlement ? json(validSettlement) : null,
      seller?.id ?? null,
      method === 'transfer' ? 'transfer' : 'cash',
    );
    saleId = sale.lastInsertRowId;
    for (const item of items) {
      const subtotal = roundMoney(item.price * item.quantity);
      await db.runAsync(
        'INSERT INTO sale_lines(sale_id,product_id,name,quantity,price,subtotal,area_id,unit,unit_cost,category) VALUES(?,?,?,?,?,?,?,?,?,?)',
        saleId,
        item.product.id,
        currentProducts.get(item.product.id)!.name,
        item.quantity,
        item.price,
        subtotal,
        item.areaId,
        currentProducts.get(item.product.id)!.unit,
        currentProducts.get(item.product.id)!.unit_cost ?? null,
        currentProducts.get(item.product.id)!.category,
      );
      const update = await db.runAsync(
        'UPDATE products SET stock=ROUND(stock-?,3) WHERE id=? AND stock+0.000001>=?',
        item.quantity,
        item.product.id,
        item.quantity,
      );
      if (!update.changes) throw new Error(`Stock insuficiente para ${item.product.name}.`);
      const areaUpdate = await db.runAsync(
        'UPDATE area_stock SET quantity=ROUND(quantity-?,3) WHERE area_id=? AND product_id=? AND quantity+0.000001>=?',
        item.quantity,
        item.areaId,
        item.product.id,
        item.quantity,
      );
      if (!areaUpdate.changes)
        throw new Error(`Stock insuficiente de ${item.product.name} en el área seleccionada.`);
    }
    await Business.assignSaleTicket(
      db,
      saleId,
      items.map((item) => item.areaId),
    );
    await db.runAsync(
      'INSERT INTO network_events(type,entity_id,created_at) VALUES(?,?,?)',
      'sale.created',
      saleId,
      now(),
    );
    if (networkCommand) {
      await db.runAsync(
        'UPDATE network_commands SET response=? WHERE command_id=? AND client_id=?',
        json({ saleId, fingerprint }),
        networkCommand.commandId,
        networkCommand.clientId,
      );
    }
  });
  return saleId;
}
export async function findTransferTransaction(reference: string): Promise<{ id: number } | null> {
  if (typeof reference !== 'string' || reference.length > 200)
    throw new Error('Revisa el número de transacción.');
  const normalized = reference.trim().toUpperCase();
  if (!normalized) return null;
  return (await getDatabase()).getFirstAsync<{ id: number }>(
    `SELECT id FROM sales WHERE upper(trim(json_extract(settlement,'$.transferReceipt.reference')))=? ORDER BY id LIMIT 1`,
    normalized,
  );
}

export async function getSale(id: number) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<
    Omit<Venta, 'payments' | 'settlement'> & { payments: string; settlement: string | null }
  >('SELECT * FROM sales WHERE id=?', id);
  if (!row) return null;
  const lines = await db.getAllAsync<LineaVenta>(
    'SELECT * FROM sale_lines WHERE sale_id=? ORDER BY id',
    id,
  );
  return {
    sale: {
      ...row,
      payments: parsePayments(row.payments),
      settlement: row.settlement ? storedSettlementSchema.parse(JSON.parse(row.settlement)) : null,
    },
    lines,
  };
}

export async function listAreaStock() {
  return (await getDatabase()).getAllAsync<AreaStock>(
    'SELECT area_id,product_id,quantity FROM area_stock ORDER BY area_id,product_id',
  );
}

export async function listAreas() {
  return (await getDatabase()).getAllAsync<Area>('SELECT * FROM areas ORDER BY name');
}
export async function addArea(name: string, command?: MutationCommand) {
  if (!name.trim()) throw new Error('El nombre del área es obligatorio.');
  const db = await getDatabase();
  return transaction(
    db,
    async () => {
      await db.runAsync('INSERT INTO areas(name) VALUES(?)', name.trim());
    },
    command,
    (value) => mutationVoidSchema.parse(value),
  );
}
export async function registerMovement(
  input: {
    type: MovementType;
    productId: number;
    quantity: number;
    fromArea?: string;
    toArea?: string;
    username: string;
  },
  command?: MutationCommand,
) {
  if (!['entrada', 'salida', 'traslado'].includes(input.type))
    throw new Error('El tipo de movimiento no es válido.');
  if (!Number.isFinite(input.quantity) || input.quantity <= 0)
    throw new Error('La cantidad debe ser mayor que cero.');
  const db = await getDatabase();
  await transaction(
    db,
    async () => {
      const product = await db.getFirstAsync<Producto>(
        'SELECT * FROM products WHERE id=?',
        input.productId,
      );
      if (!product) throw new Error('Producto no encontrado.');
      validateQuantity(input.quantity, product.quantity_decimals);
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
      } else if (Math.abs((assigned?.total ?? 0) - product.stock) > 0.001) {
        throw new Error(
          'Las existencias por área no coinciden con el inventario. Revisa el producto antes de moverlo.',
        );
      }
      if (input.type === 'entrada') {
        if (!input.toArea) throw new Error('Selecciona un área de destino.');
        const target = await areaId(input.toArea);
        await db.runAsync(
          'UPDATE products SET stock=ROUND(stock+?,3) WHERE id=?',
          input.quantity,
          product.id,
        );
        await db.runAsync(
          `INSERT INTO area_stock(area_id,product_id,quantity) VALUES(?,?,?)
         ON CONFLICT(area_id,product_id) DO UPDATE SET quantity=ROUND(quantity+excluded.quantity,3)`,
          target,
          product.id,
          input.quantity,
        );
      } else if (input.type === 'salida') {
        if (!input.fromArea) throw new Error('Selecciona un área de origen.');
        const source = await areaId(input.fromArea);
        const areaChanged = await db.runAsync(
          'UPDATE area_stock SET quantity=ROUND(quantity-?,3) WHERE area_id=? AND product_id=? AND quantity+0.000001>=?',
          input.quantity,
          source,
          product.id,
          input.quantity,
        );
        if (!areaChanged.changes) throw new Error('Stock insuficiente en el área de origen.');
        const changed = await db.runAsync(
          'UPDATE products SET stock=ROUND(stock-?,3) WHERE id=? AND stock+0.000001>=?',
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
        if (source === target) throw new Error('El origen y el destino deben ser diferentes.');
        const changed = await db.runAsync(
          'UPDATE area_stock SET quantity=ROUND(quantity-?,3) WHERE area_id=? AND product_id=? AND quantity+0.000001>=?',
          input.quantity,
          source,
          product.id,
          input.quantity,
        );
        if (!changed.changes) throw new Error('Stock insuficiente en el área de origen.');
        await db.runAsync(
          `INSERT INTO area_stock(area_id,product_id,quantity) VALUES(?,?,?)
         ON CONFLICT(area_id,product_id) DO UPDATE SET quantity=ROUND(quantity+excluded.quantity,3)`,
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
    },
    command,
    (value) => mutationVoidSchema.parse(value),
  );
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

async function periodSalesTotals(start: string, end: string) {
  const db = await getDatabase();
  return (
    (await db.getFirstAsync<{ totalSales: number; salesCount: number }>(
      `SELECT ROUND(COALESCE(SUM(total),0)-(SELECT COALESCE(SUM(amount),0) FROM sale_adjustments WHERE date BETWEEN ? AND ?),2) AS totalSales,
      COUNT(*) AS salesCount FROM sales WHERE date BETWEEN ? AND ?`,
      start,
      end,
      start,
      end,
    )) ?? { totalSales: 0, salesCount: 0 }
  );
}
const PRODUCT_PERIOD_EVENTS = `WITH events AS (
  SELECT l.product_id,l.name,l.unit,l.quantity,l.subtotal AS total FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.date BETWEEN ? AND ?
  UNION ALL
  SELECT l.product_id,l.name,l.unit,-a.quantity,-a.amount FROM sale_adjustments a JOIN sale_lines l ON l.id=a.line_id WHERE a.date BETWEEN ? AND ?
) SELECT product_id,name,unit,ROUND(SUM(quantity),3) AS quantity,ROUND(SUM(total),2) AS total FROM events GROUP BY product_id,name,unit ORDER BY quantity DESC`;
export async function getHomeSummary() {
  const { start, end } = dayRange();
  return periodSalesTotals(start, end);
}

export async function getDailyReport(date = new Date()): Promise<DailyReport> {
  const db = await getDatabase();
  const { start, end } = dayRange(date);
  const totals = await periodSalesTotals(start, end);
  const paymentRows = await db.getAllAsync<{ type: string; amount: number }>(
    `WITH events AS (
      SELECT json_extract(value,'$.type') AS type,json_extract(value,'$.amount') AS amount FROM sales,json_each(sales.payments) WHERE date BETWEEN ? AND ?
      UNION ALL
      SELECT json_extract(value,'$.type'),-json_extract(value,'$.amount') FROM sale_adjustments,json_each(sale_adjustments.payments) WHERE date BETWEEN ? AND ?
    ) SELECT type,ROUND(SUM(amount),2) AS amount FROM events GROUP BY type`,
    start,
    end,
    start,
    end,
  );
  const byUser = await db.getAllAsync<{ user: string; total: number; count: number }>(
    `WITH events AS (
      SELECT seller_id,user,total,1 AS count FROM sales WHERE date BETWEEN ? AND ?
      UNION ALL
      SELECT s.seller_id,s.user,-a.amount,0 FROM sale_adjustments a JOIN sales s ON s.id=a.sale_id WHERE a.date BETWEEN ? AND ?
    ) SELECT COALESCE(u.username,e.user) AS user,ROUND(SUM(e.total),2) AS total,SUM(e.count) AS count FROM events e LEFT JOIN users u ON u.id=e.seller_id GROUP BY COALESCE('id:'||e.seller_id,'legacy:'||e.user) ORDER BY total DESC`,
    start,
    end,
    start,
    end,
  );
  const productRows = await db.getAllAsync<{
    name: string;
    unit: string;
    quantity: number;
    total: number;
  }>(PRODUCT_PERIOD_EVENTS, start, end, start, end);
  const byProduct = productRows.map(({ name, ...row }) => ({ product: name, ...row }));
  const amount = (type: string) => paymentRows.find((row) => row.type === type)?.amount ?? 0;
  return {
    totalSales: totals.totalSales,
    salesCount: totals.salesCount,
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
  if (type === 'sales') {
    type SalesExportRow = Record<string, SQLite.SQLiteBindValue> & { date: string };
    const sales = await db.getAllAsync<SalesExportRow>(
      "SELECT id,session_id,user,date,total,method,json_extract(settlement,'$.cashReceived') AS cash_received,json_extract(settlement,'$.changeDue') AS change_due,json_extract(settlement,'$.transferReceipt.ci') AS customer_ci,json_extract(settlement,'$.transferReceipt.fullName') AS customer_name,json_extract(settlement,'$.transferReceipt.address') AS customer_address,json_extract(settlement,'$.transferReceipt.amount') AS transfer_amount,json_extract(settlement,'$.transferReceipt.reference') AS transfer_reference,json_extract(settlement,'$.transferReceipt.receiptDate') AS receipt_date,json_extract(settlement,'$.transferReceipt.bank') AS receipt_bank,json_extract(settlement,'$.transferReceipt.beneficiary') AS receipt_beneficiary,json_extract(settlement,'$.transferReceipt.orderer') AS receipt_orderer,json_extract(settlement,'$.transferReceipt.currency') AS receipt_currency,json_extract(settlement,'$.transferReceipt.remainingBalance') AS receipt_remaining_balance,json_extract(settlement,'$.transferReceipt.status') AS receipt_status,json_extract(settlement,'$.transferReceipt.rawText') AS receipt_text FROM sales WHERE date BETWEEN ? AND ? ORDER BY date",
      start,
      end,
    );
    const adjustments = await db.getAllAsync<SalesExportRow>(
      `SELECT a.id AS adjustment_id,a.sale_id,a.session_id,s.user,a.date,-a.amount AS total,a.kind AS event,s.method,a.reason,a.actor_name AS registered_by,a.authorizer_name AS authorized_by FROM sale_adjustments a JOIN sales s ON s.id=a.sale_id WHERE a.date BETWEEN ? AND ? ORDER BY a.date`,
      start,
      end,
    );
    return [
      ...sales.map<SalesExportRow>((row) => ({
        ...row,
        sale_id: row.id,
        event: 'venta',
      })),
      ...adjustments,
    ].sort((a, b) => a.date.localeCompare(b.date));
  }
  if (type === 'movements')
    return db.getAllAsync<Record<string, SQLite.SQLiteBindValue>>(
      'SELECT * FROM movements WHERE date BETWEEN ? AND ? ORDER BY date',
      start,
      end,
    );
  if (type === 'inventory')
    return db.getAllAsync<Record<string, SQLite.SQLiteBindValue>>(
      'SELECT id,name,category,subcategory,unit,quantity_decimals,stock,price_cash,price_transfer FROM products ORDER BY name',
    );
  if (type === 'sold')
    return db.getAllAsync<Record<string, SQLite.SQLiteBindValue>>(
      PRODUCT_PERIOD_EVENTS,
      start,
      end,
      start,
      end,
    );
  const sessions = await db.getAllAsync<Record<string, SQLite.SQLiteBindValue>>(
    'SELECT s.*,c.detail AS closure_detail,c.authorized_by AS closure_authorized_by,c.date AS closure_date FROM cash_sessions s LEFT JOIN cash_closures c ON c.session_id=s.id ORDER BY s.id DESC',
  );
  return Promise.all(
    sessions.map(async (session) => ({
      ...session,
      withdrawals: json(
        await db.getAllAsync<CashWithdrawal>(
          'SELECT * FROM cash_withdrawals WHERE session_id=? ORDER BY id',
          session.id,
        ),
      ),
      difference_approvals: json(
        await db.getAllAsync<CashDifferenceApproval>(
          'SELECT * FROM cash_difference_approvals WHERE session_id=? ORDER BY id',
          session.id,
        ),
      ),
    })),
  );
}

export async function importProducts(
  rows: Array<Record<string, string | number | boolean | null | undefined>>,
  username: string,
  command?: MutationCommand,
) {
  const db = await getDatabase();
  return transaction(
    db,
    async () => {
      let imported = 0;
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
        if (
          ![stock, cash, transfer].every(Number.isFinite) ||
          stock < 0 ||
          cash < 0 ||
          transfer < 0
        )
          throw new Error(`Valores inválidos para ${name}.`);
        const unit = String(row.unit ?? 'u')
          .trim()
          .toLowerCase();
        const decimals =
          row.quantity_decimals === undefined
            ? fractionalUnit(unit)
              ? 3
              : 0
            : Number(row.quantity_decimals);
        if (!unit || ![0, 3].includes(decimals)) throw new Error(`Unidad inválida para ${name}.`);
        validateQuantity(stock, decimals, true);
        await consumeDemoQuota(db, 'products');
        const result = await db.runAsync(
          'INSERT INTO products(name,category,subcategory,unit,quantity_decimals,stock,price_cash,price_transfer,image_path) VALUES(?,?,?,?,?,?,?,?,NULL)',
          name,
          typeof row.category === 'string' ? row.category : '',
          typeof row.subcategory === 'string' ? row.subcategory : '',
          unit,
          decimals,
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
      return imported;
    },
    command,
    (value) => mutationCountSchema.parse(value),
  );
}

async function runFinanceMutation<T>(
  input: { commandId: string },
  username: string,
  adminOnly: boolean,
  action: (db: SQLite.SQLiteDatabase, actor: Usuario) => Promise<T>,
  parseResult: (value: unknown) => T,
  command?: MutationCommand,
): Promise<T> {
  const db = await getDatabase();
  const fingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    json([username, withoutSecrets(input)]),
  );
  return transaction(
    db,
    async () => {
      const actor = await Finance.financeActor(db, username, adminOnly);
      return Finance.financeCommand(
        db,
        input.commandId,
        fingerprint,
        () => action(db, actor),
        parseResult,
      );
    },
    command,
    parseResult,
  );
}
export function setProductCost(input: CostInput, username: string, command?: MutationCommand) {
  return runFinanceMutation(
    input,
    username,
    true,
    (db, actor) => Finance.setCost(db, input, actor),
    Finance.parseFinanceNumericResult,
    command,
  );
}
export function receiveCostedStock(
  input: PurchaseInput,
  username: string,
  command?: MutationCommand,
) {
  return runFinanceMutation(
    input,
    username,
    true,
    (db, actor) => Finance.receivePurchase(db, input, actor),
    Finance.parseFinanceNumericResult,
    command,
  );
}
export function registerConsumption(
  input: ConsumptionInput,
  username: string,
  command?: MutationCommand,
) {
  return runFinanceMutation(
    input,
    username,
    false,
    (db, actor) => {
      assertProductNotInDraft(input.productId);
      return Finance.consume(db, input, actor);
    },
    Finance.parseFinanceRecordResult,
    command,
  );
}
export function cancelConsumption(
  input: ConsumptionVoidInput,
  username: string,
  command?: MutationCommand,
) {
  return runFinanceMutation(
    input,
    username,
    false,
    (db, actor) => Finance.voidConsumption(db, input, actor),
    Finance.parseFinanceRecordResult,
    command,
  );
}
export function registerSaleAdjustment(
  input: SaleAdjustmentInput,
  username: string,
  command?: MutationCommand,
) {
  return runFinanceMutation(
    input,
    username,
    true,
    (db, actor) => Finance.adjustSale(db, input, actor),
    Finance.parseFinanceNumericResult,
    command,
  );
}
export function getFinanceReport(filter: FinanceFilter, username: string) {
  return consistentRead(async () => {
    const db = await getDatabase();
    await Finance.financeActor(db, username);
    return Finance.reportFinance(db, filter);
  });
}
export function getInvestmentData(username: string) {
  return consistentRead(async () => {
    const db = await getDatabase();
    await Finance.financeActor(db, username);
    return {
      products: await listProducts(),
      history: await db.getAllAsync<{
        id: number;
        product_id: number;
        date: string;
        old_cost: number | null;
        new_cost: number | null;
        method: string;
        reason: string;
        actor_name: string;
        quantity: number;
        purchase_cost: number | null;
      }>('SELECT * FROM cost_history ORDER BY id DESC'),
    };
  });
}
export function getConsumptionData(username: string) {
  return consistentRead(async () => {
    const db = await getDatabase();
    const actor = await Finance.financeActor(db, username, false);
    const rows = await db.getAllAsync<ConsumptionRecord>(
      'SELECT * FROM internal_consumptions WHERE (?=1 OR actor_id=?) ORDER BY date DESC',
      actor.role === 'admin' || actor.role === 'supervisor' ? 1 : 0,
      actor.id,
    );
    const events = await db.getAllAsync<{
      consumption_id: string;
      date: string;
      action: string;
      reason: string;
      actor_name: string;
      authorizer_name: string;
    }>(
      'SELECT consumption_id,date,action,reason,actor_name,authorizer_name FROM consumption_events ORDER BY id DESC',
    );
    return {
      rows:
        actor.role === 'admin'
          ? rows
          : rows.map((row) => ({ ...row, unit_cost: null, cost: null })),
      events: events.filter((e) => rows.some((r) => r.id === e.consumption_id)),
    };
  });
}
export function getFiscalData(filter: FiscalFilter, username: string) {
  return consistentRead(async () => Onat.readFiscalData(await getDatabase(), filter, username));
}
export async function getBusinessData(filter: BusinessFilter, username: string) {
  return consistentRead(async () =>
    Business.getBusinessData(await getDatabase(), username, filter),
  );
}
export async function getTransferData(username?: string) {
  return consistentRead(async () => {
    const data = await Business.getBusinessData(await getDatabase(), username ?? '');
    return {
      branches: data.branches,
      areas: data.areas,
      transfers: data.transfers,
      transferLines: data.transferLines,
    };
  });
}
export async function executeBusinessCommand(
  input: BusinessCommand,
  username: string,
  command?: MutationCommand,
): Promise<string> {
  const db = await getDatabase();
  return transaction(
    db,
    () => Business.executeBusinessCommand(db, input, username),
    command,
    (value) => parseOperationResult('executeBusinessCommand', value),
  );
}
export async function getSaleTicket(saleId: number) {
  if (!Number.isInteger(saleId) || saleId <= 0) throw new Error('Venta no válida.');
  return consistentRead(async () => Business.getSaleTicket(await getDatabase(), saleId));
}
export async function executeFiscalCommand(
  input: OnatCommand,
  username: string,
  command?: MutationCommand,
): Promise<string> {
  const db = await getDatabase();
  await Onat.fiscalActor(db, username);
  return transaction(
    db,
    () => Onat.executeFiscalCommand(db, input, username),
    command,
    (value) => parseOperationResult('executeFiscalCommand', value),
  );
}
export async function setFiscalPermission(
  userId: number,
  allowed: boolean,
  username: string,
  command?: MutationCommand,
) {
  const db = await getDatabase();
  await Onat.fiscalActor(db, username, true);
  return transaction(
    db,
    () => Onat.grantFiscalPermission(db, userId, allowed, username),
    command,
    (value) => mutationIdSchema.parse(value),
  );
}
export function setConsumptionPermission(
  userId: number,
  allowed: boolean,
  username: string,
  command?: MutationCommand,
) {
  return (async () => {
    const db = await getDatabase();
    return transaction(
      db,
      async () => {
        await Finance.financeActor(db, username);
        const target = await db.getFirstAsync<Usuario>('SELECT * FROM users WHERE id=?', userId);
        if (target?.role !== 'supervisor')
          throw new Error('El permiso se aplica únicamente a supervisores.');
        await db.runAsync(
          'UPDATE users SET can_authorize_consumption=? WHERE id=?',
          allowed ? 1 : 0,
          userId,
        );
        await db.runAsync(
          'INSERT INTO audit_log(action,username,entity_id,date,detail) VALUES(?,?,?,?,?)',
          'consumption.permission',
          username,
          userId,
          now(),
          json({ allowed }),
        );
        return userId;
      },
      command,
      (value) => mutationIdSchema.parse(value),
    );
  })();
}
