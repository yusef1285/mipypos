import * as Haptics from 'expo-haptics';
import { Button, Checkbox, Input, Label, TextArea, TextField, Typography } from 'heroui-native';
import { useState } from 'react';
import { View, Image } from 'react-native';
import type { TransferReceipt } from '@/lib/models';
import { captureReceipt } from '@/lib/receipt-camera';

export const emptyTransferReceipt = (): TransferReceipt => ({
  ci: '',
  fullName: '',
  address: '',
  amount: 0,
  rawText: '',
  reference: '',
  receiptDate: '',
  imageBase64: '',
  reviewed: false,
});
export function TransferReceiptForm({
  value,
  onChange,
  onAmount,
  onBusyChange,
  disabled,
}: {
  value: TransferReceipt;
  onChange: (value: TransferReceipt) => void;
  onAmount: (amount: number) => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [amountDraft, setAmountDraft] = useState(String(value.amount || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const patch = (next: Partial<TransferReceipt>) =>
    onChange({ ...value, ...next, reviewed: false });
  const capture = async (library: boolean) => {
    try {
      setBusy(true);
      onBusyChange(true);
      setError('');
      onChange({ ...value, reviewed: false });
      const result = await captureReceipt(library);
      if (!result) return;
      const amount = result.amount ?? 0;
      setAmountDraft(result.amount === null ? '' : String(result.amount));
      onChange({ ...value, ...result, amount, reviewed: false });
      if (result.amount !== null) onAmount(result.amount);
      else setError('No se identificó un importe único. Revisa el texto y escribe el importe.');
      void Haptics.notificationAsync(
        result.amount === null
          ? Haptics.NotificationFeedbackType.Error
          : Haptics.NotificationFeedbackType.Success,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo captar el comprobante.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <View className="gap-4">
      <Typography.Heading type="h4">Datos de la transferencia</Typography.Heading>
      {(
        [
          { key: 'ci', label: 'CI (carnet de identidad)' },
          { key: 'fullName', label: 'Nombre completo' },
          { key: 'address', label: 'Dirección particular' },
        ] as const
      ).map(({ key, label }) => (
        <TextField key={key} isDisabled={disabled || busy}>
          <Label>{label}</Label>
          <Input
            keyboardType={key === 'ci' ? 'number-pad' : 'default'}
            maxLength={key === 'ci' ? 11 : 240}
            value={value[key]}
            onChangeText={(text) => patch({ [key]: text })}
          />
        </TextField>
      ))}
      <Button
        isDisabled={
          disabled ||
          busy ||
          !/^\d{11}$/.test(value.ci) ||
          !value.fullName.trim() ||
          !value.address.trim()
        }
        onPress={() => void capture(false)}
      >
        <Button.Label>{busy ? 'Leyendo…' : 'Fotografiar comprobante'}</Button.Label>
      </Button>
      <Button
        variant="secondary"
        isDisabled={
          disabled ||
          busy ||
          !/^\d{11}$/.test(value.ci) ||
          !value.fullName.trim() ||
          !value.address.trim()
        }
        onPress={() => void capture(true)}
      >
        <Button.Label>Leer imagen de galería</Button.Label>
      </Button>
      {error ? <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph> : null}
      {value.imageBase64 ? (
        <>
          <Image
            source={{ uri: `data:image/jpeg;base64,${value.imageBase64}` }}
            resizeMode="contain"
            style={{ width: '100%', height: 220 }}
          />
          <TextField isDisabled={disabled}>
            <Label>Importe transferido (CUP)</Label>
            <Input
              keyboardType="decimal-pad"
              value={amountDraft}
              onChangeText={(text) => {
                setAmountDraft(text);
                const amount = Number(text.replace(',', '.'));
                patch({ amount });
                onAmount(amount);
              }}
            />
          </TextField>
          <TextField isDisabled={disabled}>
            <Label>Referencia de operación</Label>
            <Input value={value.reference} onChangeText={(reference) => patch({ reference })} />
          </TextField>
          <TextField isDisabled={disabled}>
            <Label>Fecha del comprobante</Label>
            <Input
              value={value.receiptDate}
              onChangeText={(receiptDate) => patch({ receiptDate })}
            />
          </TextField>
          <TextField isDisabled={disabled}>
            <Label>Texto reconocido</Label>
            <TextArea value={value.rawText} onChangeText={(rawText) => patch({ rawText })} />
          </TextField>
          <View className="flex-row items-center gap-3">
            <Checkbox
              accessibilityLabel="Revisé los datos y comprobé la recepción del dinero"
              isSelected={value.reviewed}
              isDisabled={disabled}
              onSelectedChange={(reviewed) => {
                onChange({ ...value, reviewed });
                void Haptics.selectionAsync();
              }}
            >
              <Checkbox.Indicator />
            </Checkbox>
            <Typography.Paragraph className="flex-1">
              Revisé los datos y comprobé la recepción del dinero
            </Typography.Paragraph>
          </View>
          <Typography.Paragraph type="body-sm" color="muted">
            La imagen no verifica el abono bancario. Comprueba la recepción antes de cobrar.
          </Typography.Paragraph>
        </>
      ) : null}
    </View>
  );
}
