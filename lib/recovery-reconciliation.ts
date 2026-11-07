import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { DATABASE_VERSION } from '@/lib/database-migrations';
import { BUSINESS_V10_TABLES } from '@/lib/business-schema';
import { JOURNAL_EXCLUDED_TABLES, planRecoveryReplay } from '@/lib/recovery-journal';

export interface RecoveryTableDifference {
  table: string;
  currentRows: number;
  backupRows: number;
  status: 'equal' | 'different';
}
export interface RecoveryReconciliation {
  canRestore: boolean;
  tables: RecoveryTableDifference[];
  confirmedReceipts: number;
  backupReceipts: number;
  replayEntries: number;
}

// Device runtime and private recovery evidence never roll back. The journal
// is not a LAN replica and must not be exported with commercial data.
export const RECOVERY_RUNTIME_TABLES = JOURNAL_EXCLUDED_TABLES;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export async function verifyRecoveryDatabase(db: SQLiteDatabase, authorityId: string) {
  const checks = await db.getAllAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  const foreignKeys = await db.getAllAsync('PRAGMA foreign_key_check');
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const identity = await db.getFirstAsync<{ authority_id: string; revision: number }>(
    'SELECT authority_id,revision FROM sync_state WHERE id=1',
  );
  if (
    !authorityId ||
    checks.length !== 1 ||
    checks[0]?.integrity_check !== 'ok' ||
    foreignKeys.length ||
    version?.user_version !== DATABASE_VERSION ||
    identity?.authority_id !== authorityId ||
    !Number.isSafeInteger(identity.revision) ||
    identity.revision < 0
  )
    throw new Error('La base no superó la verificación. Se mantienen bloqueadas las operaciones.');
}

async function rowsForComparison(db: SQLiteDatabase, table: string) {
  let query = `SELECT * FROM ${quote(table)}`;
  if (table === 'settings') query += " WHERE key NOT LIKE 'private_backup:%'";
  if (table === 'audit_log') query += " WHERE action NOT IN ('recovery.backup','recovery.restore')";
  const rows = await db.getAllAsync<Record<string, unknown>>(query);
  // Canonicalize columns and row order; no values, passwords or hashes are
  // returned to the UI. Blob data is normalized instead of silently omitted.
  const encoded = rows
    .map((row) =>
      JSON.stringify(
        Object.keys(row)
          .sort()
          .map((key) => {
            const value = row[key];
            return [key, value instanceof Uint8Array ? Array.from(value) : value];
          }),
      ),
    )
    .sort();
  return {
    count: rows.length,
    digest: await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(encoded),
    ),
  };
}

async function emptyComparison() {
  return {
    count: 0,
    digest: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, '[]'),
  };
}

export async function reconcileRecoveryDatabases(
  current: SQLiteDatabase,
  backup: SQLiteDatabase,
): Promise<RecoveryReconciliation> {
  const backupVersion = await backup.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const legacy = backupVersion?.user_version === 8;
  // v10 adds only new (initially empty) business tables. Before v10 those
  // objects are excluded from the current schema; rows still have to match.
  const preBusiness = legacy || backupVersion?.user_version === 9;
  const v10Tables = BUSINESS_V10_TABLES.map((table) => `'${table}'`).join(',');
  // v9 adds only private journal structures. A v8 backup must otherwise have
  // exactly the existing schema; do not hide unexpected objects in the backup.
  const schemaQuery =
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'";
  const currentSchema = await current.getAllAsync(
    schemaQuery +
      (legacy
        ? " AND tbl_name NOT IN ('recovery_journal','recovery_lineage') AND name NOT LIKE 'recovery_capture_%'"
        : '') +
      (preBusiness ? ` AND tbl_name NOT IN (${v10Tables})` : '') +
      ' ORDER BY type,name',
  );
  const backupSchema = await backup.getAllAsync(schemaQuery + ' ORDER BY type,name');
  if (JSON.stringify(currentSchema) !== JSON.stringify(backupSchema))
    throw new Error('La estructura de la copia no coincide con la instalación. No se restaurará.');
  const names = await current.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  const tables: RecoveryTableDifference[] = [];
  for (const { name } of names) {
    if (RECOVERY_RUNTIME_TABLES.has(name)) continue;
    const a = await rowsForComparison(current, name);
    const b =
      preBusiness && BUSINESS_V10_TABLES.some((table) => table === name)
        ? await emptyComparison()
        : await rowsForComparison(backup, name);
    tables.push({
      table: name,
      currentRows: a.count,
      backupRows: b.count,
      status: a.digest === b.digest ? 'equal' : 'different',
    });
  }
  const currentReceipts = await current.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM network_commands',
  );
  const backupReceipts = await backup.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM network_commands',
  );
  const equal = tables.every((table) => table.status === 'equal');
  if (legacy && !equal)
    throw new Error(
      'La copia v8 difiere de los datos actuales y no tiene historial para conciliarlos. Se conservan ambas bases.',
    );
  const replay = equal ? null : await planRecoveryReplay(current, backup);
  return {
    canRestore: equal || (replay !== null && replay.entries > 0),
    replayEntries: replay?.entries ?? 0,
    tables,
    confirmedReceipts: currentReceipts?.count ?? 0,
    backupReceipts: backupReceipts?.count ?? 0,
  };
}

export async function preserveRecoveryRuntime(
  current: SQLiteDatabase,
  destination: SQLiteDatabase,
) {
  // Called only with triggers suspended on an isolated candidate after verified
  // row replay. Full business equality is required again before activation.
  for (const table of [...RECOVERY_RUNTIME_TABLES, 'settings', 'audit_log']) {
    const exists = await current.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      table,
    );
    if (!exists) continue;
    const rows = await current.getAllAsync<Record<string, string | number | null | Uint8Array>>(
      `SELECT * FROM ${quote(table)}`,
    );
    await destination.runAsync(`DELETE FROM ${quote(table)}`);
    for (const row of rows) {
      const columns = Object.keys(row);
      await destination.runAsync(
        `INSERT INTO ${quote(table)}(${columns.map(quote).join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
        columns.map((key) => row[key]),
      );
    }
  }
}
