import * as Haptics from 'expo-haptics';
import { Button, Card, Typography } from 'heroui-native';
import { QrCode, Wifi } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { QrScanner } from '@/components/QrScanner';
import { useApp } from '@/lib/app-context';
import { checkLanHost } from '@/lib/network/client';
import { assertPendingAuthority } from '@/lib/network/config';
import { createLanQr, parseLanConnection, QR_COLORS } from '@/lib/network/qr';
import {
  connectHotspot,
  disconnectHotspot,
  getLocalHotspot,
  openWifiSettings,
  startLocalHotspot,
  stopLocalHotspot,
  type HotspotCredentials,
} from '@/lib/network/hotspot';
import {
  getPendingWithdrawal,
  upgradePendingWithdrawalTransport,
} from '@/lib/network/pending-withdrawal';
import {
  createDirectGroup,
  connectDirectPeer,
  disconnectDirect,
  getDirectInfo,
  type DirectInfo,
} from '@/lib/network/direct';
import {
  cancelLanDiscovery,
  findPairedLanHost,
  getAdvertisementError,
} from '@/lib/network/discovery';
import { getHostPin } from '@/lib/network/tls';
import { getPendingOperation, rebindPendingOperation } from '@/lib/network/pending-operation';
import { getPendingSale, upgradePendingSaleTransport } from '@/lib/network/pending-sale';

