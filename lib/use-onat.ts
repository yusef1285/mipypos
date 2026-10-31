import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/app-context';
import { canAccess } from '@/lib/permissions';
import { usePosRepository } from '@/lib/use-pos-repository';
import { financeFailure } from '@/components/FinanceControls';
import type { FiscalData, FiscalFilter, OnatCommand } from '@/lib/onat-models';
import * as Haptics from 'expo-haptics';
import { useFinanceCommand } from '@/lib/use-finance-command';
import { reconcileFiscalReminders } from '@/lib/onat-notifications';

export function useOnat(filter: FiscalFilter) {
  const { user } = useApp();
  const username = user?.username ?? '';
  const { getFiscalData, executeFiscalCommand } = usePosRepository();
  const allowed = canAccess(user?.role, 'onat', user?.can_manage_fiscal);
  const [data, setData] = useState<FiscalData>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const commandIdentity = useFinanceCommand();
  const saving = useRef(false);
  const { taxpayerId, start, end } = filter;
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    if (!allowed) {
      setData(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await getFiscalData({ taxpayerId, start, end }, username);
      if (seq === sequence.current) {
        setData(result);
        try {
          await reconcileFiscalReminders(result.records);
        } catch {
          if (seq === sequence.current) {
            setError(
              'Los datos están actualizados, pero no se pudieron cancelar los recordatorios cumplidos. Vuelve a intentar.',
            );
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          }
        }
      }
    } catch (failure) {
      if (seq === sequence.current) {
        setData(undefined);
        setError(financeFailure(failure));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [allowed, getFiscalData, taxpayerId, start, end, username]);
  useEffect(() => {
    const requestSequence = sequence;
    let cancelled = false;
    // Start the SQLite refresh asynchronously; cleanup also cancels queued work.
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      requestSequence.current++;
    };
  }, [load]);
  const save = async (command: OnatCommand) => {
    if (saving.current) throw new Error('Espera a que termine el registro en curso.');
    saving.current = true;
    setBusy(true);
    setError('');
    // The UI can generate a fresh UUID on every tap; transport retries must not.
    const stableId = commandIdentity.idFor({ ...command, commandId: undefined });
    try {
      const result = await executeFiscalCommand({ ...command, commandId: stableId }, username);
      commandIdentity.clear();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return result;
    } catch (failure) {
      setError(financeFailure(failure));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      throw failure;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return { data: allowed ? data : undefined, allowed, loading, busy, error, load, save };
}
export function todayFiscal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fiscalMonth() {
  const today = todayFiscal();
  const d = new Date();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${end}` };
}
