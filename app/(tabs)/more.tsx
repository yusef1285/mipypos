import { router } from 'expo-router';
import { Card, ListGroup, LinkButton, Typography, useThemeColor } from 'heroui-native';
import { ChevronRight } from 'lucide-react-native';
import { Linking } from 'react-native';

import { appIcons } from '@/components/app-icons';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { BRAND_LINE, CREATOR_WHATSAPP, CREATOR_WHATSAPP_URL } from '@/lib/branding';
import { canAccess, type ModuleKey } from '@/lib/permissions';

const items: Array<{
  module: ModuleKey;
  label: string;
  href:
    | '/products'
    | '/movements'
    | '/users'
    | '/exports'
    | '/settings'
    | '/audit'
    | '/consumption'
    | '/investment'
    | '/profitability'
    | '/seller-performance'
    | '/onat'
    | '/branches'
    | '/transfers'
    | '/parties'
    | '/currencies'
    | '/payroll'
    | '/partners'
    | '/consolidated'
    | '/purchases'
    | '/inventory-count';
  icon: (typeof appIcons)[keyof typeof appIcons];
}> = [
  { module: 'onat', label: '🧾 MipyPOS ONAT', href: '/onat', icon: appIcons.reports },
  { module: 'audit', label: 'Auditoría', href: '/audit', icon: appIcons.reports },
  { module: 'products', label: 'Productos', href: '/products', icon: appIcons.products },
  {
    module: 'consumption',
    label: 'Consumo interno',
    href: '/consumption',
    icon: appIcons.movements,
  },
  {
    module: 'investment',
    label: 'Inversión y costos',
    href: '/investment',
    icon: appIcons.products,
  },
  {
    module: 'profitability',
    label: 'Rentabilidad del negocio',
    href: '/profitability',
    icon: appIcons.reports,
  },
  {
    module: 'seller-performance',
    label: 'Rendimiento de vendedores',
    href: '/seller-performance',
    icon: appIcons.users,
  },
  { module: 'business', label: 'Consolidado', href: '/consolidated', icon: appIcons.reports },
  { module: 'business', label: 'Sucursales', href: '/branches', icon: appIcons.store },
  { module: 'transfers', label: 'Transferencias', href: '/transfers', icon: appIcons.package },
  { module: 'transfers', label: 'Conteo físico', href: '/inventory-count', icon: appIcons.package },
  {
    module: 'business',
    label: 'Compras a proveedores',
    href: '/purchases',
    icon: appIcons.package,
  },
  {
    module: 'business',
    label: 'Clientes y proveedores',
    href: '/parties',
    icon: appIcons.wallet,
  },
  { module: 'business', label: 'Monedas y tasas', href: '/currencies', icon: appIcons.payment },
  { module: 'business', label: 'Nómina', href: '/payroll', icon: appIcons.userSettings },
  { module: 'business', label: 'Socios', href: '/partners', icon: appIcons.value },
  { module: 'movements', label: 'Movimientos', href: '/movements', icon: appIcons.movements },
  { module: 'users', label: 'Usuarios', href: '/users', icon: appIcons.users },
  { module: 'exports', label: 'Exportaciones', href: '/exports', icon: appIcons.exports },
  { module: 'settings', label: 'Configuración', href: '/settings', icon: appIcons.settings },
];
export default function More() {
  const { user } = useApp();
  const [accent, muted] = useThemeColor(['accent', 'muted']);
  if (!user) return null;
  return (
    <Screen title="Más">
      <Card>
        <ListGroup>
          {items
            .filter((item) => canAccess(user.role, item.module, user.can_manage_fiscal))
            .map((item) => {
              const Icon = item.icon;
              return (
                <ListGroup.Item key={item.href} onPress={() => router.push(item.href)}>
                  <Icon color={accent} size={21} />
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{item.label}</ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ChevronRight color={muted} size={19} />
                </ListGroup.Item>
              );
            })}
        </ListGroup>
      </Card>
      <Card className="items-center gap-1 p-4">
        <Typography.Paragraph type="body-sm" color="muted">
          {BRAND_LINE}
        </Typography.Paragraph>
        <LinkButton onPress={() => void Linking.openURL(CREATOR_WHATSAPP_URL)}>
          <LinkButton.Label>WhatsApp {CREATOR_WHATSAPP}</LinkButton.Label>
        </LinkButton>
      </Card>
    </Screen>
  );
}
