import { Link } from 'expo-router';
import { Button, Card, Typography } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { AccessDenied } from '@/components/AccessDenied';
import { Screen } from '@/components/Screen';
import { EmptyState } from '@/components/pos-ui';
import {
  Choice,
  FinanceStatus,
  PeriodSelector,
  financeFailure,
} from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { FinanceSummary, FinanceValue } from '@/components/FinanceSummary';
import { FinanceChart } from '@/components/FinanceChart';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import { periodRange, type Period } from '@/lib/finance-periods';
import type { FinanceGroup, FinanceReport } from '@/lib/finance-models';
import { exportRows } from '@/lib/exports';
import { money } from '@/lib/format';
import type { Producto } from '@/lib/models';
const RANKS = ['Ventas netas', 'Ganancia bruta', 'Margen', 'Unidades vendidas'] as const;
export function financeExportRow(row: FinanceGroup) {
  return {
    ID: row.key,
    Nombre: row.name,
    'Ventas brutas CUP': row.gross,
    'Descuentos CUP': row.discounts,
    'Devoluciones y anulaciones CUP': row.returns,
    'Ventas netas CUP': row.net,
    'Costo conocido CUP': row.knownCost,
    'Ganancia bruta CUP': row.profit ?? 'Pendiente de costo',
    'Margen bruto %': row.margin ?? '',
    Operaciones: row.operations,
    Unidades: row.units,
    'Promedio CUP': row.average,
    'Líneas pendientes de costo': row.missingCostLines,
  };
}
export default function FinanceDashboard({ sellers = false }: { sellers?: boolean }) {
  const { user, revision, licenseMode } = useApp();
  const { getFinanceReport, listProducts } = usePosRepository();
  const [period, setPeriod] = useState<Period>('Hoy');
  const [start, setStart] = useState(new Date());
  const [end, setEnd] = useState(new Date());
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [options, setOptions] = useState<FinanceReport | null>(null);
  const [products, setProducts] = useState<Producto[]>([]);
  const [seller, setSeller] = useState('Todos');
  const [product, setProduct] = useState('Todos');
  const [category, setCategory] = useState('Todas');
  const [rank, setRank] = useState<(typeof RANKS)[number]>('Ventas netas');
  const [group, setGroup] = useState('Más vendidos');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (user?.role !== 'admin') return;
    setLoading(true);
    setError('');
    try {
      const range = periodRange(period, start, end);
      const [next, all, p] = await Promise.all([
        getFinanceReport(
          {
            ...range,
            ...(seller !== 'Todos' ? { sellerKey: seller } : {}),
            ...(product !== 'Todos' ? { productId: Number(product) } : {}),
            ...(category !== 'Todas' ? { category } : {}),
          },
          user.username,
        ),
        getFinanceReport(range, user.username),
        listProducts(),
      ]);
      setReport(next);
      setOptions(all);
      setProducts(p);
    } catch (e) {
      setError(financeFailure(e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [user, getFinanceReport, listProducts, period, start, end, seller, product, category]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, revision]);
  if (user?.role !== 'admin') return <AccessDenied />;
  const sortField =
    rank === 'Ganancia bruta'
      ? 'profit'
      : rank === 'Margen'
        ? 'margin'
        : rank === 'Unidades vendidas'
          ? 'units'
          : 'net';
  const rows =
    (sellers ? report?.sellers : report?.products)
      ?.filter((r) => sellers || group !== 'Menor margen' || r.margin !== null)
      .slice()
      .sort((a, b) =>
        sellers
          ? (b[sortField] ?? -Infinity) - (a[sortField] ?? -Infinity)
          : group === 'Más vendidos'
            ? b.units - a.units
            : group === 'Más rentables'
              ? (b.profit ?? -Infinity) - (a.profit ?? -Infinity)
              : (a.margin ?? Infinity) - (b.margin ?? Infinity),
      ) ?? [];
  const exportExcel = async () => {
    if (!report) return;
    setBusy(true);
    try {
      const metadata = {
        Desde: report.filter.start,
        Hasta: report.filter.end,
        Moneda: report.currency,
        'Vendedor filtrado': seller,
        'Producto filtrado': product,
        'Categoría filtrada': category,
      };
      const summary = { key: 'total', name: 'Total del período', ...report.totals };
      const exported = [summary, ...rows].map((r) => ({
        ...metadata,
        ...financeExportRow(r),
        'Consumo a precio de venta CUP': report.consumption.value,
        'Costo conocido consumo CUP': report.consumption.knownCost,
        'Consumos sin costo': report.consumption.missingCost,
        'Inventario actual a costo conocido CUP': report.inventory.knownValue,
        'Productos sin costo': report.inventory.missingCost,
        'Inventario valorado al': report.inventory.asOf,
      }));
      await exportRows(
        sellers ? 'rendimiento-vendedores' : 'rentabilidad',
        exported,
        'xlsx',
        licenseMode,
      );
    } catch (e) {
      setError(financeFailure(e));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setSeller('Todos');
    setProduct('Todos');
    setCategory('Todas');
  };
  return (
    <Screen scroll={false}>
      <FlatList
        data={loading ? [] : rows}
        keyExtractor={(r) => r.key}
        contentContainerClassName="gap-4 p-4 pb-12 web:mx-auto web:w-full web:max-w-5xl"
        ListHeaderComponent={
          <View className="gap-4">
            <Typography.Heading type="h2">
              {sellers ? 'Rendimiento de vendedores' : 'Rentabilidad del negocio'}
            </Typography.Heading>
            <Link href="/more">Volver a Más</Link>
            <PeriodSelector
              period={period}
              onPeriod={setPeriod}
              start={start}
              end={end}
              onStart={setStart}
              onEnd={setEnd}
            />
            {sellers ? (
              <FinanceSelect
                label="Vendedor"
                options={[
                  { value: 'Todos', label: 'Todos' },
                  ...(options?.sellers.map((s) => ({ value: s.key, label: s.name })) ?? []),
                ]}
                value={seller}
                onChange={setSeller}
              />
            ) : null}
            <FinanceSelect
              label="Producto"
              options={[
                { value: 'Todos', label: 'Todos' },
                ...products.map((p) => ({ value: String(p.id), label: `${p.id} · ${p.name}` })),
              ]}
              value={product}
              onChange={setProduct}
            />
            <FinanceSelect
              label="Categoría"
              options={['Todas', ...new Set(products.map((p) => p.category))].map((c) => ({
                value: c,
                label: c || 'Sin categoría',
              }))}
              value={category}
              onChange={setCategory}
            />
            <FinanceStatus loading={loading} error={error} retry={() => void load()} />
            {!loading && report ? (
              <>
                <Typography.Heading type="h3">Resultados del período</Typography.Heading>
                <Typography.Paragraph color="muted">
                  Ganancia bruta, antes de gastos operativos. Los ajustes se contabilizan en la
                  fecha en que se registran.
                </Typography.Paragraph>
                <FinanceSummary totals={report.totals} />
                {!sellers ? (
                  <>
                    <Typography.Heading type="h3">Mercancía fuera de ventas</Typography.Heading>
                    <FinanceValue
                      label="Consumo interno a precio de venta"
                      value={money(report.consumption.value)}
                    />
                    <FinanceValue
                      label={
                        report.consumption.missingCost
                          ? 'Costo conocido de consumo interno (parcial)'
                          : 'Consumo interno a costo'
                      }
                      value={money(report.consumption.knownCost)}
                    />
                    {report.consumption.missingCost ? (
                      <Typography.Paragraph className="text-warning">
                        Hay consumos pendientes de costo.
                      </Typography.Paragraph>
                    ) : null}
                    <FinanceValue
                      label={
                        report.inventory.missingCost
                          ? 'Inventario actual a costo conocido (parcial)'
                          : 'Inventario disponible a costo actual'
                      }
                      value={money(report.inventory.knownValue)}
                    />
                    <Typography.Paragraph color="muted">
                      Inventario valorado al{' '}
                      {new Date(report.inventory.asOf).toLocaleString('es-CU')}; no es el stock
                      histórico del período.
                    </Typography.Paragraph>
                    {report.inventory.missingCost ? (
                      <Typography.Paragraph className="text-warning">
                        Hay productos en stock pendientes de costo.
                      </Typography.Paragraph>
                    ) : null}
                  </>
                ) : null}
                <FinanceChart rows={report.timeline} field="net" label="Ventas netas por día" />
                <FinanceChart
                  rows={report.timeline}
                  field="profit"
                  label="Ganancia bruta por día"
                />
                <FinanceChart rows={report.timeline} field="margin" label="Margen bruto por día" />
                <Button variant="secondary" isDisabled={busy} onPress={() => void exportExcel()}>
                  <Button.Label>{busy ? 'Exportando…' : 'Exportar Excel'}</Button.Label>
                </Button>
              </>
            ) : null}
            <Typography.Heading type="h3">
              {sellers ? 'Comparación entre vendedores' : 'Productos'}
            </Typography.Heading>
            {sellers ? (
              <Choice values={RANKS} value={rank} onChange={setRank} />
            ) : (
              <Choice
                values={['Más vendidos', 'Más rentables', 'Menor margen']}
                value={group}
                onChange={setGroup}
              />
            )}
            {!sellers ? (
              <Link href="/sale-adjustments">Devoluciones, descuentos y anulaciones</Link>
            ) : null}
          </View>
        }
        renderItem={({ item: r }) => (
          <Card className="gap-3 p-4">
            <Typography.Heading type="h4">{r.name}</Typography.Heading>
            <Typography.Paragraph color="muted">
              {sellers ? 'Vendedor' : 'Producto'}: {r.key}
            </Typography.Paragraph>
            {sellers ? (
              <FinanceSummary totals={r} />
            ) : (
              <>
                <FinanceValue label="Ventas netas" value={money(r.net)} />
                <FinanceValue label="Unidades vendidas" value={String(r.units)} />
                <FinanceValue
                  label="Ganancia bruta"
                  value={r.profit === null ? 'Pendiente de costo' : money(r.profit)}
                />
                <FinanceValue
                  label="Margen bruto"
                  value={r.margin === null ? 'No calculable' : `${r.margin.toFixed(2)} %`}
                />
                {r.profit !== null && r.profit < 0 ? (
                  <Typography.Paragraph className="text-danger">
                    Ganancia bruta negativa
                  </Typography.Paragraph>
                ) : null}
              </>
            )}
          </Card>
        )}
        ListEmptyComponent={
          !loading && !error ? (
            <EmptyState
              title="No hay operaciones con este período y filtros"
              action={
                <Button variant="secondary" onPress={reset}>
                  <Button.Label>Limpiar filtros</Button.Label>
                </Button>
              }
            />
          ) : undefined
        }
      />
    </Screen>
  );
}