export function LanConnection({ allowHost = false }: { allowHost?: boolean }) {
  const {
    networkConfig,
    configureNetwork,
    hostAddress,
    user,
    networkStatus,
    networkError,
    refresh,
  } = useApp();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [direct, setDirect] = useState<DirectInfo | null>(null);
  const [hotspot, setHotspot] = useState<HotspotCredentials | null>(null);
  useEffect(() => {
    void getLocalHotspot()
      .then(setHotspot)
      .catch(() => setHotspot(null));
    // Host address and mode changes invalidate credentials held by the native Wi-Fi service.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [hostAddress, networkConfig.mode]);
  useEffect(() => {
    let active = true;
    const update = () => {
      void getDirectInfo()
        .then((info) => {
          if (active) setDirect(info);
        })
        .catch(() => {
          if (active) setDirect(null);
        });
    };
    update();
    const timer = setInterval(update, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [hostAddress, networkConfig.mode]);
  const startDirect = async () => {
    try {
      setBusy(true);
      setError('');
      if (
        (await getPendingOperation()) ||
        (await getPendingSale()) ||
        (await getPendingWithdrawal())
      )
        throw new Error('Confirma las operaciones pendientes antes de crear otra red.');
      if (await getLocalHotspot()) await stopLocalHotspot();
      await disconnectHotspot();
      const info = await createDirectGroup();
      try {
        await configureNetwork({
          ...networkConfig,
          mode: 'host',
          hostUrl: '',
          transport: 'direct',
        });
      } catch (failure) {
        await disconnectDirect();
        throw failure;
      }
      setDirect(info);
      setHotspot(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo crear Wi-Fi Direct.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };
  const changeMode = async (mode: 'host' | 'standalone', createNetwork = false) => {
    try {
      setBusy(true);
      setError('');
      if (createNetwork) {
        if (await getPendingOperation())
          throw new Error('Confirma la operación pendiente antes de crear otra red.');
        if (await getPendingSale())
          throw new Error('Confirma la venta pendiente antes de crear otra red.');
        if (await getPendingWithdrawal())
          throw new Error('Confirma la extracción pendiente antes de crear otra red.');
        await disconnectDirect();
        const credentials = await startLocalHotspot();
        try {
          await configureNetwork({
            ...networkConfig,
            mode: 'host',
            hostUrl: '',
            transport: 'wifi',
          });
        } catch (failure) {
          await stopLocalHotspot();
          throw failure;
        }
        setHotspot(credentials);
      } else {
        await configureNetwork({ ...networkConfig, mode, hostUrl: '' });
        if (mode === 'standalone') setHotspot(null);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo cambiar la conexión.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };
  const connect = async (data: string) => {
    let joinedWifi = false;
    let joinedDirect = false;
    try {
      setBusy(true);
      const { hostUrl, hostPin, wifi, directAddress } = parseLanConnection(data);
      const operation = await getPendingOperation();
      const pending = await getPendingSale();
      const withdrawal = await getPendingWithdrawal();
      const records = [operation, pending, withdrawal].filter((record) => record !== null);
      const authorities = records.map((record) =>
        'authority' in record ? record.authority : record.hostUrl,
      );
      const pins = records.map((record) => record.hostPin);
      assertPendingAuthority(
        networkConfig,
        { ...networkConfig, mode: 'client', hostUrl, hostPin },
        authorities,
        pins,
      );
      // Identity may be recovered only from every authenticated pending journal.
      // The candidate still has to complete the pinned TLS handshake below.
      const sameIdentity = (networkConfig.hostPin ?? records[0]?.hostPin) === hostPin;
      const retainsAuthority = (previous: string, journalPin?: string) =>
        previous.replace(/^http:/, 'https:') === hostUrl ||
        (sameIdentity &&
          (previous === networkConfig.hostUrl ||
            (!networkConfig.hostPin && journalPin === hostPin)));
      if (operation && !retainsAuthority(operation.hostUrl, operation.hostPin))
        throw new Error('Confirma la operación pendiente antes de cambiar de administrador.');
      if (pending && !retainsAuthority(pending.hostUrl, pending.hostPin))
        throw new Error('Confirma la venta pendiente antes de cambiar de administrador.');
      if (withdrawal && !retainsAuthority(withdrawal.authority, withdrawal.hostPin))
        throw new Error('Confirma la extracción pendiente antes de cambiar de administrador.');
      if (directAddress) {
        await disconnectHotspot();
        const current = await getDirectInfo();
        if (
          current &&
          (current.isOwner || current.deviceAddress.toLowerCase() !== directAddress.toLowerCase())
        )
          await disconnectDirect();
        const info =
          current &&
          !current.isOwner &&
          current.deviceAddress.toLowerCase() === directAddress.toLowerCase()
            ? current
            : await connectDirectPeer(directAddress);
        joinedDirect = true;
        if (new URL(hostUrl).hostname !== info.hostIp)
          throw new Error('La dirección del administrador cambió. Genera y escanea un QR nuevo.');
      } else if (wifi) {
        await disconnectDirect();
        await connectHotspot(wifi);
        joinedWifi = true;
      }
      await checkLanHost(hostUrl, hostPin);
      const previousHost = sameIdentity ? networkConfig.hostUrl : undefined;
      await upgradePendingSaleTransport(
        hostUrl,
        !networkConfig.hostPin && pending?.hostPin === hostPin ? pending.hostUrl : previousHost,
      );
      await upgradePendingWithdrawalTransport(
        hostUrl,
        !networkConfig.hostPin && withdrawal?.hostPin === hostPin
          ? withdrawal.authority
          : previousHost,
      );
      const operationHost =
        !networkConfig.hostPin && operation?.hostPin === hostPin ? operation.hostUrl : previousHost;
      if (operationHost) await rebindPendingOperation(operationHost, hostUrl);
      await configureNetwork({
        ...networkConfig,
        mode: 'client',
        hostUrl,
        hostPin,
        transport: directAddress ? 'direct' : 'wifi',
      });
      setScanning(false);
      setError('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      if (joinedWifi) await disconnectHotspot();
      if (joinedDirect) await disconnectDirect();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      throw failure;
    } finally {
      setBusy(false);
    }
  };
  useEffect(
    () => () => {
      void cancelLanDiscovery().catch(() => undefined);
    },
    [],
  );
  const findAdministrator = async () => {
    try {
      setBusy(true);
      setError('');
      const hostUrl = await findPairedLanHost(networkConfig.hostPin ?? '');
      await connect(createLanQr(hostUrl, undefined, networkConfig.hostPin));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'No se pudo encontrar al administrador.',
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };
  let qr = '';
  if (networkConfig.mode === 'host' && hostAddress.startsWith('https://')) {
    if (networkConfig.transport !== 'direct' || direct?.isOwner)
      try {
        qr = createLanQr(
          hostAddress,
          direct?.isOwner ? undefined : (hotspot ?? undefined),
          getHostPin(),
          direct?.isOwner ? direct.deviceAddress : undefined,
        );
      } catch {
        qr = '';
      }
  }
  return (
    <Card className="gap-4 p-4">
      <View className="flex-row items-center gap-2">
        <Wifi size={20} />
        <Typography.Heading type="h4">Red local</Typography.Heading>
      </View>
      <Typography.Paragraph>
        {networkConfig.mode === 'host'
          ? 'Administrador · host'
          : networkConfig.mode === 'client'
            ? !user
              ? 'Terminal · inicia sesión con el administrador'
              : {
                  connected: 'Conectado',
                  syncing: 'Sincronizando',
                  offline: 'Sin conexión',
                  pending: 'Cambios pendientes',
                  error: 'Error de sincronización',
                }[networkStatus]
            : 'Este dispositivo trabaja solo'}
      </Typography.Paragraph>
      {networkConfig.mode === 'client' ? (
        <Typography.Paragraph type="body-sm" color="muted">
          {networkConfig.hostUrl}. Inicia sesión con un usuario del administrador.
        </Typography.Paragraph>
      ) : null}
      {networkConfig.recoveryMessage || networkError ? (
        <Typography.Paragraph type="body-sm" className="text-danger">
          {networkConfig.recoveryMessage || networkError}
        </Typography.Paragraph>
      ) : null}
      {networkConfig.mode === 'client' && user && networkStatus !== 'connected' ? (
        <Button
          variant="secondary"
          isDisabled={busy || networkStatus === 'syncing'}
          onPress={() => {
            setBusy(true);
            void refresh()
              .catch((failure: unknown) => {
                setError(failure instanceof Error ? failure.message : 'No se pudo reconectar.');
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              })
              .finally(() => setBusy(false));
          }}
        >
          <Button.Label>Reintentar conexión</Button.Label>
        </Button>
      ) : null}
      {Platform.OS !== 'android' ? (
        <Typography.Paragraph type="body-sm" color="muted">
          La red segura entre teléfonos requiere Android.
        </Typography.Paragraph>
      ) : null}
      {qr ? (
        <View className="items-center gap-3">
          <View style={{ padding: 16, backgroundColor: QR_COLORS.background, borderRadius: 12 }}>
            <QRCode
              value={qr}
              size={200}
              backgroundColor={QR_COLORS.background}
              color={QR_COLORS.foreground}
            />
          </View>
          <Typography.Paragraph type="body-sm" color="muted">
            {hostAddress}
          </Typography.Paragraph>
          <Typography.Paragraph>
            {direct?.isOwner
              ? 'Wi-Fi Direct: escanea este QR desde MipyPOS en el otro Android, activa ubicación y acepta la conexión del sistema. No requiere internet ni router.'
              : hotspot
                ? `Escanea desde MipyPOS en el otro teléfono y acepta la conexión Wi-Fi de Android. Red: ${hotspot.ssid}.`
                : 'Conecta ambos teléfonos al mismo Wi-Fi o hotspot y escanea este QR desde el otro teléfono.'}
          </Typography.Paragraph>
          {hotspot ? (
            <Typography.Paragraph type="body-sm" color="muted">
              Clave Wi-Fi: {hotspot.password}. Comparte este QR solo con tus terminales.
            </Typography.Paragraph>
          ) : null}
        </View>
      ) : null}
      {networkConfig.mode === 'host' && !qr ? (
        <Typography.Paragraph className="text-danger">
          {hostAddress && !hostAddress.startsWith('https://')
            ? hostAddress
            : 'El host no está disponible. Conecta el Wi-Fi o hotspot y vuelve a iniciarlo.'}
        </Typography.Paragraph>
      ) : null}
      {error ? <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph> : null}
      {scanning ? (
        <QrScanner onScan={connect} onCancel={() => setScanning(false)} />
      ) : (
        <Button
          variant="secondary"
          isDisabled={busy || Platform.OS !== 'android'}
          onPress={() => {
            setError('');
            setScanning(true);
          }}
        >
          <QrCode size={18} />
          <Button.Label>Escanear QR</Button.Label>
        </Button>
      )}
      {networkConfig.mode === 'host' && getAdvertisementError() ? (
        <Typography.Paragraph type="body-sm" color="muted">
          {getAdvertisementError()}
        </Typography.Paragraph>
      ) : null}
      {networkConfig.mode === 'client' &&
      networkConfig.transport !== 'direct' &&
      networkConfig.hostPin &&
      Platform.OS === 'android' ? (
        <Button variant="secondary" isDisabled={busy} onPress={() => void findAdministrator()}>
          <Button.Label>{busy ? 'Buscando…' : 'Buscar mi administrador en Wi-Fi'}</Button.Label>
        </Button>
      ) : null}
      {allowHost && user?.role === 'admin' && Platform.OS === 'android' ? (
        <View className="gap-3">
          <Button isDisabled={busy} onPress={() => void startDirect()}>
            <Button.Label>{busy ? 'Conectando…' : 'Crear Wi-Fi Direct y mostrar QR'}</Button.Label>
          </Button>
          <Button isDisabled={busy} onPress={() => void changeMode('host', true)}>
            <Button.Label>{busy ? 'Creando red…' : 'Crear hotspot y mostrar QR'}</Button.Label>
          </Button>
          <Button variant="secondary" isDisabled={busy} onPress={() => void changeMode('host')}>
            <Button.Label>
              {busy
                ? 'Iniciando…'
                : networkConfig.mode === 'host'
                  ? 'Actualizar QR del host'
                  : 'Iniciar como administrador host'}
            </Button.Label>
          </Button>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() =>
              void openWifiSettings().catch((failure: unknown) => {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : 'No se pudieron abrir los ajustes Wi-Fi.',
                );
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              })
            }
          >
            <Button.Label>Abrir ajustes Wi-Fi</Button.Label>
          </Button>
        </View>
      ) : null}
      {networkConfig.mode !== 'standalone' ? (
        <Button variant="secondary" isDisabled={busy} onPress={() => void changeMode('standalone')}>
          <Button.Label>Trabajar solo en este dispositivo</Button.Label>
        </Button>
      ) : null}
    </Card>
  );
}
