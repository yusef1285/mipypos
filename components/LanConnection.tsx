import * as Haptics from 'expo-haptics';
import { Button, Card, Typography } from 'heroui-native';
import { QrCode, Wifi } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { QrScanner } from '@/components/QrScanner';
import { useApp } from '@/lib/app-context';
import { checkLanHost } from '@/lib/network/client';
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
import { getPendingWithdrawal } from '@/lib/network/pending-withdrawal';
import { getPendingSale } from '@/lib/network/pending-sale';

export function LanConnection({ allowHost = false }: { allowHost?: boolean }) {
  const { networkConfig, configureNetwork, hostAddress, user } = useApp();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hotspot, setHotspot] = useState<HotspotCredentials | null>(null);
  useEffect(() => {
    void getLocalHotspot()
      .then(setHotspot)
      .catch(() => setHotspot(null));
    // Host address and mode changes invalidate credentials held by the native Wi-Fi service.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [hostAddress, networkConfig.mode]);
  const changeMode = async (mode: 'host' | 'standalone', createNetwork = false) => {
    try {
      setBusy(true);
      setError('');
      if (createNetwork) {
        if (await getPendingSale())
          throw new Error('Confirma la venta pendiente antes de crear otra red.');
        if (await getPendingWithdrawal())
          throw new Error('Confirma la extracción pendiente antes de crear otra red.');
        const credentials = await startLocalHotspot();
        try {
          await configureNetwork({ ...networkConfig, mode: 'host', hostUrl: '' });
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
    try {
      const { hostUrl, wifi } = parseLanConnection(data);
      const pending = await getPendingSale();
      if (pending && pending.hostUrl !== hostUrl)
        throw new Error('Confirma la venta pendiente antes de cambiar de administrador.');
      const withdrawal = await getPendingWithdrawal();
      if (withdrawal && withdrawal.authority !== hostUrl)
        throw new Error('Confirma la extracción pendiente antes de cambiar de administrador.');
      if (wifi) {
        await connectHotspot(wifi);
        joinedWifi = true;
      }
      await checkLanHost(hostUrl);
      await configureNetwork({ ...networkConfig, mode: 'client', hostUrl });
      setScanning(false);
      setError('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      if (joinedWifi) await disconnectHotspot();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      throw failure;
    }
  };
  let qr = '';
  if (networkConfig.mode === 'host' && hostAddress.startsWith('http://')) {
    try {
      qr = createLanQr(hostAddress, hotspot ?? undefined);
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
            ? 'Terminal conectada al administrador'
            : 'Este dispositivo trabaja solo'}
      </Typography.Paragraph>
      {networkConfig.mode === 'client' ? (
        <Typography.Paragraph type="body-sm" color="muted">
          {networkConfig.hostUrl}. Inicia sesión con un usuario del administrador.
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
            {hotspot
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
          {hostAddress && !hostAddress.startsWith('http://')
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
          isDisabled={busy}
          onPress={() => {
            setError('');
            setScanning(true);
          }}
        >
          <QrCode size={18} />
          <Button.Label>Escanear QR</Button.Label>
        </Button>
      )}
      {allowHost && user?.role === 'admin' && Platform.OS === 'android' ? (
        <View className="gap-3">
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
