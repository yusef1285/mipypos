import * as Haptics from 'expo-haptics';
import {
  Accordion,
  Button,
  Checkbox,
  Input,
  Label,
  TextArea,
  TextField,
  Typography,
} from 'heroui-native';
import { useEffect, useState } from 'react';
import { View, Image } from 'react-native';
import type { TransferReceipt } from '@/lib/models';
import { captureReceipt } from '@/lib/receipt-camera';
import { usePosRepository } from '@/lib/use-pos-repository';

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
  const { findTransferTransaction } = usePosRepository();
  const [check, setCheck] = useState<{
    reference: string;
    retry: number;
    saleId: number | null;
    error: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const reference = value.reference.trim().toUpperCase();
  const currentCheck = check?.reference === reference && check.retry === retry ? check : null;
  const checking = Boolean(reference) && currentCheck === null;
  useEffect(() => {
    let active = true;
    if (!reference) return undefined;
    const timer = setTimeout(() => {
      void findTransferTransaction(reference)
        .then((duplicate) => {
          if (!active) return;
          setCheck({ reference, retry, saleId: duplicate?.id ?? null, error: '' });
          if (duplicate) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        })
        .catch(() => {
          if (!active) return;
          setCheck({
            reference,
            retry,
            saleId: null,
            error: 'No se pudo comprobar el número de transacción.',
          });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [reference, findTransferTransaction, retry]);
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
      onAmount(amount);
      if (result.amount === null)
        setError('No se identificó un importe único. Revisa el texto y escribe el importe.');
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
      <Accordion
        selectionMode="single"
        isCollapsible
        onValueChange={() => void Haptics.selectionAsync()}
      >
        <Accordion.Item value="personal">
          <Accordion.Trigger>
            <Typography.Paragraph className="flex-1">
              Datos personales (opcionales)
            </Typography.Paragraph>
            <Accordion.Indicator />
          </Accordion.Trigger>
          <Accordion.Content>
            <View className="gap-4 pb-3">
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
            </View>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
      <Button isDisabled={disabled || busy} onPress={() => void capture(false)}>
        <Button.Label>{busy ? 'Leyendo…' : 'Fotografiar comprobante'}</Button.Label>
      </Button>
      <Button variant="secondary" isDisabled={disabled || busy} onPress={() => void capture(true)}>
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
            <Label>Número de transacción</Label>
            <Input
              maxLength={200}
              value={value.reference}
              onChangeText={(text) => patch({ reference: text })}
            />
          </TextField>
          {checking ? (
            <Typography.Paragraph color="muted">Comprobando transacción…</Typography.Paragraph>
          ) : null}
          {currentCheck?.saleId ? (
            <Typography.Paragraph className="text-danger" accessibilityRole="alert">
              Este número de transacción ya se usó en la venta #{currentCheck.saleId}. No puedes
              reutilizarlo; revisa el número o captura otro comprobante.
            </Typography.Paragraph>
          ) : null}
          {currentCheck?.error ? (
            <View className="gap-2">
              <Typography.Paragraph className="text-danger" accessibilityRole="alert">
                {currentCheck.error}
              </Typography.Paragraph>
              <Button
                variant="secondary"
                isDisabled={disabled || busy}
                onPress={() => setRetry((n) => n + 1)}
              >
                <Button.Label>Reintentar comprobación</Button.Label>
              </Button>
            </View>
          ) : null}
          <TextField isDisabled={disabled}>
            <Label>Fecha del comprobante</Label>
            <Input
              value={value.receiptDate}
              onChangeText={(receiptDate) => patch({ receiptDate })}
            />
          </TextField>
          {(
            [
              { key: 'bank', label: 'Banco' },
              { key: 'beneficiary', label: 'Beneficiario (cuenta)' },
              { key: 'orderer', label: 'Ordenante (texto del mensaje)' },
              { key: 'currency', label: 'Moneda' },
              { key: 'remainingBalance', label: 'Saldo restante del mensaje' },
              { key: 'status', label: 'Estado indicado en el mensaje' },
            ] as const
          ).map(({ key, label }) => (
            <TextField key={key} isDisabled={disabled}>
              <Label>{label}</Label>
              <Input
                value={value[key] ?? ''}
                maxLength={240}
                onChangeText={(text) => patch({ [key]: text })}
              />
            </TextField>
          ))}
          <TextField isDisabled={disabled}>
            <Label>Texto reconocido</Label>
            <TextArea value={value.rawText} onChangeText={(rawText) => patch({ rawText })} />
          </TextField>
          <View className="flex-row items-center gap-3">
            <Checkbox
              accessibilityLabel="Revisé los datos y comprobé la recepción del dinero"
              isSelected={value.reviewed}
              isDisabled={
                disabled || busy || checking || Boolean(currentCheck?.saleId || currentCheck?.error)
              }
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
