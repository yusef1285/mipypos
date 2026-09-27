import { Card, Chip, Typography } from 'heroui-native';
import { Banknote, CreditCard, Send, ShoppingBag } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { EmptyState, MetricCard, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { getDailyReport } from '@/lib/database';
import { money } from '@/lib/format';
import type { DailyReport } from '@/lib/models';
import { canAccess } from '@/lib/permissions';

export default function Reports() {
  const { user } = useApp();
  const [report, setReport] = useState<DailyReport | null>(null);
  const load = useCallback(async () => setReport(await getDailyReport()), []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  if (!user || !canAccess(user.role, 'reports')) return <AccessDenied />;
  return (
    <Screen title="Reporte diario" onRefresh={load}>
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
        <MetricCard label="Transferencia" value={money(report?.transfer ?? 0)} icon={Send} />
        <MetricCard label="Tarjeta" value={money(report?.card ?? 0)} icon={CreditCard} />
      </View>
      <SectionTitle>Ventas por usuario</SectionTitle>
      {report?.byUser.length ? (
        <Card className="p-4">
          {report.byUser.map((row) => (
            <View key={row.user} className="border-border flex-row justify-between border-b py-3">
              <View>
                <Typography.Paragraph className="font-semibold">{row.user}</Typography.Paragraph>
                <Typography.Paragraph type="body-sm" color="muted">
                  {row.count} ventas
                </Typography.Paragraph>
              </View>
              <Typography.Paragraph className="font-semibold">
                {money(row.total)}
              </Typography.Paragraph>
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState title="Sin ventas hoy" />
      )}
      <SectionTitle>Productos vendidos</SectionTitle>
      {report?.byProduct.length ? (
        <Card className="p-4">
          {report.byProduct.map((row) => (
            <View
              key={row.product}
              className="border-border flex-row items-center justify-between border-b py-3"
            >
              <Typography.Paragraph className="flex-1">{row.product}</Typography.Paragraph>
              <Chip size="sm" variant="soft">
                {row.quantity} u.
              </Chip>
              <Typography.Paragraph className="ml-3">{money(row.total)}</Typography.Paragraph>
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState title="Sin productos vendidos" />
      )}
      <SectionTitle badge={report?.movements.length ?? 0}>Movimientos del día</SectionTitle>
      <SectionTitle badge={report?.inventory.length ?? 0}>Inventario final</SectionTitle>
    </Screen>
  );
}
