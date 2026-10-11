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
export function createLanQr(hostUrl: string) {
  return JSON.stringify({ app: 'MipyPOS', version: 2, hostUrl: validateLanUrl(hostUrl) });
}
export function parseLanQr(data: string): string {
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
    value.version !== 2 ||
    !('hostUrl' in value) ||
    typeof value.hostUrl !== 'string'
  )
    throw new Error('Este QR no es compatible. Genera uno nuevo en el administrador.');
  return validateLanUrl(value.hostUrl);
}
