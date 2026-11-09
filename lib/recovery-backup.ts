import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { z } from 'zod';
import { DATABASE_VERSION } from '@/lib/database-migrations';

export const recoveryBackupSchema = z
  .object({
    id: z.string().uuid(),
    fileName: z.string().regex(/^mipypos\.recovery\.[0-9a-f-]{36}\.db$/),
    createdAt: z.string().datetime(),
    schemaVersion: z.number().int().nonnegative(),
    authorityId: z.string().min(1),
  })
  .refine((copy) => copy.fileName === `mipypos.recovery.${copy.id}.db`, {
    message: 'El archivo no corresponde al identificador de la copia.',
  });
export type RecoveryBackup = z.infer<typeof recoveryBackupSchema>;

export interface RecoveryBackupInspection {
  backup: RecoveryBackup;
  verifiedAt: string;
  revision: number;
  sales: number;
  products: number;
  cashSessions: number;
  commandReceipts: number;
  recovery?: {
    status: 'equal' | 'forward' | 'blocked';
    replayEntries: number;
    reason?: string;
  };
}

// Verification never opens a missing path (SQLite would create an empty database).
// It does not restore, migrate, export or alter the credential-bearing snapshot.
export async function inspectRecoverySnapshot(
  metadata: RecoveryBackup,
  expectedAuthorityId: string,
): Promise<RecoveryBackupInspection> {
  const parsed = recoveryBackupSchema.safeParse(metadata);
  if (!parsed.success) throw new Error('El registro de la copia necesita revisión.');
  const copy = parsed.data;
  if (copy.authorityId !== expectedAuthorityId)
    throw new Error('La copia pertenece a otra autoridad. No se utilizará.');
  if (
    copy.schemaVersion !== 8 &&
    copy.schemaVersion !== 9 &&
    copy.schemaVersion !== 10 &&
    copy.schemaVersion !== DATABASE_VERSION
  )
    throw new Error('Esta copia necesita revisión de compatibilidad antes de recuperarla.');
  const directory = Platform.OS === 'web' ? null : new Directory(Paths.document, 'SQLite');
  if (!directory)
    throw new Error('Comprueba la copia en el teléfono donde fue creada.');
  if (!new File(directory, copy.fileName).exists)
    throw new Error('No se encontró el archivo de la copia. Su registro se conserva.');
  const source = await SQLite.openDatabaseAsync(copy.fileName, { useNewConnection: true });
  try {
    await source.execAsync('PRAGMA query_only=ON');
    const checks = await source.getAllAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    const foreignKeys = await source.getAllAsync('PRAGMA foreign_key_check');
    const version = await source.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const identity = await source.getFirstAsync<{ authority_id: string; revision: number }>(
      'SELECT authority_id,revision FROM sync_state WHERE id=1',
    );
    if (
      checks.length !== 1 ||
      checks[0]?.integrity_check !== 'ok' ||
      foreignKeys.length ||
      version?.user_version !== copy.schemaVersion ||
      identity?.authority_id !== expectedAuthorityId ||
      !Number.isSafeInteger(identity.revision) ||
      identity.revision < 0
    )
      throw new Error('La copia no superó la comprobación. Se conserva sin modificar.');
    const totals = await source.getFirstAsync<{
      sales: number;
      products: number;
      cashSessions: number;
      commandReceipts: number;
    }>(`SELECT
      (SELECT COUNT(*) FROM sales) AS sales,
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM cash_sessions) AS cashSessions,
      (SELECT COUNT(*) FROM network_commands) AS commandReceipts`);
    if (!totals) throw new Error('No se pudo comprobar el contenido de la copia.');
    return {
      backup: copy,
      verifiedAt: new Date().toISOString(),
      revision: identity.revision,
      ...totals,
    };
  } catch (error) {
    throw new Error('No se pudo verificar la copia. El archivo y su registro se conservan.', {
      cause: error,
    });
  } finally {
    await source.closeAsync();
  }
}

// Caller must hold the application mutation queue, but NOT a write transaction:
// SQLite Backup cannot copy a source connection with an active write transaction.
// These credential-bearing files stay inside SQLite's private app directory.
export async function createRecoverySnapshot(
  source: SQLite.SQLiteDatabase,
): Promise<RecoveryBackup> {
  const version = await source.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version?.user_version !== DATABASE_VERSION)
    throw new Error('Completa la actualización antes de crear una copia.');
  const identity = await source.getFirstAsync<{ authority_id: string }>(
    'SELECT authority_id FROM sync_state WHERE id=1',
  );
  if (!identity?.authority_id) throw new Error('No se pudo verificar la identidad de los datos.');
  const id = Crypto.randomUUID();
  const metadata: RecoveryBackup = {
    id,
    fileName: `mipypos.recovery.${id}.db`,
    createdAt: new Date().toISOString(),
    schemaVersion: version.user_version,
    authorityId: identity.authority_id,
  };
  const destination = await SQLite.openDatabaseAsync(metadata.fileName, { useNewConnection: true });
  try {
    const existing = await destination.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type='table' LIMIT 1",
    );
    if (existing)
      throw new Error('Ya existe una copia con ese identificador. No se sobrescribirá.');
    await SQLite.backupDatabaseAsync({ sourceDatabase: source, destDatabase: destination });
    const integrity = await destination.getFirstAsync<{ integrity_check: string }>(
      'PRAGMA integrity_check',
    );
    const foreignKeys = await destination.getAllAsync('PRAGMA foreign_key_check');
    const copiedVersion = await destination.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    const copiedIdentity = await destination.getFirstAsync<{ authority_id: string }>(
      'SELECT authority_id FROM sync_state WHERE id=1',
    );
    if (
      integrity?.integrity_check !== 'ok' ||
      foreignKeys.length ||
      copiedVersion?.user_version !== metadata.schemaVersion ||
      copiedIdentity?.authority_id !== metadata.authorityId
    )
      throw new Error(
        'La copia no superó la comprobación de integridad. No se usará para recuperar datos.',
      );
    return metadata;
  } finally {
    // Never delete an uncertain or failed snapshot automatically.
    await destination.closeAsync();
  }
}
