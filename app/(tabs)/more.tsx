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
  href: '/products' | '/movements' | '/users' | '/exports' | '/settings';
  icon: (typeof appIcons)[keyof typeof appIcons];
}> = [
  { module: 'products', label: 'Productos', href: '/products', icon: appIcons.products },
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
            .filter((item) => canAccess(user.role, item.module))
            .map((item) => {
              const Icon = item.icon;
              return (
                <ListGroup.Item key={item.module} onPress={() => router.push(item.href)}>
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
