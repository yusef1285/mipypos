import { randomUUID } from 'expo-crypto';
import { useRef } from 'react';
export function useFinanceCommand() {
  const pending = useRef<{ signature: string; id: string } | null>(null);
  return {
    idFor: (input: unknown) => {
      const signature = JSON.stringify(input);
      if (pending.current?.signature !== signature)
        pending.current = { signature, id: randomUUID() };
      return pending.current.id;
    },
    clear: () => {
      pending.current = null;
    },
  };
}
