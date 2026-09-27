import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export async function getDeviceId() {
  if (Platform.OS === 'android') {
    const androidId = Application.getAndroidId();
    if (androidId) return androidId;
  }
  return `${Device.modelName ?? 'device'}-${Device.osBuildId ?? 'unknown'}`;
}

export async function getExpectedLicenseKey() {
  const deviceId = await getDeviceId();
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `MIPYPOS-PRO:${deviceId}:LOCAL-LICENSE-V1`,
  );
  return `MP-${digest.slice(0, 6)}-${digest.slice(6, 12)}-${digest.slice(12, 18)}`.toUpperCase();
}

export async function validateLicenseKey(key: string) {
  const expected = await getExpectedLicenseKey();
  return key.trim().toUpperCase() === expected;
}

export async function getDeviceInfo() {
  return {
    id: await getDeviceId(),
    brand: Device.brand ?? 'Desconocida',
    model: Device.modelName ?? 'Desconocido',
    os: `${Device.osName ?? 'Android'} ${Device.osVersion ?? ''}`.trim(),
    version: Application.nativeApplicationVersion ?? '1.0.0',
  };
}
