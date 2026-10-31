import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Button,
  Card,
  Input,
  Label,
  Spinner,
  TextField,
  Typography,
  useThemeColor,
} from 'heroui-native';
import { useApp } from '@/lib/app-context';
import {
  createPrivateRecoveryBackup,
  inspectPrivateRecoveryBackup,
  listPrivateRecoveryBackups,
} from '@/lib/database';
import type { RecoveryBackup, RecoveryBackupInspection } from '@/lib/recovery-backup';

export function RecoveryBackupControls() {
  const { user, networkConfig } = useApp();
  const enabled =
    user?.role === 'admin' && networkConfig.mode !== 'client' && Platform.OS !== 'web';
  const username = user?.username;
  if (!enabled || !username) return null;
  return <RecoveryBackupForm key={username} username={username} />;
}

function RecoveryBackupForm({ username }: { username: string }) {
  const spinnerColor = useThemeColor('accent-foreground');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastCopy, setLastCopy] = useState<RecoveryBackup | null>(null);
  const [inspection, setInspection] = useState<RecoveryBackupInspection | null>(null);
  const [checking, setChecking] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    void listPrivateRecoveryBackups(username)
      .then((copies) => {
        if (active) setLastCopy(copies[0] ?? null);
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(failure instanceof Error ? failure.message : 'No se pudo consultar las copias.');
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [username]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setSuccess(false);
    setInspection(null);
    try {
      const copy = await createPrivateRecoveryBackup(username, password);
      setLastCopy(copy);
      setPassword('');
      setSuccess(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'No se pudo crear la copia. Vuelve a intentarlo.',
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };
  const check = async () => {
    if (busy || !lastCopy) return;
    setBusy(true);
    setChecking(true);
    setError('');
    setSuccess(false);
    setInspection(null);
    try {
      setInspection(await inspectPrivateRecoveryBackup(username, password, lastCopy.id));
      setPassword('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'No se pudo verificar la copia. Vuelve a intentarlo.',
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setChecking(false);
      setBusy(false);
    }
  };
  return (
    <Card className="gap-3 p-4">
      <Typography.Heading type="h4">Copia privada de recuperación</Typography.Heading>
      <Typography.Paragraph type="body-sm" color="muted">
        Incluye tus datos y cuentas. Permanece en este teléfono; no protege contra pérdida o
        desinstalación. La restauración aún requiere asistencia técnica.
      </Typography.Paragraph>
      {loading ? (
        <Spinner size="sm" />
      ) : lastCopy ? (
        <Typography.Paragraph type="body-sm">
          Última copia: {new Date(lastCopy.createdAt).toLocaleString('es-CU')}
        </Typography.Paragraph>
      ) : (
        <Typography.Paragraph type="body-sm" color="muted">
          Aún no hay copias manuales.
        </Typography.Paragraph>
      )}
      <TextField isDisabled={busy}>
        <Label>Tu contraseña de administrador</Label>
        <Input
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={password}
          onChangeText={setPassword}
        />
      </TextField>
      {error ? (
        <Typography.Paragraph className="text-danger" accessibilityRole="alert">
          {error}
        </Typography.Paragraph>
      ) : null}
      {success ? (
        <Typography.Paragraph className="text-success" accessibilityRole="alert">
          Copia creada y verificada.
        </Typography.Paragraph>
      ) : null}
      {inspection ? (
        <Typography.Paragraph className="text-success" accessibilityRole="alert">
          Copia comprobada: {inspection.sales} {inspection.sales === 1 ? 'venta' : 'ventas'},{' '}
          {inspection.products} {inspection.products === 1 ? 'producto' : 'productos'}. No se han
          restaurado datos.
        </Typography.Paragraph>
      ) : null}
      <Button isDisabled={busy || loading || !password} onPress={() => void save()}>
        {busy && !checking ? <Spinner size="sm" color={spinnerColor} /> : null}
        <Button.Label>{busy && !checking ? 'Creando copia…' : 'Crear copia privada'}</Button.Label>
      </Button>
      {lastCopy ? (
        <Button
          variant="secondary"
          isDisabled={busy || loading || !password}
          onPress={() => void check()}
        >
          {checking ? <Spinner size="sm" /> : null}
          <Button.Label>{checking ? 'Comprobando…' : 'Comprobar última copia'}</Button.Label>
        </Button>
      ) : null}
    </Card>
  );
}
