import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Typography } from 'heroui-native';
import { useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';

export function QrScanner({
  onScan,
  onCancel,
}: {
  onScan: (data: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  if (Platform.OS === 'web' && !('BarcodeDetector' in globalThis))
    return (
      <View className="gap-3">
        <Typography.Paragraph>
          Este navegador no permite leer QR. Usa la app Android para conectar este teléfono.
        </Typography.Paragraph>
        <Button variant="secondary" onPress={onCancel}>
          <Button.Label>Volver</Button.Label>
        </Button>
      </View>
    );
  const scan = async (data: string) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await onScan(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo conectar.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-3">
      {!permission?.granted ? (
        <>
          <Typography.Paragraph>
            Permite el acceso a la cámara para leer el QR del administrador.
          </Typography.Paragraph>
          <Button
            onPress={() =>
              void (permission?.canAskAgain === false && Platform.OS !== 'web'
                ? Linking.openSettings()
                : requestPermission())
            }
          >
            <Button.Label>
              {permission?.canAskAgain === false ? 'Abrir permisos' : 'Permitir cámara'}
            </Button.Label>
          </Button>
        </>
      ) : !error ? (
        <CameraView
          style={{ width: '100%', height: 260 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => void scan(data)}
          onMountError={() => setError('No se pudo abrir la cámara. Revisa sus permisos.')}
        />
      ) : null}
      {error ? (
        <>
          <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph>
          <Button
            onPress={() => {
              setError('');
              locked.current = false;
            }}
          >
            <Button.Label>Reintentar</Button.Label>
          </Button>
        </>
      ) : null}
      {busy ? <Typography.Paragraph>Comprobando conexión…</Typography.Paragraph> : null}
      <Button variant="secondary" isDisabled={busy} onPress={onCancel}>
        <Button.Label>Cancelar</Button.Label>
      </Button>
    </View>
  );
}
