import { advertiseLanHost, stopLanAdvertisement } from '@/lib/network/discovery';
import { z } from 'zod';
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
import { redactCosts } from '@/lib/finance-privacy';
import { saleUnitPrice } from '@/lib/sale-pricing';
import { saleFingerprint } from '@/lib/sale-identity';
import { assertOperationRequest, assertSaleCommand, ProtocolError } from '@/lib/network/validation';
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
function requestIdentity(value: unknown): string | undefined {
  if (
    value &&
    typeof value === 'object' &&
    'commandId' in value &&
    typeof value.commandId === 'string' &&
    value.commandId.length <= 128
  )
    return value.commandId;
  return undefined;
}
class ExpiredSession extends Error {}
function failure(error: unknown, requestId?: string): ApiResult<never> {
  return {
    ok: false,
    success: false,
    ...(requestId ? { requestId } : {}),
    code:
      error instanceof ExpiredSession
        ? 'AUTH_EXPIRED'
        : error instanceof ProtocolError
          ? error.code
          : 'REJECTED',
    error: error instanceof Error ? error.message : 'Solicitud no válida.',
  };
}

async function authorized(token: string, module: ModuleKey, auditRead = false) {
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
  if (
    !canAccess(current.role, module, current.can_manage_fiscal) &&
    !(current.role === 'auditor' && auditRead)
  )
    throw new Error(
      'Tu rol no permite esta operación. Pide al administrador que revise tu acceso.',
    );
  entry.expiresAt = Date.now() + 15 * 60 * 1000;
  return current;
}

async function buildSnapshot(): Promise<NetworkSnapshot> {
  return DB.getSharedSnapshot();
}

async function handleOperation(request: OperationRequest, user: Usuario): Promise<unknown> {
  if (
    user.role === 'auditor' &&
    operationPermissions[request.operation] !== 'onat' &&
    (mutationOperations.has(request.operation) || request.operation === 'registerCashWithdrawal')
  )
    throw new Error('El auditor solo puede consultar.');
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
    case 'getFiscalData':
      return DB.getFiscalData(request.args[0], user.username);
    case 'executeFiscalCommand':
      return DB.executeFiscalCommand(request.args[0], user.username, command);
    case 'setFiscalPermission':
      return DB.setFiscalPermission(request.args[0], request.args[1], user.username, command);
    case 'getInvestmentData':
      return DB.getInvestmentData(user.username);
    case 'setProductCost':
      return DB.setProductCost(request.args[0], user.username, command);
    case 'receiveCostedStock':
      return DB.receiveCostedStock(request.args[0], user.username, command);
    case 'getFinanceReport':
      return DB.getFinanceReport(request.args[0], user.username);
    case 'getConsumptionData':
      return DB.getConsumptionData(user.username);
    case 'registerConsumption':
      return DB.registerConsumption(request.args[0], user.username, command);
    case 'cancelConsumption':
      return DB.cancelConsumption(request.args[0], user.username, command);
    case 'registerSaleAdjustment':
      return DB.registerSaleAdjustment(request.args[0], user.username, command);
    case 'setConsumptionPermission':
      return DB.setConsumptionPermission(request.args[0], request.args[1], user.username, command);
    case 'getAuditSnapshot':
      return DB.getAuditSnapshot();
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
    case 'findTransferTransaction':
      return DB.findTransferTransaction(request.args[0]);
    default:
      throw new ProtocolError(
        'UNKNOWN_OPERATION',
        'Esta operación no está disponible. Actualiza ambos dispositivos.',
      );
  }
}

