import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { HostRejection } from '@/lib/network/client';
import type { CashWithdrawalInput } from '@/lib/models';

const KEY = 'mipypos.pendingWithdrawal.v1';
const schema = z.object({
  authority: z.string(),
  username: z.string(),
  sessionId: z.number().int(),
  commandId: z.string(),
  amount: z.number().positive(),
  reason: z.string().min(1),
});
export type PendingWithdrawal = z.infer<typeof schema>;
export async function getPendingWithdrawal(): Promise<PendingWithdrawal | null> {
  const value = await AsyncStorage.getItem(KEY);
  return value ? schema.parse(JSON.parse(value)) : null;
}
let sending = false;
export async function submitWithdrawal(
  values: Omit<PendingWithdrawal, 'commandId'>,
  credentials: Pick<CashWithdrawalInput, 'adminUsername' | 'adminPassword'>,
  register: (sessionId: number, input: CashWithdrawalInput, username: string) => Promise<number>,
) {
  if (sending) throw new Error('La extracción ya se está confirmando.');
  sending = true;
  try {
    const existing = await getPendingWithdrawal();
    if (
      existing &&
      (existing.authority !== values.authority ||
        existing.username !== values.username ||
        existing.sessionId !== values.sessionId ||
        existing.amount !== values.amount ||
        existing.reason !== values.reason)
    )
      throw new Error(
        'Confirma la extracción pendiente con el mismo usuario, importe y administrador.',
      );
    const command = existing ?? { ...values, commandId: Crypto.randomUUID() };
    await AsyncStorage.setItem(KEY, JSON.stringify(command));
    try {
      const id = await register(
        command.sessionId,
        {
          commandId: command.commandId,
          amount: command.amount,
          reason: command.reason,
          ...credentials,
        },
        command.username,
      );
      await AsyncStorage.removeItem(KEY);
      return id;
    } catch (error) {
      if (
        values.authority === 'local' ||
        (error instanceof HostRejection && error.code === 'REJECTED')
      )
        await AsyncStorage.removeItem(KEY);
      throw error;
    }
  } finally {
    sending = false;
  }
}
