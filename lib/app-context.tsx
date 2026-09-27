import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useSegments } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  authenticate,
  getLicenseMode,
  getOpenSession,
  getSetting,
  initializeDatabase,
  setSetting,
} from '@/lib/database';
import { validateLicenseKey } from '@/lib/license';
import type { LicenseMode, SesionCaja, Usuario } from '@/lib/models';

interface AppContextValue {
  ready: boolean;
  user: Usuario | null;
  rememberedUsername: string;
  session: SesionCaja | null;
  licenseMode: LicenseMode;
  revision: number;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  setLicense: (mode: LicenseMode, key?: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Usuario | null>(null);
  const [rememberedUsername, setRememberedUsername] = useState('');
  const [session, setSession] = useState<SesionCaja | null>(null);
  const [licenseMode, setLicenseMode] = useState<LicenseMode>('demo');
  const [revision, setRevision] = useState(0);
  const segments = useSegments();

  const refresh = useCallback(async () => {
    setSession(await getOpenSession());
    setLicenseMode(await getLicenseMode());
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    void (async () => {
      await initializeDatabase();
      setRememberedUsername((await AsyncStorage.getItem('mipypos.rememberedUsername')) ?? '');
      setSession(await getOpenSession());
      const storedMode = await getLicenseMode();
      const storedKey = await getSetting('license_key');
      const validPro =
        storedMode === 'pro' && storedKey ? await validateLicenseKey(storedKey) : false;
      if (storedMode === 'pro' && !validPro) await setSetting('license_mode', 'demo');
      setLicenseMode(validPro ? 'pro' : 'demo');
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === 'login';
    if (!user && !onLogin) router.replace('/login');
    else if (user && onLogin) router.replace('/(tabs)');
  }, [ready, user, segments]);

  const login = useCallback(async (username: string, password: string, remember: boolean) => {
    const authenticated = await authenticate(username, password);
    if (!authenticated) throw new Error('Usuario o contraseña incorrectos.');
    if (remember) await AsyncStorage.setItem('mipypos.rememberedUsername', authenticated.username);
    else await AsyncStorage.removeItem('mipypos.rememberedUsername');
    setRememberedUsername(remember ? authenticated.username : '');
    setUser(authenticated);
  }, []);
  const logout = useCallback(() => setUser(null), []);
  const setLicense = useCallback(async (mode: LicenseMode, key?: string) => {
    if (mode === 'pro') {
      if (!key || !(await validateLicenseKey(key))) throw new Error('La licencia no es válida.');
      await setSetting('license_key', key.trim().toUpperCase());
    }
    await setSetting('license_mode', mode);
    setLicenseMode(mode);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      user,
      rememberedUsername,
      session,
      licenseMode,
      revision,
      login,
      logout,
      refresh,
      setLicense,
    }),
    [
      ready,
      user,
      rememberedUsername,
      session,
      licenseMode,
      revision,
      login,
      logout,
      refresh,
      setLicense,
    ],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp debe usarse dentro de AppProvider.');
  return value;
}
