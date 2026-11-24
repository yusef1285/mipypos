import { router, type Href } from 'expo-router';
import { Button, Card, Chip, Typography, useThemeColor } from 'heroui-native';
import {
  Banknote,
  Boxes,
  type LucideIcon,
  ChartNoAxesCombined,
  CircleAlert,
  Package,
  ShoppingCart,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { FadeInDown, FadeInUp } from 'react-native-reanimated';

import {
  PosterBackdrop,
  PosterBrand,
  PosterModule,
  type PosterTone,
} from '@/components/PosterChrome';
import { MetricCard, SectionTitle } from '@/components/pos-ui';
import { AnimatedView } from '@/components/ui/primitives/AnimatedView';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import { money } from '@/lib/format';
import type { Producto } from '@/lib/models';
import type { getHomeSummary as homeSummary } from '@/lib/database';
import { canAccess, type ModuleKey } from '@/lib/permissions';
import { hoursSinceArchiveShare } from '@/lib/backup-reminder';
import { poster } from '@/lib/branding';

const quickActions: Array<{
  module: ModuleKey;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: PosterTone;
  href: Href;
}> = [
  {
    module: 'sales',
    label: 'Venta nueva',
    description: 'Empieza un cobro',
    icon: ShoppingCart,
    tone: 'blue',
    href: '/(tabs)/sales',
  },
  {
    module: 'inventory',
    label: 'Inventario',
    description: 'Consulta existencias',
    icon: Boxes,
    tone: 'green',
    href: '/(tabs)/inventory',
  },
  {
    module: 'cash',
    label: 'Caja',
    description: 'Gestiona tu turno',
    icon: Banknote,
    tone: 'orange',
    href: '/(tabs)/cash',
  },
  {
    module: 'reports',
    label: 'Reportes',
    description: 'Revisa tus resultados',
    icon: ChartNoAxesCombined,
    tone: 'purple',
    href: '/(tabs)/reports',
  },
];

export default function Home() {
  const { user, session, licenseMode, refresh } = useApp();
  const accent = useThemeColor('accent');
  const { width, fontScale } = useWindowDimensions();
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
  const actions = quickActions.filter(({ module }) => canAccess(user.role, module));
  const columns =
    width / Math.max(1, fontScale) >= 760 ? 4 : width / Math.max(1, fontScale) >= 310 ? 2 : 1;
  const actionRows = Array.from({ length: Math.ceil(actions.length / columns) }, (_, i) =>
    actions.slice(i * columns, (i + 1) * columns),
  );
  return (
    <Screen onRefresh={load} branded safeTop>
      <AnimatedView entering={FadeInDown.springify().damping(15)}>
        <View style={styles.hero}>
          <PosterBackdrop />
          <View style={styles.heroTop}>
            <PosterBrand />
            <View style={styles.edition}>
              <Text style={styles.editionLabel}>MINORISTA</Text>
            </View>
          </View>
          <View style={styles.heroMain}>
            <Text style={styles.heroHello}>Hola, {user.username}</Text>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              Resumen de hoy
            </Text>
          </View>
          <View style={styles.heroStatus}>
            <View style={styles.statusChip}>
              <View
                style={[styles.statusDot, { backgroundColor: session ? '#89F2AA' : poster.yellow }]}
              />
              <Text style={styles.statusText}>{session ? 'Caja abierta' : 'Caja cerrada'}</Text>
            </View>
            <View style={styles.statusChip}>
              <Text style={styles.statusText}>
                {licenseMode === 'pro' ? 'Licencia Pro' : 'Modo demo'}
              </Text>
            </View>
          </View>
        </View>
      </AnimatedView>
      {actions.length ? (
        <AnimatedView entering={FadeInUp.springify().delay(100)} className="gap-2.5">
          <SectionTitle>Accesos rápidos</SectionTitle>
          {actionRows.map((row) => (
            <View key={row[0].module} style={styles.actionRow}>
              {row.map(({ module, href, ...action }) => (
                <PosterModule key={module} {...action} onPress={() => router.push(href)} />
              ))}
            </View>
          ))}
        </AnimatedView>
      ) : null}
      <View className="gap-2.5">
        <SectionTitle>Indicadores del día</SectionTitle>
        <View className="flex-row flex-wrap gap-2.5">
          <MetricCard
            compact
            label="Ventas"
            value={money(report?.totalSales ?? 0)}
            icon={ShoppingCart}
          />
          <MetricCard
            compact
            label="Operaciones"
            value={String(report?.salesCount ?? 0)}
            icon={ChartNoAxesCombined}
            tone="success"
          />
          <MetricCard
            compact
            label="Stock bajo"
            value={String(low.length)}
            icon={CircleAlert}
            tone="warning"
          />
        </View>
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
      {canAccess(user.role, 'products') ? (
        <Button className="self-start" variant="secondary" onPress={() => router.push('/products')}>
          <Package color={accent} size={18} />
          <Button.Label>Productos</Button.Label>
        </Button>
      ) : null}
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

const styles = StyleSheet.create({
  hero: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 23,
    borderWidth: 1,
    borderColor: poster.chromeBorder,
    backgroundColor: poster.navy,
    padding: 17,
    gap: 14,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 7,
  },
  edition: {
    borderRadius: 7,
    backgroundColor: poster.yellow,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  editionLabel: { color: poster.navyDeep, fontSize: 10, fontWeight: '900', letterSpacing: 0.85 },
  heroMain: { gap: 1 },
  heroHello: { color: poster.muted, fontSize: 14, fontWeight: '600' },
  heroTitle: { color: poster.white, fontSize: 28, fontWeight: '800', letterSpacing: -0.65 },
  heroStatus: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#6387BB',
    borderRadius: 10,
    backgroundColor: '#102854',
  },
  statusText: { color: poster.white, fontSize: 12, fontWeight: '600' },
  statusDot: { width: 7, height: 7, borderRadius: 10 },
  actionRow: { flexDirection: 'row', gap: 10 },
});
