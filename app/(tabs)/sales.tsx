import * as Haptics from 'expo-haptics';
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  Skeleton,
  TextField,
  Typography,
  useThemeColor,
} from 'heroui-native';
import { Minus, Plus, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { AccessDenied } from '@/components/AccessDenied';
import { DemoQuota } from '@/components/DemoQuota';
import { TransferReceiptForm, emptyTransferReceipt } from '@/components/TransferReceiptForm';
import { receiptPaymentAmounts, validateSettlement } from '@/lib/settlement';
import { EmptyState, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { money } from '@/lib/format';
import type { Area, AreaStock, CartItem, PaymentType, Producto, SaleMethod } from '@/lib/models';
import { canAccess } from '@/lib/permissions';
import { registerPosSale } from '@/lib/pos-repository';
import { getPendingSale, sendPendingSale } from '@/lib/network/pending-sale';
import { getHostSnapshot } from '@/lib/network/client';
import { usePosRepository } from '@/lib/use-pos-repository';
import { createThermalTicket } from '@/lib/ticket';
import { roundMoney, roundQuantity, validateQuantity } from '@/lib/units';
import { trackSaleDraft, clearSaleDraft } from '@/lib/sale-draft';
import { saleUnitPrice } from '@/lib/sale-pricing';

const methods: Array<{ key: PaymentType; label: string }> = [
  { key: 'cash', label: 'Efectivo' },
  { key: 'transfer', label: 'Transferencia' },
];
export default function Sales() {
  const { user, session, licenseMode, refresh, networkConfig } = useApp();
  const { listProducts, listAreas, listAreaStock, getSale } = usePosRepository();
  const [products, setProducts] = useState<Producto[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [stocks, setStocks] = useState<AreaStock[]>([]);
  const [areaId, setAreaId] = useState<number>();
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  useEffect(() => {
    if (!user) return undefined;
    const owner = `${networkConfig.clientId}:${user.id}`;
    trackSaleDraft(
      owner,
      cart.map((item) => ({ productId: item.product.id })),
    );
    return () => clearSaleDraft(owner);
  }, [cart, user, networkConfig.clientId]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [method, setMethod] = useState<SaleMethod>('cash');
  const [amounts, setAmounts] = useState<Record<PaymentType, string>>({
    cash: '',
    transfer: '',
  });
  const [cashReceived, setCashReceived] = useState('');
  const [receipt, setReceipt] = useState(emptyTransferReceipt);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [submitting, setSaving] = useState(false);
  const saving = submitting || receiptBusy;
  const [pendingSale, setPendingSale] = useState(false);
  const loadingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accent, danger] = useThemeColor(['accent', 'danger']);
  const load = useCallback(async () => {
    if (!user || !canAccess(user.role, 'sales') || loadingRef.current) return;
    loadingRef.current = true;
    try {
      setPendingSale(networkConfig.mode === 'client' && Boolean(await getPendingSale()));
      const data =
        networkConfig.mode === 'client'
          ? await getHostSnapshot(networkConfig.hostUrl)
          : {
              products: await listProducts(),
              areas: await listAreas(),
              areaStock: await listAreaStock(),
            };
      setProducts(data.products);
      setAreas(data.areas);
      setStocks(data.areaStock);
      setAreaId((current) =>
        data.areas.some((area) => area.id === current) ? current : data.areas[0]?.id,
      );
      setError('');
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'No se pudieron cargar las existencias.',
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [user, networkConfig, listProducts, listAreas, listAreaStock]);
  useEffect(() => {
    // Synchronize with external SQLite/LAN stock through the polling subscription.
    const initialTimer = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 2500);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [load]);
  const available = useMemo(
    () =>
      new Map(
        stocks
          .filter((stock) => stock.area_id === areaId)
          .map((stock) => [stock.product_id, stock.quantity]),
      ),
    [stocks, areaId],
  );
  const visible = products.filter((product) =>
    `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase()),
  );
  const total = roundMoney(
    cart.reduce((sum, item) => sum + roundMoney(item.price * item.quantity), 0),
  );
  const cashPart =
    method === 'cash' ? total : method === 'mixed' ? Number(amounts.cash.replace(',', '.')) : 0;
  const tender = Number(cashReceived.replace(',', '.'));
  const change = roundMoney(tender - cashPart);
  const updateQuantity = (id: number, value: string) => {
    setDrafts((current) => ({ ...current, [id]: value }));
    const quantity = Number(value.replace(',', '.'));
    setCart((current) =>
      current.map((item) =>
        item.product.id === id
          ? { ...item, quantity: Number.isFinite(quantity) ? quantity : 0 }
          : item,
      ),
    );
  };
  const add = (product: Producto) => {
    if (!areaId || saving || pendingSale) return;
    const stock = available.get(product.id) ?? 0;
    const existing = cart.find((item) => item.product.id === product.id);
    const quantity = roundQuantity((existing?.quantity ?? 0) + Math.min(1, stock));
    if (stock <= 0 || quantity > stock) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Stock insuficiente en esta área');
      return;
    }
    setDrafts((current) => ({ ...current, [product.id]: String(quantity) }));
    if (existing) updateQuantity(product.id, String(quantity));
    else
      setCart((current) => [
        ...current,
        {
          areaId,
          product,
          quantity,
          price: saleUnitPrice(product, method),
        },
      ]);
  };
  const chooseMethod = (next: SaleMethod) => {
    if (saving || pendingSale) return;
    void Haptics.selectionAsync();
    setMethod(next);
    setCashReceived('');
    setReceipt(emptyTransferReceipt());
    setCart((current) =>
      current.map((item) => ({
        ...item,
        price: saleUnitPrice(item.product, next),
      })),
    );
    setAmounts({ cash: '', transfer: '' });
  };
  const finish = async () => {
    if (!user || saving) return;
    let committed = false;
    try {
      setSaving(true);
      let id: number;
      if (pendingSale) {
        id = await sendPendingSale(networkConfig, user.username);
      } else {
        if (!session) throw new Error('Abre la caja antes de vender.');
        cart.forEach((item) => {
          validateQuantity(item.quantity, item.product.quantity_decimals);
          if (item.quantity > (available.get(item.product.id) ?? 0))
            throw new Error(`Stock insuficiente de ${item.product.name} en esta área.`);
        });
        const payments = methods.map(({ key }) => ({
          type: key,
          amount:
            method === 'mixed'
              ? Number(amounts[key].replace(',', '.'))
              : method === key
                ? total
                : 0,
        }));
        const settlement = {
          cashReceived: cashPart > 0 ? (cashReceived.trim() ? tender : NaN) : null,
          transferReceipt: method !== 'cash' ? receipt : null,
        };
        validateSettlement(payments, settlement);
        id = await registerPosSale(
          networkConfig,
          cart,
          method,
          payments,
          user.username,
          session.id,
          settlement,
        );
      }
      setPendingSale(false);
      committed = true;
      setCart([]);
      setDrafts({});
      setCashReceived('');
      setReceipt(emptyTransferReceipt());
      setAmounts({ cash: '', transfer: '' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Venta registrada',
        `Venta #${id}${cashPart > 0 && !pendingSale ? `\nVuelto: ${money(change)}` : ''}`,
        licenseMode === 'pro'
          ? [
              { text: 'Cerrar' },
              {
                text: 'Ticket',
                onPress: () => {
                  void (async () => {
                    try {
                      const data = await getSale(id);
                      if (data) await createThermalTicket(data.sale, data.lines, licenseMode);
                    } catch (failure) {
                      Alert.alert(
                        'No se pudo generar el ticket',
                        failure instanceof Error ? failure.message : 'Inténtalo de nuevo.',
                      );
                    }
                  })();
                },
              },
            ]
          : [{ text: 'Aceptar' }],
      );
      await refresh();
      await load();
    } catch (failure) {
      setPendingSale(networkConfig.mode === 'client' && Boolean(await getPendingSale()));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        committed ? 'Venta guardada; actualización pendiente' : 'No se pudo confirmar la venta',
        failure instanceof Error ? failure.message : 'Inténtalo de nuevo.',
      );
    } finally {
      setSaving(false);
    }
  };
  if (!user || !canAccess(user.role, 'sales')) return <AccessDenied />;
  const footer = (
    <View className="gap-5 pt-5">
      <SectionTitle badge={cart.length}>Carrito</SectionTitle>
      {cart.length ? (
        cart.map((item) => (
          <Animated.View key={item.product.id} entering={FadeIn} exiting={FadeOut}>
            <Card className="gap-3 p-3">
              <Typography.Paragraph className="font-semibold">
                {item.product.name}
              </Typography.Paragraph>
              <Typography.Paragraph type="body-sm" color="muted">
                {money(item.price)} / {item.product.unit} ·{' '}
                {money(roundMoney(item.price * item.quantity))}
              </Typography.Paragraph>
              <View className="flex-row items-center gap-2">
                <Button
                  size="sm"
                  isIconOnly
                  variant="ghost"
                  isDisabled={saving || pendingSale}
                  onPress={() =>
                    updateQuantity(
                      item.product.id,
                      String(
                        roundQuantity(
                          Math.max(item.product.quantity_decimals ? 0.001 : 1, item.quantity - 1),
                        ),
                      ),
                    )
                  }
                >
                  <Minus size={18} color={accent} />
                </Button>
                <Input
                  className="min-w-0 flex-1"
                  accessibilityLabel={`Cantidad en ${item.product.unit} de ${item.product.name}`}
                  editable={!saving && !pendingSale}
                  keyboardType={item.product.quantity_decimals ? 'decimal-pad' : 'number-pad'}
                  value={drafts[item.product.id] ?? String(item.quantity)}
                  onChangeText={(value) => updateQuantity(item.product.id, value)}
                />
                <Button
                  size="sm"
                  isIconOnly
                  variant="ghost"
                  isDisabled={saving || pendingSale}
                  onPress={() =>
                    updateQuantity(
                      item.product.id,
                      String(
                        roundQuantity(
                          Math.min(available.get(item.product.id) ?? 0, item.quantity + 1),
                        ),
                      ),
                    )
                  }
                >
                  <Plus size={18} color={accent} />
                </Button>
                <Button
                  size="sm"
                  isIconOnly
                  variant="ghost"
                  isDisabled={saving || pendingSale}
                  onPress={() =>
                    setCart((current) =>
                      current.filter((row) => row.product.id !== item.product.id),
                    )
                  }
                >
                  <Trash2 size={18} color={danger} />
                </Button>
              </View>
            </Card>
          </Animated.View>
        ))
      ) : (
        <EmptyState title="Añade productos para comenzar" />
      )}
      <SectionTitle>Forma de pago</SectionTitle>
      <View className="flex-row flex-wrap gap-2">
        {[...methods, { key: 'mixed' as const, label: 'Mixto' }].map(({ key, label }) => (
          <Chip
            key={key}
            disabled={saving || pendingSale}
            variant={method === key ? 'primary' : 'soft'}
            onPress={() => chooseMethod(key)}
          >
            <Chip.Label numberOfLines={1}>{label}</Chip.Label>
          </Chip>
        ))}
      </View>
      {method === 'mixed'
        ? methods.map(({ key, label }) => (
            <TextField key={key}>
              <Label>{label} (CUP)</Label>
              <Input
                editable={!saving && !pendingSale}
                keyboardType="decimal-pad"
                value={amounts[key]}
                onChangeText={(value) => setAmounts((current) => ({ ...current, [key]: value }))}
                placeholder="0.00"
              />
            </TextField>
          ))
        : null}
      {method !== 'cash' ? (
        <TransferReceiptForm
          value={receipt}
          onChange={setReceipt}
          disabled={saving || pendingSale}
          onBusyChange={setReceiptBusy}
          onAmount={(amount) =>
            setAmounts((current) => ({
              ...current,
              ...(method === 'mixed'
                ? receiptPaymentAmounts(total, amount)
                : { transfer: String(amount) }),
            }))
          }
        />
      ) : null}
      {method !== 'transfer' ? (
        <>
          <TextField isDisabled={saving || pendingSale}>
            <Label>Efectivo recibido (CUP)</Label>
            <Input
              keyboardType="decimal-pad"
              value={cashReceived}
              onChangeText={setCashReceived}
              placeholder="0.00"
            />
          </TextField>
          <Typography.Heading type="h3">
            {cashReceived.trim() && Number.isFinite(change)
              ? change < 0
                ? `Faltan: ${money(-change)}`
                : `Vuelto: ${money(change)}`
              : 'Vuelto: —'}
          </Typography.Heading>
        </>
      ) : null}
      <Typography.Heading type="h2">Total: {money(total)}</Typography.Heading>
      {pendingSale ? (
        <Typography.Paragraph className="text-warning">
          Hay una venta pendiente de confirmación. Reintenta para comprobarla sin volver a cobrar.
        </Typography.Paragraph>
      ) : null}
      <Button
        size="lg"
        isDisabled={
          saving || (!pendingSale && (!session || !cart.length || !areaId || Boolean(error)))
        }
        onPress={() => void finish()}
      >
        <Button.Label>
          {saving ? 'Confirmando…' : pendingSale ? 'Confirmar venta pendiente' : 'Completar venta'}
        </Button.Label>
      </Button>
    </View>
  );
  return (
    <Screen keyboard scroll={false}>
      <FlatList
        data={loading || error ? [] : visible}
        keyExtractor={(product) => String(product.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 40,
          gap: 12,
          width: '100%',
          maxWidth: 1024,
          alignSelf: 'center',
        }}
        onRefresh={() => void load()}
        refreshing={loading}
        ListHeaderComponent={
          <View className="gap-4 pb-3">
            <Typography.Heading type="h2">Nueva venta</Typography.Heading>
            <DemoQuota resource="sales" />
            <Chip color={session ? 'success' : 'danger'} variant="soft">
              <Chip.Label>{session ? 'Caja abierta' : 'Caja cerrada'}</Chip.Label>
            </Chip>
            <SectionTitle>Área de venta</SectionTitle>
            <View className="flex-row flex-wrap gap-2">
              {areas.map((area) => (
                <Chip
                  key={area.id}
                  disabled={saving || pendingSale || cart.length > 0}
                  variant={areaId === area.id ? 'primary' : 'soft'}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setAreaId(area.id);
                  }}
                >
                  <Chip.Label numberOfLines={1}>{area.name}</Chip.Label>
                </Chip>
              ))}
            </View>
            {cart.length ? (
              <Button
                variant="secondary"
                isDisabled={saving || pendingSale}
                onPress={() => {
                  setCart([]);
                  setDrafts({});
                }}
              >
                <Button.Label>Vaciar carrito para cambiar de área</Button.Label>
              </Button>
            ) : null}
            <Input value={search} onChangeText={setSearch} placeholder="Buscar producto" />
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View className="gap-3">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </View>
          ) : error ? (
            <Card className="gap-3 p-4">
              <Typography.Paragraph>{error}</Typography.Paragraph>
              <Button onPress={() => void load()}>
                <Button.Label>Reintentar</Button.Label>
              </Button>
            </Card>
          ) : (
            <EmptyState
              title={search ? 'No hay coincidencias' : 'No hay productos'}
              action={
                <Button variant="secondary" onPress={() => (search ? setSearch('') : void load())}>
                  <Button.Label>{search ? 'Limpiar búsqueda' : 'Actualizar'}</Button.Label>
                </Button>
              }
            />
          )
        }
        renderItem={({ item: product }) => (
          <Card className="flex-row items-center gap-3 p-3">
            <View className="flex-1">
              <Typography.Paragraph className="font-semibold">{product.name}</Typography.Paragraph>
              <Typography.Paragraph type="body-sm" color="muted">
                {available.get(product.id) ?? 0} {product.unit} disponibles ·{' '}
                {money(saleUnitPrice(product, method))} / {product.unit}
              </Typography.Paragraph>
            </View>
            <Button
              size="sm"
              isIconOnly
              isDisabled={saving || pendingSale || !(available.get(product.id) ?? 0)}
              onPress={() => add(product)}
            >
              <Plus color="white" size={18} />
            </Button>
          </Card>
        )}
        ListFooterComponent={footer}
      />
    </Screen>
  );
}
