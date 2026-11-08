import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';
import { z } from 'zod';

import { LICENSE_PUBLIC_KEYS } from '@/lib/license-keys';

// Signed license format (see docs/LICENCIAS.md):
//   MIPY1.<base64url(JSON payload, ASCII only)>.<base64url(Ed25519 signature)>
// The signature covers the bytes "MIPY1." + payloadPart. Only the public key
// ships in the app; the private key stays with the issuer, so a license can be
// verified offline but never forged from the app code.
export const LICENSE_PREFIX = 'MIPY1';
const DAY = 86_400_000;
// Tolerated clock drift before a license is treated as tampered with.
export const CLOCK_TOLERANCE_MS = DAY;
export const EXPIRY_WARNING_DAYS = 7;

export const licensePlans = ['trial', 'monthly', 'annual', 'custom'] as const;
export type LicensePlan = (typeof licensePlans)[number];
export const planLabel: Record<LicensePlan, string> = {
  trial: 'Prueba',
  monthly: 'Mensual',
  annual: 'Anual',
  custom: 'Personalizada',
};

const iso = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Fecha inválida.');
export const licensePayloadSchema = z
  .object({
    v: z.literal(1),
    kid: z.string().regex(/^[0-9a-f]{8}$/),
    id: z.string().uuid(),
    plan: z.enum(licensePlans),
    customer: z.string().max(120).default(''),
    // Device code shown in Configuración; omitted = valid on any device.
    device: z
      .string()
      .regex(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/)
      .optional(),
    iat: iso,
    exp: iso,
  })
  .strict()
  .refine((value) => Date.parse(value.exp) > Date.parse(value.iat), 'Vencimiento inválido.');
export type LicensePayload = z.output<typeof licensePayloadSchema>;

export type LicenseStatus =
  | { state: 'none' }
  | { state: 'invalid'; reason: string }
  | { state: 'clock'; payload: LicensePayload; reason: string }
  | { state: 'expired'; payload: LicensePayload }
  | { state: 'active'; payload: LicensePayload; daysLeft: number; expiringSoon: boolean };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function base64UrlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1)
    throw new Error('Codificación inválida.');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    buffer = (buffer << 6) | B64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64[(buffer >> bits) & 63];
    }
  }
  if (bits > 0) out += B64[(buffer << (6 - bits)) & 63];
  return out;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Short, shareable code derived from the platform device id (never the raw id). */
export function deviceCodeFrom(deviceId: string) {
  const digest = hex(sha256(utf8ToBytes(`MIPYPOS-DEVICE-V1:${deviceId}`)))
    .slice(0, 16)
    .toUpperCase();
  return digest.match(/.{4}/g)!.join('-');
}

/** Removes whitespace/line breaks that chat apps add when pasting long tokens. */
export const normalizeLicense = (token: string) => token.replace(/\s+/g, '');

export function decodeLicense(token: string): LicensePayload {
  const parts = normalizeLicense(token).split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX)
    throw new Error('El texto no es una licencia de MipyPOS.');
  let json: unknown;
  try {
    json = JSON.parse(String.fromCharCode(...base64UrlDecode(parts[1])));
  } catch {
    throw new Error('La licencia está incompleta o dañada.');
  }
  const parsed = licensePayloadSchema.safeParse(json);
  if (!parsed.success) throw new Error('La licencia tiene un formato no soportado.');
  const key = LICENSE_PUBLIC_KEYS[parsed.data.kid];
  if (!key) throw new Error('La licencia fue firmada con una clave desconocida.');
  let valid = false;
  try {
    valid = ed25519.verify(
      base64UrlDecode(parts[2]),
      utf8ToBytes(`${parts[0]}.${parts[1]}`),
      base64UrlDecode(key),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new Error('La firma de la licencia no es válida.');
  return parsed.data;
}

/**
 * Pure evaluation used by the app and the tests.
 * `lastSeen` is the latest trusted time already observed on this device; a
 * clock set back beyond the tolerance never reactivates an expired license.
 */
export function evaluateLicense(
  token: string | null | undefined,
  deviceCode: string,
  now: number,
  lastSeen = 0,
): LicenseStatus {
  if (!token) return { state: 'none' };
  let payload: LicensePayload;
  try {
    payload = decodeLicense(token);
  } catch (failure) {
    return {
      state: 'invalid',
      reason: failure instanceof Error ? failure.message : 'Licencia inválida.',
    };
  }
  if (payload.device && payload.device !== deviceCode)
    return { state: 'invalid', reason: 'La licencia pertenece a otro dispositivo.' };
  const exp = Date.parse(payload.exp);
  const iat = Date.parse(payload.iat);
  if (now + CLOCK_TOLERANCE_MS < lastSeen || now + CLOCK_TOLERANCE_MS < iat)
    return {
      state: 'clock',
      payload,
      reason: 'La fecha del teléfono está atrasada. Corrígela para usar la licencia.',
    };
  if (Math.max(now, lastSeen) >= exp) return { state: 'expired', payload };
  const daysLeft = Math.max(0, Math.ceil((exp - now) / DAY));
  return { state: 'active', payload, daysLeft, expiringSoon: daysLeft <= EXPIRY_WARNING_DAYS };
}
