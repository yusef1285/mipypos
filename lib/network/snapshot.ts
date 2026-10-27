import { z } from 'zod';
import type { NetworkSnapshot } from '@/lib/network/types';
const number = z.number().finite();
const snapshotSchema = z.object({
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
  return parsed.data;
}
