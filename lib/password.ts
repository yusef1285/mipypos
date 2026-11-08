import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import * as Crypto from 'expo-crypto';
import { NativeModules } from 'react-native';

// Stored format: pbkdf2-sha256$<iterations>$<salt hex>$<derived hex>. The
// iteration count travels with each hash so it can be raised later; accounts
// are upgraded transparently on their next successful login.
export const PASSWORD_ITERATIONS = 310_000;
export const DEFAULT_ADMIN_PASSWORD = 'admin123';
export const MIN_PASSWORD_LENGTH = 8;
const KEY_LENGTH = 32;
const LEGACY_HASH = /^[0-9a-f]{64}$/;
const MODERN_HASH = /^pbkdf2-sha256\$(\d{1,7})\$([0-9a-f]{32})\$([0-9a-f]{64})$/;

type NativePassword = {
  pbkdf2Sha256(
    password: string,
    saltHex: string,
    iterations: number,
    length: number,
  ): Promise<string>;
};

export const isLegacyPasswordHash = (value: string) => LEGACY_HASH.test(value);
export const isPasswordHash = (value: unknown): value is string =>
  typeof value === 'string' && (LEGACY_HASH.test(value) || MODERN_HASH.test(value));

/** Pre-v10 format: unsalted SHA-256. Only used to verify and upgrade old accounts. */
export function legacyPasswordHash(password: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `MipyPOS:${password}`);
}

const hexToBytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

async function derive(password: string, saltHex: string, iterations: number) {
  const native = (NativeModules as { MipyPassword?: NativePassword }).MipyPassword;
  if (native?.pbkdf2Sha256) return native.pbkdf2Sha256(password, saltHex, iterations, KEY_LENGTH);
  const subtle = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto.subtle;
  if (subtle?.importKey && subtle.deriveBits) {
    const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations },
      key,
      KEY_LENGTH * 8,
    );
    return bytesToHex(new Uint8Array(bits));
  }
  // Development builds without the native module: slower but non-blocking.
  return bytesToHex(
    await pbkdf2Async(sha256, password, hexToBytes(saltHex), {
      c: iterations,
      dkLen: KEY_LENGTH,
      asyncTick: 15,
    }),
  );
}

export async function createPasswordHash(password: string, iterations = PASSWORD_ITERATIONS) {
  const salt = bytesToHex(Crypto.getRandomBytes(16));
  return `pbkdf2-sha256$${iterations}$${salt}$${await derive(password, salt, iterations)}`;
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export async function verifyPassword(password: string, stored: string) {
  if (!password) return false;
  if (LEGACY_HASH.test(stored))
    return constantTimeEqual(await legacyPasswordHash(password), stored);
  const match = MODERN_HASH.exec(stored);
  if (!match) return false;
  const iterations = Number(match[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 1) return false;
  return constantTimeEqual(await derive(password, match[2], iterations), match[3]);
}

export const needsPasswordUpgrade = (stored: string) => {
  const match = MODERN_HASH.exec(stored);
  return !match || Number(match[1]) < PASSWORD_ITERATIONS;
};

export function assertNewPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  if (password.toLowerCase() === DEFAULT_ADMIN_PASSWORD)
    throw new Error('Elige una contraseña distinta de la contraseña inicial.');
}

/**
 * Removes credentials from values used only to detect replayed commands, so
 * receipts and fingerprints never contain a fast hash of a password.
 */
export function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'password' || key === 'passwordHash' ? '[secreto]' : withoutSecrets(entry),
    ]),
  );
}
