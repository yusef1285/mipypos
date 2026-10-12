import { z } from 'zod';
import { getSecret, setSecret } from '@/lib/network/secure-storage';
import { pinnedRequest } from '@/lib/network/tls';
const KEY = 'mipypos.pending-revocations';
interface Revocation {
  hostUrl: string;
  hostPin: string;
  token: string;
  expiresAt: number;
}
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.catch(() => undefined);
  return result;
}
const revocationsSchema = z.array(
  z.object({
    hostUrl: z.string(),
    hostPin: z.string(),
    token: z.string(),
    expiresAt: z.number().finite(),
  }),
);
async function load(): Promise<Revocation[]> {
  const data = await getSecret(KEY);
  return (data ? revocationsSchema.parse(JSON.parse(data)) : []).filter(
    (entry) => entry.expiresAt > Date.now(),
  );
}
export function revokeOrDefer(hostUrl: string, hostPin: string, token: string) {
  return serialized(async () => {
    const entries = await load();
    entries.push({ hostUrl, hostPin, token, expiresAt: Date.now() + 16 * 60000 });
    await setSecret(KEY, JSON.stringify(entries));
    await flush(entries, hostUrl);
  });
}
async function flush(entries: Revocation[], hostUrl: string) {
  const remaining: Revocation[] = [];
  for (const entry of entries) {
    if (entry.hostUrl !== hostUrl) {
      remaining.push(entry);
      continue;
    }
    try {
      const response = z
        .object({ ok: z.boolean() })
        .parse(
          JSON.parse(
            await pinnedRequest(entry.hostUrl, '/v1/logout', { token: entry.token }, entry.hostPin),
          ),
        );
      if (!response.ok) remaining.push(entry);
    } catch {
      remaining.push(entry);
    }
  }
  await setSecret(KEY, JSON.stringify(remaining));
}
export function flushRevocations(hostUrl: string) {
  return serialized(async () => flush(await load(), hostUrl));
}
