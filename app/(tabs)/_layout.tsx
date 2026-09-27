import { Tabs } from 'expo-router';
import {
  Banknote,
  Boxes,
  ChartNoAxesCombined,
  House,
  MoreHorizontal,
  ShoppingCart,
} from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { useThemeColor } from 'heroui-native';
import { useUniwind } from 'uniwind';

import { useApp } from '@/lib/app-context';
import { canAccess } from '@/lib/permissions';

export default function TabLayout() {
  const { user } = useApp();
  const { theme } = useUniwind();
  const [background, foreground, border, accent, muted] = useThemeColor([
    'background',
    'foreground',
    'border',
    'accent',
    'muted',
  ]);
  const options = {
    headerStyle: { backgroundColor: background },
    headerTintColor: foreground,
    headerTitleStyle: { color: foreground, fontWeight: '700' as const },
    headerShadowVisible: false,
    sceneStyle: { backgroundColor: background },
    tabBarStyle: {
      backgroundColor: background,
      borderTopColor: border,
      shadowColor: border,
      shadowOpacity: theme === 'dark' ? 0.35 : 0.12,
      shadowRadius: 8,
      elevation: 8,
      height: 64,
      paddingBottom: 8,
      paddingTop: 7,
    },
    tabBarActiveTintColor: accent,
    tabBarInactiveTintColor: muted,
  };
  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Tabs screenOptions={options}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Inicio',
            headerShown: false,
            tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="sales"
          options={{
            title: 'Ventas',
            href: canAccess(user?.role, 'sales') ? undefined : null,
            tabBarIcon: ({ color, size }) => <ShoppingCart color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="cash"
          options={{
            title: 'Caja',
            href: canAccess(user?.role, 'cash') ? undefined : null,
            tabBarIcon: ({ color, size }) => <Banknote color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="inventory"
          options={{
            title: 'Inventario',
            href: canAccess(user?.role, 'inventory') ? undefined : null,
            tabBarIcon: ({ color, size }) => <Boxes color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: 'Reportes',
            href: canAccess(user?.role, 'reports') ? undefined : null,
            tabBarIcon: ({ color, size }) => <ChartNoAxesCombined color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'Más',
            tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} />,
          }}
        />
      </Tabs>
    </>
  );
}
