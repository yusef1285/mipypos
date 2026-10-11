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
import { getPendingSale } from '@/lib/network/pending-sale';
import { HostRejection, getHostSnapshot, loginToHost, logoutFromHost } from '@/lib/network/client';
import { loadNetworkConfig, saveNetworkConfig } from '@/lib/network/config';
import { startLanHost, stopLanHost } from '@/lib/network/host';
import type { NetworkConfig } from '@/lib/network/types';
import { validateLicenseKey } from '@/lib/license';
import type { LicenseMode, SesionCaja, Usuario } from '@/lib/models';

type AuthenticatedUser = Omit<Usuario, 'password_hash'>;

interface AppContextValue {
  ready: boolean;
  user: AuthenticatedUser | null;
  rememberedUsername: string;
  session: SesionCaja | null;
  licenseMode: LicenseMode;
  revision: number;
  networkConfig: NetworkConfig;
  hostAddress: string;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  configureNetwork: (config: NetworkConfig) => Promise<void>;
  setLicense: (mode: LicenseMode, key?: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [rememberedUsername, setRememberedUsername] = useState('');
  const [session, setSession] = useState<SesionCaja | null>(null);
  const [licenseMode, setLicenseMode] = useState<LicenseMode>('demo');
  const [revision, setRevision] = useState(0);
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig>({
    mode: 'standalone',
    hostUrl: '',
    clientId: '',
  });
  const [hostAddress, setHostAddress] = useState('');
  const segments = useSegments();

  const refresh = useCallback(async () => {
    if (networkConfig.mode === 'client' && networkConfig.hostUrl) {
      const snapshot = await getHostSnapshot(networkConfig.hostUrl);
      setSession(snapshot.session);
      setRevision(snapshot.revision);
      return;
    }
    setSession(await getOpenSession());
    setLicenseMode(await getLicenseMode());
    setRevision((value) => value + 1);
  }, [networkConfig]);

  useEffect(() => {
    void (async () => {
      await initializeDatabase();
      const storedNetwork = await loadNetworkConfig();
      setNetworkConfig(storedNetwork);
      if (storedNetwork.mode === 'host') {
        try {
          setHostAddress(await startLanHost());
        } catch {
          setHostAddress('Host no disponible en esta compilación');
        }
      }
      setRememberedUsername((await AsyncStorage.getItem('mipypos.rememberedUsername')) ?? '');
      setSession(storedNetwork.mode === 'client' ? null : await getOpenSession());
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

  useEffect(() => {
    if (!ready || networkConfig.mode !== 'client' || !networkConfig.hostUrl || !user)
      return () => undefined;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch (failure) {
        if (active && failure instanceof HostRejection && failure.code === 'AUTH_EXPIRED')
          setUser(null);
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1500);
      }
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [networkConfig, ready, refresh, user]);

  const login = useCallback(
    async (username: string, password: string, remember: boolean) => {
      const authenticated =
        networkConfig.mode === 'client' && networkConfig.hostUrl
          ? await loginToHost(networkConfig.hostUrl, username, password)
          : await authenticate(username, password);
      if (!authenticated) throw new Error('Usuario o contraseña incorrectos.');
      if (remember)
        await AsyncStorage.setItem('mipypos.rememberedUsername', authenticated.username);
      else await AsyncStorage.removeItem('mipypos.rememberedUsername');
      setRememberedUsername(remember ? authenticated.username : '');
      if (networkConfig.mode === 'client') await refresh();
      setUser(authenticated);
    },
    [networkConfig, refresh],
  );
  const logout = useCallback(() => {
    setUser(null);
    if (networkConfig.mode === 'client') void logoutFromHost();
  }, [networkConfig.mode]);
  const configureNetwork = useCallback(
    async (next: NetworkConfig) => {
      const pending = await getPendingSale();
      if (pending && (next.mode !== 'client' || next.hostUrl !== pending.hostUrl))
        throw new Error(
          'Confirma la venta pendiente antes de cambiar de administrador o trabajar solo.',
        );
      if (next.mode === 'host' && user?.role !== 'admin')
        throw new Error('Solo un administrador puede iniciar el host.');
      const address = next.mode === 'host' ? await startLanHost() : '';
      await saveNetworkConfig(next);
      if (next.mode !== 'host') stopLanHost();
      await logoutFromHost();
      const changedAuthority = networkConfig.mode === 'client' || next.mode === 'client';
      setNetworkConfig(next);
      if (changedAuthority) setUser(null);
      setSession(next.mode === 'client' ? null : await getOpenSession());
      setHostAddress(address);
    },
    [user, networkConfig.mode],
  );
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
      networkConfig,
      hostAddress,
      login,
      logout,
      refresh,
      setLicense,
      configureNetwork,
    }),
    [
      ready,
      user,
      rememberedUsername,
      session,
      licenseMode,
      revision,
      networkConfig,
      hostAddress,
      login,
      logout,
      refresh,
      setLicense,
      configureNetwork,
    ],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp debe usarse dentro de AppProvider.');
  return value;
}
