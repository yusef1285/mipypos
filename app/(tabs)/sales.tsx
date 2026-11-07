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
import { randomUUID } from 'expo-crypto';
import { Minus, PauseCircle, Plus, ScanLine, Trash2 } from 'lucide-react-native';
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
import { lineUnitPrice, saleUnitPrice } from '@/lib/sale-pricing';
import { PRODUCT_BARCODES, QrScanner } from '@/components/QrScanner';
import { FinanceSelect } from '@/components/FinanceSelect';
import { holdOrder, listHeldOrders, removeHeldOrder, type HeldOrder } from '@/lib/held-orders';
import type { ProductExtras } from '@/lib/business-models';

type SaleOptions = {
  baseCurrency: string;
  extras: ProductExtras[];
  clients: { id: number; name: string }[];
  currencies: { code: string; name: string; rate: number }[];
};
type Special = 'normal' | 'credit' | 'fx';

const methods: Array<{ key: PaymentType; label: string }> = [
  { key: 'cash', label: 'Efectivo' },
  { key: 'transfer', label: 'Transferencia' },
];
export default function Sales() {
  const { user, session, licenseMode, refresh, networkConfig } = useApp();
  const {
    listProducts,
    listAreas,
    listAreaStock,
    getSale,
    getSaleTicket,
    getSaleOptions,
    executeSaleCommand,
  } = usePosRepository();
  const [options, setOptions] = useState<SaleOptions>({
    baseCurrency: 'CUP',
    extras: [],
    clients: [],
    currencies: [],
  });
  const [special, setSpecial] = useState<Special>('normal');
  const [clientId, setClientId] = useState('');
  const [fxCode, setFxCode] = useState('');
  const [fxAmount, setFxAmount] = useState('');
  const [scanning, setScanning] = useState(false);
  const [held, setHeld] = useState<HeldOrder[]>([]);
  const [holdLabel, setHoldLabel] = useState('');
  const heldOwner = user ? `${networkConfig.clientId}:${user.id}` : '';
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
      // Optional data: an older host without v11 simply sells without these extras.
      const saleOptions = await getSaleOptions().catch(() => null);
      if (saleOptions) setOptions(saleOptions);
      if (heldOwner) setHeld(await listHeldOrders(heldOwner));
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
  }, [user, networkConfig, listProducts, listAreas, listAreaStock, getSaleOptions, heldOwner]);
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
  const tiers = useMemo(
    () => new Map(options.extras.map((extra) => [extra.product_id, extra])),
    [options.extras],
  );
  const byBarcode = useMemo(
    () =>
      new Map(
        options.extras.flatMap((extra) =>
          extra.barcode ? [[extra.barcode, extra.product_id] as const] : [],
        ),
      ),
    [options.extras],
  );
  const term = search.trim().toLowerCase();
  const visible = products.filter(
    (product) =>
      `${product.name} ${product.category}`.toLowerCase().includes(term) ||
      (term.length >= 4 && tiers.get(product.id)?.barcode === search.trim()),
  );
  // Wholesale tiers depend on each line's quantity, so prices are derived here.
  const priced = cart.map((item) => ({
    ...item,
    price: lineUnitPrice(item.product, method, item.quantity, tiers.get(item.product.id)),
  }));
  const total = roundMoney(
    priced.reduce((sum, item) => sum + roundMoney(item.price * item.quantity), 0),
  );
  const fx = options.currencies.find((currency) => currency.code === fxCode);
  const fxValue = Number(fxAmount.replace(',', '.'));
  const fxBase = fx && Number.isFinite(fxValue) ? roundMoney(fxValue * fx.rate) : 0;
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
  const hold = () => saveHeld(holdLabel);
  const saveHeld = async (label: string) => {
    if (!areaId) return;
    try {
      await holdOrder({
        label: label.trim() || `Pedido ${held.length + 1}`,
        areaId,
        owner: heldOwner,
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
      });
      setCart([]);
      setDrafts({});
      setHoldLabel('');
      setHeld(await listHeldOrders(heldOwner));
    } catch (failure) {
      Alert.alert('No se pudo guardar', failure instanceof Error ? failure.message : '');
    }
  };
  const resume = (order: HeldOrder) => {
    if (cart.length) {
      Alert.alert('Carrito ocupado', 'Completa o pon en espera la venta actual primero.');
      return;
    }
    const rows = order.items.flatMap((line) => {
      const product = products.find((p) => p.id === line.productId);
      return product
        ? [{ product, areaId: order.areaId, quantity: line.quantity, price: product.price_cash }]
        : [];
    });
    setAreaId(order.areaId);
    setCart(rows);
    setDrafts({});
    void removeHeldOrder(order.id).then(async () => setHeld(await listHeldOrders(heldOwner)));
    if (rows.length < order.items.length)
      Alert.alert('Pedido recuperado', 'Algunos productos ya no existen y se omitieron.');
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
        if (special === 'credit' && !clientId)
          throw new Error('Elige el cliente de la venta a crédito.');
        if (special === 'fx' && (!fx || fxBase + 0.005 < total))
          throw new Error('El importe en divisa no cubre el total de la venta.');
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
          cashReceived:
            cashPart > 0
              ? special !== 'normal'
                ? total
                : cashReceived.trim()
                  ? tender
                  : NaN
              : null,
          transferReceipt: method !== 'cash' ? receipt : null,
        };
        validateSettlement(payments, settlement);
        id = await registerPosSale(
          networkConfig,
          priced,
          method,
          payments,
          user.username,
          session.id,
          settlement,
        );
      }
      setPendingSale(false);
      committed = true;
      let followUp = '';
      if (!pendingSale && special !== 'normal') {
        try {
          if (special === 'credit')
            await executeSaleCommand(
              {
                commandId: randomUUID(),
                action: 'sale.credit',
                saleId: id,
                partyId: Number(clientId),
              },
              user.username,
            );
          else if (fx)
            await executeSaleCommand(
              {
                commandId: randomUUID(),
                action: 'sale.fx',
                saleId: id,
                currency: fx.code,
                amount: roundMoney(fxValue),
              },
              user.username,
            );
          followUp =
            special === 'credit'
              ? '\nCargada a la cuenta del cliente.'
              : `\nCobrado en ${fxCode}. Vuelto: ${money(roundMoney(fxBase - total))}`;
        } catch (failure) {
          followUp = `\nAtención: la venta quedó en efectivo. ${failure instanceof Error ? failure.message : ''}`;
        }
      }
      setSpecial('normal');
      setFxAmount('');
      setCart([]);
      setDrafts({});
      setCashReceived('');
      setReceipt(emptyTransferReceipt());
      setAmounts({ cash: '', transfer: '' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Venta registrada',
        `Venta #${id}${cashPart > 0 && !pendingSale && !followUp ? `\nVuelto: ${money(change)}` : ''}${followUp}`,
        licenseMode === 'pro'
          ? [
              { text: 'Cerrar' },
              {
                text: 'Ticket',
                onPress: () => {
                  void (async () => {
                    try {
                      const [data, numbering] = await Promise.all([
                        getSale(id),
                        getSaleTicket(id).catch(() => null),
                      ]);
                      if (data)
                        await createThermalTicket(data.sale, data.lines, licenseMode, numbering);
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
        priced.map((item) => (
          <Animated.View key={item.product.id} entering={FadeIn} exiting={FadeOut}>
            <Card className="gap-3 p-3">
              <Typography.Paragraph className="font-semibold">
                {item.product.name}
              </Typography.Paragraph>
              <Typography.Paragraph type="body-sm" color="muted">
                {money(item.price)} / {item.product.unit} ·{' '}
                {money(roundMoney(item.price * item.quantity))}
                {item.price !== saleUnitPrice(item.product, method) ? ' · precio mayorista' : ''}
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
      {method === 'mixed' ? (
        <Typography.Paragraph type="body-sm" color="muted">
          En mixto se aplica el precio de efectivo a toda la venta.
        </Typography.Paragraph>
      ) : null}
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
      {method !== 'transfer' && special === 'normal' ? (
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
      {method === 'cash' &&
      !pendingSale &&
      (options.clients.length || options.currencies.length) ? (
        <>
          <SectionTitle>Cobro especial</SectionTitle>
          <View className="flex-row flex-wrap gap-2">
            {(
              [
                ['normal', 'Normal'],
                ...(options.clients.length ? [['credit', 'A crédito'] as const] : []),
                ...(options.currencies.length ? [['fx', 'En divisa'] as const] : []),
              ] as const
            ).map(([key, label]) => (
              <Chip
                key={key}
                disabled={saving}
                variant={special === key ? 'primary' : 'soft'}
                onPress={() => setSpecial(key)}
              >
                <Chip.Label>{label}</Chip.Label>
              </Chip>
            ))}
          </View>
          {special === 'credit' ? (
            <FinanceSelect
              label="Cliente"
              value={clientId}
              onChange={setClientId}
              options={options.clients.map((client) => ({
                value: String(client.id),
                label: client.name,
              }))}
            />
          ) : null}
          {special === 'fx' ? (
            <>
              <FinanceSelect
                label="Moneda recibida"
                value={fxCode}
                onChange={setFxCode}
                options={options.currencies.map((currency) => ({
                  value: currency.code,
                  label: `${currency.code} · tasa ${currency.rate}`,
                }))}
              />
              <TextField isDisabled={saving}>
                <Label>Importe recibido {fxCode ? `(${fxCode})` : ''}</Label>
                <Input
                  keyboardType="decimal-pad"
                  value={fxAmount}
                  onChangeText={setFxAmount}
                  placeholder="0.00"
                />
              </TextField>
              <Typography.Paragraph>
                {fx && fxBase
                  ? fxBase + 0.005 < total
                    ? `Equivale a ${money(fxBase)}: faltan ${money(total - fxBase)}`
                    : `Equivale a ${money(fxBase)} · vuelto ${money(roundMoney(fxBase - total))} en ${options.baseCurrency}`
                  : 'Elige la moneda e indica el importe.'}
              </Typography.Paragraph>
            </>
          ) : null}
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
      {cart.length && !pendingSale && areaId ? (
        <TextField isDisabled={saving}>
          <Label>Nombre del pedido en espera</Label>
          <Input value={holdLabel} onChangeText={setHoldLabel} placeholder="Mesa 3, Juan…" />
        </TextField>
      ) : null}
      {cart.length && !pendingSale && areaId ? (
        <Button variant="secondary" isDisabled={saving} onPress={() => void hold()}>
          <PauseCircle size={18} color={accent} />
          <Button.Label>Poner en espera (mesa o cliente)</Button.Label>
        </Button>
      ) : null}
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
            {held.length ? (
              <>
                <SectionTitle badge={held.length}>Pedidos en espera</SectionTitle>
                <View className="flex-row flex-wrap gap-2">
                  {held.map((order) => (
                    <Chip
                      key={order.id}
                      disabled={saving || pendingSale}
                      variant="soft"
                      onPress={() => resume(order)}
                    >
                      <Chip.Label numberOfLines={1}>
                        {order.label} · {order.items.length}
                      </Chip.Label>
                    </Chip>
                  ))}
                </View>
              </>
            ) : null}
            <View className="flex-row items-center gap-2">
              <Input
                className="min-w-0 flex-1"
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar producto o código"
              />
              {byBarcode.size ? (
                <Button
                  isIconOnly
                  variant="secondary"
                  accessibilityLabel="Escanear código de barras"
                  onPress={() => setScanning((value) => !value)}
                >
                  <ScanLine size={20} color={accent} />
                </Button>
              ) : null}
            </View>
            {scanning ? (
              <QrScanner
                types={PRODUCT_BARCODES}
                prompt="Permite la cámara para escanear códigos de barras."
                busyText="Agregando…"
                repeat
                onCancel={() => setScanning(false)}
                onScan={async (code) => {
                  const product = products.find((p) => p.id === byBarcode.get(code.trim()));
                  if (!product) throw new Error(`No hay ningún producto con el código ${code}.`);
                  add(product);
                  void Haptics.selectionAsync();
                }}
              />
            ) : null}
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
                {tiers.get(product.id)?.wholesale_price != null
                  ? ` · mayor ${money(tiers.get(product.id)?.wholesale_price ?? 0)} desde ${tiers.get(product.id)?.wholesale_min_qty}`
                  : ''}
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
