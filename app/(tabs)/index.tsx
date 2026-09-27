import { router } from 'expo-router';
import { Button, Card, Chip, Typography, useThemeColor } from 'heroui-native';
import {
  Banknote,
  Boxes,
  ChartNoAxesCombined,
  CircleAlert,
  Package,
  ShoppingCart,
  Store,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { MetricCard, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { getDailyReport, listProducts } from '@/lib/database';
import { money } from '@/lib/format';
import type { DailyReport, Producto } from '@/lib/models';
import { canAccess } from '@/lib/permissions';

export default function Home() {
  const { user, session, licenseMode, refresh } = useApp();
  const accent = useThemeColor('accent');
  const [report, setReport] = useState<DailyReport | null>(null);
  const [low, setLow] = useState<Producto[]>([]);
  const load = useCallback(async () => {
    await refresh();
    setReport(await getDailyReport());
    setLow((await listProducts()).filter((p) => p.stock <= 5));
  }, [refresh]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  if (!user) return null;
  return (
    <Screen onRefresh={load}>
      <View className="bg-accent overflow-hidden rounded-3xl p-5">
        <View className="mb-5 flex-row items-start justify-between">
          <View className="flex-1">
            <Typography.Paragraph className="text-accent-foreground/80">
              Hola, {user.username}
            </Typography.Paragraph>
            <Typography.Heading type="h2" className="text-accent-foreground">
              Resumen de hoy
            </Typography.Heading>
          </View>
          <View className="rounded-2xl bg-white/15 p-3">
            <Store color="white" size={24} />
          </View>
        </View>
        <View className="flex-row items-center justify-between">
          <Chip size="sm" variant="soft">
            {session ? 'Caja abierta' : 'Caja cerrada'}
          </Chip>
          <Typography.Paragraph type="body-sm" className="text-accent-foreground">
            {licenseMode === 'pro' ? 'Licencia Pro' : 'Modo demo'}
          </Typography.Paragraph>
        </View>
      </View>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard label="Ventas" value={money(report?.totalSales ?? 0)} icon={ShoppingCart} />
        <MetricCard
          label="Operaciones"
          value={String(report?.salesCount ?? 0)}
          icon={ChartNoAxesCombined}
          tone="success"
        />
        <MetricCard
          label="Stock bajo"
          value={String(low.length)}
          icon={CircleAlert}
          tone="warning"
        />
      </View>
      <SectionTitle>Accesos rápidos</SectionTitle>
      <View className="flex-row flex-wrap gap-3">
        {canAccess(user.role, 'sales') ? (
          <Button
            className="min-w-36 flex-1"
            variant="secondary"
            onPress={() => router.push('/(tabs)/sales')}
          >
            <ShoppingCart color={accent} size={18} />
            <Button.Label>Venta nueva</Button.Label>
          </Button>
        ) : null}
        {canAccess(user.role, 'cash') ? (
          <Button
            className="min-w-36 flex-1"
            variant="secondary"
            onPress={() => router.push('/(tabs)/cash')}
          >
            <Banknote color={accent} size={18} />
            <Button.Label>Caja</Button.Label>
          </Button>
        ) : null}
        {canAccess(user.role, 'inventory') ? (
          <Button
            className="min-w-36 flex-1"
            variant="secondary"
            onPress={() => router.push('/(tabs)/inventory')}
          >
            <Boxes color={accent} size={18} />
            <Button.Label>Inventario</Button.Label>
          </Button>
        ) : null}
        {canAccess(user.role, 'products') ? (
          <Button
            className="min-w-36 flex-1"
            variant="secondary"
            onPress={() => router.push('/products')}
          >
            <Package color={accent} size={18} />
            <Button.Label>Productos</Button.Label>
          </Button>
        ) : null}
      </View>
      {low.length ? (
        <>
          <SectionTitle badge={low.length}>Productos con stock bajo</SectionTitle>
          <Card className="divide-border divide-y px-4">
            {low.slice(0, 6).map((product) => (
              <View key={product.id} className="flex-row items-center justify-between py-3">
                <Typography.Paragraph>{product.name}</Typography.Paragraph>
                <Chip size="sm" color="warning" variant="soft">
                  {product.stock} u.
                </Chip>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
