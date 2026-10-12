import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import { SecureLanServer } from '@/lib/network/tls';
import { NativeModules, Platform } from 'react-native';
import { getLanHostIp } from '@/lib/network/hotspot';
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
import {
  mutationOperations,
  operationPermissions,
  type OperationRequest,
} from '@/lib/network/operations';
import { operationFingerprint } from '@/lib/network/pending-operation';
import { canAccess, type ModuleKey } from '@/lib/permissions';

interface SessionEntry {
  user: Usuario;
  expiresAt: number;
}
const sessions = new Map<string, SessionEntry>();
let server: SecureLanServer | null = null;
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
    throw new Error(
      'Tu rol no permite esta operación. Pide al administrador que revise tu acceso.',
    );
  entry.expiresAt = Date.now() + 15 * 60 * 1000;
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
    licenseMode: await DB.getLicenseMode(),
    products: await DB.listProducts(),
    areas: await DB.listAreas(),
    areaStock: await DB.listAreaStock(),
    session: await DB.getOpenSession(),
  };
}

async function handleOperation(request: OperationRequest, user: Usuario): Promise<unknown> {
  let command: DB.MutationCommand | undefined;
  if (mutationOperations.has(request.operation)) {
    if (
      !request.commandId ||
      !request.clientId ||
      request.commandId.length > 128 ||
      request.clientId.length > 128
    )
      throw new Error('La operación no tiene una identidad válida. Actualiza la terminal.');
    command = {
      commandId: request.commandId,
      clientId: request.clientId,
      action: request.operation,
      fingerprint: await operationFingerprint(request.operation, request.args),
      username: user.username,
    };
  }
  switch (request.operation) {
    case 'getDemoUsage':
      return DB.getDemoUsage();
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
        command,
      );
    case 'deleteProduct':
      return DB.deleteProduct(request.args[0], command);
    case 'importProducts':
      return DB.importProducts(request.args[0], user.username, command);
    case 'registerMovement':
      return DB.registerMovement({ ...request.args[0], username: user.username }, command);
    case 'addArea':
      if (user.role !== 'admin') throw new Error('Solo un administrador puede crear áreas.');
      return DB.addArea(request.args[0], command);
    case 'listMovements':
      return DB.listMovements(...request.args);
    case 'listUsers':
      return DB.listUsers();
    case 'saveUser':
      return DB.saveUser(request.args[0], command);
    case 'deleteUser':
      return DB.deleteUser(request.args[0], user.id, command);
    case 'getCashClosurePreview':
      return DB.getCashClosurePreview(request.args[0]);
    case 'openCashSession':
      return DB.openCashSession(request.args[0], user.username, command);
    case 'closeCashSession':
      return DB.closeCashSession(request.args[0], request.args[1], command);
    case 'registerCashWithdrawal':
      return DB.registerCashWithdrawal(request.args[0], request.args[1], user.username);
    case 'authorizeCashDifference':
      return DB.authorizeCashDifference(request.args[0], request.args[1], command);
    case 'listCashClosures':
      return DB.listCashClosures();
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
  const db = await DB.getDatabase();
  const defaultPassword = await DB.hashPassword('admin123');
  const unsafeAdmin = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM users WHERE role='admin' AND password_hash=? LIMIT 1",
    defaultPassword,
  );
  if (unsafeAdmin)
    throw new Error(
      'Cambia la contraseña inicial del administrador en Usuarios antes de iniciar la red local.',
    );
  let ip = await getLanHostIp();
  for (let attempt = 0; !ip && attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    ip = await getLanHostIp();
  }
  ip ??= await Network.getIpAddressAsync();
  if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1')
    throw new Error('Conecta el Wi-Fi o activa el hotspot antes de iniciar el host.');
  if (server) {
    server.stop();
    server = null;
    sessions.clear();
  }
  if (!NativeModules.MipyTls)
    throw new Error(
      'Esta instalación no incluye el servidor LAN. Instala una compilación Android con el módulo de red.',
    );
  const nextServer = new SecureLanServer();
  nextServer.get('/v1/health', async () => success({ name: 'MipyPOS', protocol: 4, ready: true }));
  nextServer.post<{ username?: string; password?: string }>('/v1/login', async (request) => {
    try {
      const { username = '', password = '' } = request.data;
      const user = await DB.authenticateForLogin(username, password);
      if (!user) throw new Error('Usuario o contraseña incorrectos.');
      const token = Crypto.randomUUID();
      for (const [key, entry] of sessions) if (entry.expiresAt < Date.now()) sessions.delete(key);
      if (sessions.size >= 64)
        throw new Error('Hay demasiadas sesiones de red. Cierra las que no estés usando.');
      sessions.set(token, { user, expiresAt: Date.now() + 15 * 60 * 1000 });
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
  nextServer.post<{ token?: string }>('/v1/logout', async (request) => {
    sessions.delete(request.data.token ?? '');
    return success(null);
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
  nextServer.post<OperationRequest>('/v1/receipt', async (request) => {
    try {
      const input = request.data;
      const user = await authorized(input.token, 'home');
      if (
        !input.commandId ||
        !input.clientId ||
        !mutationOperations.has(input.operation) ||
        !Array.isArray(input.args)
      )
        throw new Error('Operación no válida.');
      return success(
        await DB.findMutationReceipt({
          commandId: input.commandId,
          clientId: input.clientId,
          action: input.operation,
          username: user.username,
          fingerprint: await operationFingerprint(input.operation, input.args),
        }),
      );
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
  await nextServer.listen(ip, LAN_PORT);
  server = nextServer;
  const address = `https://${ip}:${LAN_PORT}`;
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
