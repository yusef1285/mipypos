import { Tabs } from 'expo-router';
import {
  Banknote,
  Boxes,
  ChartNoAxesCombined,
  House,
  MoreHorizontal,
  ShoppingCart,
} from 'lucide-react-native';
import { useThemeColor } from 'heroui-native';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/lib/app-context';
import { canAccess } from '@/lib/permissions';
import { poster } from '@/lib/branding';

export default function TabLayout() {
  const { user } = useApp();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const background = useThemeColor('background');
  const options = {
    headerStyle: { backgroundColor: poster.navy },
    headerTintColor: poster.white,
    headerTitleStyle: { color: poster.white, fontWeight: '700' as const },
    headerShadowVisible: false,
    sceneStyle: { backgroundColor: background },
    tabBarStyle: {
      backgroundColor: poster.navy,
      borderTopColor: poster.chromeBorder,
      shadowColor: poster.navyDeep,
      shadowOpacity: 0.26,
      shadowRadius: 8,
      elevation: 8,
      height: 64 + insets.bottom,
      paddingBottom: insets.bottom + 6,
      paddingTop: 5,
      paddingHorizontal: 2,
    },
    tabBarActiveTintColor: poster.cyan,
    tabBarInactiveTintColor: poster.muted,
    tabBarActiveBackgroundColor: poster.navyActive,
    tabBarItemStyle: {
      borderRadius: 10,
      marginHorizontal: 1,
      paddingHorizontal: 1,
      overflow: 'hidden' as const,
    },
    tabBarLabelStyle: {
      fontSize: 10,
      fontWeight: '700' as const,
      ...(width < 480 ? { marginHorizontal: -4 } : {}),
    },
  };
  return (
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
  );
}
