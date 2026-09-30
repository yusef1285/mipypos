import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import type { NetworkConfig } from '@/lib/network/types';

const CONFIG_KEY = 'mipypos.network.config';
const TOKEN_KEY = 'mipypos.network.token';

const fallbackConfig: NetworkConfig = { mode: 'standalone', hostUrl: '', clientId: '' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function loadNetworkConfig(): Promise<NetworkConfig> {
  const stored = await AsyncStorage.getItem(CONFIG_KEY);
  if (!stored) return { ...fallbackConfig, clientId: Crypto.randomUUID() };
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) return { ...fallbackConfig, clientId: Crypto.randomUUID() };
    return {
      mode: parsed.mode === 'host' || parsed.mode === 'client' ? parsed.mode : 'standalone',
      hostUrl: typeof parsed.hostUrl === 'string' ? parsed.hostUrl : '',
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
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export const getNetworkToken = () => AsyncStorage.getItem(TOKEN_KEY);
export const saveNetworkToken = (token: string) => AsyncStorage.setItem(TOKEN_KEY, token);
export const clearNetworkToken = () => AsyncStorage.removeItem(TOKEN_KEY);
