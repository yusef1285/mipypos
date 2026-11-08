import * as Haptics from 'expo-haptics';
import { Button, Card, Typography } from 'heroui-native';
import { useState } from 'react';
import { View } from 'react-native';
import { useApp } from '@/lib/app-context';
import type { BusinessArchive } from '@/lib/business-archive';
import {
  pickBusinessArchive,
  receiveBusinessArchive,
  shareBusinessArchive,
} from '@/lib/business-transfer';
import { isDesktop } from '@/lib/desktop';
import { money } from '@/lib/format';
import { getPendingSale } from '@/lib/network/pending-sale';
import { getPendingOperation } from '@/lib/network/pending-operation';
import { getPendingWithdrawal } from '@/lib/network/pending-withdrawal';

export function BusinessTransfer() {
  const { user, networkConfig, session, refresh, logout } = useApp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [incoming, setIncoming] = useState<BusinessArchive | null>(null);
  if (user?.role !== 'admin') return null;
  const desktop = isDesktop();
  const run = async (action: () => Promise<void>) => {
    try {
      setBusy(true);
      setError('');
      setMessage('');
      if (networkConfig.mode !== 'standalone')
        throw new Error(
          'Desconecta las terminales y selecciona trabajar solo antes de trasladar el negocio.',
        );
      if (
        (await getPendingSale()) ||
        (await getPendingOperation()) ||
        (await getPendingWithdrawal())
      )
        throw new Error('Confirma todas las operaciones pendientes antes de trasladar el negocio.');
      await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo trasladar el negocio.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="gap-4 p-4">
      <Typography.Heading type="h4">
        {desktop ? 'Copias y traslado del negocio' : 'Continuar en otro teléfono'}
      </Typography.Heading>
      {desktop ? (
        <Typography.Paragraph type="body-sm" color="muted">
          En Windows el archivo se guarda en Documentos\MipyPOS\Copias y se crea una copia
          automática después de cada cierre de caja. Para pasar el negocio de un teléfono a esta
          computadora, copia aquí el JSON del teléfono y usa “Recibir archivo de cierre”.
        </Typography.Paragraph>
      ) : null}
      <Typography.Paragraph>
        El archivo incluye usuarios, ventas, comprobantes, cierres y existencias, pero no
        contraseñas ni hashes de acceso. La licencia permanece en cada teléfono. Compártelo solo con
        personas autorizadas: contiene información comercial y datos personales.
      </Typography.Paragraph>
      <Typography.Paragraph type="body-sm" color="muted">
        Cierra la caja y deja de operar en el teléfono anterior. Recibe el archivo en un teléfono
        sin productos ni turnos; no se mezclan negocios.
      </Typography.Paragraph>
      <Button
        isDisabled={busy || !!session}
        onPress={() =>
          void run(async () => {
            const path = await shareBusinessArchive(user.username);
            setMessage(
              desktop
                ? `Copia guardada en ${path}`
                : 'Archivo de cierre guardado y listo para compartir.',
            );
          })
        }
      >
        <Button.Label>
          {busy
            ? 'Procesando…'
            : desktop
              ? 'Guardar copia del cierre'
              : 'Guardar y enviar cierre completo'}
        </Button.Label>
      </Button>
      <Button
        variant="secondary"
        isDisabled={busy || !!session}
        onPress={() =>
          void run(async () => {
            setIncoming(await pickBusinessArchive());
          })
        }
      >
        <Button.Label>Recibir archivo de cierre</Button.Label>
      </Button>
      {incoming ? (
        <View className="gap-3">
          <Typography.Paragraph>
            {incoming.tables.products.length}{' '}
            {incoming.tables.products.length === 1 ? 'producto' : 'productos'} ·{' '}
            {incoming.tables.sales.length} {incoming.tables.sales.length === 1 ? 'venta' : 'ventas'}{' '}
            · Fondo próximo: {money(incoming.openingFund)}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm">
            Al importar, inicia sesión como{' '}
            {String(
              incoming.tables.users.find(
                (account) => account.role === 'admin' && account.username === incoming.sourceUser,
              )?.username ??
                incoming.tables.users.find((account) => account.role === 'admin')?.username,
            )}{' '}
            con la contraseña del administrador de este teléfono. Después asigna nuevas contraseñas
            al resto de usuarios en Usuarios.
            {incoming.version === 1
              ? ' El archivo antiguo contiene hashes de acceso; no se reutilizarán. Elimina las copias compartidas cuando termines.'
              : ''}
          </Typography.Paragraph>
          <Button
            isDisabled={busy}
            onPress={() =>
              void run(async () => {
                await receiveBusinessArchive(incoming, user.username);
                setIncoming(null);
                logout();
                await refresh();
              })
            }
          >
            <Button.Label>Importar negocio</Button.Label>
          </Button>
          <Button variant="ghost" isDisabled={busy} onPress={() => setIncoming(null)}>
            <Button.Label>Cancelar</Button.Label>
          </Button>
        </View>
      ) : null}
      {message ? <Typography.Paragraph>{message}</Typography.Paragraph> : null}
      {error ? <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph> : null}
    </Card>
  );
}
