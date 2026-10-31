import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Button,
  Card,
  ControlField,
  Input,
  Label,
  Spinner,
  TextField,
  Typography,
  useThemeColor,
} from 'heroui-native';
import { FinanceSelect } from '@/components/FinanceSelect';
import { useApp } from '@/lib/app-context';
import {
  createPrivateRecoveryBackup,
  inspectPrivateRecoveryBackup,
  listPrivateRecoveryBackups,
  restorePrivateRecoveryBackup,
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
  const { refresh, logout, networkConfig } = useApp();
  const spinnerColor = useThemeColor('accent-foreground');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState<RecoveryBackup[]>([]);
  const [lastCopy, setLastCopy] = useState<RecoveryBackup | null>(null);
  const [inspection, setInspection] = useState<RecoveryBackupInspection | null>(null);
  const [checking, setChecking] = useState(false);
  const [success, setSuccess] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    void listPrivateRecoveryBackups(username)
      .then((availableCopies) => {
        if (active) {
          setCopies(availableCopies);
          setLastCopy(availableCopies[0] ?? null);
        }
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
      setCopies((previous) => [copy, ...previous]);
      setConfirmed(false);
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
      const inspectionResult = await inspectPrivateRecoveryBackup(username, password, lastCopy.id);
      setInspection(inspectionResult);
      setPassword('');
      if (inspectionResult.recovery?.status === 'blocked') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
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
  const restore = async () => {
    if (busy || !lastCopy || !confirmed) return;
    setBusy(true);
    setRestoring(true);
    setError('');
    setSuccess(false);
    setInspection(null);
    try {
      await restorePrivateRecoveryBackup(username, password, lastCopy.id, confirmed);
      setPassword('');
      setConfirmed(false);
      try {
        await refresh();
      } finally {
        // A confirmed generation must invalidate the old session even when
        // refreshing the displayed totals fails.
        logout();
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'No se pudo confirmar la restauración. Tus archivos se conservan.',
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRestoring(false);
      setBusy(false);
    }
  };
  return (
    <Card className="gap-3 p-4">
      <Typography.Heading type="h4">Copia privada de recuperación</Typography.Heading>
      <Typography.Paragraph type="body-sm" color="muted">
        Incluye tus datos y cuentas. Permanece en este teléfono; no protege contra pérdida o
        desinstalación. Se conservan las operaciones posteriores cuando existe un historial
        verificable. Si las versiones divergen o faltan confirmaciones, la restauración se bloquea.
      </Typography.Paragraph>
      {loading ? (
        <Spinner size="sm" />
      ) : lastCopy ? (
        <Typography.Paragraph type="body-sm">
          Copia seleccionada: {new Date(lastCopy.createdAt).toLocaleString('es-CU')}
        </Typography.Paragraph>
      ) : (
        <Typography.Paragraph type="body-sm" color="muted">
          Aún no hay copias manuales.
        </Typography.Paragraph>
      )}
      {!busy && copies.length > 1 ? (
        <FinanceSelect
          label="Copia que quieres recuperar"
          options={copies.map((copy) => ({
            value: copy.id,
            label: `${new Date(copy.createdAt).toLocaleString('es-CU')} · ${copy.id.slice(0, 8)}`,
          }))}
          value={lastCopy?.id ?? ''}
          onChange={(id) => {
            setLastCopy(copies.find((copy) => copy.id === id) ?? null);
            setInspection(null);
            setConfirmed(false);
            setSuccess(false);
            setError('');
          }}
        />
      ) : null}
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
      {inspection?.recovery ? (
        <Typography.Paragraph
          className={inspection.recovery.status === 'blocked' ? 'text-danger' : 'text-foreground'}
          accessibilityRole="alert"
        >
          {inspection.recovery.status === 'blocked'
            ? `Restauración bloqueada. ${inspection.recovery.reason ?? 'Los estados no coinciden.'}`
            : inspection.recovery.status === 'forward'
              ? `Se conservarán ${inspection.recovery.replayEntries} cambios registrados posteriores a esta copia. Se comprobarán de nuevo antes de activarla.`
              : 'La copia coincide con tus operaciones actuales. Se verificará de nuevo al restaurar.'}
        </Typography.Paragraph>
      ) : null}
      <Button isDisabled={busy || loading || !password} onPress={() => void save()}>
        {busy && !checking && !restoring ? <Spinner size="sm" color={spinnerColor} /> : null}
        <Button.Label>
          {busy && !checking && !restoring ? 'Creando copia…' : 'Crear copia privada'}
        </Button.Label>
      </Button>
      {lastCopy ? (
        <Button
          variant="secondary"
          isDisabled={busy || loading || !password}
          onPress={() => void check()}
        >
          {checking ? <Spinner size="sm" /> : null}
          <Button.Label>{checking ? 'Comprobando…' : 'Comprobar copia seleccionada'}</Button.Label>
        </Button>
      ) : null}
      {lastCopy && networkConfig.mode === 'standalone' ? (
        <>
          <ControlField
            isSelected={confirmed}
            isDisabled={busy}
            onSelectedChange={(selected) => {
              setConfirmed(selected);
              void Haptics.selectionAsync();
            }}
          >
            <Label className="flex-1">
              Conservar la base actual y comprobar antes de restaurar
            </Label>
            <ControlField.Indicator />
          </ControlField>
          <Button
            variant="secondary"
            isDisabled={
              busy ||
              loading ||
              !password ||
              !confirmed ||
              inspection?.recovery?.status === 'blocked'
            }
            onPress={() => void restore()}
          >
            {restoring ? <Spinner size="sm" /> : null}
            <Button.Label>
              {restoring ? 'Restaurando…' : 'Restaurar copia seleccionada'}
            </Button.Label>
          </Button>
        </>
      ) : null}
    </Card>
  );
}
