import { NativeModules, Platform } from 'react-native';
import { z } from 'zod';
import { checkLanHost } from '@/lib/network/client';
import { validateLanUrl } from '@/lib/network/qr';
const candidateSchema = z.array(z.object({ name: z.string(), hostUrl: z.string() })).max(12);
interface DiscoveryBridge {
  advertise(identity: string, port: number): Promise<void>;
  stopAdvertisement(): Promise<void>;
  discover(): Promise<unknown>;
  cancelDiscovery(): Promise<void>;
}
function isDiscoveryBridge(value: unknown): value is DiscoveryBridge {
  return (
    value !== null &&
    typeof value === 'object' &&
    'advertise' in value &&
    typeof value.advertise === 'function' &&
    'stopAdvertisement' in value &&
    typeof value.stopAdvertisement === 'function' &&
    'discover' in value &&
    typeof value.discover === 'function' &&
    'cancelDiscovery' in value &&
    typeof value.cancelDiscovery === 'function'
  );
}
function bridge(): DiscoveryBridge {
  if (Platform.OS !== 'android')
    throw new Error('Buscar administradores en la red requiere Android.');
  const value: unknown = NativeModules.MipyDiscovery;
  if (!isDiscoveryBridge(value))
    throw new Error(
      'Esta instalación no incluye búsqueda de administradores. Usa el QR o instala la nueva compilación Android.',
    );
  return value;
}
let advertisementError = '';
export const getAdvertisementError = () => advertisementError;
export async function advertiseLanHost(identity: string, port: number) {
  advertisementError = '';
  try {
    await bridge().advertise(identity, port);
  } catch (error) {
    advertisementError =
      error instanceof Error ? error.message : 'No se pudo anunciar el administrador. Usa su QR.';
  }
}
export function stopLanAdvertisement() {
  if (Platform.OS === 'android' && NativeModules.MipyDiscovery)
    void bridge()
      .stopAdvertisement()
      .catch(() => undefined);
  advertisementError = '';
}
export async function findPairedLanHost(pin: string): Promise<string> {
  if (!pin) throw new Error('Escanea primero el QR del administrador para autorizar su identidad.');
  const parsed = candidateSchema.safeParse(await bridge().discover());
  if (!parsed.success)
    throw new Error('No se pudieron verificar los administradores encontrados. Usa el QR.');
  for (const candidate of parsed.data) {
    try {
      const url = validateLanUrl(candidate.hostUrl);
      await checkLanHost(url, pin);
      return url;
    } catch {
      /* Discovered names and addresses confer no trust; only the saved TLS pin does. */
    }
  }
  throw new Error(
    'No se encontró al administrador autorizado. Conecta ambos teléfonos al mismo Wi-Fi, inicia el host y vuelve a buscar o escanea su QR.',
  );
}
export async function cancelLanDiscovery() {
  if (Platform.OS === 'android' && NativeModules.MipyDiscovery) await bridge().cancelDiscovery();
}
