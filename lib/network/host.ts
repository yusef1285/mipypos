import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import { Platform } from 'react-native';

import {
  authenticate,
  getDatabase,
  getDailyReport,
  getOpenSession,
  listProducts,
  registerSale,
} from '@/lib/database';
import type { CartItem, DailyReport, Usuario } from '@/lib/models';
import type {
  ApiResult,
  NetworkSaleCommand,
  NetworkSession,
  NetworkSnapshot,
} from '@/lib/network/types';
import { LAN_PORT } from '@/lib/network/types';
import { canAccess } from '@/lib/permissions';

interface SessionEntry {
  user: Usuario;
  expiresAt: number;
}

const sessions = new Map<string, SessionEntry>();
let server: import('react-native-http-bridge-refurbished').BridgeServer | null = null;

function success<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function failure(error: unknown): ApiResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : 'Solicitud no válida.' };
}

function authorized(token: string, module: 'sales' | 'reports') {
  const entry = sessions.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) sessions.delete(token);
    throw new Error('La sesión de red venció. Inicia sesión nuevamente.');
  }
  if (!canAccess(entry.user.role, module)) throw new Error('Tu rol no permite esta operación.');
  entry.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  return entry.user;
}

async function buildSnapshot(): Promise<NetworkSnapshot> {
  const db = await getDatabase();
  const revision =
    (
      await db.getFirstAsync<{ revision: number }>(
        'SELECT COALESCE(MAX(id),0) AS revision FROM network_events',
      )
    )?.revision ?? 0;
  return { revision, products: await listProducts(), session: await getOpenSession() };
}

async function handleNetworkSale(command: NetworkSaleCommand, user: Usuario) {
  if (!command.commandId || !command.clientId)
    throw new Error('La venta no tiene identidad de red.');
  if (!Array.isArray(command.items) || !command.items.length)
    throw new Error('El carrito está vacío.');
  const products = await listProducts();
  const byId = new Map(products.map((product) => [product.id, product]));
  const items: CartItem[] = command.items.map((input) => {
    const product = byId.get(input.productId);
    if (!product) throw new Error('Uno de los productos ya no existe.');
    if (!Number.isFinite(input.quantity) || input.quantity <= 0)
      throw new Error(`Cantidad inválida para ${product.name}.`);
    return {
      product,
      quantity: input.quantity,
      price: command.method === 'transfer' ? product.price_transfer : product.price_cash,
    };
  });
  return registerSale(items, command.method, command.payments, user.username, {
    commandId: command.commandId,
    clientId: command.clientId,
  });
}

export async function startLanHost(): Promise<string> {
  if (Platform.OS === 'web') throw new Error('El host local solo está disponible en Android.');
  if (server) return `http://${await Network.getIpAddressAsync()}:${LAN_PORT}`;

  const { BridgeServer } = await import('react-native-http-bridge-refurbished');
  const nextServer = new BridgeServer('mipypos_lan', false);

  nextServer.get('/v1/health', async () => success({ name: 'MipyPOS', ready: true }));
  nextServer.post<{ username?: string; password?: string }>('/v1/login', async (request) => {
    try {
      const { username = '', password = '' } = request.data;
      const user = await authenticate(username, password);
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
      authorized(request.data.token ?? '', 'sales');
      return success(await buildSnapshot());
    } catch (error) {
      return failure(error);
    }
  });
  nextServer.post<{ token?: string }>('/v1/report', async (request) => {
    try {
      authorized(request.data.token ?? '', 'reports');
      return success<DailyReport>(await getDailyReport());
    } catch (error) {
      return failure(error);
    }
  });
  nextServer.post<NetworkSaleCommand>('/v1/sale', async (request) => {
    try {
      const user = authorized(request.data.token ?? '', 'sales');
      return success({ saleId: await handleNetworkSale(request.data, user) });
    } catch (error) {
      return failure(error);
    }
  });

  nextServer.listen(LAN_PORT);
  server = nextServer;
  return `http://${await Network.getIpAddressAsync()}:${LAN_PORT}`;
}

export function stopLanHost() {
  server?.stop();
  server = null;
  sessions.clear();
}
