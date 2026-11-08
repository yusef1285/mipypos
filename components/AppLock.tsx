import * as LocalAuthentication from 'expo-local-authentication';
import { Button, Typography } from 'heroui-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';

import { useApp } from '@/lib/app-context';

// After this time in background the session is locked; biometrics (or the device PIN)
// unlock it. Devices without any screen lock get logged out instead.
const LOCK_AFTER_MS = 2 * 60 * 1000;
const LOGOUT_AFTER_MS = 30 * 60 * 1000;

export function AppLock() {
  const { user, logout } = useApp();
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const hiddenAt = useRef<number | null>(null);
  const unlock = useCallback(async () => {
    setError('');
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquear MipyPOS',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: false,
      });
      if (result.success) setLocked(false);
      else if (result.error !== 'user_cancel') setError('No se pudo verificar tu identidad.');
    } catch {
      setError('No se pudo verificar tu identidad.');
    }
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web' || !user) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        hiddenAt.current ??= Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (away >= LOGOUT_AFTER_MS) {
        logout();
        return;
      }
      if (away < LOCK_AFTER_MS) return;
      void LocalAuthentication.getEnrolledLevelAsync().then((level) => {
        if (level === LocalAuthentication.SecurityLevel.NONE) logout();
        else {
          setLocked(true);
          void unlock();
        }
      });
    });
    return () => subscription.remove();
  }, [logout, unlock, user]);
  if (!locked || !user) return null;
  return (
    <View className="bg-background absolute inset-0 items-center justify-center gap-4 p-8">
      <Typography.Heading type="h3">Sesión bloqueada</Typography.Heading>
      <Typography.Paragraph color="muted" className="text-center">
        {user.username}, confirma tu huella, rostro o PIN del teléfono para continuar.
      </Typography.Paragraph>
      {error ? <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph> : null}
      <Button size="lg" onPress={() => void unlock()}>
        <Button.Label>Desbloquear</Button.Label>
      </Button>
      <Button
        variant="ghost"
        onPress={() => {
          setLocked(false);
          logout();
        }}
      >
        <Button.Label>Cerrar sesión</Button.Label>
      </Button>
    </View>
  );
}
