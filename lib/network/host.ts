import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import { NativeModules, Platform } from 'react-native';
import { checkLanHost } from '@/lib/network/client';
import * as DB from '@/lib/database';
import type { CartItem, Usuario } from '@/lib/models';
import type {
  ApiResult,
  NetworkSaleCommand,
  NetworkSession,
  NetworkSnapshot,
} from '@/lib/network/types';
import { LAN_PORT } from '@/lib/network/types';
import { operationPermissions, type OperationRequest } from '@/lib/network/operations';
import { canAccess, type ModuleKey } from '@/lib/permissions';

interface SessionEntry {
  user: Usuario;
  expiresAt: number;
}
const sessions = new Map<string, SessionEntry>();
let server: import('react-native-http-bridge-refurbished').BridgeServer | null = null;
function success<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}
class ExpiredSession extends Error {}
function failure(error: unknown): ApiResult<never> {
  return {
    ok: false,
    code: error instanceof ExpiredSession ? 'AUTH_EXPIRED' : 'REJECTED',
    error: error instanceof Error ? error.message : 'Solicitud no válida.',
  };
}

async function authorized(token: string, module: ModuleKey) {
  const entry = sessions.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    sessions.delete(token);
    throw new ExpiredSession('La sesión de red venció. Inicia sesión nuevamente.');
  }
  const current = await (
    await DB.getDatabase()
  ).getFirstAsync<Usuario>('SELECT * FROM users WHERE id=?', entry.user.id);
  if (!current || current.password_hash !== entry.user.password_hash) {
    sessions.delete(token);
    throw new ExpiredSession('Inicia sesión nuevamente.');
  }
  if (!canAccess(current.role, module))
    throw new ExpiredSession(
      'Tu rol no permite esta operación. Pide al administrador que revise tu acceso.',
    );
  entry.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  return current;
}

async function buildSnapshot(): Promise<NetworkSnapshot> {
  const db = await DB.getDatabase();
  const revision =
    (
      await db.getFirstAsync<{ revision: number }>(
        'SELECT COALESCE(MAX(id),0) AS revision FROM network_events',
      )
    )?.revision ?? 0;
  return {
    revision,
    products: await DB.listProducts(),
    areas: await DB.listAreas(),
    areaStock: await DB.listAreaStock(),
    session: await DB.getOpenSession(),
  };
}

async function handleOperation(request: OperationRequest, user: Usuario): Promise<unknown> {
  switch (request.operation) {
    case 'listProducts':
      return DB.listProducts(...request.args);
    case 'listAreas':
      return DB.listAreas();
    case 'listAreaStock':
      return DB.listAreaStock();
    case 'saveProduct':
      return DB.saveProduct(
        {
          ...request.args[0],
          image_path: request.args[0].id
            ? ((await DB.getProduct(request.args[0].id))?.image_path ?? null)
            : null,
        },
        user.username,
      );
    case 'deleteProduct':
      return DB.deleteProduct(request.args[0]);
    case 'importProducts':
      return DB.importProducts(request.args[0], user.username);
    case 'registerMovement':
      return DB.registerMovement({ ...request.args[0], username: user.username });
    case 'addArea':
      if (user.role !== 'admin') throw new Error('Solo un administrador puede crear áreas.');
      return DB.addArea(request.args[0]);
    case 'listMovements':
      return DB.listMovements(...request.args);
    case 'listUsers':
      return DB.listUsers();
    case 'saveUser':
      return DB.saveUser(request.args[0]);
    case 'deleteUser':
      return DB.deleteUser(request.args[0], user.id);
    case 'getCashClosurePreview':
      return DB.getCashClosurePreview(request.args[0]);
    case 'openCashSession':
      return DB.openCashSession(request.args[0], user.username);
    case 'closeCashSession':
      return DB.closeCashSession(...request.args);
    case 'getHomeSummary':
      return DB.getHomeSummary();
    case 'getDailyReport':
      return DB.getDailyReport(request.args[0] ? new Date(request.args[0]) : undefined);
    case 'getExportRows':
      return DB.getExportRows(...request.args);
    case 'getSale':
      return DB.getSale(request.args[0]);
  }
  return undefined;
}

