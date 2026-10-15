import { Link } from 'expo-router';
import { Button, Card, Typography } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AccessDenied } from '@/components/AccessDenied';
import { Screen } from '@/components/Screen';
import { EmptyState } from '@/components/pos-ui';
import {
  Choice,
  FinanceField,
  FinanceStatus,
  financeFailure,
  numeric,
} from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { FinanceValue } from '@/components/FinanceSummary';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import { useFinanceCommand } from '@/lib/use-finance-command';
import { unitMargin, inventoryByCategory } from '@/lib/finance-calculations';
import { exportRows } from '@/lib/exports';
import { money } from '@/lib/format';
import type { Area, Producto } from '@/lib/models';
const SORTS = ['Nombre', 'Valor de inventario', 'Menor margen'] as const;
export default function Investment() {
  const { user, licenseMode, revision, refresh } = useApp();
  const { getInvestmentData, listAreas, setProductCost, receiveCostedStock } = usePosRepository();
  const [data, setData] = useState<Awaited<ReturnType<typeof getInvestmentData>> | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Todas');
  const [sort, setSort] = useState<(typeof SORTS)[number]>('Nombre');
  const [onlyPending, setOnlyPending] = useState('Todos');
  const [editing, setEditing] = useState<Producto | null>(null);
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState('Costo actual');
  const [quantity, setQuantity] = useState('');
  const [areaId, setAreaId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const command = useFinanceCommand();
  const load = useCallback(async () => {
    if (user?.role !== 'admin') return;
    setLoading(true);
    setError('');
    try {
      const [next, nextAreas] = await Promise.all([getInvestmentData(user.username), listAreas()]);
      setData(next);
      setAreas(nextAreas);
    } catch (e) {
      setError(financeFailure(e));
    } finally {
      setLoading(false);
    }
  }, [user, getInvestmentData, listAreas]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, revision]);
  if (user?.role !== 'admin') return <AccessDenied />;
  const products = data?.products ?? [];
  const categories = ['Todas', ...new Set(products.map((p) => p.category))];
  const rows = products
    .filter(
      (p) =>
        `${p.id} ${p.name}`.toLowerCase().includes(search.toLowerCase()) &&
        (category === 'Todas' || p.category === category) &&
        (onlyPending === 'Todos' || p.unit_cost == null),
    )
    .sort((a, b) =>
      sort === 'Nombre'
        ? a.name.localeCompare(b.name)
        : sort === 'Valor de inventario'
          ? b.stock * (b.unit_cost ?? 0) - a.stock * (a.unit_cost ?? 0)
          : (unitMargin(a.price_cash, a.unit_cost)?.margin ?? Infinity) -
            (unitMargin(b.price_cash, b.unit_cost)?.margin ?? Infinity),
    );
  const edit = (p: Producto) => {
    setEditing(p);
    setCost(p.unit_cost == null ? '' : String(p.unit_cost));
    setReason('');
    setQuantity('');
    setMode('Costo actual');
    setAreaId(String(areas[0]?.id ?? ''));
    setError('');
    command.clear();
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      const input = { productId: editing.id, cost: cost.trim() ? numeric(cost) : null, reason };
      if (mode === 'Entrada de mercancía') {
        if (input.cost === null) throw new Error('Indica el costo unitario de la entrada.');
        const purchase = {
          ...input,
          cost: input.cost,
          quantity: numeric(quantity),
          areaId: Number(areaId),
        };
        await receiveCostedStock(
          { ...purchase, commandId: command.idFor(purchase) },
          user.username,
        );
      } else await setProductCost({ ...input, commandId: command.idFor(input) }, user.username);
      command.clear();
      setEditing(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
      await load();
    } catch (e) {
      setError(financeFailure(e));
    } finally {
      setBusy(false);
    }
  };
  const exportExcel = async () => {
    setBusy(true);
    try {
      await exportRows(
        'inversion-costos',
        rows.map((p) => ({
          Código: p.id,
          Producto: p.name,
          Categoría: p.category,
          'Costo unitario CUP': p.unit_cost ?? 'Pendiente de costo',
          'Precio efectivo CUP': p.price_cash,
          'Precio transferencia CUP': p.price_transfer,
          'Ganancia unitaria efectivo CUP':
            unitMargin(p.price_cash, p.unit_cost)?.profit ?? 'Pendiente de costo',
          'Margen efectivo %': unitMargin(p.price_cash, p.unit_cost)?.margin ?? '',
          'Ganancia unitaria transferencia CUP':
            unitMargin(p.price_transfer, p.unit_cost)?.profit ?? 'Pendiente de costo',
          'Margen transferencia %': unitMargin(p.price_transfer, p.unit_cost)?.margin ?? '',
          Existencias: p.stock,
          Unidad: p.unit,
          'Valor a costo CUP': p.unit_cost == null ? 'Pendiente de costo' : p.stock * p.unit_cost,
        })),
        'xlsx',
        licenseMode,
      );
    } catch (e) {
      setError(financeFailure(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen scroll={false} keyboard>
      <FlatList
        data={loading ? [] : rows}
        keyExtractor={(p) => String(p.id)}
        contentContainerClassName="gap-4 p-4 pb-12 web:mx-auto web:w-full web:max-w-5xl"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View className="gap-4">
            <Typography.Heading type="h2">Inversión y costos</Typography.Heading>
            <Link href="/more">Volver a Más</Link>
            <FinanceStatus loading={loading} error={error} retry={() => void load()} />
            {data ? (
              <>
                <FinanceValue
                  label={
                    products.some((p) => p.stock > 0 && p.unit_cost == null)
                      ? 'Valor conocido del inventario (parcial)'
                      : 'Valor total del inventario a costo'
                  }
                  value={money(products.reduce((s, p) => s + p.stock * (p.unit_cost ?? 0), 0))}
                />
                {products.some((p) => p.stock > 0 && p.unit_cost == null) ? (
                  <Typography.Paragraph className="text-warning">
                    Hay existencias pendientes de costo.
                  </Typography.Paragraph>
                ) : null}
                <Typography.Heading type="h4">Capital por categoría</Typography.Heading>
                {inventoryByCategory(products).map((group) => (
                  <View key={group.category} className="gap-1">
                    <FinanceValue
                      label={`${group.category || 'Sin categoría'}${group.missingCostProducts ? ' (parcial)' : ''}`}
                      value={money(group.value)}
                    />
                    {group.missingCostProducts ? (
                      <Typography.Paragraph className="text-warning">
                        {group.missingCostProducts}{' '}
                        {group.missingCostProducts === 1
                          ? 'producto pendiente'
                          : 'productos pendientes'}{' '}
                        de costo
                      </Typography.Paragraph>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
            <FinanceField label="Buscar nombre o código" value={search} onChange={setSearch} />
            <FinanceSelect
              label="Categoría"
              options={categories.map((c) => ({ value: c, label: c || 'Sin categoría' }))}
              value={category}
              onChange={setCategory}
            />
            <Choice
              values={['Todos', 'Pendientes de costo']}
              value={onlyPending}
              onChange={setOnlyPending}
            />
            <Choice values={SORTS} value={sort} onChange={setSort} />
            <Button
              variant="secondary"
              isDisabled={busy || loading || !rows.length}
              onPress={() => void exportExcel()}
            >
              <Button.Label>{busy ? 'Procesando…' : 'Exportar Excel'}</Button.Label>
            </Button>
            {editing ? (
              <Card className="gap-4 p-4">
                <Typography.Heading type="h4">{editing.name}</Typography.Heading>
                <Choice
                  values={['Costo actual', 'Entrada de mercancía']}
                  value={mode}
                  onChange={setMode}
                />
                <FinanceField
                  label={
                    mode === 'Costo actual'
                      ? 'Costo unitario CUP (vacío: desconocido)'
                      : 'Costo unitario de compra CUP'
                  }
                  value={cost}
                  onChange={setCost}
                  decimal
                />
                {mode === 'Entrada de mercancía' ? (
                  <>
                    <FinanceField
                      label="Cantidad recibida"
                      value={quantity}
                      onChange={setQuantity}
                      decimal
                    />
                    <FinanceSelect
                      label="Área de entrada"
                      options={areas.map((a) => ({ value: String(a.id), label: a.name }))}
                      value={areaId}
                      onChange={setAreaId}
                    />
                    <Typography.Paragraph color="muted">
                      Se aplicará el costo promedio ponderado al stock disponible.
                    </Typography.Paragraph>
                  </>
                ) : null}
                <FinanceField label="Motivo o comprobante" value={reason} onChange={setReason} />
                <Button isDisabled={busy} onPress={() => void save()}>
                  <Button.Label>{busy ? 'Guardando…' : 'Guardar'}</Button.Label>
                </Button>
                <Button variant="ghost" isDisabled={busy} onPress={() => setEditing(null)}>
                  <Button.Label>Cancelar</Button.Label>
                </Button>
                <Typography.Heading type="h4">Historial de costos</Typography.Heading>
                {data?.history
                  .filter((h) => h.product_id === editing.id)
                  .map((h) => (
                    <View key={h.id} className="border-border border-b py-2">
                      <Typography.Paragraph>
                        {new Date(h.date).toLocaleString('es-CU')} · {h.actor_name}
                      </Typography.Paragraph>
                      <Typography.Paragraph>
                        {h.old_cost == null ? 'Desconocido' : money(h.old_cost)} →{' '}
                        {h.new_cost == null ? 'Desconocido' : money(h.new_cost)}
                      </Typography.Paragraph>
                      <Typography.Paragraph color="muted">
                        {h.reason} ·{' '}
                        {h.method === 'promedio_ponderado' ? 'Promedio ponderado' : 'Cambio manual'}
                      </Typography.Paragraph>
                    </View>
                  ))}
                {!data?.history.some((h) => h.product_id === editing.id) ? (
                  <Typography.Paragraph color="muted">
                    Los cambios de costo aparecerán aquí.
                  </Typography.Paragraph>
                ) : null}
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item: p }) => (
          <Card className="gap-2 p-4">
            <Typography.Heading type="h4">{p.name}</Typography.Heading>
            <Typography.Paragraph color="muted">
              Código {p.id} · {p.category || 'Sin categoría'} · {p.stock} {p.unit}
            </Typography.Paragraph>
            <Typography.Paragraph>
              Costo: {p.unit_cost == null ? 'Pendiente de costo' : money(p.unit_cost)}
            </Typography.Paragraph>
            <Typography.Paragraph>
              Efectivo: {money(p.price_cash)} · Ganancia:{' '}
              {unitMargin(p.price_cash, p.unit_cost)?.profit == null
                ? 'Pendiente'
                : money(unitMargin(p.price_cash, p.unit_cost)!.profit)}
            </Typography.Paragraph>
            <Typography.Paragraph>
              Transferencia: {money(p.price_transfer)} · Ganancia:{' '}
              {unitMargin(p.price_transfer, p.unit_cost)?.profit == null
                ? 'Pendiente'
                : money(unitMargin(p.price_transfer, p.unit_cost)!.profit)}
            </Typography.Paragraph>
            <Typography.Paragraph color="muted">
              Margen efectivo: {unitMargin(p.price_cash, p.unit_cost)?.margin?.toFixed(2) ?? '—'} %
              · Transferencia:{' '}
              {unitMargin(p.price_transfer, p.unit_cost)?.margin?.toFixed(2) ?? '—'} %
            </Typography.Paragraph>
            <Typography.Paragraph>
              Inventario a costo:{' '}
              {p.unit_cost == null ? 'Pendiente de costo' : money(p.stock * p.unit_cost)}
            </Typography.Paragraph>
            <Button variant="secondary" onPress={() => edit(p)}>
              <Button.Label>Editar costo o registrar entrada</Button.Label>
            </Button>
          </Card>
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              title={
                products.length
                  ? 'No hay productos con estos filtros'
                  : 'Registra productos para administrar sus costos'
              }
              action={
                products.length ? (
                  <Button
                    variant="secondary"
                    onPress={() => {
                      setSearch('');
                      setCategory('Todas');
                      setOnlyPending('Todos');
                    }}
                  >
                    <Button.Label>Limpiar filtros</Button.Label>
                  </Button>
                ) : (
                  <Link href="/products">Ir a Productos</Link>
                )
              }
            />
          ) : null
        }
      />
    </Screen>
  );
}
