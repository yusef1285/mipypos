import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';

import { migrateBusiness } from '@/lib/business-schema';
import { assertRecoveryJournalAvailable, installRecoveryJournal } from '@/lib/recovery-journal';

export const DATABASE_VERSION = 10;

// The SQLite backup API includes committed WAL pages. Copies stay in the private
// database directory; never export this credential-bearing recovery database.
export async function prepareMigrationBackup(db: SQLite.SQLiteDatabase) {
  const version =
    (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (version > DATABASE_VERSION)
    throw new Error('Esta base de datos necesita una versión más reciente de MipyPOS.');
  await assertRecoveryJournalAvailable(db);
  const existing = await db.getFirstAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (version === DATABASE_VERSION || !existing) return;
  const destination = await SQLite.openDatabaseAsync(`mipypos.pre-v${version}.db`);
  try {
    // A failed migration can be retried after the source changes. Never replace
    // the original recovery evidence with the newer (possibly damaged) source.
    const saved = await destination.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    );
    if (saved) {
      const savedVersion = await destination.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version',
      );
      const integrity = await destination.getFirstAsync<{ integrity_check: string }>(
        'PRAGMA integrity_check',
      );
      if (savedVersion?.user_version !== version || integrity?.integrity_check !== 'ok')
        throw new Error('La copia original necesita revisión. Se conserva sin sobrescribirla.');
      return;
    }
    const otherTables = await destination.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
    );
    if (otherTables)
      throw new Error('La copia existente está incompleta. Se conserva sin sobrescribirla.');
    await SQLite.backupDatabaseAsync({ sourceDatabase: db, destDatabase: destination });
    const check = await destination.getFirstAsync<{ integrity_check: string }>(
      'PRAGMA integrity_check',
    );
    if (check?.integrity_check !== 'ok')
      throw new Error('La copia de recuperación no superó la comprobación de integridad.');
  } catch (error) {
    throw new Error('No se pudo preparar una copia segura. La actualización no continuará.', {
      cause: error,
    });
  } finally {
    await destination.closeAsync();
  }
}

// Call only inside the main migration transaction, after the v6 migration.
export async function migrateHardening(db: SQLite.SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(sales)');
  if (!columns.some((c) => c.name === 'legacy_card')) {
    await db.execAsync(
      'ALTER TABLE sales ADD COLUMN legacy_card INTEGER NOT NULL DEFAULT 0 CHECK(legacy_card IN (0,1))',
    );
    // Mark, do not convert or erase, historical card transactions.
    await db.execAsync(`UPDATE sales SET legacy_card=1 WHERE method='card' OR
      (json_valid(payments) AND EXISTS(SELECT 1 FROM json_each(sales.payments) WHERE json_extract(value,'$.type')='card'));`);
  }
  if (!columns.some((c) => c.name === 'pricing_basis'))
    await db.execAsync(
      "ALTER TABLE sales ADD COLUMN pricing_basis TEXT CHECK(pricing_basis IS NULL OR pricing_basis IN ('cash','transfer'))",
    );
  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS reject_new_card_sale BEFORE INSERT ON sales
    WHEN NEW.legacy_card=0 AND (NEW.method='card' OR
      EXISTS(SELECT 1 FROM json_each(NEW.payments) WHERE json_extract(value,'$.type')='card'))
    BEGIN SELECT RAISE(ABORT,'No se permiten nuevos pagos con tarjeta.'); END;
    CREATE TRIGGER IF NOT EXISTS reject_card_sale_edit BEFORE UPDATE OF method,payments ON sales
    WHEN OLD.legacy_card=0 AND (NEW.method='card' OR
      EXISTS(SELECT 1 FROM json_each(NEW.payments) WHERE json_extract(value,'$.type')='card'))
    BEGIN SELECT RAISE(ABORT,'No se permiten nuevos pagos con tarjeta.'); END;
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK(id=1), authority_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>=0));
    CREATE TABLE IF NOT EXISTS network_replica (
      cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, confirmed_at TEXT NOT NULL);
  `);
  await db.runAsync(
    `INSERT OR IGNORE INTO sync_state(id,authority_id,revision)
    SELECT 1,?,COALESCE(MAX(id),0) FROM network_events`,
    Crypto.randomUUID(),
  );
  // Revisions follow actual shared row changes, even if a future service bypasses
  // transaction(). Trigger updates roll back with the mutation; replays and reads
  // do not invalidate the catalog. sync_state is device-local, never imported.
  const tables = [
    'users',
    'products',
    'areas',
    'area_stock',
    'sales',
    'sale_lines',
    'cash_sessions',
    'cash_withdrawals',
    'cash_closures',
    'cash_difference_approvals',
    'movements',
    'cost_history',
    'internal_consumptions',
    'consumption_events',
    'sale_adjustments',
    'fiscal_profiles',
    'fiscal_rules',
    'fiscal_records',
  ];
  for (const table of tables) {
    const fields = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    const changed = fields.map((f) => `OLD."${f.name}" IS NOT NEW."${f.name}"`).join(' OR ');
    for (const event of ['INSERT', 'DELETE', 'UPDATE'] as const)
      await db.execAsync(`CREATE TRIGGER IF NOT EXISTS sync_${table}_${event.toLowerCase()}
        AFTER ${event} ON ${table} ${event === 'UPDATE' ? `WHEN ${changed}` : ''}
        BEGIN UPDATE sync_state SET revision=revision+1 WHERE id=1; END;`);
  }
  for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
    const row = event === 'DELETE' ? 'OLD' : 'NEW';
    await db.execAsync(`CREATE TRIGGER IF NOT EXISTS sync_license_${event.toLowerCase()}
      AFTER ${event} ON settings WHEN ${row}.key='license_mode' ${event === 'UPDATE' ? 'AND OLD.value IS NOT NEW.value' : ''}
      BEGIN UPDATE sync_state SET revision=revision+1 WHERE id=1; END;`);
  }
  // Verify v9 evidence before adding v10 tables; the install step then extends
  // the journal to the new tables without re-checking them as pre-existing.
  await assertRecoveryJournalAvailable(db);
  await migrateBusiness(db);
  const foreignErrors = await db.getAllAsync('PRAGMA foreign_key_check');
  if (foreignErrors.length)
    throw new Error(
      'Hay referencias incompletas en la base de datos. Restaura una copia antes de continuar.',
    );
  await installRecoveryJournal(db);
  await db.execAsync(`PRAGMA user_version=${DATABASE_VERSION}`);
}
