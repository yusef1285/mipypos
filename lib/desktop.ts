import { Platform } from 'react-native';
import { z } from 'zod';

/**
 * Bridge exposed by the Windows desktop shell (desktop/preload.cjs). The web
 * build runs unchanged in a browser; only MipyPOS Desktop defines this object.
 */
export interface DesktopTlsRequest {
  id: string;
  method: string;
  path: string;
  body: string;
}
export interface DesktopBackupFile {
  name: string;
  size: number;
  modifiedAt: string;
}
export interface DesktopBridge {
  version: string;
  platform: string;
  tls: {
    start(ip: string, port: number): Promise<string>;
    stop(): Promise<void>;
    respond(id: string, body: string): void;
    request(url: string, method: string, body: string, pin: string): Promise<string>;
    onRequest(listener: (request: DesktopTlsRequest) => void): () => void;
  };
  network: {
    getHostIp(): Promise<string | null>;
  };
  discovery: {
    advertise(identity: string, port: number): Promise<void>;
    stop(): Promise<void>;
  };
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  deviceId(): Promise<string>;
  backups: {
    folder(): Promise<string>;
    save(name: string, contents: string): Promise<string>;
    list(): Promise<DesktopBackupFile[]>;
    pick(): Promise<string | null>;
    openFolder(): Promise<void>;
  };
}

const fn = z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function');
const bridgeSchema = z.object({
  version: z.string(),
  platform: z.string(),
  tls: z.object({ start: fn, stop: fn, respond: fn, request: fn, onRequest: fn }),
  network: z.object({ getHostIp: fn }),
  discovery: z.object({ advertise: fn, stop: fn }),
  secrets: z.object({ get: fn, set: fn, remove: fn }),
  deviceId: fn,
  backups: z.object({ folder: fn, save: fn, list: fn, pick: fn, openFolder: fn }),
});

let cached: DesktopBridge | null | undefined;
export function getDesktopBridge(): DesktopBridge | null {
  if (cached !== undefined) return cached;
  const candidate: unknown =
    Platform.OS === 'web' && typeof globalThis === 'object'
      ? Reflect.get(globalThis, 'mipyDesktop')
      : undefined;
  // The schema only checks shape; the preload script is the trust boundary.
  const parsed = z
    .custom<DesktopBridge>((value) => bridgeSchema.safeParse(value).success)
    .safeParse(candidate);
  cached = parsed.success ? parsed.data : null;
  return cached;
}

export const isDesktop = () => getDesktopBridge() !== null;

export function desktopBridge(): DesktopBridge {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error('Esta función solo está disponible en MipyPOS para Windows.');
  return bridge;
}

/** Android phones and the desktop shell can host or join the secure local network. */
export const supportsSecureLan = () => Platform.OS === 'android' || isDesktop();

/** Only for tests: forget the cached bridge lookup. */
export function resetDesktopBridgeForTests() {
  cached = undefined;
}
