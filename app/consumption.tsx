import { Link } from 'expo-router';
import { Button, Card, Typography } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
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
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import { useFinanceCommand } from '@/lib/use-finance-command';
import { hashPassword } from '@/lib/database';
import { CONSUMPTION_REASONS, type ConsumptionRecord } from '@/lib/finance-models';
import { canAccess } from '@/lib/permissions';
import { money } from '@/lib/format';
import { assertProductNotInDraft } from '@/lib/sale-draft';
import { getPendingSale } from '@/lib/network/pending-sale';
import type { Area, Producto } from '@/lib/models';
export default function Consumption() {
  const { user, revision, refresh, licenseMode } = useApp();
  const { getConsumptionData, listProducts, listAreas, registerConsumption, cancelConsumption } =
    usePosRepository();
  const [data, setData] = useState<Awaited<ReturnType<typeof getConsumptionData>> | null>(null);
  const [products, setProducts] = useState<Producto[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [show, setShow] = useState(false);
  const [selected, setSelected] = useState<ConsumptionRecord | null>(null);
  const [action, setAction] = useState('Registrar');
  const [productId, setProductId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<(typeof CONSUMPTION_REASONS)[number]>(
    CONSUMPTION_REASONS[0],
  );
  const [notes, setNotes] = useState('');
  const [correction, setCorrection] = useState('');
  const [authUser, setAuthUser] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const command = useFinanceCommand();
  const load = useCallback(async () => {
    if (!user || !canAccess(user.role, 'consumption')) return;
    setLoading(true);
    setError('');
    try {
      const [next, p, a] = await Promise.all([
        getConsumptionData(user.username),
        listProducts(),
        listAreas(),
      ]);
      setData(next);
      setProducts(p);
      setAreas(a);
    } catch (e) {
      setError(financeFailure(e));
    } finally {
      setLoading(false);
    }
  }, [user, getConsumptionData, listProducts, listAreas]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, revision]);
  if (!user || !canAccess(user.role, 'consumption')) return <AccessDenied />;
  const rows = (data?.rows ?? []).filter(
    (r) =>
      (status === 'Todos' || r.status === status) &&
      `${r.product_name} ${r.product_id} ${r.actor_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const start = (row: ConsumptionRecord | null = null, operation = 'Registrar') => {
    setSelected(row);
    setAction(operation);
    setProductId(String(row?.product_id ?? products[0]?.id ?? ''));
    setAreaId(String(row?.area_id ?? areas[0]?.id ?? ''));
    setQuantity(row ? String(row.quantity) : '');
    setNotes(row?.notes ?? '');
    setReason(CONSUMPTION_REASONS.find((r) => r === row?.reason) ?? CONSUMPTION_REASONS[0]);
    setCorrection('');
    setAuthUser(user.role === 'admin' ? user.username : '');
    setPassword('');
    setError('');
    setShow(true);
    command.clear();
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!password) throw new Error('Introduce la contraseña del usuario que autoriza.');
      const authorization = { username: authUser, passwordHash: await hashPassword(password) };
      if (action === 'Anular' && selected) {
        const input = { id: selected.id, reason: correction, authorization };
        await cancelConsumption({ ...input, commandId: command.idFor(input) }, user.username);
      } else {
        assertProductNotInDraft(Number(productId));
        const pending = await getPendingSale();
        if (pending?.command.items.some((item) => item.productId === Number(productId)))
          throw new Error(
            'Resuelve la venta pendiente de confirmación antes de retirar este producto.',
          );
        const input = {
          productId: Number(productId),
          areaId: Number(areaId),
          quantity: numeric(quantity),
          reason,
          notes,
          authorization,
          ...(selected ? { replacesId: selected.id, correctionReason: correction } : {}),
        };
        await registerConsumption({ ...input, commandId: command.idFor(input) }, user.username);
      }
      command.clear();
      setPassword('');
      setShow(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
      await load();
    } catch (e) {
      setError(financeFailure(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen keyboard scroll={false}>
      <FlatList
        data={loading ? [] : rows}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 p-4 pb-12 web:mx-auto web:w-full web:max-w-5xl"
        ListHeaderComponent={
          <View className="gap-4">
            <Typography.Heading type="h2">Consumo interno</Typography.Heading>
            <Link href="/more">Volver a Más</Link>
            <FinanceStatus loading={loading} error={error} retry={() => void load()} />
            <Button isDisabled={busy || loading || !products.length} onPress={() => start()}>
              <Button.Label>Registrar retiro autorizado</Button.Label>
            </Button>
            {show ? (
              <Card className="gap-4 p-4">
                <Typography.Heading type="h4">{action} retiro</Typography.Heading>
                {action !== 'Anular' ? (
                  <>
                    <FinanceSelect
                      label="Producto"
                      options={products.map((p) => ({
                        value: String(p.id),
                        label: `${p.id} · ${p.name}`,
                      }))}
                      value={productId}
                      onChange={setProductId}
                    />
                    <FinanceSelect
                      label="Área de salida"
                      options={areas.map((a) => ({ value: String(a.id), label: a.name }))}
                      value={areaId}
                      onChange={setAreaId}
                    />
                    <FinanceField
                      label="Cantidad"
                      value={quantity}
                      onChange={setQuantity}
                      decimal
                    />
                    <Choice values={CONSUMPTION_REASONS} value={reason} onChange={setReason} />
                    <FinanceField label="Observaciones" value={notes} onChange={setNotes} />
                    <Typography.Paragraph color="muted">
                      Este retiro no cobra ni registra una venta. Si el producto está en una venta
                      pendiente, retíralo de esa operación antes de confirmar.
                    </Typography.Paragraph>
                  </>
                ) : null}
                {selected ? (
                  <FinanceField
                    label={action === 'Anular' ? 'Motivo de anulación' : 'Motivo de rectificación'}
                    value={correction}
                    onChange={setCorrection}
                  />
                ) : null}
                <FinanceField
                  label="Usuario que autoriza"
                  value={authUser}
                  onChange={setAuthUser}
                />
                <FinanceField
                  label="Contraseña de autorización"
                  value={password}
                  onChange={setPassword}
                  secret
                />
                <Typography.Paragraph color="muted">
                  Autoriza un administrador o un supervisor con permiso.
                </Typography.Paragraph>
                <Button isDisabled={busy} onPress={() => void submit()}>
                  <Button.Label>
                    {busy
                      ? 'Confirmando…'
                      : action === 'Anular'
                        ? 'Confirmar anulación'
                        : 'Confirmar retiro'}
                  </Button.Label>
                </Button>
                <Button
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => {
                    setShow(false);
                    setPassword('');
                  }}
                >
                  <Button.Label>Cancelar</Button.Label>
                </Button>
              </Card>
            ) : null}
            <FinanceField label="Buscar producto o usuario" value={search} onChange={setSearch} />
            <Choice
              values={['Todos', 'confirmado', 'anulado', 'rectificado']}
              value={status}
              onChange={setStatus}
            />
            {user.role === 'admin' ? (
              <Button
                variant="secondary"
                isDisabled={busy || !rows.length}
                onPress={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      const { exportRows } = await import('@/lib/exports');
                      await exportRows(
                        'consumo-interno',
                        rows.map((r) => ({
                          ID: r.id,
                          Fecha: r.date,
                          Código: r.product_id,
                          Producto: r.product_name,
                          Área: r.area_id,
                          Cantidad: r.quantity,
                          'Precio CUP': r.price,
                          'Costo unitario CUP': r.unit_cost ?? 'Pendiente de costo',
                          'Valor CUP': r.value,
                          'Costo CUP': r.cost ?? 'Pendiente de costo',
                          Motivo: r.reason,
                          Registra: r.actor_name,
                          Autoriza: r.authorizer_name,
                          Observaciones: r.notes,
                          Estado: r.status,
                          Rectifica: r.replaces_id ?? '',
                        })),
                        'xlsx',
                        licenseMode,
                      );
                    } catch (e) {
                      setError(financeFailure(e));
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                <Button.Label>{busy ? 'Procesando…' : 'Exportar Excel'}</Button.Label>
              </Button>
            ) : null}
          </View>
        }
        renderItem={({ item: r }) => (
          <Animated.View entering={FadeIn} exiting={FadeOut}>
            <Card className="gap-2 p-4">
              <Typography.Heading type="h4">{r.product_name}</Typography.Heading>
              <Typography.Paragraph color="muted">
                Código {r.product_id} · {new Date(r.date).toLocaleString('es-CU')}
              </Typography.Paragraph>
              <Typography.Paragraph>
                {r.quantity} · {r.reason} · {r.status}
              </Typography.Paragraph>
              <Typography.Paragraph>Valor a precio de venta: {money(r.value)}</Typography.Paragraph>
              {user.role === 'admin' ? (
                <Typography.Paragraph>
                  Costo: {r.cost === null ? 'Pendiente de costo' : money(r.cost)}
                </Typography.Paragraph>
              ) : null}
              <Typography.Paragraph>
                Registra: {r.actor_name} · Autoriza: {r.authorizer_name}
              </Typography.Paragraph>
              {r.notes ? (
                <Typography.Paragraph color="muted">{r.notes}</Typography.Paragraph>
              ) : null}
              {r.replaces_id ? (
                <Typography.Paragraph color="muted">
                  Rectifica: {r.replaces_id}
                </Typography.Paragraph>
              ) : null}
              {data?.events
                .filter((e) => e.consumption_id === r.id && e.action !== 'confirmado')
                .map((e) => (
                  <Typography.Paragraph key={`${e.date}-${e.action}`} color="muted">
                    {e.action} · {new Date(e.date).toLocaleString('es-CU')} · {e.reason} ·{' '}
                    {e.actor_name} · autoriza {e.authorizer_name}
                  </Typography.Paragraph>
                ))}
              {r.status === 'confirmado' ? (
                <View className="gap-2">
                  <Button variant="secondary" onPress={() => start(r, 'Rectificar')}>
                    <Button.Label>Rectificar</Button.Label>
                  </Button>
                  <Button variant="ghost" onPress={() => start(r, 'Anular')}>
                    <Button.Label>Anular con autorización</Button.Label>
                  </Button>
                </View>
              ) : null}
            </Card>
          </Animated.View>
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              title={
                data?.rows.length
                  ? 'No hay retiros con estos filtros'
                  : 'Los retiros autorizados aparecerán aquí'
              }
              action={
                <Button
                  variant="secondary"
                  onPress={() => {
                    if (data?.rows.length) {
                      setSearch('');
                      setStatus('Todos');
                    } else start();
                  }}
                  isDisabled={!products.length}
                >
                  <Button.Label>
                    {data?.rows.length ? 'Limpiar filtros' : 'Registrar retiro'}
                  </Button.Label>
                </Button>
              }
            />
          ) : undefined
        }
      />
    </Screen>
  );
}
