import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const supportsSecretStorage = () => Platform.OS === 'android' || Platform.OS === 'ios';
export async function getSecret(key: string): Promise<string | null> {
  if (!supportsSecretStorage()) return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    throw new Error(
      'No se pudo abrir el almacenamiento seguro. Desbloquea el teléfono y vuelve a intentarlo.',
      { cause: error },
    );
  }
}
export async function setSecret(key: string, value: string) {
  if (!supportsSecretStorage())
    throw new Error(
      'Este navegador no dispone de almacenamiento seguro para la conexión entre teléfonos. Utiliza Android.',
    );
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if ((await SecureStore.getItemAsync(key)) !== value)
      throw new Error('La escritura no se pudo confirmar.');
  } catch (error) {
    throw new Error(
      'No se pudo guardar de forma segura. La operación no se ha enviado; vuelve a intentarlo.',
      { cause: error },
    );
  }
}
export async function removeSecret(key: string) {
  if (supportsSecretStorage()) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      throw new Error('No se pudo cerrar la sesión guardada. Vuelve a intentarlo.', {
        cause: error,
      });
    }
  }
}
