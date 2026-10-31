import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/app-context';
import { canAccess } from '@/lib/permissions';
import { usePosRepository } from '@/lib/use-pos-repository';
import { financeFailure } from '@/components/FinanceControls';
import type { FiscalData, FiscalFilter, OnatCommand } from '@/lib/onat-models';
import * as Haptics from 'expo-haptics';

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
      if (seq === sequence.current) setData(result);
    } catch (failure) {
      if (seq === sequence.current) {
        setData(undefined);
        setError(financeFailure(failure));
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
    setBusy(true);
    setError('');
    try {
      const result = await executeFiscalCommand(command, username);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return result;
    } catch (failure) {
      setError(financeFailure(failure));
      throw failure;
    } finally {
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
