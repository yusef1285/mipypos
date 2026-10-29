import { findCashWithdrawalReceipt } from '@/lib/database';
import { createPendingStore } from '@/lib/network/pending-store';
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
const store = createPendingStore(KEY, (raw) => schema.parse(JSON.parse(raw)), { allowWeb: true });
export const getPendingWithdrawal = store.get;
export async function upgradePendingWithdrawalTransport(
  hostUrl: string,
  verifiedPreviousHost?: string,
) {
  const pending = await getPendingWithdrawal();
  if (
    pending &&
    ((pending.authority.startsWith('http:') &&
      pending.authority.replace(/^http:/, 'https:') === hostUrl) ||
      pending.authority === verifiedPreviousHost)
  )
    await store.set({ ...pending, authority: hostUrl });
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
    await store.set(command);
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
      await store.clear();
      return id;
    } catch (error) {
      if (values.authority === 'local') {
        const receipt = await findCashWithdrawalReceipt(
          command.sessionId,
          command,
          command.username,
        );
        if (receipt !== null) {
          await store.clear();
          return receipt;
        }
        await store.clear();
      } else if (error instanceof HostRejection && error.code === 'NOT_COMMITTED')
        await store.clear();
      throw error;
    }
  } finally {
    sending = false;
  }
}
