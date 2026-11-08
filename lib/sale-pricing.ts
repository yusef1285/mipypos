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

export type WholesaleTier = { wholesale_price: number | null; wholesale_min_qty: number | null };
// Price for one cart line: the wholesale tier replaces the tariff once the line
// reaches its minimum quantity, whatever the tender. Host and POS share this rule.
export function lineUnitPrice(
  product: Pick<Producto, 'price_cash' | 'price_transfer'>,
  method: SaleMethod,
  quantity: number,
  tier?: WholesaleTier | null,
): number {
  const price = saleUnitPrice(product, method);
  if (
    tier?.wholesale_price != null &&
    tier.wholesale_min_qty != null &&
    Number.isFinite(tier.wholesale_price) &&
    tier.wholesale_price >= 0 &&
    quantity + 0.000001 >= tier.wholesale_min_qty
  )
    return tier.wholesale_price;
  return price;
}
