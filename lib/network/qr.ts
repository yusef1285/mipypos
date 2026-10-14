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
    url.protocol !== 'https:' ||
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
export function validateHostPin(pin: string): string {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(pin))
    throw new Error('El QR no contiene una identidad segura válida. Genera uno nuevo.');
  return pin;
}
export function createLanQr(
  hostUrl: string,
  wifi?: HotspotCredentials,
  hostPin = '',
  directAddress?: string,
) {
  return JSON.stringify({
    app: 'MipyPOS',
    version: 4,
    hostUrl: validateLanUrl(hostUrl),
    hostPin: validateHostPin(hostPin),
    ...(directAddress ? { directAddress } : {}),
    ...(wifi ? { wifi } : {}),
  });
}
export function parseLanQr(data: string): string {
  return parseLanConnection(data).hostUrl;
}
export function parseLanConnection(data: string): {
  hostUrl: string;
  hostPin: string;
  wifi?: HotspotCredentials;
  directAddress?: string;
} {
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
    value.version !== 4 ||
    !('hostPin' in value) ||
    typeof value.hostPin !== 'string' ||
    !('hostUrl' in value) ||
    typeof value.hostUrl !== 'string'
  )
    throw new Error('Este QR no es compatible. Genera uno nuevo en el administrador.');
  const hostUrl = validateLanUrl(value.hostUrl);
  const hostPin = validateHostPin(value.hostPin);
  if ('directAddress' in value) {
    if (
      typeof value.directAddress !== 'string' ||
      !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(value.directAddress) ||
      value.directAddress === '02:00:00:00:00:00' ||
      'wifi' in value
    )
      throw new Error('El QR Wi-Fi Direct no es válido. Genera uno nuevo.');
    return { hostUrl, hostPin, directAddress: value.directAddress };
  }
  if (!('wifi' in value)) return { hostUrl, hostPin };
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
  return { hostUrl, hostPin, wifi: { ssid: value.wifi.ssid, password: value.wifi.password } };
}
