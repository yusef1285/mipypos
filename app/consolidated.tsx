import { Card, Typography } from 'heroui-native';
import { Banknote, Boxes, ReceiptText, Truck } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { Row, amount, monthStartIso, todayIso, useBusinessData } from '@/components/BusinessKit';
import { FinanceField, FinanceStatus } from '@/components/FinanceControls';
import { EmptyState, MetricCard, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { canAccess } from '@/lib/permissions';

const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export default function Consolidated() {
  const { user } = useApp();
  const [start, setStart] = useState(monthStartIso());
  const [end, setEnd] = useState(todayIso());
  const filter = valid(start) && valid(end) ? { start, end } : {};
  const { data, error, loading, load } = useBusinessData(filter);
  if (!user || !canAccess(user.role, 'business')) return <AccessDenied />;
  const report = data?.consolidation;
  const base = report?.baseCurrency ?? data?.baseCurrency ?? 'CUP';
  return (
    <Screen title="Consolidado" keyboard onRefresh={load}>
      <Card className="gap-3 p-4">
        <View className="flex-row gap-2">
          <View className="flex-1">
            <FinanceField label="Desde (AAAA-MM-DD)" value={start} onChange={setStart} />
          </View>
          <View className="flex-1">
            <FinanceField label="Hasta (AAAA-MM-DD)" value={end} onChange={setEnd} />
          </View>
        </View>
        <Typography.Paragraph type="body-sm" color="muted">
          Agrupa por día local del dispositivo. El inventario en tránsito se valora al costo
          registrado al enviarlo.
        </Typography.Paragraph>
      </Card>
      <FinanceStatus loading={loading && !data} error={error} retry={() => void load()} />
      {report ? (
        <>
          <View className="flex-row flex-wrap gap-3">
            <MetricCard
              label="Ventas"
              value={amount(report.totals.sales, base)}
              icon={ReceiptText}
            />
            <MetricCard
              label="Inventario valorado"
              value={amount(report.totals.inventoryValue, base)}
              icon={Boxes}
              tone="success"
            />
            <MetricCard
              label="En tránsito"
              value={amount(report.totals.inTransitValue, base)}
              icon={Truck}
              tone="warning"
            />
            <MetricCard
              label="Caja por cuentas, nómina y socios"
              value={amount(report.totals.cashEntriesNet, base)}
              icon={Banknote}
            />
          </View>
          <Card className="gap-2 p-4">
            <Row label="Tickets" value={String(report.totals.tickets)} />
            <Row label="Por cobrar" value={amount(report.totals.receivables, base)} />
            <Row label="Por pagar" value={amount(report.totals.payables, base)} />
            <Row label="Nómina del periodo" value={amount(report.totals.payroll, base)} />
            <Row label="Capital de socios" value={amount(report.totals.partnerCapital, base)} />
          </Card>
          <SectionTitle badge={report.branches.length}>Por sucursal</SectionTitle>
          {report.branches.map((b) => (
            <Card key={b.branchId ?? 'main'} className="gap-2 p-4">
              <Typography.Paragraph className="font-semibold">{b.name}</Typography.Paragraph>
              <Row label="Ventas" value={amount(b.sales, base)} />
              <Row label="Tickets" value={String(b.tickets)} />
              <Row label="Inventario valorado" value={amount(b.inventoryValue, base)} />
              {b.inventoryUnknownCost ? (
                <Row
                  label="Productos sin costo"
                  value={String(b.inventoryUnknownCost)}
                  tone="text-warning"
                />
              ) : null}
              <Row label="Nómina" value={amount(b.payroll, base)} />
            </Card>
          ))}
        </>
      ) : data ? (
        <EmptyState title="Sin datos para el periodo." />
      ) : null}
    </Screen>
  );
}
