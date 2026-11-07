import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { NetworkConfig } from '@/lib/network/types';
import { getSecret, setSecret, removeSecret } from '@/lib/network/secure-storage';
import { validateHostPin, validateLanUrl } from '@/lib/network/qr';
import { supportsSecureLan } from '@/lib/desktop';

const CONFIG_KEY = 'mipypos.network.config';
const TOKEN_KEY = 'mipypos.network.token';
const PIN_KEY = 'mipypos.network.pin';
const validIdentity = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,512}$/.test(value);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function normalize(value: unknown, pin: string): NetworkConfig {
  if (!isRecord(value))
    throw new Error(
      'La configuración de red no es válida. Escanea de nuevo el QR del administrador.',
    );
  if (!['standalone', 'host', 'client'].includes(String(value.mode)))
    throw new Error('El modo de red no es válido. Escanea de nuevo el QR del administrador.');
  const mode = value.mode === 'host' || value.mode === 'client' ? value.mode : 'standalone';
  if (value.transport !== undefined && value.transport !== 'wifi' && value.transport !== 'direct')
    throw new Error('El transporte de red no es válido. Vuelve a emparejar el dispositivo.');
  if (mode === 'client' && typeof value.hostUrl !== 'string')
    throw new Error('Falta la dirección del administrador. Escanea de nuevo su QR.');
  return {
    mode,
    transport: mode === 'standalone' ? 'wifi' : value.transport === 'direct' ? 'direct' : 'wifi',
    clientId: validIdentity(value.clientId) ? value.clientId : Crypto.randomUUID(),
    hostUrl:
      mode === 'client' && typeof value.hostUrl === 'string' ? validateLanUrl(value.hostUrl) : '',
    hostPin: mode === 'client' ? validateHostPin(pin) : '',
  };
}
function publicConfig(config: NetworkConfig) {
  return {
    version: 1,
    mode: config.mode,
    transport: config.transport,
    clientId: config.clientId,
    hostUrl: config.hostUrl,
    ...(config.recoveryMessage ? { recoveryMessage: config.recoveryMessage } : {}),
  };
}
export async function loadNetworkConfig(): Promise<NetworkConfig> {
  const stored = await AsyncStorage.getItem(CONFIG_KEY);
  if (!stored) {
    const config: NetworkConfig = {
      mode: 'standalone',
      transport: 'wifi',
      hostUrl: '',
      clientId: Crypto.randomUUID(),
    };
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(publicConfig(config)));
    return config;
  }
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    value = null;
  }
  // Never change a broken client to standalone automatically: that could create
  // a second authority. Preserve the original record until explicit re-pairing.
  try {
    const pin =
      isRecord(value) && value.mode === 'client' ? ((await getSecret(PIN_KEY)) ?? '') : '';
    const config = normalize(value, pin);
    if (!supportsSecureLan() && config.mode !== 'standalone')
      config.recoveryMessage =
        'La conexión segura solo está disponible en Android y en MipyPOS para Windows. Los datos locales se conservan.';
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(publicConfig(config)));
    return config;
  } catch (error) {
    return {
      mode: 'client',
      transport: 'wifi',
      hostUrl: '',
      clientId:
        isRecord(value) && validIdentity(value.clientId) ? value.clientId : Crypto.randomUUID(),
      recoveryMessage:
        error instanceof Error
          ? error.message
          : 'Vuelve a emparejar el dispositivo con el administrador.',
    };
  }
}
export async function saveNetworkConfig(config: NetworkConfig) {
  const normalized = normalize(config, config.hostPin ?? '');
  if (!supportsSecureLan() && normalized.mode !== 'standalone')
    throw new Error(
      'La conexión segura solo está disponible en Android y en MipyPOS para Windows.',
    );
  if (normalized.hostPin) await setSecret(PIN_KEY, normalized.hostPin);
  else await removeSecret(PIN_KEY);
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(publicConfig(normalized)));
  return normalized;
}
// New encrypted journals retain the original public TLS pin. Old journals without
// an anchor still require reconciliation; an IP or a candidate QR cannot supply it.
export function pendingAuthorityPin(
  current: NetworkConfig,
  authorities: readonly string[],
  pins: readonly (string | undefined)[] = [],
): string | undefined {
  const remote = authorities.flatMap((authority, index) =>
    authority === 'local' ? [] : [{ authority, pin: pins[index] }],
  );
  if (!remote.length) return current.hostPin;
  const expected = current.hostPin ?? remote[0]?.pin;
  if (
    !expected ||
    remote.some(
      (record) =>
        (record.pin !== undefined && record.pin !== expected) ||
        (!current.hostPin && (!record.pin || !record.authority.startsWith('https:'))),
    )
  )
    throw new Error(
      'No se puede verificar la identidad original del administrador. Las operaciones pendientes se conservan; revisa su confirmación antes de volver a emparejar.',
    );
  if (!current.hostPin) validateHostPin(expected);
  return expected;
}
export function assertPendingAuthority(
  current: NetworkConfig,
  next: NetworkConfig,
  authorities: readonly string[],
  pins: readonly (string | undefined)[] = [],
) {
  const remote = authorities.filter((authority) => authority !== 'local');
  if (!remote.length) return;
  const originalPin = pendingAuthorityPin(current, authorities, pins);
  if (current.mode !== 'client' || next.mode !== 'client' || next.hostPin !== originalPin)
    throw new Error(
      'No se puede verificar la identidad original del administrador. Las operaciones pendientes se conservan; revisa su confirmación antes de volver a emparejar.',
    );
  if (
    authorities.some(
      (authority, index) =>
        authority !== 'local' &&
        authority !== current.hostUrl &&
        authority !== next.hostUrl &&
        !(!current.hostPin && pins[index] === originalPin),
    )
  )
    throw new Error('Confirma las operaciones pendientes con el administrador original.');
}

