import { Button, Card, Chip, Input, Typography, useThemeColor } from 'heroui-native';
import {
  Banknote,
  CreditCard,
  Minus,
  Plus,
  Search,
  Send,
  ShoppingCart,
  Trash2,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { EmptyState, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { money } from '@/lib/format';
import type { CartItem, PaymentType, Producto, SaleMethod } from '@/lib/models';
import { canAccess } from '@/lib/permissions';
import { getPosSale, listPosProducts, registerPosSale } from '@/lib/pos-repository';
import { createThermalTicket } from '@/lib/ticket';

const methods: Array<{ key: PaymentType; label: string; icon: typeof Banknote }> = [
  { key: 'cash', label: 'Efectivo', icon: Banknote },
  { key: 'transfer', label: 'Transferencia', icon: Send },
  { key: 'card', label: 'Tarjeta', icon: CreditCard },
];

export default function Sales() {
  const { user, session, licenseMode, refresh, networkConfig } = useApp();
  const [products, setProducts] = useState<Producto[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [method, setMethod] = useState<SaleMethod>('cash');
  const [amounts, setAmounts] = useState<Record<PaymentType, string>>({
    cash: '',
    transfer: '',
    card: '',
  });
  const [saving, setSaving] = useState(false);
  const [accent, danger] = useThemeColor(['accent', 'danger']);
  const load = useCallback(
    async () => setProducts(await listPosProducts(networkConfig, search)),
    [networkConfig, search],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const total = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  );
  const add = (product: Producto) => {
    if (product.stock <= 0) return Alert.alert('Sin stock', 'Este producto no tiene existencias.');
    setCart((current) => {
      const item = current.find((row) => row.product.id === product.id);
      if (item) {
        if (item.quantity >= product.stock) {
          Alert.alert('Stock insuficiente');
          return current;
        }
        return current.map((row) =>
          row.product.id === product.id ? { ...row, quantity: row.quantity + 1 } : row,
        );
      }
      return [
        ...current,
        {
          product,
          quantity: 1,
          price: method === 'transfer' ? product.price_transfer : product.price_cash,
        },
      ];
    });
  };
  const quantity = (id: number, change: number) =>
    setCart((current) =>
      current.map((item) =>
        item.product.id === id
          ? { ...item, quantity: Math.min(item.product.stock, Math.max(1, item.quantity + change)) }
          : item,
      ),
    );
  const chooseMethod = (next: SaleMethod) => {
    setMethod(next);
    setCart((current) =>
      current.map((item) => ({
        ...item,
        price: next === 'transfer' ? item.product.price_transfer : item.product.price_cash,
      })),
    );
    setAmounts({ cash: '', transfer: '', card: '' });
  };
  const payments = methods.map((item) => ({
    type: item.key,
    amount:
      method === 'mixed'
        ? Number(amounts[item.key].replace(',', '.')) || 0
        : item.key === method
          ? total
          : 0,
  }));
  const finish = async () => {
    if (!user) return;
    try {
      setSaving(true);
      const id = await registerPosSale(networkConfig, cart, method, payments, user.username);
      setCart([]);
      setAmounts({ cash: '', transfer: '', card: '' });
      await refresh();
      await load();
      Alert.alert(
        'Venta registrada',
        `Venta #${id} guardada correctamente.`,
        licenseMode === 'pro' && networkConfig.mode !== 'client'
          ? [
              { text: 'Cerrar' },
              {
                text: 'Generar ticket',
                onPress: () =>
                  void (async () => {
                    const data = await getPosSale(networkConfig, id);
                    if (data) await createThermalTicket(data.sale, data.lines, licenseMode);
                  })(),
              },
            ]
          : [{ text: 'Aceptar' }],
      );
    } catch (error) {
      Alert.alert(
        'No se pudo registrar',
        error instanceof Error ? error.message : 'Revisa los datos.',
      );
    } finally {
      setSaving(false);
    }
  };
  if (!user || !canAccess(user.role, 'sales')) return <AccessDenied />;
  return (
    <Screen keyboard>
      <View className="flex-row items-center justify-between">
        <Typography.Heading type="h2">Nueva venta</Typography.Heading>
        <Chip color={session ? 'success' : 'danger'} variant="soft">
          {session ? 'Caja abierta' : 'Caja cerrada'}
        </Chip>
      </View>
      <View className="relative">
        <View className="absolute top-3 left-3 z-10">
          <Search color={accent} size={20} />
        </View>
        <Input
          className="pl-10"
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar producto"
        />
      </View>
      <View className="flex-row flex-wrap gap-3">
        {products.slice(0, 30).map((product) => (
          <Card key={product.id} className="min-w-40 flex-1 basis-[45%] p-3">
            <Typography.Paragraph className="font-semibold" numberOfLines={1}>
              {product.name}
            </Typography.Paragraph>
            <Typography.Paragraph
              type="body-sm"
              className={product.stock <= 5 ? 'text-warning' : 'text-muted'}
            >
              {product.stock} disponibles
            </Typography.Paragraph>
            <View className="mt-3 flex-row items-center justify-between">
              <Typography.Heading type="h4">
                {money(method === 'transfer' ? product.price_transfer : product.price_cash)}
              </Typography.Heading>
              <Button size="sm" isIconOnly onPress={() => add(product)}>
                <Plus color="white" size={18} />
              </Button>
            </View>
          </Card>
        ))}
      </View>
      <SectionTitle badge={cart.length}>Carrito</SectionTitle>
      {cart.length ? (
        <Card className="gap-1 p-3">
          {cart.map((item) => (
            <View
              key={item.product.id}
              className="border-border flex-row items-center gap-2 border-b py-3"
            >
              <View className="flex-1">
                <Typography.Paragraph className="font-semibold">
                  {item.product.name}
                </Typography.Paragraph>
                <Typography.Paragraph type="body-sm" color="muted">
                  {money(item.price)} · {money(item.price * item.quantity)}
                </Typography.Paragraph>
              </View>
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                onPress={() => quantity(item.product.id, -1)}
              >
                <Minus color={accent} size={17} />
              </Button>
              <Typography.Paragraph className="w-7 text-center">
                {item.quantity}
              </Typography.Paragraph>
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                onPress={() => quantity(item.product.id, 1)}
              >
                <Plus color={accent} size={17} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                onPress={() =>
                  setCart((current) => current.filter((row) => row.product.id !== item.product.id))
                }
              >
                <Trash2 color={danger} size={17} />
              </Button>
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState title="Añade productos para comenzar" />
      )}
      <SectionTitle>Forma de pago</SectionTitle>
      <View className="flex-row flex-wrap gap-2">
        {(['cash', 'transfer', 'card', 'mixed'] as SaleMethod[]).map((value) => (
          <Chip
            key={value}
            variant={method === value ? 'primary' : 'soft'}
            onPress={() => chooseMethod(value)}
          >
            {value === 'cash'
              ? 'Efectivo'
              : value === 'transfer'
                ? 'Transferencia'
                : value === 'card'
                  ? 'Tarjeta'
                  : 'Mixto'}
          </Chip>
        ))}
      </View>
      {method === 'mixed' ? (
        <Card className="gap-3 p-4">
          {methods.map((item) => (
            <View key={item.key} className="flex-row items-center gap-3">
              <item.icon color={accent} size={20} />
              <Typography.Paragraph className="flex-1">{item.label}</Typography.Paragraph>
              <Input
                className="w-32"
                keyboardType="decimal-pad"
                value={amounts[item.key]}
                onChangeText={(value) =>
                  setAmounts((current) => ({ ...current, [item.key]: value }))
                }
                placeholder="0.00"
              />
            </View>
          ))}
        </Card>
      ) : null}
      <Card className="flex-row items-center justify-between p-5">
        <View>
          <Typography.Paragraph color="muted">Total</Typography.Paragraph>
          <Typography.Heading type="h1">{money(total)}</Typography.Heading>
        </View>
        <ShoppingCart color={accent} size={30} />
      </Card>
      <Button
        size="lg"
        isDisabled={!session || !cart.length || saving}
        onPress={() => void finish()}
      >
        <Button.Label>{saving ? 'Registrando…' : 'Completar venta'}</Button.Label>
      </Button>
    </Screen>
  );
}
