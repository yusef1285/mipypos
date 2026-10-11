import * as Haptics from 'expo-haptics';
import { Button, Card, Typography } from 'heroui-native';
import { QrCode, Wifi } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { QrScanner } from '@/components/QrScanner';
import { useApp } from '@/lib/app-context';
import { checkLanHost } from '@/lib/network/client';
import { createLanQr, parseLanQr, QR_COLORS } from '@/lib/network/qr';

export function LanConnection({ allowHost = false }: { allowHost?: boolean }) {
  const { networkConfig, configureNetwork, hostAddress, user } = useApp();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changeMode = async (mode: 'host' | 'standalone') => {
    try {
      setBusy(true);
      setError('');
      await configureNetwork({ ...networkConfig, mode, hostUrl: '' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo cambiar la conexión.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };
  const connect = async (data: string) => {
    try {
      const hostUrl = parseLanQr(data);
      await checkLanHost(hostUrl);
      await configureNetwork({ ...networkConfig, mode: 'client', hostUrl });
      setScanning(false);
      setError('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      throw failure;
    }
  };
  let qr = '';
  if (networkConfig.mode === 'host' && hostAddress.startsWith('http://')) {
    try {
      qr = createLanQr(hostAddress);
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
            Conecta ambos teléfonos al mismo Wi-Fi o hotspot y escanea este QR desde el otro
            teléfono.
          </Typography.Paragraph>
        </View>
      ) : null}
      {networkConfig.mode === 'host' && !qr ? (
        <Typography.Paragraph className="text-danger">
          El host no está disponible. Conecta el Wi-Fi o hotspot y vuelve a iniciarlo.
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
        <Button isDisabled={busy} onPress={() => void changeMode('host')}>
          <Button.Label>
            {busy
              ? 'Iniciando…'
              : networkConfig.mode === 'host'
                ? 'Actualizar QR del host'
                : 'Iniciar como administrador host'}
          </Button.Label>
        </Button>
      ) : null}
      {networkConfig.mode !== 'standalone' ? (
        <Button variant="secondary" isDisabled={busy} onPress={() => void changeMode('standalone')}>
          <Button.Label>Trabajar solo en este dispositivo</Button.Label>
        </Button>
      ) : null}
    </Card>
  );
}
