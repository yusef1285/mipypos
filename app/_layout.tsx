// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import
import '../global.css';

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform, Pressable, Text, View } from 'react-native';
import { useEffect } from 'react';
import * as DevClient from 'expo-dev-client';
import { HeroUINativeProvider, useThemeColor } from 'heroui-native';
import {
  ErrorBoundary as ExpoErrorBoundary,
  type ErrorBoundaryProps,
  SplashScreen,
  Stack,
} from 'expo-router';

import { initPostHog } from '@/lib/posthog';
import { installGlobalErrorHandler, recordError } from '@/lib/error-log';
import { AppLock } from '@/components/AppLock';
import { registerServiceWorker } from '@/lib/registerServiceWorker';
import { reportErrorToParent } from '@/lib/reportPreviewError';
import { InstallPrompt } from '@/components/InstallPrompt';
import { AppProvider } from '@/lib/app-context';
import { registerColorTokens } from '@/lib/registerColorTokens';

registerColorTokens();
installGlobalErrorHandler();

/**
 * Custom ErrorBoundary that reports React render errors to the parent window (Bilt preview iframe)
 * and then renders the default Expo error UI.
 */
function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    if (Platform.OS === 'web' && error) {
      const message = [error.message, error.stack].filter(Boolean).join('\n');
      reportErrorToParent(message);
    }
    if (error) void recordError('render', error);
  }, [error]);
  if (Platform.OS === 'web') return <ExpoErrorBoundary error={error} retry={retry} />;
  // Native: friendly Spanish screen. Data lives in SQLite, so retrying is safe.
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 32, gap: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Algo salió mal</Text>
      <Text style={{ fontSize: 16 }}>
        Tus datos están guardados. Pulsa Reintentar; si se repite, envía el registro de errores
        desde Configuración al soporte.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={{ backgroundColor: '#0f766e', borderRadius: 12, padding: 14 }}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, textAlign: 'center' }}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

export { ErrorBoundary };

function AppStack() {
  const [background, foreground] = useThemeColor(['background', 'foreground']);
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: background },
        headerStyle: { backgroundColor: background },
        headerTintColor: foreground,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="products" options={{ headerShown: true, title: 'Productos' }} />
      <Stack.Screen name="movements" options={{ headerShown: true, title: 'Movimientos' }} />
      <Stack.Screen name="users" options={{ headerShown: true, title: 'Usuarios' }} />
      <Stack.Screen name="onat" options={{ headerShown: true, title: 'MipyPOS ONAT' }} />
      <Stack.Screen name="onat-edit" options={{ headerShown: true, title: 'Gestión fiscal' }} />
      <Stack.Screen name="audit" options={{ headerShown: true, title: 'Auditoría' }} />
      <Stack.Screen name="consumption" options={{ headerShown: true, title: 'Consumo interno' }} />
      <Stack.Screen
        name="investment"
        options={{ headerShown: true, title: 'Inversión y costos' }}
      />
      <Stack.Screen name="profitability" options={{ headerShown: true, title: 'Rentabilidad' }} />
      <Stack.Screen
        name="seller-performance"
        options={{ headerShown: true, title: 'Vendedores' }}
      />
      <Stack.Screen
        name="sale-adjustments"
        options={{ headerShown: true, title: 'Ajustes de venta' }}
      />
      <Stack.Screen name="exports" options={{ headerShown: true, title: 'Exportaciones' }} />
      <Stack.Screen name="cash-history" options={{ headerShown: true, title: 'Cierres de caja' }} />
      <Stack.Screen name="settings" options={{ headerShown: true, title: 'Configuración' }} />
      <Stack.Screen name="branches" options={{ headerShown: true, title: 'Sucursales' }} />
      <Stack.Screen name="transfers" options={{ headerShown: true, title: 'Transferencias' }} />
      <Stack.Screen name="purchases" options={{ headerShown: true, title: 'Compras' }} />
      <Stack.Screen
        name="inventory-count"
        options={{ headerShown: true, title: 'Conteo físico' }}
      />
      <Stack.Screen
        name="parties"
        options={{ headerShown: true, title: 'Clientes y proveedores' }}
      />
      <Stack.Screen name="currencies" options={{ headerShown: true, title: 'Monedas y tasas' }} />
      <Stack.Screen name="payroll" options={{ headerShown: true, title: 'Nómina' }} />
      <Stack.Screen name="partners" options={{ headerShown: true, title: 'Socios' }} />
      <Stack.Screen name="consolidated" options={{ headerShown: true, title: 'Consolidado' }} />
    </Stack>
  );
}

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Report uncaught JS errors and unhandled promise rejections to parent (Bilt preview iframe)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    const handleError = (event: ErrorEvent) => {
      const message = event.error?.stack ?? event.message ?? 'Unknown error';
      reportErrorToParent(message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      void recordError('promise', err);
      const message =
        err instanceof Error ? [err.message, err.stack].filter(Boolean).join('\n') : String(err);
      reportErrorToParent(message);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Inject Google Fonts link tag for web to ensure fonts load through proxy
  // Also register font family names as fallback if expo-font fails
  useEffect(() => {
    if (Platform.OS === 'web') {
      // Check if link already exists
      const existingLink = document.querySelector(
        'link[href*="fonts.googleapis.com/css2?family=Inter"]',
      );

      if (!existingLink) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href =
          'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
      }

      // Note: The @import in global.css and the link tag above ensure Inter font loads
      // expo-font will register the font family names (Inter_400Regular, etc.)
      // If expo-font fails due to proxy issues, the fonts should still be available
      // via the direct Google Fonts CDN link, though the specific font family names
      // might not be registered. The app should still render with Inter font.
    }
  }, []);

  useEffect(() => {
    const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    if (__DEV__ && Platform.OS !== 'web' && !isExpoGo) {
      const timer = setTimeout(() => {
        DevClient.closeMenu();
        DevClient.hideMenu();
      }, 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      initPostHog();
    }
  }, []);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    if (loaded || error) {
      void SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <AppProvider>
          <AppStack />
          <AppLock />
          <InstallPrompt />
        </AppProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
