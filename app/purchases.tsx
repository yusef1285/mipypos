import { Button, Card, Chip, Typography } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import {
  FormCard,
  Row,
  amount,
  parseAmount,
  quantityText,
  useBusinessCommand,
  useBusinessData,
} from '@/components/BusinessKit';
import { FinanceField } from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { EmptyState } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { IsoDateField } from '@/components/IsoDateField';
import { useApp } from '@/lib/app-context';
import type { Producto } from '@/lib/models';
import { usePosRepository } from '@/lib/use-pos-repository';

type Line = { productId: number; name: string; unit: string; quantity: number; cost: number };
const payments = ['credit', 'cash', 'transfer'] as const;
const paymentLabel = { credit: 'A crédito', cash: 'Efectivo', transfer: 'Transferencia' } as const;

// Receives supplier merchandise into an area, updating stock, average cost and payables.
export default function Purchases() {
  const { user, refresh } = useApp();
  const { listProducts } = usePosRepository();
  const { data, error, load } = useBusinessData();
  const { busy, run } = useBusinessCommand(load);
  const [products, setProducts] = useState<Producto[]>([]);
  const [supplier, setSupplier] = useState('');
  const [area, setArea] = useState('');
  const [product, setProduct] = useState('');
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [payment, setPayment] = useState<(typeof payments)[number]>('credit');
  const [reference, setReference] = useState('');
  const [dueDate, setDueDate] = useState('');
  const loadProducts = useCallback(async () => setProducts(await listProducts('')), [listProducts]);
  useEffect(() => {
    const timer = setTimeout(() => void loadProducts().catch(() => undefined), 0);
    return () => clearTimeout(timer);
  }, [loadProducts]);
  if (user?.role !== 'admin') return <AccessDenied />;
  const suppliers = (data?.parties ?? []).filter((p) => p.active && p.kind !== 'client');
  const total = lines.reduce((sum, line) => sum + line.quantity * line.cost, 0);
  const addLine = () => {
    const item = products.find((p) => p.id === Number(product));
    const qty = parseAmount(quantity);
    const unitCost = parseAmount(cost);
    if (!item || !(qty > 0) || !(unitCost >= 0)) return;
    setLines((current) => [
      ...current.filter((line) => line.productId !== item.id),
      { productId: item.id, name: item.name, unit: item.unit, quantity: qty, cost: unitCost },
    ]);
    setQuantity('');
    setCost('');
  };
  const submit = async () => {
    const done = await run(
      {
        action: 'purchase.receive',
        partyId: Number(supplier),
        areaId: Number(area),
        lines: lines.map(({ productId, quantity: q, cost: c }) => ({
          productId,
          quantity: q,
          cost: c,
        })),
        payment,
        reference,
        ...(payment === 'credit' && dueDate.trim() ? { dueDate: dueDate.trim() } : {}),
      },
      'Compra recibida. El stock y el costo promedio se actualizaron.',
    );
    if (done) {
      setLines([]);
      setReference('');
      setDueDate('');
      await refresh();
      await loadProducts();
    }
  };
  return (
    <Screen title="Compras a proveedores" keyboard>
      <Typography.Paragraph color="muted">
        Registra la mercancía recibida. Las compras a crédito quedan como deuda con el proveedor en
        Clientes y proveedores; las de contado salen de la caja abierta.
      </Typography.Paragraph>
      {error ? <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph> : null}
      {!suppliers.length ? (
        <EmptyState title="Primero registra un proveedor en Clientes y proveedores" />
      ) : (
        <FormCard title="Nueva compra">
          <FinanceSelect
            label="Proveedor"
            value={supplier}
            onChange={setSupplier}
            options={suppliers.map((p) => ({ value: String(p.id), label: p.name }))}
          />
          <FinanceSelect
            label="Área que recibe"
            value={area}
            onChange={setArea}
            options={(data?.areas ?? []).map((a) => ({
              value: String(a.area_id),
              label: a.area_name,
            }))}
          />
          <FinanceSelect
            label="Producto"
            value={product}
            onChange={setProduct}
            options={products.map((p) => ({ value: String(p.id), label: `${p.name} (${p.unit})` }))}
          />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <FinanceField label="Cantidad" value={quantity} onChange={setQuantity} decimal />
            </View>
            <View className="flex-1">
              <FinanceField label="Costo unitario" value={cost} onChange={setCost} decimal />
            </View>
          </View>
          <Button variant="secondary" isDisabled={!product} onPress={addLine}>
            <Button.Label>Agregar a la compra</Button.Label>
          </Button>
          {lines.map((line) => (
            <Card key={line.productId} className="gap-1 p-3">
              <Row
                label={`${line.name} · ${quantityText(line.quantity)} ${line.unit}`}
                value={amount(line.quantity * line.cost)}
              />
              <Button
                size="sm"
                variant="ghost"
                onPress={() => setLines((c) => c.filter((l) => l.productId !== line.productId))}
              >
                <Button.Label>Quitar</Button.Label>
              </Button>
            </Card>
          ))}
          <Row label="Total de la compra" value={amount(total, data?.baseCurrency)} />
          <View className="flex-row flex-wrap gap-2">
            {payments.map((value) => (
              <Chip
                key={value}
                variant={payment === value ? 'primary' : 'soft'}
                onPress={() => setPayment(value)}
              >
                <Chip.Label>{paymentLabel[value]}</Chip.Label>
              </Chip>
            ))}
          </View>
          <FinanceField label="Factura o comprobante" value={reference} onChange={setReference} />
          {payment === 'credit' ? (
            <IsoDateField optional label="Vence" value={dueDate} onChange={setDueDate} />
          ) : null}
          <Button
            isDisabled={busy || !lines.length || !supplier || !area}
            onPress={() => void submit()}
          >
            <Button.Label>{busy ? 'Registrando…' : 'Recibir compra'}</Button.Label>
          </Button>
        </FormCard>
      )}
    </Screen>
  );
}
