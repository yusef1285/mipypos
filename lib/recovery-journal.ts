import type { SQLiteDatabase, SQLiteBindValue } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';

// Private recovery evidence only. Never included in LAN snapshots or portable
// business exports: row images can contain credentials and fiscal attachments.
export const JOURNAL_EXCLUDED_TABLES = new Set([
  'recovery_journal',
  'recovery_lineage',
  'login_attempts',
  'network_events',
  'network_replica',
  'sync_state',
  'sqlite_sequence',
]);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export interface RecoveryJournalEntry {
  seq: number;
  operation_id: string;
  table_name: string;
  before_row: string | null;
  after_row: string | null;
  recorded_at: string;
}
interface Column {
  name: string;
  pk: number;
}
type Row = Record<string, SQLiteBindValue>;
const PAGE_SIZE = 250;

export async function assertRecoveryJournalAvailable(db: SQLiteDatabase) {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version?.user_version !== 9) return;
  const evidence = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('recovery_journal','recovery_lineage')",
  );
  const lineage =
    evidence.length === 2
      ? await db.getFirstAsync<{ epoch: string }>('SELECT epoch FROM recovery_lineage WHERE id=1')
      : null;
  if (!lineage?.epoch)
    throw new Error(
      'Falta el historial de recuperación de esta instalación. No se creará otro silenciosamente.',
    );
  await journalSize(db);
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  for (const { name } of tables) {
    if (JOURNAL_EXCLUDED_TABLES.has(name)) continue;
    for (const event of ['insert', 'update', 'delete']) {
      if (
        !(await db.getFirstAsync(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name=? AND tbl_name=?",
          `recovery_capture_${name}_${event}`,
          name,
        ))
      )
        throw new Error(
          'Falta una protección del historial de recuperación. Se conserva la base para revisión.',
        );
    }
  }
}

export async function migrateRecoveryJournal(db: SQLiteDatabase) {
  await assertRecoveryJournalAvailable(db);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS recovery_lineage (
      id INTEGER PRIMARY KEY CHECK(id=1), epoch TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS recovery_journal (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL UNIQUE,
      table_name TEXT NOT NULL,
      before_row TEXT,
      after_row TEXT,
      recorded_at TEXT NOT NULL,
      CHECK(before_row IS NOT NULL OR after_row IS NOT NULL));
    CREATE TRIGGER IF NOT EXISTS recovery_journal_no_update BEFORE UPDATE ON recovery_journal
      BEGIN SELECT RAISE(ABORT,'El historial de recuperación no se modifica.'); END;
    CREATE TRIGGER IF NOT EXISTS recovery_journal_no_delete BEFORE DELETE ON recovery_journal
      BEGIN SELECT RAISE(ABORT,'El historial de recuperación no se elimina.'); END;
    CREATE TRIGGER IF NOT EXISTS recovery_lineage_no_update BEFORE UPDATE ON recovery_lineage
      BEGIN SELECT RAISE(ABORT,'La identidad de recuperación no se modifica.'); END;
    CREATE TRIGGER IF NOT EXISTS recovery_lineage_no_delete BEFORE DELETE ON recovery_lineage
      BEGIN SELECT RAISE(ABORT,'La identidad de recuperación no se elimina.'); END;
  `);
  await db.runAsync(
    'INSERT OR IGNORE INTO recovery_lineage(id,epoch) VALUES(1,?)',
    Crypto.randomUUID(),
  );
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  for (const { name } of tables) {
    if (JOURNAL_EXCLUDED_TABLES.has(name)) continue;
    const columns = await db.getAllAsync<Column>(`PRAGMA table_info(${quote(name)})`);
    if (!columns.some((column) => column.pk))
      throw new Error('Una tabla no tiene identificadores seguros para recuperación.');
    const image = (row: 'OLD' | 'NEW') =>
      `json_object(${columns
        .map(({ name: field }) => {
          const value = `${row}.${quote(field)}`;
          return `'${field.replaceAll("'", "''")}',CASE WHEN typeof(${value})='blob' THEN json_object('$blob',hex(${value})) ELSE ${value} END`;
        })
        .join(',')})`;
    for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const row = event === 'DELETE' ? 'OLD' : 'NEW';
      const conditions: string[] = [];
      if (name === 'settings') conditions.push(`${row}.key NOT LIKE 'private_backup:%'`);
      if (name === 'audit_log')
        conditions.push(`${row}.action NOT IN ('recovery.backup','recovery.restore')`);
      if (event === 'UPDATE')
        conditions.push(
          `(${columns.map(({ name: field }) => `OLD.${quote(field)} IS NOT NEW.${quote(field)}`).join(' OR ')})`,
        );
      const triggerName = `recovery_capture_${name}_${event.toLowerCase()}`;
      await db.execAsync(`CREATE TRIGGER IF NOT EXISTS ${quote(triggerName)}
        AFTER ${event} ON ${quote(name)} ${conditions.length ? `WHEN ${conditions.join(' AND ')}` : ''}
        BEGIN INSERT INTO recovery_journal(operation_id,table_name,before_row,after_row,recorded_at)
        VALUES(lower(hex(randomblob(16))),'${name.replaceAll("'", "''")}',${event === 'INSERT' ? 'NULL' : image('OLD')},${event === 'DELETE' ? 'NULL' : image('NEW')},strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;`);
    }
  }
}

