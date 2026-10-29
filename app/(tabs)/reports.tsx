import * as Haptics from 'expo-haptics';
import { Link } from 'expo-router';
import { Button, Card, Skeleton, Typography } from 'heroui-native';
import { Banknote, CreditCard, Send, ShoppingBag } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { AccessDenied } from '@/components/AccessDenied';
import { EmptyState, MetricCard, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import { money } from '@/lib/format';
import type { DailyReport, Movimiento, Producto } from '@/lib/models';
import { canAccess } from '@/lib/permissions';

type Row = { key: string } & (
  | { kind: 'heading'; title: string; count: number }
  | { kind: 'empty'; title: string }
  | { kind: 'user'; value: DailyReport['byUser'][number] }
  | { kind: 'sold'; value: DailyReport['byProduct'][number] }
  | { kind: 'movement'; value: Movimiento }
  | { kind: 'stock'; value: Producto }
);
function ReportRow({ row }: { row: Row }) {
  switch (row.kind) {
    case 'heading':
      return (
        <View className="pt-4">
          <SectionTitle badge={row.count}>{row.title}</SectionTitle>
        </View>
      );
    case 'empty':
      return (
        <EmptyState
          title={row.title}
          action={
            <Link href="/sales" asChild>
              <Button variant="secondary">
                <Button.Label>Ir a ventas</Button.Label>
              </Button>
            </Link>
          }
        />
      );
    case 'user':
      return (
        <Card className="flex-row items-center gap-3 p-4">
          <View className="flex-1">
            <Typography.Paragraph className="font-semibold">{row.value.user}</Typography.Paragraph>
            <Typography.Paragraph type="body-sm" color="muted">
              {row.value.count} {row.value.count === 1 ? 'venta' : 'ventas'}
            </Typography.Paragraph>
          </View>
          <Typography.Paragraph>{money(row.value.total)}</Typography.Paragraph>
        </Card>
      );
    case 'sold':
      return (
        <View className="border-border gap-1 border-b py-3">
          <Typography.Paragraph>{row.value.product}</Typography.Paragraph>
          <Typography.Paragraph type="body-sm" color="muted">
            {row.value.quantity} {row.value.unit} · {money(row.value.total)}
          </Typography.Paragraph>
        </View>
      );
    case 'movement':
      return (
        <View className="border-border gap-1 border-b py-3">
          <Typography.Paragraph>
            {row.value.product_name} · {row.value.quantity}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm" color="muted">
            {row.value.type} · {row.value.from_area ?? 'Exterior'} →{' '}
            {row.value.to_area ?? 'Exterior'} · {row.value.user}
          </Typography.Paragraph>
        </View>
      );
    case 'stock':
      return (
        <View className="border-border flex-row gap-3 border-b py-3">
          <Typography.Paragraph className="flex-1">{row.value.name}</Typography.Paragraph>
          <Typography.Paragraph>
            {row.value.stock} {row.value.unit}
          </Typography.Paragraph>
        </View>
      );
    default: {
      const exhaustive: never = row;
      throw new Error(`Unknown report row: ${JSON.stringify(exhaustive)}`);
    }
  }
}
export default function Reports() {
  const { user } = useApp();
  const { getDailyReport } = usePosRepository();
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!user || !canAccess(user.role, 'reports')) return Promise.resolve();
    return getDailyReport()
      .then(
        (dailyReport) => {
          setReport(dailyReport);
          setError('');
        },
        (failure: unknown) => {
          setError(failure instanceof Error ? failure.message : 'No se pudo cargar el reporte.');
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        },
      )
      .finally(() => setLoading(false));
  }, [getDailyReport, user]);
  const reload = () => {
    setLoading(true);
    setError('');
    void load();
  };
  useEffect(() => {
    void load();
  }, [load]);
  const rows = useMemo<Row[]>(() => {
    if (!report) return [];
    return [
      { key: 'users', kind: 'heading', title: 'Ventas por usuario', count: report.byUser.length },
      ...report.byUser.map((value): Row => ({ key: `user-${value.user}`, kind: 'user', value })),
      ...(!report.byUser.length
        ? [{ key: 'no-users', kind: 'empty' as const, title: 'Sin ventas hoy' }]
        : []),
      { key: 'sold', kind: 'heading', title: 'Productos vendidos', count: report.byProduct.length },
      ...report.byProduct.map(
        (value): Row => ({ key: `sold-${value.product}-${value.unit}`, kind: 'sold', value }),
      ),
      ...(!report.byProduct.length
        ? [{ key: 'no-sold', kind: 'empty' as const, title: 'Sin productos vendidos' }]
        : []),
      {
        key: 'movements',
        kind: 'heading',
        title: 'Movimientos del día',
        count: report.movements.length,
      },
      ...report.movements.map(
        (value): Row => ({ key: `movement-${value.id}`, kind: 'movement', value }),
      ),
      ...(!report.movements.length
        ? [{ key: 'no-movements', kind: 'empty' as const, title: 'Sin movimientos hoy' }]
        : []),
      { key: 'stock', kind: 'heading', title: 'Inventario actual', count: report.inventory.length },
      ...report.inventory.map((value): Row => ({ key: `stock-${value.id}`, kind: 'stock', value })),
      ...(!report.inventory.length
        ? [{ key: 'no-stock', kind: 'empty' as const, title: 'No hay productos en inventario' }]
        : []),
    ];
  }, [report]);
  if (!user || !canAccess(user.role, 'reports')) return <AccessDenied />;
  return (
    <Screen scroll={false}>
      <FlatList
        data={loading || error ? [] : rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => <ReportRow row={item} />}
        contentContainerStyle={{
          padding: 16,
          gap: 12,
          maxWidth: 1024,
          width: '100%',
          alignSelf: 'center',
        }}
        refreshing={loading}
        onRefresh={reload}
        ListHeaderComponent={
          <View className="gap-4">
            <Typography.Heading type="h2">Reporte diario</Typography.Heading>
            {!loading && !error ? (
              <View className="flex-row flex-wrap gap-3">
                <MetricCard
                  label="Total ventas"
                  value={money(report?.totalSales ?? 0)}
                  icon={ShoppingBag}
                />
                <MetricCard
                  label="Efectivo"
                  value={money(report?.cash ?? 0)}
                  icon={Banknote}
                  tone="success"
                />
                <MetricCard
                  label="Transferencia"
                  value={money(report?.transfer ?? 0)}
                  icon={Send}
                />
                {report && report.card > 0 ? (
                  <MetricCard
                    label="Tarjeta histórica"
                    value={money(report.card)}
                    icon={CreditCard}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View className="gap-3">
              <Skeleton className="h-28 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </View>
          ) : error ? (
            <View className="gap-3">
              <Typography.Paragraph>{error}</Typography.Paragraph>
              <Button onPress={reload}>
                <Button.Label>Reintentar</Button.Label>
              </Button>
            </View>
          ) : undefined
        }
      />
    </Screen>
  );
}
