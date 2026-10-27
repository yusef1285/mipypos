import type { Producto, SaleMethod } from '@/lib/models';

// One price per line, regardless of how the tender is split. Mixed sales use
// the cash tariff for the entire cart; the transfer only settles part of it.
export const MIXED_PRICE_BASIS = 'cash' as const;
export function saleUnitPrice(
  product: Pick<Producto, 'price_cash' | 'price_transfer'>,
  method: SaleMethod,
): number {
  if (method !== 'cash' && method !== 'transfer' && method !== 'mixed')
    throw new Error('El método de pago no está permitido.');
  const price = method === 'transfer' ? product.price_transfer : product.price_cash;
  if (!Number.isFinite(price) || price < 0) throw new Error('El precio del producto no es válido.');
  return price;
}