let tokenQueue: Promise<unknown> = Promise.resolve();
function withTokenStorage<T>(action: () => Promise<T>): Promise<T> {
  const running = tokenQueue.then(action);
  tokenQueue = running.catch(() => undefined);
  return running;
}
export function getNetworkToken(): Promise<string | null> {
  return withTokenStorage(readToken);
}
async function readToken(): Promise<string | null> {
  const secure = await getSecret(TOKEN_KEY);
  if (secure !== null) {
    if (!validToken(secure))
      throw new Error('La sesión guardada no es válida. Inicia sesión de nuevo.');
    // Cleanup is best-effort only AFTER a valid secure read, never before.
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
    return secure;
  }
  if (Platform.OS === 'web') return null;
  const legacy = await AsyncStorage.getItem(TOKEN_KEY);
  if (legacy === null) return null;
  if (!validToken(legacy))
    throw new Error('La sesión antigua no es válida. Inicia sesión de nuevo.');
  await setSecret(TOKEN_KEY, legacy);
  if ((await getSecret(TOKEN_KEY)) !== legacy)
    throw new Error(
      'No se pudo proteger la sesión. El registro anterior se conserva; vuelve a intentarlo.',
    );
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  // This is storage migration only: host authentication and expiry still decide
  // whether the bearer is usable. It never creates a new authenticated session.
  return legacy;
}
export function saveNetworkToken(token: string) {
  return withTokenStorage(async () => {
    if (!validToken(token)) throw new Error('La sesión recibida no es válida.');
    await setSecret(TOKEN_KEY, token);
  });
}
export function clearNetworkToken(expectedToken?: string): Promise<boolean> {
  return withTokenStorage(async () => {
    // Compare and delete in the same storage queue: an old response cannot
    // erase a bearer installed by a newer login between these two steps.
    if (expectedToken !== undefined && (await readToken()) !== expectedToken) return false;
    await removeSecret(TOKEN_KEY);
    await AsyncStorage.removeItem(TOKEN_KEY);
    return true;
  });
}
