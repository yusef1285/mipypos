import { listProducts, registerSale } from '@/lib/database';
import type { CartItem, Payment, SaleMethod, SaleSettlement } from '@/lib/models';
import { HostRejection, listHostProducts } from '@/lib/network/client';
import {
  discardOutboxSale,
  enqueueOutboxSale,
  syncOutbox,
  type OutboxSale,
} from '@/lib/network/sale-outbox';
import { roundMoney } from '@/lib/units';
import type { NetworkConfig } from '@/lib/network/types';

export function listPosProducts(config: NetworkConfig, search = '') {
  if (config.mode === 'client') {
    if (!config.hostUrl) throw new Error('Escanea el QR del administrador.');
    return listHostProducts(config.hostUrl, search);
  }
  return listProducts(search);
}
export type PosSaleResult = { saleId: number; offline?: undefined } | { offline: OutboxSale };

/**
 * Standalone/host: registers the sale locally. Terminal: the sale goes to the
 * durable outbox first and is sent to the administrator; if the Wi-Fi is down
 * it stays queued (the phone keeps selling) and is confirmed on the next sync.
 */
export async function registerPosSale(
  config: NetworkConfig,
  cart: CartItem[],
  method: SaleMethod,
  payments: Payment[],
  username: string,
  sessionId: number,
  settlement: SaleSettlement,
): Promise<PosSaleResult> {
  if (config.mode !== 'client')
    return {
      saleId: await registerSale(
        cart,
        method,
        payments,
        username,
        undefined,
        sessionId,
        settlement,
      ),
    };
  if (!config.hostUrl) throw new Error('Escanea el QR del administrador.');
  const entry = await enqueueOutboxSale(
    config,
    username,
    {
      method,
      payments,
      sessionId,
      settlement,
      items: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        areaId: item.areaId,
      })),
    },
    {
      total: roundMoney(cart.reduce((sum, item) => sum + item.price * item.quantity, 0)),
      lines: cart.map((item) => ({ name: item.product.name, price: item.price })),
    },
  );
  const result = await syncOutbox(config, username);
  const sent = result.sent.find((item) => item.commandId === entry.command.commandId);
  if (sent) return { saleId: sent.saleId };
  const rejected = result.rejected.find(
    (item) => item.command.commandId === entry.command.commandId,
  );
  if (rejected) {
    // Rejected while online (e.g. stock changed): behave like a normal failed sale.
    if (rejected.notCommitted) {
      await discardOutboxSale(rejected.command.commandId);
      throw new HostRejection(
        rejected.error ?? 'El administrador rechazó la venta.',
        'NOT_COMMITTED',
      );
    }
    throw new Error(
      `${rejected.error ?? 'El administrador no confirmó la venta.'} La venta queda pendiente de revisar.`,
    );
  }
  return { offline: entry };
}
