import * as Haptics from 'expo-haptics';
import { Button, Card, Typography } from 'heroui-native';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useApp } from '@/lib/app-context';
import { money } from '@/lib/format';
import {
  discardOutboxSale,
  getOutbox,
  retryOutboxSale,
  syncOutbox,
  type OutboxSale,
} from '@/lib/network/sale-outbox';

/** Terminal sales queued while the administrator was unreachable. */
export function SaleOutboxPanel({ onChange }: { onChange?: () => void }) {
  const { user, networkConfig, session, refresh } = useApp();
  const [entries, setEntries] = useState<OutboxSale[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    try {
      setEntries((await getOutbox()).entries);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'No se pudo leer la cola.');
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const timer = setInterval(() => void reload(), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [reload]);
  if (!user || !entries.length) return null;
  const pending = entries.filter((entry) => entry.status === 'pending');
  const rejected = entries.filter((entry) => entry.status === 'rejected');
  const others = pending.filter((entry) => entry.username !== user.username).length;
  const sync = async () => {
    try {
      setBusy(true);
      setMessage('');
      const result = await syncOutbox(networkConfig, user.username);
      if (result.authExpired) {
        await refresh().catch(() => undefined);
        setMessage(
          'Renovando la sesión con el administrador. Vuelve a intentarlo en unos segundos.',
        );
      } else if (result.offline)
        setMessage('El administrador sigue sin responder. Las ventas se conservan en el teléfono.');
      else if (result.sent.length)
        setMessage(
          `${result.sent.length} ${result.sent.length === 1 ? 'venta enviada' : 'ventas enviadas'} al administrador.`,
        );
      if (result.rejected.length)
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      await refresh().catch(() => undefined);
      onChange?.();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'No se pudo sincronizar.');
    } finally {
      await reload();
      setBusy(false);
    }
  };
  const retry = async (entry: OutboxSale) => {
    try {
      setBusy(true);
      await retryOutboxSale(entry.command.commandId, session?.id);
      await reload();
      await sync();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'No se pudo reintentar.');
      setBusy(false);
    }
  };
  const discard = (entry: OutboxSale) =>
    Alert.alert(
      `Descartar venta T-${entry.localNumber}`,
      `El administrador confirmó que esta venta de ${money(entry.total)} no se registró. Si cobraste al cliente, devuelve el dinero o registra la venta de nuevo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descartar',
          style: 'destructive',
          onPress: () =>
            void discardOutboxSale(entry.command.commandId)
              .then(reload)
              .then(() => onChange?.())
              .catch((failure: unknown) =>
                setMessage(failure instanceof Error ? failure.message : 'No se pudo descartar.'),
              ),
        },
      ],
    );
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <CloudOff size={18} />
        <Typography.Heading type="h4">
          {pending.length} {pending.length === 1 ? 'venta sin enviar' : 'ventas sin enviar'}
        </Typography.Heading>
      </View>
      <Typography.Paragraph type="body-sm" color="muted">
        Se guardaron en este teléfono y se envían solas al administrador cuando vuelve la conexión.
        No cierres la caja en el administrador hasta que lleguen.
        {others ? ` ${others} pertenecen a otro usuario: debe iniciar sesión para enviarlas.` : ''}
      </Typography.Paragraph>
      {rejected.map((entry) => (
        <View key={entry.command.commandId} className="gap-2">
          <Typography.Paragraph className="text-danger">
            T-{entry.localNumber} · {money(entry.total)} · rechazada: {entry.error}
          </Typography.Paragraph>
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy}
              onPress={() => void retry(entry)}
            >
              <Button.Label>
                {entry.notCommitted ? 'Reintentar en la caja actual' : 'Reintentar'}
              </Button.Label>
            </Button>
            {entry.notCommitted ? (
              <Button
                size="sm"
                variant="danger-soft"
                isDisabled={busy}
                onPress={() => discard(entry)}
              >
                <Button.Label>Descartar</Button.Label>
              </Button>
            ) : null}
          </View>
        </View>
      ))}
      {message ? <Typography.Paragraph type="body-sm">{message}</Typography.Paragraph> : null}
      <Button variant="secondary" isDisabled={busy} onPress={() => void sync()}>
        <RefreshCw size={16} />
        <Button.Label>{busy ? 'Sincronizando…' : 'Sincronizar ahora'}</Button.Label>
      </Button>
    </Card>
  );
}
