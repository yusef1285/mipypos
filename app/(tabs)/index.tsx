import { router } from 'expo-router';
import { Button, Card, Chip, Typography, useThemeColor } from 'heroui-native';
import { LinearGradient } from 'expo-linear-gradient';
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
import { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { MetricCard, SectionTitle } from '@/components/pos-ui';
import { AnimatedView } from '@/components/ui/primitives/AnimatedView';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import { money } from '@/lib/format';
import type { Producto } from '@/lib/models';
import type { getHomeSummary as homeSummary } from '@/lib/database';
import { Alert } from 'react-native';
import { canAccess } from '@/lib/permissions';
import { hoursSinceArchiveShare } from '@/lib/backup-reminder';

export default function Home() {
  const { user, session, licenseMode, refresh } = useApp();
  const accent = useThemeColor('accent');
  const { getHomeSummary, listProducts, listProductExtras } = usePosRepository();
  const [backupHours, setBackupHours] = useState(0);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [report, setReport] = useState<Awaited<ReturnType<typeof homeSummary>> | null>(null);
  const [low, setLow] = useState<Producto[]>([]);
  const load = useCallback(async () => {
    if (!user) return;
    try {
      await refresh();
      setReport(await getHomeSummary());
      const products = await listProducts();
      const minimum = new Map(
        (await listProductExtras().catch(() => [])).map((e) => [e.product_id, e.min_stock]),
      );
      setProductCount(products.length);
      setLow(products.filter((p) => p.stock <= (minimum.get(p.id) || 5)));
      setBackupHours(await hoursSinceArchiveShare());
    } catch (failure) {
      Alert.alert(
        'No se pudo actualizar el resumen',
        failure instanceof Error ? failure.message : 'Vuelve a intentarlo.',
      );
    }
  }, [refresh, getHomeSummary, listProducts, listProductExtras, user]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  if (!user) return null;
  return (
    <Screen onRefresh={load} safeTop>
      <AnimatedView entering={FadeInDown.springify().damping(15)}>
        <LinearGradient
          colors={['#0F766E', '#064E3B']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          className="relative overflow-hidden rounded-3xl p-5"
        >
          <View className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white opacity-[0.07]" />
          <View className="absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-white opacity-[0.05]" />
          <View className="relative mb-5 flex-row items-start justify-between">
            <View className="flex-1">
              <Typography.Paragraph className="text-white/80">
                Hola, {user.username}
              </Typography.Paragraph>
              <Typography.Heading type="h2" className="text-white">
                Resumen de hoy
              </Typography.Heading>
            </View>
            <View className="rounded-2xl bg-white/15 p-3">
              <Store color="white" size={24} />
            </View>
          </View>
          <View className="relative flex-row items-center justify-between">
            <View className="rounded-full bg-white/20 px-3 py-1">
              <Typography.Paragraph type="body-sm" className="text-white">
                {session ? 'Caja abierta' : 'Caja cerrada'}
              </Typography.Paragraph>
            </View>
            <Typography.Paragraph type="body-sm" className="text-white">
              {licenseMode === 'pro' ? 'Licencia Pro' : 'Modo demo'}
            </Typography.Paragraph>
          </View>
        </LinearGradient>
      </AnimatedView>
      <View className="flex-row flex-wrap gap-3">
        <AnimatedView entering={FadeInUp.springify().delay(120)} className="min-w-36 flex-1">
          <MetricCard label="Ventas" value={money(report?.totalSales ?? 0)} icon={ShoppingCart} />
        </AnimatedView>
        <AnimatedView entering={FadeInUp.springify().delay(200)} className="min-w-36 flex-1">
          <MetricCard
            label="Operaciones"
            value={String(report?.salesCount ?? 0)}
            icon={ChartNoAxesCombined}
            tone="success"
          />
        </AnimatedView>
        <AnimatedView entering={FadeInUp.springify().delay(280)} className="min-w-36 flex-1">
          <MetricCard label="Stock bajo" value={String(low.length)} icon={CircleAlert} tone="warning" />
        </AnimatedView>
      </View>
      {user.role === 'admin' && productCount === 0 ? (
        <Card className="gap-2 p-4">
          <Typography.Heading type="h4">Primeros pasos</Typography.Heading>
          <Typography.Paragraph type="body-sm">
            1. Cambia la contraseña del administrador y crea los usuarios en Más → Usuarios.
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm">
            2. Revisa la moneda base y las tasas en Más → Monedas y tasas.
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm">
            3. Crea tus productos (o impórtalos en CSV) y sus áreas en Inventario.
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm">
            4. Abre la caja y registra tu primera venta.
          </Typography.Paragraph>
          <Button variant="secondary" onPress={() => router.push('/products')}>
            <Button.Label>Crear el primer producto</Button.Label>
          </Button>
        </Card>
      ) : null}
      {user.role === 'admin' && productCount && backupHours > 24 ? (
        <Card className="gap-2 p-4">
          <Typography.Heading type="h4">Copia fuera del teléfono</Typography.Heading>
          <Typography.Paragraph type="body-sm" color="muted">
            {Number.isFinite(backupHours)
              ? `Hace ${Math.floor(backupHours / 24)} día(s) que no envías una copia completa.`
              : 'Aún no has enviado una copia completa del negocio a otro lugar.'}{' '}
            Si el teléfono se pierde o se daña, esa copia es la única forma de recuperar los datos.
          </Typography.Paragraph>
          <Button variant="secondary" onPress={() => router.push('/exports')}>
            <Button.Label>Enviar copia ahora</Button.Label>
          </Button>
        </Card>
      ) : null}
      <AnimatedView entering={FadeInUp.springify().delay(200)}>
        <SectionTitle>Accesos rápidos</SectionTitle>
      </AnimatedView>
      <AnimatedView
        entering={FadeInUp.springify().delay(280)}
        className="flex-row flex-wrap gap-3"
      >
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
      </AnimatedView>
      {low.length ? (
        <>
          <SectionTitle badge={low.length}>Productos con stock bajo</SectionTitle>
          <Card className="divide-border divide-y px-4">
            {low.slice(0, 6).map((product) => (
              <View key={product.id} className="flex-row items-center justify-between py-3">
                <Typography.Paragraph>{product.name}</Typography.Paragraph>
                <Chip size="sm" color="warning" variant="soft">
                  {product.stock} {product.unit}
                </Chip>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
