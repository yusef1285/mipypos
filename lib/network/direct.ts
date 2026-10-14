import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
export interface DirectInfo {
  isOwner: boolean;
  hostIp: string;
  deviceAddress: string;
}
interface DirectBridge {
  createGroup(): Promise<DirectInfo>;
  connectPeer(address: string): Promise<DirectInfo>;
  getInfo(): Promise<DirectInfo | null>;
  disconnect(): Promise<void>;
}
function isDirectBridge(value: unknown): value is DirectBridge {
  return (
    !!value &&
    typeof value === 'object' &&
    'createGroup' in value &&
    typeof value.createGroup === 'function' &&
    'connectPeer' in value &&
    typeof value.connectPeer === 'function' &&
    'getInfo' in value &&
    typeof value.getInfo === 'function' &&
    'disconnect' in value &&
    typeof value.disconnect === 'function'
  );
}
function bridge(): DirectBridge {
  const value: unknown = NativeModules.MipyDirect;
  if (Platform.OS !== 'android' || !isDirectBridge(value))
    throw new Error('Wi-Fi Direct requiere una nueva compilación Android de MipyPOS.');
  return value;
}
async function permissions() {
  bridge();
  const permission =
    Number(Platform.Version) >= 33
      ? PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES
      : PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (
    !(await PermissionsAndroid.check(permission)) &&
    (await PermissionsAndroid.request(permission)) !== PermissionsAndroid.RESULTS.GRANTED
  )
    throw new Error('Permite dispositivos cercanos o ubicación para usar Wi-Fi Direct.');
}
export async function createDirectGroup() {
  await permissions();
  return bridge().createGroup();
}
export async function connectDirectPeer(address: string) {
  if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(address) || address === '02:00:00:00:00:00')
    throw new Error('El QR no contiene un teléfono Wi-Fi Direct válido.');
  await permissions();
  return bridge().connectPeer(address);
}
export async function getDirectInfo(): Promise<DirectInfo | null> {
  if (Platform.OS !== 'android' || !NativeModules.MipyDirect) return null;
  return bridge().getInfo();
}
export async function disconnectDirect() {
  if (await getDirectInfo()) await bridge().disconnect();
}
