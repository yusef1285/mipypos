import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';
import { getSecret, setSecret, supportsSecretStorage } from '@/lib/network/secure-storage';

const SECRET_KEY = 'mipypos.recovery.identity.v1';
const WITNESS_KEY = 'mipypos.recovery.identity.witness.v1';
const schema = z.discriminatedUnion('phase', [
  z.object({ version: z.literal(1), phase: z.literal('opening') }).strict(),
  z
    .object({ version: z.literal(1), phase: z.literal('ready'), authorityId: z.string().min(1) })
    .strict(),
]);
export type DatabaseAnchor = z.infer<typeof schema>;
const unavailable = (cause?: unknown) =>
  new Error(
    'La identidad de recuperación necesita revisión. No se creará ni reemplazará tu base de datos.',
    { cause },
  );

// The witness detects a missing secure record. Neither record contains a
// password, license or transaction payload. Never recreate missing evidence.
export async function loadDatabaseAnchor(): Promise<DatabaseAnchor | null> {
  if (!supportsSecretStorage()) return null;
  const [raw, witness] = await Promise.all([
    getSecret(SECRET_KEY),
    AsyncStorage.getItem(WITNESS_KEY),
  ]);
  if (raw === null && witness === null) return null;
  if (raw === null || witness !== 'present') throw unavailable();
  try {
    return schema.parse(JSON.parse(raw));
  } catch (cause) {
    throw unavailable(cause);
  }
}
async function writeAnchor(anchor: DatabaseAnchor) {
  const encoded = JSON.stringify(schema.parse(anchor));
  await AsyncStorage.setItem(WITNESS_KEY, 'present');
  if ((await AsyncStorage.getItem(WITNESS_KEY)) !== 'present') throw unavailable();
  await setSecret(SECRET_KEY, encoded);
}

// Reserve first creation before SQLite can create a file. A crash before file
// creation remains visible and must not masquerade as a clean installation.
export async function reserveDatabaseCreation() {
  if (!supportsSecretStorage()) return;
  if (await loadDatabaseAnchor()) throw unavailable();
  await writeAnchor({ version: 1, phase: 'opening' });
}

export async function assertDatabaseIdentity(db: SQLiteDatabase, authorityId?: string) {
  if (!supportsSecretStorage()) return;
  const anchor = await loadDatabaseAnchor();
  const expected = anchor?.phase === 'ready' ? anchor.authorityId : authorityId;
  if (anchor?.phase === 'ready' && authorityId && authorityId !== anchor.authorityId)
    throw unavailable();
  if (!expected) return;
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const identityTable = await db.getFirstAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_state'",
  );
  if (!identityTable || !version || version.user_version === 0) throw unavailable();
  const identity = await db.getFirstAsync<{ authority_id: string }>(
    'SELECT authority_id FROM sync_state WHERE id=1',
  );
  if (identity?.authority_id !== expected) throw unavailable();
}

// Call only after schema and seeds commit. A failed anchor write fails startup;
// the next attempt verifies the existing database instead of clearing it.
export async function confirmDatabaseIdentity(db: SQLiteDatabase) {
  if (!supportsSecretStorage()) return;
  await assertDatabaseIdentity(db);
  const identity = await db.getFirstAsync<{ authority_id: string }>(
    'SELECT authority_id FROM sync_state WHERE id=1',
  );
  if (!identity?.authority_id) throw unavailable();
  const anchor = await loadDatabaseAnchor();
  if (anchor?.phase === 'ready') return;
  await writeAnchor({ version: 1, phase: 'ready', authorityId: identity.authority_id });
}
