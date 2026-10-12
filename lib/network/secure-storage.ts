import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export async function getSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(key);
}
export async function setSecret(key: string, value: string) {
  if (Platform.OS === 'web') throw new Error('La red segura requiere la aplicación Android.');
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
export async function removeSecret(key: string) {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(key);
}
