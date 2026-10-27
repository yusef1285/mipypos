import * as Crypto from 'expo-crypto';
import type { Payment, SaleMethod, SaleSettlement } from '@/lib/models';
export interface SaleIdentityInput {
  items: Array<{ productId: number; areaId: number; quantity: number }>;
  method: SaleMethod;
  payments: Payment[];
  sessionId?: number;
  settlement?: SaleSettlement;
}
export function saleFingerprint(input: SaleIdentityInput) {
  // Prices and names may change while a committed command waits for its ACK.
  // Identity covers the original intent, not the current catalog's values.
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify({
      items: input.items.map((item) => ({
        productId: item.productId,
        areaId: item.areaId,
        quantity: item.quantity,
      })),
      method: input.method,
      payments: input.payments,
      sessionId: input.sessionId,
      settlement: input.settlement ?? null,
    }),
  );
}
