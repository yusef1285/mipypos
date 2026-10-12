import * as Crypto from 'expo-crypto';
import { getSecret, setSecret, removeSecret } from '@/lib/network/secure-storage';
import type { OperationRequest, PosOperation } from '@/lib/network/operations';

const KEY = 'mipypos.pending-operation';
export interface PendingOperation {
  hostUrl: string;
  username: string;
  clientId: string;
  commandId: string;
  operation: PosOperation;
  args: OperationRequest['args'];
  fingerprint: string;
}
export async function getPendingOperation(): Promise<PendingOperation | null> {
  const stored = await getSecret(KEY);
  return stored ? (JSON.parse(stored) as PendingOperation) : null;
}
export async function operationFingerprint(operation: string, args: unknown): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([operation, args]),
  );
}
export async function prepareOperation(input: Omit<PendingOperation, 'commandId' | 'fingerprint'>) {
  const fingerprint = await operationFingerprint(input.operation, input.args);
  const pending = await getPendingOperation();
  if (pending) {
    if (
      pending.hostUrl !== input.hostUrl ||
      pending.username !== input.username ||
      pending.clientId !== input.clientId ||
      pending.fingerprint !== fingerprint
    )
      throw new Error(
        'Hay una operación pendiente. Vuelve a iniciar sesión con el mismo usuario para confirmar su resultado.',
      );
    return pending;
  }
  const next = { ...input, commandId: Crypto.randomUUID(), fingerprint };
  await setSecret(KEY, JSON.stringify(next));
  return next;
}
export async function rebindPendingOperation(verifiedPreviousHost: string, hostUrl: string) {
  const pending = await getPendingOperation();
  if (pending?.hostUrl === verifiedPreviousHost)
    await setSecret(KEY, JSON.stringify({ ...pending, hostUrl }));
}
export const clearPendingOperation = () => removeSecret(KEY);
