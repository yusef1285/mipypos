import * as Haptics from 'expo-haptics';
import { Link } from 'expo-router';
import { Button, Card, Skeleton, Typography } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { z } from 'zod';
import { AccessDenied } from '@/components/AccessDenied';
import { EmptyState } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { money } from '@/lib/format';
import type { CashClosureRecord } from '@/lib/models';
import { canAccess } from '@/lib/permissions';
import { usePosRepository } from '@/lib/use-pos-repository';

const detailSchema = z.object({
  cashCount: z.number(),
  expectedCash: z.number(),
  transferCount: z.number(),
  withdrawalCount: z.number(),
  withdrawalTotal: z.number(),
  cashDifference: z.number(),
  transferDifference: z.number(),
  withdrawalDifference: z.number(),
  totalDifference: z.number(),
  inventory: z.array(
    z.object({
      productName: z.string(),
      physicalStock: z.number(),
      expectedStock: z.number(),
      difference: z.number(),
      unit: z.string(),
    }),
  ),
  approvals: z.array(
    z.object({ id: z.number(), authorized_by: z.string(), reason: z.string(), date: z.string() }),
  ),
});
function ClosureRow({ item }: { item: CashClosureRecord }) {
  let detail: z.infer<typeof detailSchema> | undefined;
  try {
    detail = detailSchema.parse(JSON.parse(item.detail));
  } catch {
    detail = undefined;
  }
  return (
    <Card className="gap-2 p-4">
      <Typography.Heading type="h4">Cierre #{item.session_id}</Typography.Heading>
      <Typography.Paragraph type="body-sm" color="muted">
        {new Date(item.date).toLocaleString()} · {item.authorized_by}
      </Typography.Paragraph>
      {detail ? (
        <>
          <Typography.Paragraph>
            Efectivo: {money(detail.cashCount)} · Esperado: {money(detail.expectedCash)}
          </Typography.Paragraph>
          <Typography.Paragraph>Transferencias: {money(detail.transferCount)}</Typography.Paragraph>
          <Typography.Paragraph>
            Extracciones: {money(detail.withdrawalTotal)} · Comprobadas:{' '}
            {money(detail.withdrawalCount)}
          </Typography.Paragraph>
          <Typography.Paragraph>
            Diferencias: efectivo {money(detail.cashDifference)}, transferencias{' '}
            {money(detail.transferDifference)}, extracciones {money(detail.withdrawalDifference)}
          </Typography.Paragraph>
          {detail.inventory
            .filter((product) => Math.abs(product.difference) > 0.0001)
            .map((product) => (
              <Typography.Paragraph key={product.productName}>
                {product.productName}: contado {product.physicalStock} / esperado{' '}
                {product.expectedStock} {product.unit} · Diferencia {product.difference}
              </Typography.Paragraph>
            ))}
          {detail.approvals.map((approval) => (
            <View key={approval.id} className="gap-1 pt-2">
              <Typography.Paragraph className="font-semibold">
                Autorizó: {approval.authorized_by}
              </Typography.Paragraph>
              <Typography.Paragraph>{approval.reason}</Typography.Paragraph>
            </View>
          ))}
          {!detail.approvals.length ? (
            <Typography.Paragraph className="text-success">Sin diferencias</Typography.Paragraph>
          ) : null}
        </>
      ) : (
        <Typography.Paragraph className="text-danger">
          No se pudo leer el detalle de este cierre.
        </Typography.Paragraph>
      )}
    </Card>
  );
}
export default function CashHistory() {
  const { user } = useApp();
  const { listCashClosures } = usePosRepository();
  const [items, setItems] = useState<CashClosureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!user || !canAccess(user.role, 'cash')) return Promise.resolve();
    return listCashClosures()
      .then(
        (closures) => {
          setItems(closures);
          setError('');
        },
        (failure: unknown) => {
          setError(
            failure instanceof Error ? failure.message : 'No se pudieron cargar los cierres.',
          );
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        },
      )
      .finally(() => setLoading(false));
  }, [user, listCashClosures]);
  const reload = () => {
    setLoading(true);
    setError('');
    void load();
  };
  useEffect(() => {
    void load();
  }, [load]);
  if (!user || !canAccess(user.role, 'cash')) return <AccessDenied />;
  return (
    <Screen scroll={false}>
      <FlatList
        data={loading || error ? [] : items}
        keyExtractor={(item) => String(item.session_id)}
        renderItem={({ item }) => <ClosureRow item={item} />}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshing={loading}
        onRefresh={reload}
        ListEmptyComponent={
          loading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : error ? (
            <View className="gap-3">
              <Typography.Paragraph>{error}</Typography.Paragraph>
              <Button onPress={reload}>
                <Button.Label>Reintentar</Button.Label>
              </Button>
            </View>
          ) : (
            <EmptyState
              title="Los próximos cierres aparecerán aquí"
              action={
                <Link href="/cash" asChild>
                  <Button>
                    <Button.Label>Ir a caja</Button.Label>
                  </Button>
                </Link>
              }
            />
          )
        }
        ListFooterComponent={
          <Link href="/cash" asChild>
            <Button variant="secondary">
              <Button.Label>Volver a caja</Button.Label>
            </Button>
          </Link>
        }
      />
    </Screen>
  );
}
