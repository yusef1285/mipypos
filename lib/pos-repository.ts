import { listProducts, registerSale } from '@/lib/database';
import type { CartItem, Payment, SaleMethod } from '@/lib/models';
import { listHostProducts } from '@/lib/network/client';
import { createPendingSale } from '@/lib/network/pending-sale';
import type { NetworkConfig } from '@/lib/network/types';

export function listPosProducts(config: NetworkConfig, search = '') {
  if (config.mode === 'client') {
    if (!config.hostUrl) throw new Error('Escanea el QR del administrador.');
    return listHostProducts(config.hostUrl, search);
  }
  return listProducts(search);
}
export async function registerPosSale(
  config: NetworkConfig,
  cart: CartItem[],
  method: SaleMethod,
  payments: Payment[],
  username: string,
  sessionId: number,
) {
  if (config.mode !== 'client')
    return registerSale(cart, method, payments, username, undefined, sessionId);
  if (!config.hostUrl) throw new Error('Escanea el QR del administrador.');
  return createPendingSale(config, username, {
    method,
    payments,
    sessionId,
    items: cart.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      areaId: item.areaId,
    })),
  });
}
