import * as Haptics from 'expo-haptics';
import { Button, Input, Label, Skeleton, TextField, Typography } from 'heroui-native';
import { useEffect, useState } from 'react';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { money, parsePositiveNumber } from '@/lib/format';
import {
  getPendingWithdrawal,
  submitWithdrawal,
  type PendingWithdrawal,
} from '@/lib/network/pending-withdrawal';
import { usePosRepository } from '@/lib/use-pos-repository';

export function CashWithdrawalForm({
  sessionId,
  available,
  onDone,
}: {
  sessionId: number;
  available: number;
  onDone: () => void;
}) {
  const { user, refresh, networkConfig } = useApp();
  const { registerCashWithdrawal } = usePosRepository();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [admin, setAdmin] = useState(user?.role === 'admin' ? user.username : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingWithdrawal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    void getPendingWithdrawal()
      .then((value) => {
        setPending(value);
        if (value) {
          setAmount(String(value.amount));
          setReason(value.reason);
        }
      })
      .catch(() => {
        setError('No se pudo recuperar la extracción pendiente. Vuelve a abrir Caja.');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      })
      .finally(() => setLoading(false));
  }, []);
  const save = async () => {
    if (!user || busy) return;
    let committed = false;
    try {
      setBusy(true);
      setError('');
      const value = parsePositiveNumber(amount, 'El importe');
      await submitWithdrawal(
        {
          sessionId: pending?.sessionId ?? sessionId,
          authority: networkConfig.mode === 'client' ? networkConfig.hostUrl : 'local',
          ...(networkConfig.mode === 'client' && networkConfig.hostPin
            ? { hostPin: networkConfig.hostPin }
            : {}),
          username: user.username,
          amount: value,
          reason: reason.trim(),
        },
        { adminUsername: admin, adminPassword: password },
        registerCashWithdrawal,
      );
      committed = true;
      setPending(null);
      setPassword('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
      onDone();
    } catch (failure) {
      if (committed) {
        onDone();
        return;
      }
      setPending(await getPendingWithdrawal());
      setError(failure instanceof Error ? failure.message : 'No se pudo registrar la extracción.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Extracción de caja" keyboard>
      {loading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <>
          <Typography.Paragraph>Disponible: {money(available)}</Typography.Paragraph>
          <TextField>
            <Label>Importe (CUP)</Label>
            <Input
              editable={!busy && !pending}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </TextField>
          <TextField>
            <Label>Motivo</Label>
            <Input editable={!busy && !pending} value={reason} onChangeText={setReason} />
          </TextField>
          <TextField>
            <Label>Usuario administrador</Label>
            <Input editable={!busy} autoCapitalize="none" value={admin} onChangeText={setAdmin} />
          </TextField>
          <TextField>
            <Label>Contraseña</Label>
            <Input editable={!busy} secureTextEntry value={password} onChangeText={setPassword} />
          </TextField>
          {pending ? (
            <Typography.Paragraph color="muted">
              Extracción pendiente de {pending.username}. Reintenta con el mismo importe para
              comprobarla sin duplicar el retiro.
            </Typography.Paragraph>
          ) : null}
          <Button
            isDisabled={busy || !amount.trim() || !reason.trim() || !admin.trim() || !password}
            onPress={() => void save()}
          >
            <Button.Label>
              {busy
                ? 'Registrando…'
                : pending
                  ? 'Confirmar extracción pendiente'
                  : 'Autorizar extracción'}
            </Button.Label>
          </Button>
        </>
      )}
      {error ? <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph> : null}
      <Button variant="secondary" isDisabled={busy} onPress={onDone}>
        <Button.Label>Volver a caja</Button.Label>
      </Button>
    </Screen>
  );
}
