import * as Haptics from 'expo-haptics';
import { Link } from 'expo-router';
import { Button, Card, Chip, Skeleton, Typography } from 'heroui-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View, Alert, Image } from 'react-native';
import { AccessDenied } from '@/components/AccessDenied';
import { CashClosureRow } from '@/components/CashClosureRow';
import type { CashClosureRecord } from '@/lib/models';
import { EmptyState } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { money, shortDate } from '@/lib/format';
import { canAccess } from '@/lib/permissions';
import { usePosRepository } from '@/lib/use-pos-repository';
import type { getAuditSnapshot, getSale } from '@/lib/database';

type Snapshot = Awaited<ReturnType<typeof getAuditSnapshot>>;
type Tab = 'sales' | 'stock' | 'movements' | 'closures';
interface Row {
  key: string;
  title: string;
  detail: string;
  saleId?: number;
  closure?: CashClosureRecord;
}
export default function Audit() {
  const { user, networkConfig } = useApp();
  const { getAuditSnapshot: snapshot, getSale: saleDetail } = usePosRepository();
  const [data, setData] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<Tab>('sales');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Awaited<ReturnType<typeof getSale>>>(null);
  const fetching = useRef(false);
  const load = useCallback(async () => {
    if (!user || !canAccess(user.role, 'audit') || fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      setData(await snapshot());
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo consultar el negocio.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, [snapshot, user]);
  useEffect(() => {
    const start = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [load]);
  if (!user || !canAccess(user.role, 'audit')) return <AccessDenied />;
  const rows: Row[] = !data
    ? []
    : tab === 'sales'
      ? data.sales.map((sale) => ({
          key: String(sale.id),
          title: `Venta #${sale.id} · ${money(sale.total)}`,
          detail: `${sale.user} · ${shortDate(sale.date)} · ${sale.method === 'cash' ? 'Efectivo' : sale.method === 'transfer' ? 'Transferencia' : 'Mixto'}`,
          saleId: sale.id,
        }))
      : tab === 'stock'
        ? data.stocks.map((stock) => {
            const product = data.products.find((p) => p.id === stock.product_id);
            return {
              key: `${stock.area_id}-${stock.product_id}`,
              title: product?.name ?? 'Producto',
              detail: `${data.areas.find((a) => a.id === stock.area_id)?.name ?? 'Área'} · ${stock.quantity} ${product?.unit ?? 'u'}`,
            };
          })
        : tab === 'movements'
          ? data.movements.map((movement) => ({
              key: String(movement.id),
              title: `${movement.product_name} · ${movement.quantity}`,
              detail: `${movement.type} · ${movement.from_area ?? ''} → ${movement.to_area ?? ''} · ${movement.user} · ${shortDate(movement.date)}`,
            }))
          : data.closures.map((closure) => ({
              key: String(closure.session_id),
              title: `Cierre #${closure.session_id}`,
              detail: `${closure.authorized_by} · ${shortDate(closure.date)}`,
              closure,
            }));
  return (
    <Screen scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        refreshing={loading}
        onRefresh={() => void load()}
        ListHeaderComponent={
          <View className="gap-4 pb-4">
            <Link href="/more" asChild>
              <Button variant="ghost">
                <Button.Label>Volver a Más</Button.Label>
              </Button>
            </Link>
            <Typography.Heading type="h2">Auditoría</Typography.Heading>
            <Typography.Paragraph color="muted">
              Solo consulta ·{' '}
              {networkConfig.mode === 'client'
                ? 'Datos del teléfono vendedor'
                : 'Datos de este teléfono'}
            </Typography.Paragraph>
            <View className="flex-row flex-wrap gap-2">
              {(
                [
                  { key: 'sales', label: 'Ventas del día' },
                  { key: 'stock', label: 'Inventario por área' },
                  { key: 'movements', label: 'Movimientos' },
                  { key: 'closures', label: 'Cierres' },
                ] as const
              ).map((item) => (
                <Chip
                  key={item.key}
                  variant={tab === item.key ? 'primary' : 'soft'}
                  onPress={() => {
                    setTab(item.key);
                    setSelected(null);
                    void Haptics.selectionAsync();
                  }}
                >
                  <Chip.Label numberOfLines={1}>{item.label}</Chip.Label>
                </Chip>
              ))}
            </View>
            {error ? (
              <>
                <Typography.Paragraph className="text-danger">
                  {error} Los datos anteriores pueden estar desactualizados.
                </Typography.Paragraph>
                <Button onPress={() => void load()}>
                  <Button.Label>Reintentar</Button.Label>
                </Button>
              </>
            ) : null}
            {selected ? (
              <Card className="gap-3 p-4">
                <Typography.Heading type="h4">Venta #{selected.sale.id}</Typography.Heading>
                {selected.lines.map((line) => (
                  <Typography.Paragraph key={line.id}>
                    {line.name} · {line.quantity} {line.unit} · {money(line.subtotal)}
                  </Typography.Paragraph>
                ))}
                {selected.sale.settlement?.cashReceived != null ? (
                  <Typography.Paragraph>
                    Recibido: {money(selected.sale.settlement.cashReceived)} · Vuelto:{' '}
                    {money(selected.sale.settlement.changeDue)}
                  </Typography.Paragraph>
                ) : null}
                {selected.sale.settlement?.transferReceipt ? (
                  <>
                    <Typography.Paragraph>
                      {selected.sale.settlement.transferReceipt.fullName} · CI{' '}
                      {selected.sale.settlement.transferReceipt.ci}
                      {'\n'}
                      {selected.sale.settlement.transferReceipt.address}
                      {'\n'}Referencia: {selected.sale.settlement.transferReceipt.reference}
                      {'\n'}
                      {selected.sale.settlement.transferReceipt.rawText}
                    </Typography.Paragraph>
                    <Image
                      source={{
                        uri: `data:image/jpeg;base64,${selected.sale.settlement.transferReceipt.imageBase64}`,
                      }}
                      resizeMode="contain"
                      style={{ width: '100%', height: 240 }}
                    />
                  </>
                ) : null}
                <Button variant="ghost" onPress={() => setSelected(null)}>
                  <Button.Label>Cerrar detalle</Button.Label>
                </Button>
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !data && loading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : (
            <EmptyState
              title="No hay registros para esta consulta"
              action={
                <Button variant="secondary" onPress={() => void load()}>
                  <Button.Label>Actualizar</Button.Label>
                </Button>
              }
            />
          )
        }
        renderItem={({ item }) =>
          item.closure ? (
            <CashClosureRow item={item.closure} />
          ) : (
            <Card className="gap-2 p-4">
              <Typography.Paragraph className="font-semibold">{item.title}</Typography.Paragraph>
              <Typography.Paragraph color="muted">{item.detail}</Typography.Paragraph>
              {item.saleId ? (
                <Button
                  variant="ghost"
                  onPress={() => {
                    void saleDetail(item.saleId!)
                      .then(setSelected)
                      .catch((failure: unknown) => {
                        Alert.alert(
                          'No se pudo consultar',
                          failure instanceof Error ? failure.message : 'Reintenta.',
                        );
                        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                      });
                  }}
                >
                  <Button.Label>Ver venta y comprobante</Button.Label>
                </Button>
              ) : null}
            </Card>
          )
        }
      />
    </Screen>
  );
}
