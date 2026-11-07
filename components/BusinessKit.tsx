import { Button, Card, Typography } from 'heroui-native';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';

import { FinanceField, financeFailure, numeric } from '@/components/FinanceControls';
import { useApp } from '@/lib/app-context';
import type { BusinessCommand, BusinessData, BusinessFilter } from '@/lib/business-models';
import { usePosRepository } from '@/lib/use-pos-repository';

// Body of a command without its idempotency key; the kit adds a fresh one per attempt.
export type CommandBody = BusinessCommand extends infer T
  ? T extends unknown
    ? Omit<T, 'commandId'>
    : never
  : never;

export const amount = (value: number, currency = 'CUP') =>
  `${value.toLocaleString('es-CU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
export const quantityText = (value: number) =>
  value.toLocaleString('es-CU', { maximumFractionDigits: 3 });
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const monthStartIso = () => `${todayIso().slice(0, 8)}01`;
export const methodLabel = { cash: 'Efectivo', transfer: 'Transferencia', other: 'Otro' } as const;
export const methods = ['cash', 'transfer', 'other'] as const;

// Parses a decimal typed by the user; returns NaN for empty input so zod reports it.
export const parseAmount = (value: string) => (value.trim() ? numeric(value) : Number.NaN);

export function useBusinessData(filter: BusinessFilter = {}) {
  const { user } = useApp();
  const username = user?.username ?? '';
  const { getBusinessData } = usePosRepository();
  const [data, setData] = useState<BusinessData>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { start, end } = filter;
  const load = useCallback(async () => {
    try {
      setError('');
      setData(await getBusinessData({ start, end }, username));
    } catch (failure) {
      setError(financeFailure(failure));
    } finally {
      setLoading(false);
    }
  }, [end, getBusinessData, start, username]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  return { data, error, loading, load };
}

export function useBusinessCommand(reload: () => Promise<void>) {
  const { user } = useApp();
  const username = user?.username ?? '';
  const { executeBusinessCommand } = usePosRepository();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (body: CommandBody, success?: string) => {
      if (busy) return false;
      setBusy(true);
      try {
        await executeBusinessCommand({ ...body, commandId: randomUUID() }, username);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (success) Alert.alert('Listo', success);
        await reload();
        return true;
      } catch (failure) {
        Alert.alert('No se pudo completar', financeFailure(failure));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, executeBusinessCommand, reload, username],
  );
  return { busy, run };
}

export function FormCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-3 p-4">
      <Typography.Heading type="h4">{title}</Typography.Heading>
      {children}
    </Card>
  );
}

export function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Typography.Paragraph type="body-sm" color="muted">
        {label}
      </Typography.Paragraph>
      <Typography.Paragraph type="body-sm" className={`font-semibold ${tone ?? ''}`}>
        {value}
      </Typography.Paragraph>
    </View>
  );
}

// Reason prompt that works on Android (Alert.prompt is iOS only).
export function ReasonForm({
  title,
  busy,
  onSubmit,
  onCancel,
}: {
  title: string;
  busy: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Card className="gap-3 p-4">
      <FinanceField label={title} value={reason} onChange={setReason} />
      <View className="flex-row gap-2">
        <Button
          className="flex-1"
          variant="danger"
          isDisabled={busy || reason.trim().length < 3}
          onPress={() => onSubmit(reason.trim())}
        >
          <Button.Label>Confirmar</Button.Label>
        </Button>
        <Button className="flex-1" variant="secondary" onPress={onCancel}>
          <Button.Label>Cancelar</Button.Label>
        </Button>
      </View>
    </Card>
  );
}
