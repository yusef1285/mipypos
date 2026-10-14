import { getDirectInfo } from '@/lib/network/direct';
import { Linking, NativeModules, PermissionsAndroid, Platform } from 'react-native';

export interface HotspotCredentials {
  ssid: string;
  password: string;
}
interface LanBridge {
  startHotspot(): Promise<HotspotCredentials>;
  stopHotspot(): Promise<void>;
  getHotspot(): Promise<HotspotCredentials | null>;
  getHostIp(): Promise<string | null>;
  connect(ssid: string, password: string): Promise<void>;
  disconnect(): Promise<void>;
}
function isLanBridge(value: unknown): value is LanBridge {
  return (
    typeof value === 'object' &&
    value !== null &&
    'startHotspot' in value &&
    typeof value.startHotspot === 'function' &&
    'stopHotspot' in value &&
    typeof value.stopHotspot === 'function' &&
    'getHotspot' in value &&
    typeof value.getHotspot === 'function' &&
    'getHostIp' in value &&
    typeof value.getHostIp === 'function' &&
    'connect' in value &&
    typeof value.connect === 'function' &&
    'disconnect' in value &&
    typeof value.disconnect === 'function'
  );
}
function bridge(): LanBridge {
  if (Platform.OS !== 'android')
    throw new Error('Crear una red local desde la app requiere Android.');
  const value: unknown = NativeModules.MipyLan;
  if (!isLanBridge(value))
    throw new Error(
      'Esta instalación no incluye la conexión Wi-Fi por QR. Instala la nueva compilación Android de MipyPOS.',
    );
  return value;
}
async function permissions() {
  bridge();
  const permission =
    Number(Platform.Version) >= 33
      ? PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES
      : PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (await PermissionsAndroid.check(permission)) return;
  const result = await PermissionsAndroid.request(permission, {
    title: 'Conectar dispositivos MipyPOS',
    message: 'Permite crear o conectar la red Wi-Fi local sin internet.',
    buttonPositive: 'Permitir',
    buttonNegative: 'Cancelar',
  });
  if (result !== PermissionsAndroid.RESULTS.GRANTED)
    throw new Error(
      'Permite el acceso a dispositivos cercanos o ubicación en los ajustes de la app.',
    );
}
export async function startLocalHotspot() {
  await permissions();
  return bridge().startHotspot();
}
export function stopLocalHotspot() {
  return bridge().stopHotspot();
}
export async function getLocalHotspot(): Promise<HotspotCredentials | null> {
  if (Platform.OS !== 'android' || !NativeModules.MipyLan) return null;
  return bridge().getHotspot();
}
export async function getLanHostIp(): Promise<string | null> {
  const direct = await getDirectInfo();
  if (direct?.isOwner) return direct.hostIp;
  if (Platform.OS !== 'android' || !NativeModules.MipyLan) return null;
  return bridge().getHostIp();
}
export async function connectHotspot(credentials: HotspotCredentials) {
  await permissions();
  await bridge().connect(credentials.ssid, credentials.password);
}
export async function disconnectHotspot() {
  if (Platform.OS === 'android' && NativeModules.MipyLan) await bridge().disconnect();
}
export async function openWifiSettings() {
  if (Platform.OS === 'android') await Linking.sendIntent('android.settings.WIFI_SETTINGS');
  else await Linking.openSettings();
}
