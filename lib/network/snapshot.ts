import { z } from 'zod';
import type { NetworkSnapshot } from '@/lib/network/types';
const number = z.number().finite();
export const snapshotSchema = z.object({
  revision: number.int().nonnegative(),
  authorityId: z.string().min(1).optional(),
  licenseMode: z.enum(['demo', 'pro']),
  products: z.array(
    z.object({
      id: number.int().positive(),
      name: z.string(),
      category: z.string(),
      subcategory: z.string(),
      unit: z.string(),
      quantity_decimals: z.union([z.literal(0), z.literal(3)]),
      stock: number.nonnegative(),
      price_cash: number.nonnegative(),
      price_transfer: number.nonnegative(),
      image_path: z.string().nullable(),
      unit_cost: number.nonnegative().nullable().optional(),
    }),
  ),
  areas: z.array(z.object({ id: number.int().positive(), name: z.string() })),
  areaStock: z.array(
    z.object({
      area_id: number.int().positive(),
      product_id: number.int().positive(),
      quantity: number.nonnegative(),
    }),
  ),
  session: z
    .object({
      id: number.int().positive(),
      open_date: z.string(),
      close_date: z.string().nullable(),
      fund: number.nonnegative(),
      final_cash: number.nullable(),
      expected_cash: number.nullable(),
      transfer_total: number.nullable(),
      products_start: z.record(z.string(), number),
      products_end: z.record(z.string(), number).nullable(),
      cash_count: number.nullable(),
      transfer_count: number.nullable(),
      movement_start_id: number.int().nullable(),
    })
    .nullable(),
});
export const unchangedSnapshotSchema = z.object({
  unchanged: z.literal(true),
  revision: number.int().nonnegative(),
  authorityId: z.string().min(1),
});
export function parseSnapshot(value: unknown): NetworkSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      'No se pudo verificar la copia de existencias del administrador. Actualiza ambos dispositivos e inténtalo de nuevo.',
    );
  const snapshot = parsed.data;
  const products = new Set(snapshot.products.map((product) => product.id));
  const areas = new Set(snapshot.areas.map((area) => area.id));
  const pairs = new Set<string>();
  const totals = new Map<number, number>();
  let invalid = products.size !== snapshot.products.length || areas.size !== snapshot.areas.length;
  for (const stock of snapshot.areaStock) {
    const key = `${stock.area_id}:${stock.product_id}`;
    if (!products.has(stock.product_id) || !areas.has(stock.area_id) || pairs.has(key))
      invalid = true;
    pairs.add(key);
    totals.set(stock.product_id, (totals.get(stock.product_id) ?? 0) + stock.quantity);
  }
  if (
    snapshot.products.some(
      (product) => Math.abs(product.stock - (totals.get(product.id) ?? 0)) > 0.001,
    )
  )
    invalid = true;
  if (invalid)
    throw new Error(
      'La copia recibida tiene existencias o referencias inconsistentes. Vuelve a sincronizar.',
    );
  return snapshot;
}