async function handleNetworkSale(command: NetworkSaleCommand, user: Usuario) {
  if (!command.commandId || !command.clientId)
    throw new Error('La venta no tiene identidad de red.');
  if (!Array.isArray(command.items) || !command.items.length)
    throw new Error('El carrito está vacío.');
  const previous = await DB.findNetworkSale(
    command.commandId,
    command.clientId,
    user.username,
    await saleFingerprint(command),
  );
  if (previous !== null) return previous;
  if (!command.settlement)
    throw new Error(
      'Actualiza la terminal: introduce el efectivo recibido o el comprobante de transferencia.',
    );
  if (!Number.isInteger(command.sessionId)) throw new Error('Actualiza la caja antes de vender.');
  const byId = new Map((await DB.listProducts()).map((product) => [product.id, product]));
  const items: CartItem[] = command.items.map((input) => {
    const product = byId.get(input.productId);
    if (!product) throw new Error('Uno de los productos ya no existe.');
    return {
      product,
      areaId: input.areaId,
      quantity: input.quantity,
      price: saleUnitPrice(product, command.method),
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
    command.settlement,
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
  if (server) await stopLanHostAndDrain();
  if (!NativeModules.MipyTls)
    throw new Error(
      'Esta instalación no incluye el servidor LAN. Instala una compilación Android con el módulo de red.',
    );
  const nextServer = new SecureLanServer();
  nextServer.get('/v1/health', async () => success({ name: 'MipyPOS', protocol: 4, ready: true }));
  nextServer.post('/v1/login', async (request) => {
    try {
      const { username, password } = z
        .object({
          username: z.string().max(240).default(''),
          password: z.string().max(1024).default(''),
        })
        .parse(request.data);
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
        can_authorize_consumption: user.can_authorize_consumption,
      };
      return success({ token, user: publicUser });
    } catch (error) {
      return failure(error, requestIdentity(request.data));
    }
  });
  nextServer.post('/v1/logout', async (request) => {
    try {
      const input = z.object({ token: z.string().max(512).default('') }).parse(request.data);
      sessions.delete(input.token);
      return success(null);
    } catch (error) {
      return failure(error, requestIdentity(request.data));
    }
  });
  nextServer.post('/v1/snapshot', async (request) => {
    try {
      const input = z
        .object({
          token: z.string().max(512).default(''),
          knownRevision: z.number().int().nonnegative().optional(),
          authorityId: z.string().min(1).optional(),
        })
        .parse(request.data);
      const user = await authorized(input.token, 'home');
      if (input.knownRevision !== undefined && input.authorityId) {
        const current = await DB.getSharedRevision();
        if (current.revision === input.knownRevision && current.authorityId === input.authorityId)
          return success({ unchanged: true, ...current });
      }
      const snapshot = await buildSnapshot();
      return success(user.role === 'admin' ? snapshot : redactCosts(snapshot));
    } catch (error) {
      return failure(error, requestIdentity(request.data));
    }
  });
  nextServer.post('/v1/report', async (request) => {
    try {
      const input = z.object({ token: z.string().max(512).default('') }).parse(request.data);
      const user = await authorized(input.token, 'reports');
      const report = await DB.getDailyReport();
      return success(user.role === 'admin' ? report : redactCosts(report));
    } catch (error) {
      return failure(error, requestIdentity(request.data));
    }
  });
  nextServer.post('/v1/receipt', async (request) => {
    try {
      const input = request.data;
      assertOperationRequest(input);
      // Receipt lookup never executes a mutation: match the authenticated owner,
      // terminal and fingerprint even if the committed change revoked their role.
      const user = await authorized(
        input.token,
        operationPermissions[input.operation] === 'onat' ? 'onat' : 'home',
      );
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
      return failure(error, requestIdentity(request.data));
    }
  });
  nextServer.post('/v1/operation', async (request) => {
    try {
      const input = request.data;
      // Authorize the minimally validated envelope before inspecting command arguments.
      const envelope = z
        .object({ operation: z.string(), token: z.string(), args: z.array(z.unknown()) })
        .parse(input);
      const operation = Object.keys(operationPermissions).find(
        (key): key is keyof typeof operationPermissions => key === envelope.operation,
      );
      if (!operation)
        throw new ProtocolError(
          'UNKNOWN_OPERATION',
          'Esta operación no está disponible. Actualiza ambos dispositivos.',
        );
      const module =
        operation === 'getExportRows' && envelope.args[0] === 'inventory'
          ? 'products'
          : operationPermissions[operation];
      const auditReads = new Set([
        'listProducts',
        'listAreas',
        'listAreaStock',
        'listMovements',
        'getCashClosurePreview',
        'listCashClosures',
        'getDailyReport',
        'getHomeSummary',
        'getExportRows',
        'getSale',
        'getDemoUsage',
        'getAuditSnapshot',
      ]);
      const user = await authorized(envelope.token, module, auditReads.has(operation));
      assertOperationRequest(input);
      const result = (await handleOperation(input, user)) ?? null;
      return success(user.role === 'admin' || module === 'onat' ? result : redactCosts(result));
    } catch (error) {
      return failure(error, requestIdentity(request.data));
    }
  });
  nextServer.post('/v1/sale-receipt', async (request) => {
    try {
      assertSaleCommand(request.data);
      const user = await authorized(request.data.token, 'home');
      const saleId = await DB.getNetworkSaleReceipt(
        request.data.commandId,
        request.data.clientId,
        user.username,
        await saleFingerprint(request.data),
      );
      return success({ saleId });
    } catch (error) {
      return failure(error, requestIdentity(request.data));
    }
  });
  nextServer.post('/v1/withdrawal-receipt', async (request) => {
    try {
      const input = z
        .object({
          token: z.string().max(512).default(''),
          sessionId: z.number().int().positive(),
          commandId: z.string().min(1).max(128),
          amount: z.number().finite().positive(),
          reason: z.string().min(1).max(2000),
        })
        .parse(request.data);
      const user = await authorized(input.token, 'home');
      return success({
        withdrawalId: await DB.findCashWithdrawalReceipt(input.sessionId, input, user.username),
      });
    } catch (error) {
      return failure(error, requestIdentity(request.data));
    }
  });
  nextServer.post('/v1/sale', async (request) => {
    try {
      const { token } = z.object({ token: z.string().max(512).default('') }).parse(request.data);
      const user = await authorized(token, 'sales');
      assertSaleCommand(request.data);
      return success({ saleId: await handleNetworkSale(request.data, user) });
    } catch (error) {
      return failure(error, requestIdentity(request.data));
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
  const identity = await DB.getSharedRevision();
  await advertiseLanHost(identity.authorityId, LAN_PORT);
  return address;
}
export async function stopLanHostAndDrain() {
  stopLanAdvertisement();
  const active = server;
  server = null;
  sessions.clear();
  if (active) await active.stopAndDrain();
}
export function stopLanHost() {
  stopLanAdvertisement();
  server?.stop();
  server = null;
  sessions.clear();
}
