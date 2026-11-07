import { Link } from 'expo-router';
import { Button, Card, Typography } from 'heroui-native';
import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { AccessDenied } from '@/components/AccessDenied';
import { Screen } from '@/components/Screen';
import { Choice, FinanceField, financeFailure, numeric } from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import { useFinanceCommand } from '@/lib/use-finance-command';
import { money } from '@/lib/format';
import type { SaleAdjustmentInput } from '@/lib/finance-models';
export default function SaleAdjustments() {
  const { user, refresh } = useApp();
  const { getSale, registerSaleAdjustment } = usePosRepository();
  const command = useFinanceCommand();
  const [id, setId] = useState('');
  const [sale, setSale] = useState<Awaited<ReturnType<typeof getSale>>>(null);
  const [kind, setKind] = useState<SaleAdjustmentInput['kind']>('devolucion');
  const [line, setLine] = useState('');
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  if (user?.role !== 'admin') return <AccessDenied />;
  const find = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    setSale(null);
    try {
      const result = await getSale(Number(id));
      if (!result) throw new Error('No se encontró esa venta.');
      setSale(result);
      setLine(String(result.lines[0]?.id ?? ''));
      command.clear();
    } catch (e) {
      setError(financeFailure(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!sale) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (!password) throw new Error('Introduce tu contraseña para autorizar el ajuste.');
      const input = {
        saleId: sale.sale.id,
        kind,
        reason,
        authorization: { username: user.username, password },
        ...(kind !== 'anulacion' ? { lineId: Number(line) } : {}),
        ...(kind === 'descuento' ? { amount: numeric(amount) } : { quantity: numeric(quantity) }),
      };
      await registerSaleAdjustment({ ...input, commandId: command.idFor(input) }, user.username);
      command.clear();
      setPassword('');
      setSale(null);
      setSuccess('Ajuste registrado. El historial original se conserva.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
    } catch (e) {
      setError(financeFailure(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Ajustes de venta" keyboard>
      <Link href="/profitability">Volver a Rentabilidad</Link>
      <Typography.Paragraph color="muted">
        Los reembolsos se registran en la caja abierta, sin modificar cierres sellados. En pagos
        mixtos se distribuyen según los importes originales.
      </Typography.Paragraph>
      <FinanceField label="Número de venta" value={id} onChange={setId} decimal />
      <Button variant="secondary" isDisabled={busy} onPress={() => void find()}>
        <Button.Label>{busy ? 'Procesando…' : 'Buscar venta'}</Button.Label>
      </Button>
      {error ? <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph> : null}
      {success ? (
        <Typography.Paragraph className="text-success">{success}</Typography.Paragraph>
      ) : null}
      {sale ? (
        <Card className="gap-4 p-4">
          <Typography.Heading type="h4">Venta #{sale.sale.id}</Typography.Heading>
          <Typography.Paragraph>
            {sale.sale.user} · {new Date(sale.sale.date).toLocaleString('es-CU')} ·{' '}
            {money(sale.sale.total)}
          </Typography.Paragraph>
          <Choice
            values={['devolucion', 'anulacion', 'descuento'] as const}
            value={kind}
            onChange={setKind}
          />
          {kind !== 'anulacion' ? (
            <FinanceSelect
              label="Producto de la venta"
              options={sale.lines.map((l) => ({
                value: String(l.id),
                label: `${l.name} · ${l.quantity} ${l.unit}`,
              }))}
              value={line}
              onChange={setLine}
            />
          ) : null}
          {kind === 'devolucion' ? (
            <FinanceField
              label="Cantidad devuelta"
              value={quantity}
              onChange={setQuantity}
              decimal
            />
          ) : null}
          {kind === 'descuento' ? (
            <FinanceField
              label="Importe a descontar CUP"
              value={amount}
              onChange={setAmount}
              decimal
            />
          ) : null}
          {kind === 'anulacion' ? (
            <Typography.Paragraph>
              Se devolverán las cantidades y los importes aún pendientes de toda la venta.
            </Typography.Paragraph>
          ) : null}
          <FinanceField label="Motivo" value={reason} onChange={setReason} />
          <FinanceField
            label="Contraseña del administrador"
            value={password}
            onChange={setPassword}
            secret
          />
          <Button isDisabled={busy} onPress={() => void submit()}>
            <Button.Label>{busy ? 'Confirmando…' : 'Confirmar ajuste autorizado'}</Button.Label>
          </Button>
        </Card>
      ) : null}
    </Screen>
  );
}
