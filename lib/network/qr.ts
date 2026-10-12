import type { HotspotCredentials } from '@/lib/network/hotspot';
import { LAN_PORT } from '@/lib/network/types';
export const QR_COLORS = { background: '#ffffff', foreground: '#000000' };
export function validateLanUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('El QR no contiene una dirección de red válida.');
  }
  const parts = url.hostname.split('.').map(Number);
  const privateIp =
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  if (
    !privateIp ||
    url.protocol !== 'http:' ||
    url.port !== String(LAN_PORT) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Escanea un QR de MipyPOS generado por el administrador en la red local.');
  return url.origin;
}
export function createLanQr(hostUrl: string, wifi?: HotspotCredentials) {
  return JSON.stringify({
    app: 'MipyPOS',
    version: wifi ? 3 : 2,
    hostUrl: validateLanUrl(hostUrl),
    ...(wifi ? { wifi } : {}),
  });
}
export function parseLanQr(data: string): string {
  return parseLanConnection(data).hostUrl;
}
export function parseLanConnection(data: string): { hostUrl: string; wifi?: HotspotCredentials } {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error('Este QR no pertenece a MipyPOS.');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('app' in value) ||
    value.app !== 'MipyPOS' ||
    !('version' in value) ||
    (value.version !== 2 && value.version !== 3) ||
    !('hostUrl' in value) ||
    typeof value.hostUrl !== 'string'
  )
    throw new Error('Este QR no es compatible. Genera uno nuevo en el administrador.');
  const hostUrl = validateLanUrl(value.hostUrl);
  if (value.version === 2) return { hostUrl };
  if (
    !('wifi' in value) ||
    !value.wifi ||
    typeof value.wifi !== 'object' ||
    !('ssid' in value.wifi) ||
    typeof value.wifi.ssid !== 'string' ||
    !value.wifi.ssid.length ||
    value.wifi.ssid.length > 32 ||
    !('password' in value.wifi) ||
    typeof value.wifi.password !== 'string' ||
    value.wifi.password.length < 8 ||
    value.wifi.password.length > 63
  )
    throw new Error('El QR no contiene credenciales Wi-Fi válidas. Genera uno nuevo.');
  return { hostUrl, wifi: { ssid: value.wifi.ssid, password: value.wifi.password } };
}