async function journalSize(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ count: number; last: number }>(
    'SELECT COUNT(*) AS count,COALESCE(MAX(seq),0) AS last FROM recovery_journal',
  );
  if (!row || !Number.isSafeInteger(row.last) || row.last < 0 || row.count !== row.last)
    throw new Error('El historial de recuperación está incompleto. Se conservan ambas bases.');
  return row.last;
}
async function page(db: SQLiteDatabase, after: number, until: number) {
  return db.getAllAsync<RecoveryJournalEntry>(
    'SELECT * FROM recovery_journal WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?',
    after,
    until,
    PAGE_SIZE,
  );
}

// A shared authority is not enough: prove the entire recorded prefix matches.
// There is no last-write-wins, inferred deletion or replay of financial commands.
export async function planRecoveryReplay(current: SQLiteDatabase, backup: SQLiteDatabase) {
  const a = await current.getFirstAsync<{ epoch: string }>(
    'SELECT epoch FROM recovery_lineage WHERE id=1',
  );
  const b = await backup.getFirstAsync<{ epoch: string }>(
    'SELECT epoch FROM recovery_lineage WHERE id=1',
  );
  if (!a?.epoch || a.epoch !== b?.epoch)
    throw new Error('Las copias no comparten un historial de recuperación verificable.');
  const last = await journalSize(current);
  const base = await journalSize(backup);
  if (base > last)
    throw new Error('La copia tiene operaciones que no están en la base actual. No se fusionará.');
  let cursor = 0;
  while (cursor < base) {
    const left = await page(current, cursor, base);
    const right = await page(backup, cursor, base);
    if (!left.length || JSON.stringify(left) !== JSON.stringify(right))
      throw new Error(
        'Los historiales de recuperación divergen. No se sobrescribirán operaciones.',
      );
    cursor = left[left.length - 1].seq;
  }
  return { base, last, entries: last - base };
}

function decodeImage(encoded: string): Row {
  const value: unknown = JSON.parse(encoded);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Registro de recuperación inválido.');
  const row: Row = {};
  for (const [key, field] of Object.entries(value)) {
    if (
      field === null ||
      typeof field === 'string' ||
      (typeof field === 'number' && Number.isFinite(field))
    )
      row[key] = field;
    else if (
      field &&
      typeof field === 'object' &&
      '$blob' in field &&
      typeof field.$blob === 'string' &&
      /^(?:[0-9A-F]{2})*$/.test(field.$blob)
    ) {
      const hex = field.$blob;
      row[key] = Uint8Array.from({ length: hex.length / 2 }, (_, index) =>
        Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
      );
    } else throw new Error('Registro de recuperación inválido.');
  }
  return row;
}
function canonical(row: Row | null) {
  return row === null
    ? 'null'
    : JSON.stringify(
        Object.keys(row)
          .sort()
          .map((key) => [key, row[key] instanceof Uint8Array ? Array.from(row[key]) : row[key]]),
      );
}

