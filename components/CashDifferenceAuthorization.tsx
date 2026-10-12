import * as Haptics from 'expo-haptics';
import { Button, Card, Input, Label, TextField, Typography } from 'heroui-native';
import { useState } from 'react';
import { useApp } from '@/lib/app-context';
import type { CashDifferenceInput } from '@/lib/models';
import { usePosRepository } from '@/lib/use-pos-repository';

export function CashDifferenceAuthorization({
  sessionId,
  difference,
  onApproved,
}: {
  sessionId: number;
  difference: Pick<CashDifferenceInput, 'kind' | 'counted' | 'transferCount' | 'productId'>;
  onApproved: (id: number) => void;
}) {
  const { user } = useApp();
  const { authorizeCashDifference } = usePosRepository();
  const [admin, setAdmin] = useState(user?.role === 'admin' ? user.username : '');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    try {
      setBusy(true);
      setError('');
      const approval = await authorizeCashDifference(sessionId, {
        ...difference,
        reason,
        adminUsername: admin,
        adminPassword: password,
      });
      setPassword('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onApproved(approval.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo autorizar la diferencia.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="gap-4 p-4">
      <Typography.Heading type="h4">Autorizar diferencia</Typography.Heading>
      <Typography.Paragraph>
        El cierre conservará los conteos reales, el motivo y quién autorizó continuar. No se
        ajustará el inventario automáticamente.
      </Typography.Paragraph>
      <TextField>
        <Label>Motivo de la diferencia</Label>
        <Input editable={!busy} value={reason} onChangeText={setReason} />
      </TextField>
      <TextField>
        <Label>Usuario administrador</Label>
        <Input editable={!busy} autoCapitalize="none" value={admin} onChangeText={setAdmin} />
      </TextField>
      <TextField>
        <Label>Contraseña</Label>
        <Input editable={!busy} secureTextEntry value={password} onChangeText={setPassword} />
      </TextField>
      {error ? <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph> : null}
      <Button
        variant="danger"
        isDisabled={busy || !reason.trim() || !admin.trim() || !password}
        onPress={() => void approve()}
      >
        <Button.Label>{busy ? 'Autorizando…' : 'Autorizar y continuar'}</Button.Label>
      </Button>
    </Card>
  );
}
