import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getSetting, setSetting } from '@/lib/database';
import { getDesktopBridge, isDesktop } from '@/lib/desktop';
import {
  deviceCodeFrom,
  evaluateLicense,
  normalizeLicense,
  type LicenseStatus,
} from '@/lib/license-token';

export async function getDeviceId() {
  // Windows: stable machine identifier provided by the desktop shell.
  const desktop = getDesktopBridge();
  if (desktop) return `desktop:${await desktop.deviceId()}`;
  if (Platform.OS === 'android') {
    const androidId = Application.getAndroidId();
    if (androidId) return androidId;
  }
  return `${Device.modelName ?? 'device'}-${Device.osBuildId ?? 'unknown'}`;
}

/** Code the customer sends to the issuer to get a device-bound license. */
export async function getDeviceCode() {
  return deviceCodeFrom(await getDeviceId());
}

async function lastSeen() {
  return Number(await getSetting('license_last_seen')) || 0;
}

// Persists the derived state; the database quota checks read license_mode and
// license_expires_at, so an expired license stops Pro even between refreshes.
async function persist(status: LicenseStatus, now: number) {
  const pro = status.state === 'active';
  if ((await getSetting('license_mode')) !== (pro ? 'pro' : 'demo'))
    await setSetting('license_mode', pro ? 'pro' : 'demo');
  const expires = status.state === 'active' ? status.payload.exp : '';
  if ((await getSetting('license_expires_at')) !== expires)
    await setSetting('license_expires_at', expires);
  if (status.state !== 'clock' && now > (await lastSeen()))
    await setSetting('license_last_seen', String(now));
}

/** Re-verifies the stored license (signature, device, expiry and clock). */
export async function refreshLicense(now = Date.now()): Promise<LicenseStatus> {
  const token = await getSetting('license_key');
  const status = evaluateLicense(token, await getDeviceCode(), now, await lastSeen());
  await persist(status, now);
  return status;
}

export async function activateLicense(token: string, now = Date.now()): Promise<LicenseStatus> {
  const clean = normalizeLicense(token);
  const status = evaluateLicense(clean, await getDeviceCode(), now, await lastSeen());
  if (status.state === 'invalid' || status.state === 'clock') throw new Error(status.reason);
  if (status.state === 'expired') throw new Error('Esta licencia ya venció.');
  if (status.state !== 'active') throw new Error('Pega el texto completo de la licencia.');
  await setSetting('license_key', clean);
  await persist(status, now);
  return status;
}

export async function removeLicense() {
  await setSetting('license_key', '');
  return refreshLicense();
}

export async function getDeviceInfo() {
  return {
    id: await getDeviceId(),
    code: await getDeviceCode(),
    brand: Device.brand ?? (isDesktop() ? 'MipyPOS' : 'Desconocida'),
    model: Device.modelName ?? (isDesktop() ? 'Escritorio' : 'Desconocido'),
    os: `${Device.osName ?? 'Android'} ${Device.osVersion ?? ''}`.trim(),
    version: Application.nativeApplicationVersion ?? '1.0.0',
  };
}