async function applyImage(
  destination: SQLiteDatabase,
  entry: RecoveryJournalEntry,
  columns: Column[],
) {
  const before = entry.before_row === null ? null : decodeImage(entry.before_row);
  const after = entry.after_row === null ? null : decodeImage(entry.after_row);
  const names = columns.map(({ name }) => name).sort();
  for (const row of [before, after]) {
    if (row && JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(names))
      throw new Error('El historial no coincide con las columnas de la copia.');
  }
  const reference = before ?? after;
  const keys = columns
    .filter(({ pk }) => pk)
    .sort((a, b) => a.pk - b.pk)
    .map(({ name }) => name);
  if (!reference || !keys.length)
    throw new Error('Falta el identificador de una operación de recuperación.');
  const where = keys.map((key) => `${quote(key)} IS ?`).join(' AND ');
  const stored = await destination.getFirstAsync<Row>(
    `SELECT * FROM ${quote(entry.table_name)} WHERE ${where}`,
    keys.map((key) => reference[key]),
  );
  if (canonical(stored) !== canonical(before))
    throw new Error('La copia no coincide con el estado anterior registrado. No se activará.');
  if (before)
    await destination.runAsync(
      `DELETE FROM ${quote(entry.table_name)} WHERE ${where}`,
      keys.map((key) => before[key]),
    );
  if (after)
    await destination.runAsync(
      `INSERT INTO ${quote(entry.table_name)}(${names.map(quote).join(',')}) VALUES(${names.map(() => '?').join(',')})`,
      names.map((key) => after[key]),
    );
}

// Only call for an isolated, inactive generation. Remove triggers in its own
// transaction to prevent row images from executing stock/cash effects twice.
// Neither the live database nor the source snapshot is ever written here.
export async function reconcileRecoveryCandidate(
  current: SQLiteDatabase,
  destination: SQLiteDatabase,
  preserveRuntimeAndAudit: () => Promise<void>,
  legacyEqualState = false,
) {
  const plan = legacyEqualState
    ? { base: 0, last: 0, entries: 0 }
    : await planRecoveryReplay(current, destination);
  const triggers = await destination.getAllAsync<{ name: string; sql: string }>(
    "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name",
  );
  const tables = await destination.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  );
  const columns = new Map<string, Column[]>();
  for (const { name } of tables) {
    if (!JOURNAL_EXCLUDED_TABLES.has(name))
      columns.set(name, await destination.getAllAsync<Column>(`PRAGMA table_info(${quote(name)})`));
  }
  await destination.execAsync('PRAGMA foreign_keys=OFF');
  try {
    await destination.withTransactionAsync(async () => {
      for (const trigger of triggers)
        await destination.execAsync(`DROP TRIGGER ${quote(trigger.name)}`);
      let cursor = plan.base;
      while (cursor < plan.last) {
        const entries = await page(current, cursor, plan.last);
        if (!entries.length) throw new Error('Faltan operaciones en el historial de recuperación.');
        for (const entry of entries) {
          const fields = columns.get(entry.table_name);
          if (entry.seq !== cursor + 1 || !fields || !/^[0-9a-f]{32}$/.test(entry.operation_id))
            throw new Error('El historial contiene una operación de recuperación inválida.');
          await applyImage(destination, entry, fields);
          cursor = entry.seq;
        }
      }
      await preserveRuntimeAndAudit();
      for (const trigger of triggers) await destination.execAsync(trigger.sql);
      if ((await destination.getAllAsync('PRAGMA foreign_key_check')).length)
        throw new Error(
          'La conciliación contiene referencias incompletas. Se conserva el original.',
        );
    });
  } finally {
    await destination.execAsync('PRAGMA foreign_keys=ON');
  }
  return plan.entries;
}
