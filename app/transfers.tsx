import { Button, Card, Chip, Typography } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import {
  FormCard,
  ReasonForm,
  quantityText,
  parseAmount,
  useBusinessCommand,
} from '@/components/BusinessKit';
import { FinanceField, FinanceStatus, financeFailure } from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { EmptyState, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import type { StockTransfer, StockTransferLine } from '@/lib/business-models';
import { shortDate } from '@/lib/format';
import type { AreaStock, Producto } from '@/lib/models';
import { canAccess } from '@/lib/permissions';
import { usePosRepository } from '@/lib/use-pos-repository';

type TransferData = Awaited<ReturnType<ReturnType<typeof usePosRepository>['getTransferData']>>;
const statusLabel: Record<StockTransfer['status'], string> = {
  sent: 'En tránsito',
  partial: 'Recibida parcial',
  received: 'Recibida',
  cancelled: 'Cancelada',
};
const pending = (line: StockTransferLine) =>
  line.quantity_sent - line.quantity_received - line.quantity_returned - line.quantity_lost;

export default function Transfers() {
  const { user } = useApp();
  const { getTransferData, listProducts, listAreaStock } = usePosRepository();
  const [data, setData] = useState<TransferData>();
  const [products, setProducts] = useState<Producto[]>([]);
  const [stock, setStock] = useState<AreaStock[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const allowed = !!user && canAccess(user.role, 'transfers');
  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setError('');
      const [next, items, levels] = await Promise.all([
        getTransferData(),
        listProducts(),
        listAreaStock(),
      ]);
      setData(next);
      setProducts(items);
      setStock(levels);
    } catch (failure) {
      setError(financeFailure(failure));
    } finally {
      setLoading(false);
    }
  }, [allowed, getTransferData, listAreaStock, listProducts]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const { busy, run } = useBusinessCommand(load);
  const [sending, setSending] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [lines, setLines] = useState<{ productId: number; quantity: number }[]>([]);
  const [receiving, setReceiving] = useState<string>();
  const [received, setReceived] = useState<Record<number, string>>({});
  const [resolving, setResolving] = useState<{
    line: StockTransferLine;
    kind: 'return' | 'loss';
  }>();
  const [cancelling, setCancelling] = useState<string>();
  if (!allowed) return <AccessDenied />;
  const areas = (data?.areas ?? []).map((a) => ({ value: String(a.area_id), label: a.area_name }));
  const available = (id: number) =>
    stock.find((s) => s.area_id === Number(from) && s.product_id === id)?.quantity ?? 0;
  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `#${id}`;
  const addLine = () => {
    const value = parseAmount(quantity);
    if (!productId || !(value > 0)) return;
    setLines((rows) => [
      ...rows.filter((r) => r.productId !== Number(productId)),
      { productId: Number(productId), quantity: value },
    ]);
    setQuantity('');
  };
  const transfers = data?.transfers ?? [];
  const linesOf = (id: string) => (data?.transferLines ?? []).filter((l) => l.transfer_id === id);
  return (
    <Screen
      title="Transferencias"
      keyboard
      onRefresh={load}
      action={
        <Button size="sm" onPress={() => setSending((v) => !v)}>
          <Button.Label>{sending ? 'Cerrar' : 'Enviar'}</Button.Label>
        </Button>
      }
    >
      <FinanceStatus loading={loading && !data} error={error} retry={() => void load()} />
      {sending ? (
        <FormCard title="Enviar mercancía">
          <FinanceSelect
            label="Desde el área"
            options={areas}
            value={from}
            onChange={(v) => {
              setFrom(v);
              setLines([]);
            }}
          />
          <FinanceSelect
            label="Hacia el área"
            options={areas.filter((a) => a.value !== from)}
            value={to}
            onChange={setTo}
          />
          {from ? (
            <>
              <FinanceSelect
                label="Producto"
                options={products
                  .filter((p) => available(p.id) > 0)
                  .map((p) => ({
                    value: String(p.id),
                    label: `${p.name} (disp. ${quantityText(available(p.id))} ${p.unit})`,
                  }))}
                value={productId}
                onChange={setProductId}
              />
              <FinanceField label="Cantidad" decimal value={quantity} onChange={setQuantity} />
              <Button variant="secondary" isDisabled={!productId} onPress={addLine}>
                <Button.Label>Agregar a la transferencia</Button.Label>
              </Button>
            </>
          ) : null}
          {lines.map((line) => (
            <View key={line.productId} className="flex-row items-center justify-between gap-2">
              <Typography.Paragraph
                className={`flex-1 ${line.quantity > available(line.productId) ? 'text-danger' : ''}`}
              >
                {productName(line.productId)} × {quantityText(line.quantity)}
              </Typography.Paragraph>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => setLines((rows) => rows.filter((r) => r !== line))}
              >
                <Button.Label>Quitar</Button.Label>
              </Button>
            </View>
          ))}
          <FinanceField label="Nota (opcional)" value={note} onChange={setNote} />
          <Button
            isDisabled={busy || !from || !to || !lines.length}
            onPress={() =>
              void run(
                {
                  action: 'transfer.send',
                  fromAreaId: Number(from),
                  toAreaId: Number(to),
                  note,
                  lines,
                },
                'La mercancía quedó en tránsito hasta que el destino la reciba.',
              ).then((ok) => {
                if (!ok) return;
                setLines([]);
                setNote('');
                setSending(false);
              })
            }
          >
            <Button.Label>Enviar transferencia</Button.Label>
          </Button>
        </FormCard>
      ) : null}
      {resolving ? (
        <ReasonForm
          title={
            resolving.kind === 'return'
              ? `Motivo de la devolución de ${resolving.line.product_name}`
              : `Motivo de la pérdida de ${resolving.line.product_name}`
          }
          busy={busy}
          onCancel={() => setResolving(undefined)}
          onSubmit={(reason) =>
            void run({
              action: 'transfer.resolve',
              transferId: resolving.line.transfer_id,
              lineId: resolving.line.id,
              resolution: resolving.kind,
              reason,
            }).then((ok) => ok && setResolving(undefined))
          }
        />
      ) : null}
      {cancelling ? (
        <ReasonForm
          title="Motivo de la cancelación"
          busy={busy}
          onCancel={() => setCancelling(undefined)}
          onSubmit={(reason) =>
            void run({ action: 'transfer.cancel', transferId: cancelling, reason }).then(
              (ok) => ok && setCancelling(undefined),
            )
          }
        />
      ) : null}
      <SectionTitle badge={transfers.length}>Historial</SectionTitle>
      {transfers.length ? (
        transfers.map((transfer) => {
          const rows = linesOf(transfer.id);
          const open = transfer.status === 'sent' || transfer.status === 'partial';
          return (
            <Card key={transfer.id} className="gap-2 p-4">
              <View className="flex-row items-center justify-between gap-2">
                <Typography.Paragraph className="flex-1 font-semibold">
                  {transfer.from_area} → {transfer.to_area}
                </Typography.Paragraph>
                <Chip
                  size="sm"
                  variant="soft"
                  color={
                    transfer.status === 'received'
                      ? 'success'
                      : transfer.status === 'cancelled'
                        ? 'default'
                        : 'warning'
                  }
                >
                  {statusLabel[transfer.status]}
                </Chip>
              </View>
              <Typography.Paragraph type="body-sm" color="muted">
                {shortDate(transfer.sent_at)} · {transfer.sent_by}
                {transfer.note ? ` · ${transfer.note}` : ''}
              </Typography.Paragraph>
              {rows.map((line) => (
                <View key={line.id} className="gap-1">
                  <Typography.Paragraph type="body-sm">
                    {line.product_name}: enviado {quantityText(line.quantity_sent)}, recibido{' '}
                    {quantityText(line.quantity_received)}
                    {line.quantity_returned
                      ? `, devuelto ${quantityText(line.quantity_returned)}`
                      : ''}
                    {line.quantity_lost ? `, perdido ${quantityText(line.quantity_lost)}` : ''}
                  </Typography.Paragraph>
                  {receiving === transfer.id && pending(line) > 0 ? (
                    <FinanceField
                      label={`Recibido ahora (pendiente ${quantityText(pending(line))})`}
                      decimal
                      value={received[line.id] ?? String(pending(line))}
                      onChange={(v) => setReceived((r) => ({ ...r, [line.id]: v }))}
                    />
                  ) : null}
                  {open && pending(line) > 0 && receiving !== transfer.id ? (
                    <View className="flex-row gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => setResolving({ line, kind: 'return' })}
                      >
                        <Button.Label>Devolver al origen</Button.Label>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => setResolving({ line, kind: 'loss' })}
                      >
                        <Button.Label className="text-danger">Registrar pérdida</Button.Label>
                      </Button>
                    </View>
                  ) : null}
                </View>
              ))}
              {open ? (
                <View className="flex-row flex-wrap gap-2">
                  {receiving === transfer.id ? (
                    <Button
                      size="sm"
                      isDisabled={busy}
                      onPress={() =>
                        void run({
                          action: 'transfer.receive',
                          transferId: transfer.id,
                          note: '',
                          lines: rows
                            .filter((l) => pending(l) > 0)
                            .map((l) => ({
                              lineId: l.id,
                              received: parseAmount(received[l.id] ?? String(pending(l))),
                            })),
                        }).then((ok) => {
                          if (!ok) return;
                          setReceiving(undefined);
                          setReceived({});
                        })
                      }
                    >
                      <Button.Label>Confirmar recepción</Button.Label>
                    </Button>
                  ) : (
                    <Button size="sm" onPress={() => setReceiving(transfer.id)}>
                      <Button.Label>Recibir</Button.Label>
                    </Button>
                  )}
                  {transfer.status === 'sent' ? (
                    <Button size="sm" variant="ghost" onPress={() => setCancelling(transfer.id)}>
                      <Button.Label>Cancelar envío</Button.Label>
                    </Button>
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        })
      ) : (
        <EmptyState title="No hay transferencias registradas." />
      )}
    </Screen>
  );
}
