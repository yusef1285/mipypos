import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';

// Orders parked on this device (tables in restaurant mode, or a customer who
// steps away). They hold no stock and no money: resuming only refills the cart,
// and prices and stock are validated again when the sale is completed.
const KEY = 'mipypos.held-orders.v1';
const heldOrderSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  areaId: z.number().int().positive(),
  items: z
    .array(z.object({ productId: z.number().int().positive(), quantity: z.number().positive() }))
    .min(1)
    .max(200),
  owner: z.string(),
  createdAt: z.string(),
});
export type HeldOrder = z.infer<typeof heldOrderSchema>;

export async function listHeldOrders(owner: string): Promise<HeldOrder[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const parsed = z.array(heldOrderSchema).safeParse(raw ? JSON.parse(raw) : []);
  return parsed.success ? parsed.data.filter((order) => order.owner === owner) : [];
}
async function writeAll(orders: HeldOrder[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(orders));
}
async function readAll(): Promise<HeldOrder[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const parsed = z.array(heldOrderSchema).safeParse(raw ? JSON.parse(raw) : []);
  return parsed.success ? parsed.data : [];
}
export async function holdOrder(order: Omit<HeldOrder, 'id' | 'createdAt'>) {
  const valid = heldOrderSchema.parse({
    ...order,
    id: Crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  const all = await readAll();
  if (all.filter((row) => row.owner === order.owner).length >= 30)
    throw new Error('Hay demasiados pedidos en espera. Completa o elimina alguno.');
  await writeAll([...all, valid]);
  return valid;
}
export async function removeHeldOrder(id: string) {
  await writeAll((await readAll()).filter((order) => order.id !== id));
}
