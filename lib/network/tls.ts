import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { z } from 'zod';
import { loadNetworkConfig } from '@/lib/network/config';
import { validateLanUrl } from '@/lib/network/qr';

interface TlsRequest {
  id: string;
  method: string;
  path: string;
  body: string;
}
interface TlsModule {
  start(ip: string, port: number): Promise<string>;
  stopServer(): Promise<void>;
  respond(id: string, body: string): void;
  request(url: string, method: string, body: string, pin: string): Promise<string>;
  addListener(event: string): void;
  removeListeners(count: number): void;
}
const nativeTlsSchema = z.object({
  // Validate call arguments synchronously; async results are checked by the adapter below.
  // A promise-output function schema defers invocation, which would delay stop/rebind.
  start: z.function({ input: [z.string(), z.number()], output: z.unknown() }),
  stopServer: z.function({ input: [], output: z.unknown() }),
  respond: z.function({ input: [z.string(), z.string()], output: z.unknown() }),
  request: z.function({
    input: [z.string(), z.string(), z.string(), z.string()],
    output: z.unknown(),
  }),
  addListener: z.function({ input: [z.string()], output: z.unknown() }),
  removeListeners: z.function({ input: [z.number()], output: z.unknown() }),
});
export const supportsLanTransport = () => Platform.OS === 'android';
function nativeTls(): TlsModule {
  const parsed = nativeTlsSchema.safeParse(NativeModules.MipyTls);
  if (!supportsLanTransport())
    throw new Error('La conexión segura entre teléfonos solo está disponible en Android.');
  if (!parsed.success)
    throw new Error(
      'La red segura requiere una nueva compilación Android de MipyPOS; no está disponible en Expo Go.',
    );
  const native = parsed.data;
  return {
    start: async (ip, port) => z.string().parse(await native.start(ip, port)),
    stopServer: async () => {
      await native.stopServer();
    },
    respond: (id, body) => {
      native.respond(id, body);
    },
    request: async (url, method, body, pin) =>
      z.string().parse(await native.request(url, method, body, pin)),
    addListener: (event) => {
      native.addListener(event);
    },
    removeListeners: (count) => {
      native.removeListeners(count);
    },
  };
}
let hostPin = '';
let hostUrl = '';
export const getHostPin = () => hostPin;
export async function pinnedRequest(
  url: string,
  path: string,
  body?: object,
  pairedPin?: string,
): Promise<string> {
  const origin = validateLanUrl(url);
  const config = await loadNetworkConfig();
  const pin =
    pairedPin ?? (origin === hostUrl ? hostPin : config.hostUrl === origin ? config.hostPin : '');
  if (!pin) throw new Error('Escanea el nuevo QR seguro del administrador.');
  return nativeTls().request(
    `${origin}${path}`,
    body ? 'POST' : 'GET',
    body ? JSON.stringify(body) : '',
    pin,
  );
}
type Handler = (request: { data: unknown }) => Promise<unknown>;
export class SecureLanServer {
  private routes = new Map<string, Handler>();
  private subscription: ReturnType<NativeEventEmitter['addListener']> | null = null;
  get(path: string, handler: Handler) {
    this.routes.set(`GET ${path}`, handler);
  }
  post(path: string, handler: Handler) {
    this.routes.set(`POST ${path}`, handler);
  }
  private native: TlsModule | null = null;
  private requests = new Set<Promise<void>>();
  async listen(ip: string, port: number) {
    const native = nativeTls();
    this.native = native;
    this.subscription = new NativeEventEmitter<{ MipyTlsRequest: [TlsRequest] }>(
      native,
    ).addListener('MipyTlsRequest', (request: TlsRequest) => {
      const handling = (async () => {
        try {
          const handler = this.routes.get(`${request.method} ${request.path}`);
          const data: unknown = JSON.parse(request.body);
          const result = handler
            ? await handler({ data })
            : { ok: false, code: 'REJECTED', error: 'Ruta o método no válido.' };
          native.respond(request.id, JSON.stringify(result));
        } catch {
          native.respond(
            request.id,
            JSON.stringify({ ok: false, code: 'REJECTED', error: 'Solicitud no válida.' }),
          );
        }
      })();
      this.requests.add(handling);
      void handling.finally(() => this.requests.delete(handling)).catch(() => undefined);
    });
    try {
      hostPin = await native.start(ip, port);
      hostUrl = `https://${ip}:${port}`;
    } catch (error) {
      this.subscription.remove();
      this.subscription = null;
      throw error;
    }
  }
  async stopAndDrain() {
    this.subscription?.remove();
    this.subscription = null;
    hostPin = '';
    hostUrl = '';
    const native = this.native;
    this.native = null;
    try {
      if (native) await native.stopServer();
    } finally {
      await Promise.allSettled(this.requests);
    }
  }
  stop() {
    this.subscription?.remove();
    this.subscription = null;
    hostPin = '';
    hostUrl = '';
    const native = this.native;
    this.native = null;
    if (native) void native.stopServer().catch(() => undefined);
  }
}
