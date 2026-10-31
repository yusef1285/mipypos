import { randomUUID } from 'expo-crypto';
import { useState } from 'react';

export function createFinanceCommandIdentity() {
  let pending: { signature: string; id: string } | null = null;
  return {
    idFor: (input: unknown) => {
      const signature = JSON.stringify(input);
      if (pending?.signature !== signature) pending = { signature, id: randomUUID() };
      return pending.id;
    },
    clear: () => {
      pending = null;
    },
  };
}

export function useFinanceCommand() {
  return useState(createFinanceCommandIdentity)[0];
}
