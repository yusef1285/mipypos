import * as Crypto from 'expo-crypto';

import { getSale, listProducts, registerSale } from '@/lib/database';
import type { CartItem, Payment, SaleMethod } from '@/lib/models';
import { listHostProducts, registerHostSale } from '@/lib/network/client';
import type { NetworkConfig } from '@/lib/network/types';

export function listPosProducts(config: NetworkConfig, search = '') {
  return config.mode === 'client' && config.hostUrl
    ? listHostProducts(config.hostUrl, search)
    : listProducts(search);
}

export async function registerPosSale(
  config: NetworkConfig,
  cart: CartItem[],
  method: SaleMethod,
  payments: Payment[],
  username: string,
) {
  if (config.mode !== 'client' || !config.hostUrl)
    return registerSale(cart, method, payments, username);
  return registerHostSale(config.hostUrl, {
    commandId: Crypto.randomUUID(),
    clientId: config.clientId,
    method,
    payments,
    items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
  });
}

export function getPosSale(config: NetworkConfig, id: number) {
  if (config.mode === 'client') return null;
  return getSale(id);
}