async function handleNetworkSale(command: NetworkSaleCommand, user: Usuario) {
  if (!command.commandId || !command.clientId)
    throw new Error('La venta no tiene identidad de red.');
  if (!Array.isArray(command.items) || !command.items.length)
    throw new Error('El carrito está vacío.');
  const previous = await DB.findNetworkSale(command.commandId, command.clientId, user.username);
  if (previous !== null) return previous;
  if (!Number.isInteger(command.sessionId)) throw new Error('Actualiza la caja antes de vender.');
  const byId = new Map((await DB.listProducts()).map((product) => [product.id, product]));
  const items: CartItem[] = command.items.map((input) => {
    const product = byId.get(input.productId);
    if (!product) throw new Error('Uno de los productos ya no existe.');
    return {
      product,
      areaId: input.areaId,
      quantity: input.quantity,
      price: command.method === 'transfer' ? product.price_transfer : product.price_cash,
    };
  });
  return DB.registerSale(
    items,
    command.method,
    command.payments,
    user.username,
    {
      commandId: command.commandId,
      clientId: command.clientId,
    },
    command.sessionId,
  );
}

export async function startLanHost(): Promise<string> {
  if (Platform.OS !== 'android')
    throw new Error('El host local requiere una compilación Android con el servidor LAN.');
  const ip = await Network.getIpAddressAsync();
  if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1')
    throw new Error('Conecta el Wi-Fi o activa el hotspot antes de iniciar el host.');
  if (server) return `http://${ip}:${LAN_PORT}`;
  if (!NativeModules.HttpServer)
    throw new Error(
      'Esta instalación no incluye el servidor LAN. Instala una compilación Android con el módulo de red.',
    );
  const { BridgeServer } = await import('react-native-http-bridge-refurbished');
  const nextServer = new BridgeServer('mipypos_lan', true);
  nextServer.get('/v1/health', async () => success({ name: 'MipyPOS', protocol: 2, ready: true }));
  nextServer.post<{ username?: string; password?: string }>('/v1/login', async (request) => {
    try {
      const { username = '', password = '' } = request.data;
      const user = await DB.authenticate(username, password);
      if (!user) throw new Error('Usuario o contraseña incorrectos.');
      const token = Crypto.randomUUID();
      sessions.set(token, { user, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      const publicUser: NetworkSession['user'] = {
        id: user.id,
        username: user.username,
        role: user.role,
      };
      return success({ token, user: publicUser });
    } catch (error) {
      return failure(error);
    }
  });
  nextServer.post<{ token?: string }>('/v1/snapshot', async (request) => {
    try {
      await authorized(request.data.token ?? '', 'home');
      return success(await buildSnapshot());
    } catch (error) {
      return failure(error);
    }
  });
  nextServer.post<{ token?: string }>('/v1/report', async (request) => {
    try {
      await authorized(request.data.token ?? '', 'reports');
      return success(await DB.getDailyReport());
    } catch (error) {
      return failure(error);
    }
  });
  nextServer.post<OperationRequest>('/v1/operation', async (request) => {
    try {
      const input: OperationRequest = request.data;
      if (
        !input ||
        !Object.hasOwn(operationPermissions, input.operation) ||
        !Array.isArray(input.args)
      )
        throw new Error('Operación no válida.');
      const module =
        input.operation === 'getExportRows' && input.args[0] === 'inventory'
          ? 'products'
          : operationPermissions[input.operation];
      const user = await authorized(input.token, module);
      return success((await handleOperation(input, user)) ?? null);
    } catch (error) {
      return failure(error);
    }
  });
  nextServer.post<NetworkSaleCommand>('/v1/sale', async (request) => {
    try {
      const user = await authorized(request.data.token ?? '', 'sales');
      return success({ saleId: await handleNetworkSale(request.data, user) });
    } catch (error) {
      return failure(error);
    }
  });
  nextServer.use(async () => failure(new Error('Ruta o método no válido.')));
  nextServer.listen(LAN_PORT);
  server = nextServer;
  const address = `http://${ip}:${LAN_PORT}`;
  try {
    await checkLanHost(address);
  } catch (error) {
    stopLanHost();
    throw new Error(
      'No se pudo iniciar el host. Revisa el Wi-Fi o hotspot y vuelve a intentarlo.',
      { cause: error },
    );
  }
  return address;
}
export function stopLanHost() {
  server?.stop();
  server = null;
  sessions.clear();
}
