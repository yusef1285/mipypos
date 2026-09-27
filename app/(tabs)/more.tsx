import { router } from 'expo-router';
import { Card, ListGroup, Typography, useThemeColor } from 'heroui-native';
import { ChevronRight, FileDown, Package, Repeat2, Settings, Users } from 'lucide-react-native';

import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { canAccess, type ModuleKey } from '@/lib/permissions';

const items: Array<{
  module: ModuleKey;
  label: string;
  href: '/products' | '/movements' | '/users' | '/exports' | '/settings';
  icon: typeof Package;
}> = [
  { module: 'products', label: 'Productos', href: '/products', icon: Package },
  { module: 'movements', label: 'Movimientos', href: '/movements', icon: Repeat2 },
  { module: 'users', label: 'Usuarios', href: '/users', icon: Users },
  { module: 'exports', label: 'Exportaciones', href: '/exports', icon: FileDown },
  { module: 'settings', label: 'Configuración', href: '/settings', icon: Settings },
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
      <Typography.Paragraph type="body-sm" color="muted" align="center">
        MipyPOS funciona sin conexión. Tus datos permanecen en este dispositivo.
      </Typography.Paragraph>
    </Screen>
  );
}
