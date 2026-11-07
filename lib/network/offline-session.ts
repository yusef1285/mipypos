import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { createPasswordHash, isPasswordHash, verifyPassword } from '@/lib/password';
import { getSecret, removeSecret, setSecret } from '@/lib/network/secure-storage';
import { networkSessionSchema } from '@/lib/network/validation';
import type { NetworkSession } from '@/lib/network/types';

/**
 * Offline sign-in for terminals. After a successful sign-in on the administrator,
 * the terminal keeps a salted PBKDF2 verifier (never the password) in secure
 * storage. While the administrator is unreachable the same user can open a
 * sales-only session for OFFLINE_DAYS; queued sales are confirmed later with a
 * real host session.
 */
export const OFFLINE_DAYS = 7;
const recordSchema = z
  .object({
    version: z.literal(1),
    hostPin: z.string().min(1),
    user: networkSessionSchema.shape.user,
    hash: z.string().refine(isPasswordHash),
    savedAt: z.string().datetime(),
  })
  .strict();
type OfflineRecord = z.infer<typeof recordSchema>;
export type OfflineUser = NetworkSession['user'];

async function keyFor(hostPin: string, username: string) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(['mipypos-offline-login-v1', hostPin, username.trim().toLocaleLowerCase()]),
  );
  return `mipypos.offline.login.${digest.slice(0, 40)}`;
}

export async function rememberOfflineLogin(
  hostPin: string | undefined,
  user: OfflineUser,
  password: string,
  now = new Date(),
) {
  if (!hostPin || !password) return;
  const record: OfflineRecord = {
    version: 1,
    hostPin,
    user,
    hash: await createPasswordHash(password),
    savedAt: now.toISOString(),
  };
  await setSecret(await keyFor(hostPin, user.username), JSON.stringify(record));
}

export async function forgetOfflineLogin(hostPin: string | undefined, username: string) {
  if (!hostPin || !username) return;
  await removeSecret(await keyFor(hostPin, username));
}

export async function verifyOfflineLogin(
  hostPin: string | undefined,
  username: string,
  password: string,
  now = Date.now(),
): Promise<OfflineUser | null> {
  if (!hostPin || !username || !password) return null;
  const raw = await getSecret(await keyFor(hostPin, username));
  if (!raw) return null;
  let record: OfflineRecord;
  try {
    record = recordSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
  if (record.hostPin !== hostPin) return null;
  const age = now - Date.parse(record.savedAt);
  if (age < -5 * 60_000 || age > OFFLINE_DAYS * 86_400_000)
    throw new Error(
      `Este usuario lleva más de ${OFFLINE_DAYS} días sin conectarse al administrador. Conéctate a su Wi-Fi para iniciar sesión.`,
    );
  if (!(await verifyPassword(password, record.hash))) return null;
  return record.user;
}
