import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import type { NetworkConfig } from '@/lib/network/types';
import { getSecret, setSecret, removeSecret } from '@/lib/network/secure-storage';

const CONFIG_KEY = 'mipypos.network.config';
const TOKEN_KEY = 'mipypos.network.token';
const PIN_KEY = 'mipypos.network.pin';

const fallbackConfig: NetworkConfig = { mode: 'standalone', hostUrl: '', clientId: '' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function loadNetworkConfig(): Promise<NetworkConfig> {
  const stored = await AsyncStorage.getItem(CONFIG_KEY);
  if (!stored) return { ...fallbackConfig, clientId: Crypto.randomUUID() };
  const hostPin = (await getSecret(PIN_KEY)) ?? '';
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) return { ...fallbackConfig, clientId: Crypto.randomUUID() };
    return {
      mode: parsed.mode === 'host' || parsed.mode === 'client' ? parsed.mode : 'standalone',
      hostUrl: typeof parsed.hostUrl === 'string' ? parsed.hostUrl : '',
      hostPin,
      clientId:
        typeof parsed.clientId === 'string' && parsed.clientId
          ? parsed.clientId
          : Crypto.randomUUID(),
    };
  } catch {
    return { ...fallbackConfig, clientId: Crypto.randomUUID() };
  }
}

export async function saveNetworkConfig(config: NetworkConfig) {
  if (config.hostPin) await setSecret(PIN_KEY, config.hostPin);
  else await removeSecret(PIN_KEY);
  const publicConfig = { mode: config.mode, hostUrl: config.hostUrl, clientId: config.clientId };
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(publicConfig));
}

// Old cleartext sessions must log in again; never migrate a copied bearer token.
export async function getNetworkToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
  return getSecret(TOKEN_KEY);
}
export const saveNetworkToken = (token: string) => setSecret(TOKEN_KEY, token);
export async function clearNetworkToken() {
  await removeSecret(TOKEN_KEY);
  await AsyncStorage.removeItem(TOKEN_KEY);
}
