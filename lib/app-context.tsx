import * as Haptics from 'expo-haptics';
import { Button, Typography } from 'heroui-native';
import { SafeAreaView } from '@/components/ui/primitives/SafeAreaView';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useSegments } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  authenticateForLogin,
  changeOwnPassword,
  getLicenseMode,
  getOpenSession,
  initializeDatabase,
  clearNetworkReplicas,
} from '@/lib/database';
import { getPendingWithdrawal } from '@/lib/network/pending-withdrawal';
import { getPendingOperation } from '@/lib/network/pending-operation';
import { getPendingSale } from '@/lib/network/pending-sale';
import {
  HostRejection,
  getHostSnapshot,
  getOfflineSnapshot,
  loginToHost,
  logoutFromHost,
  setOfflineIdentity,
} from '@/lib/network/client';
import { getOutbox, rebindOutbox, syncOutbox } from '@/lib/network/sale-outbox';
import {
  forgetOfflineLogin,
  rememberOfflineLogin,
  verifyOfflineLogin,
} from '@/lib/network/offline-session';
import { assertPendingAuthority, loadNetworkConfig, saveNetworkConfig } from '@/lib/network/config';
import {
  disconnectHotspot,
  getLocalHotspot,
  stopLocalHotspot,
  subscribeLanStatus,
} from '@/lib/network/hotspot';
import { disconnectDirect, getDirectInfo } from '@/lib/network/direct';
import { startLanHost, stopLanHostAndDrain } from '@/lib/network/host';
import { AppState } from 'react-native';
import { supportsSecureLan } from '@/lib/desktop';
import type { NetworkConfig } from '@/lib/network/types';
import { activateLicense, refreshLicense, removeLicense } from '@/lib/license';
import type { LicenseStatus } from '@/lib/license-token';
import { DEFAULT_ADMIN_PASSWORD } from '@/lib/password';
import type { LicenseMode, SesionCaja, Usuario } from '@/lib/models';

type AuthenticatedUser = Omit<Usuario, 'password_hash'>;

/** The published initial password never opens a session; it must be replaced first. */
export class PasswordChangeRequired extends Error {
  constructor() {
    super('Por seguridad, cambia la contraseña inicial antes de continuar.');
  }
}

type NetworkStatus = 'connected' | 'syncing' | 'offline' | 'pending' | 'error';
interface AppContextValue {
  ready: boolean;
  user: AuthenticatedUser | null;
  rememberedUsername: string;
  session: SesionCaja | null;
  licenseMode: LicenseMode;
  revision: number;
  networkConfig: NetworkConfig;
  hostAddress: string;
  networkStatus: NetworkStatus;
  networkError: string;
  /** Terminal signed in without the administrator; sales are queued until sync. */
  offlineSession: boolean;
  /** Sales waiting on this terminal for the administrator (pending + rejected). */
  outboxCount: number;
  login: (
    username: string,
    password: string,
    remember: boolean,
    newPassword?: string,
  ) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  configureNetwork: (config: NetworkConfig) => Promise<void>;
  license: LicenseStatus;
  /** Activates a signed license, or removes the current one with null. */
  setLicense: (token: string | null) => Promise<LicenseStatus>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState('');
  const [bootAttempt, setBootAttempt] = useState(0);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [rememberedUsername, setRememberedUsername] = useState('');
  const [session, setSession] = useState<SesionCaja | null>(null);
  const [licenseMode, setLicenseMode] = useState<LicenseMode>('demo');
  const [license, setLicenseStatus] = useState<LicenseStatus>({ state: 'none' });
  const [revision, setRevision] = useState(0);
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig>({
    mode: 'standalone',
    hostUrl: '',
    clientId: '',
  });
  const [hostAddress, setHostAddress] = useState('');
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('offline');
  const [networkError, setNetworkError] = useState('');
  const [offlineSession, setOfflineSession] = useState(false);
  const [outboxCount, setOutboxCount] = useState(0);
  const segments = useSegments();
  // Memory only: lets a terminal renew its host session after a Wi-Fi cut or an
  // administrator restart without asking again. Never persisted.
  const credentials = useRef<{ username: string; password: string } | null>(null);
  const userRef = useRef<AuthenticatedUser | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const applyOfflineCatalog = useCallback(
    async (username: string) => {
      const offline = await getOfflineSnapshot(
        networkConfig.hostPin || networkConfig.hostUrl,
        username,
      );
      if (!offline) return false;
      setSession((current) => current ?? offline.session);
      setLicenseMode(offline.licenseMode);
      return true;
    },
    [networkConfig.hostUrl, networkConfig.hostPin],
  );

  const refresh = useCallback(async () => {
    if (networkConfig.mode === 'client') {
      if (!networkConfig.hostUrl || networkConfig.recoveryMessage)
        throw new Error(networkConfig.recoveryMessage ?? 'Escanea el QR del administrador.');
      setNetworkStatus((current) => (current === 'connected' ? current : 'syncing'));
      const current = userRef.current;
      try {
        const snapshot = await getHostSnapshot(networkConfig.hostUrl);
        setSession(snapshot.session);
        setLicenseMode(snapshot.licenseMode);
        setRevision(snapshot.revision);
        setOfflineSession(false);
        if (current) {
          const sync = await syncOutbox(networkConfig, current.username);
          if (sync.sent.length) setRevision((value) => value + 1);
          if (sync.authExpired)
            throw new HostRejection(sync.error ?? 'Inicia sesión nuevamente.', 'AUTH_EXPIRED');
        }
        const outbox = (await getOutbox()).entries.length;
        setOutboxCount(outbox);
        const pending = Boolean(
          outbox ||
          (await getPendingOperation()) ||
          (await getPendingSale()) ||
          (await getPendingWithdrawal()),
        );
        setNetworkStatus(pending ? 'pending' : 'connected');
        setNetworkError('');
      } catch (error) {
        setOutboxCount((await getOutbox().catch(() => null))?.entries.length ?? 0);
        const offline = !(error instanceof HostRejection);
        if (offline && current) await applyOfflineCatalog(current.username).catch(() => false);
        setNetworkStatus(offline ? 'offline' : 'error');
        setNetworkError(
          offline
            ? 'Sin conexión con el administrador. Puedes seguir vendiendo: las ventas se enviarán al volver la red.'
            : error instanceof Error
              ? error.message
              : 'No se pudo confirmar la conexión.',
        );
        throw error;
      }
      return;
    }
    setSession(await getOpenSession());
    setLicenseStatus(await refreshLicense());
    setLicenseMode(await getLicenseMode());
    setRevision((value) => value + 1);
  }, [networkConfig, applyOfflineCatalog]);

  useEffect(() => {
    void (async () => {
      await initializeDatabase();
      const storedNetwork = await loadNetworkConfig();
      setNetworkConfig(storedNetwork);
      setNetworkError(storedNetwork.recoveryMessage ?? '');
      if (storedNetwork.recoveryMessage) setNetworkStatus('error');
      if (storedNetwork.mode === 'host' && supportsSecureLan()) {
        try {
          if (storedNetwork.transport === 'direct' && !(await getDirectInfo())?.isOwner)
            throw new Error(
              'Vuelve a crear Wi-Fi Direct y empareja las terminales con el nuevo QR.',
            );
          setHostAddress(await startLanHost());
        } catch (failure) {
          setHostAddress(
            failure instanceof Error ? failure.message : 'No se pudo iniciar el host.',
          );
        }
      }
      setRememberedUsername((await AsyncStorage.getItem('mipypos.rememberedUsername')) ?? '');
      setSession(storedNetwork.mode === 'client' ? null : await getOpenSession());
      // Clients inherit Pro from the host snapshot; host/standalone verify the
      // signed license locally (signature, device, expiry and clock).
      if (storedNetwork.mode !== 'client') setLicenseStatus(await refreshLicense());
      setLicenseMode(await getLicenseMode());
      setReady(true);
    })().catch((failure: unknown) => {
      setBootError(failure instanceof Error ? failure.message : 'No se pudo abrir MipyPOS.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    });
    // The retry counter deliberately reruns initialization after a failed boot.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [bootAttempt]);

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
    let failures = 0;
    const poll = async () => {
      if (AppState.currentState && AppState.currentState !== 'active') {
        if (active) timer = setTimeout(() => void poll(), 15000);
        return;
      }
      try {
        await refresh();
        failures = 0;
      } catch (failure) {
        failures += 1;
        if (active && failure instanceof HostRejection && failure.code === 'AUTH_EXPIRED') {
          const saved = credentials.current;
          if (!saved || saved.username !== user.username) setUser(null);
          else
            try {
              // The administrator restarted or the token expired: renew silently.
              await loginToHost(networkConfig.hostUrl, saved.username, saved.password);
              await refresh();
              failures = 0;
            } catch (renewal) {
              if (renewal instanceof HostRejection) {
                if (/incorrect/i.test(renewal.message))
                  await forgetOfflineLogin(networkConfig.hostPin, saved.username).catch(
                    () => undefined,
                  );
                credentials.current = null;
                setUser(null);
              } else {
                setOfflineSession(true);
                setNetworkStatus('offline');
              }
            }
        }
      } finally {
        if (active)
          timer = setTimeout(() => void poll(), Math.min(30000, 2500 * 2 ** Math.min(failures, 4)));
      }
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [networkConfig, ready, refresh, user]);

  useEffect(() => {
    if (networkConfig.mode !== 'client') return undefined;
    return subscribeLanStatus((status) => {
      if (status === 'lost') {
        setNetworkStatus('offline');
        setNetworkError('Se perdió el Wi-Fi. Las operaciones pendientes se conservan.');
      } else if (user) void refresh().catch(() => undefined);
    });
  }, [networkConfig.mode, user, refresh]);

  const login = useCallback(
    async (username: string, password: string, remember: boolean, newPassword?: string) => {
      if (
        networkConfig.mode === 'client' &&
        (!networkConfig.hostUrl || networkConfig.recoveryMessage)
      )
        throw new Error(
          networkConfig.recoveryMessage ??
            'Escanea el QR del administrador antes de iniciar sesión.',
        );
      const remote = networkConfig.mode === 'client' && networkConfig.hostUrl;
      if (!remote && password === DEFAULT_ADMIN_PASSWORD && !newPassword) {
        if (!(await authenticateForLogin(username, password)))
          throw new Error('Usuario o contraseña incorrectos.');
        throw new PasswordChangeRequired();
      }
      let offline = false;
      let authenticated: AuthenticatedUser | null;
      if (remote) {
        try {
          authenticated = await loginToHost(networkConfig.hostUrl, username, password);
          await rememberOfflineLogin(networkConfig.hostPin, authenticated, password).catch(
            () => undefined,
          );
        } catch (failure) {
          if (failure instanceof HostRejection) {
            if (/incorrect/i.test(failure.message))
              await forgetOfflineLogin(networkConfig.hostPin, username).catch(() => undefined);
            throw failure;
          }
          // Administrator unreachable: sales-only session with the cached verifier.
          authenticated = await verifyOfflineLogin(networkConfig.hostPin, username, password);
          if (!authenticated)
            throw new Error(
              'No hay conexión con el administrador. Para trabajar sin conexión, este usuario debe haber iniciado sesión antes en este teléfono con la misma contraseña.',
              { cause: failure },
            );
          offline = true;
          setOfflineIdentity(networkConfig.hostUrl, authenticated.username, networkConfig.hostPin);
        }
      } else
        authenticated = newPassword
          ? await changeOwnPassword(username, password, newPassword)
          : await authenticateForLogin(username, password);
      if (!authenticated) throw new Error('Usuario o contraseña incorrectos.');
      if (remote) credentials.current = { username: authenticated.username, password };
      if (remember)
        await AsyncStorage.setItem('mipypos.rememberedUsername', authenticated.username);
      else await AsyncStorage.removeItem('mipypos.rememberedUsername');
      setRememberedUsername(remember ? authenticated.username : '');
      setOfflineSession(offline);
      if (offline) {
        await applyOfflineCatalog(authenticated.username);
        setNetworkStatus('offline');
        setNetworkError(
          'Sesión sin conexión: puedes vender con el último catálogo recibido. Las ventas se enviarán al administrador al volver la red.',
        );
      } else if (networkConfig.mode === 'client') {
        userRef.current = authenticated;
        await refresh().catch((failure: unknown) => {
          if (failure instanceof HostRejection) throw failure;
        });
      }
      setUser(authenticated);
    },
    [networkConfig, refresh, applyOfflineCatalog],
  );
  const logout = useCallback(() => {
    credentials.current = null;
    setOfflineSession(false);
    setOfflineIdentity(networkConfig.hostUrl, null);
    setUser(null);
    if (networkConfig.mode === 'client')
      void logoutFromHost(networkConfig.hostUrl, networkConfig.hostPin).catch(() => undefined);
  }, [networkConfig.mode, networkConfig.hostUrl, networkConfig.hostPin]);
  const configureNetwork = useCallback(
    async (next: NetworkConfig) => {
      const operation = await getPendingOperation();
      if (operation && (next.mode !== 'client' || next.hostUrl !== operation.hostUrl))
        throw new Error(
          'Confirma la operación pendiente iniciando sesión antes de cambiar de administrador.',
        );
      const pending = await getPendingSale();
      if (pending && (next.mode !== 'client' || next.hostUrl !== pending.hostUrl))
        throw new Error(
          'Confirma la venta pendiente antes de cambiar de administrador o trabajar solo.',
        );
      const outbox = (await getOutbox()).entries;
      if (
        outbox.some(
          (entry) =>
            next.mode !== 'client' ||
            (entry.hostPin ? entry.hostPin !== next.hostPin : entry.hostUrl !== next.hostUrl),
        )
      )
        throw new Error(
          `Hay ${outbox.length} ventas de este teléfono sin enviar al administrador. Sincronízalas antes de cambiar de administrador o trabajar solo.`,
        );
      const withdrawal = await getPendingWithdrawal();
      if (withdrawal && withdrawal.authority !== (next.mode === 'client' ? next.hostUrl : 'local'))
        throw new Error(
          'Confirma la extracción pendiente antes de cambiar de administrador o trabajar solo.',
        );
      assertPendingAuthority(
        networkConfig,
        next,
        [operation, pending, withdrawal].flatMap((record) =>
          record ? ['authority' in record ? record.authority : record.hostUrl] : [],
        ),
        [operation, pending, withdrawal].flatMap((record) => (record ? [record.hostPin] : [])),
      );
      if (next.mode === 'host' && user?.role !== 'admin')
        throw new Error('Solo un administrador puede iniciar el host.');
      const address = next.mode === 'host' ? await startLanHost() : '';
      await logoutFromHost(
        networkConfig.mode === 'client' ? networkConfig.hostUrl : undefined,
        networkConfig.hostPin,
      );
      const normalized = await saveNetworkConfig(next);
      // A different administrator identity must never see the previous offline catalog.
      if (next.mode !== 'client' || next.hostPin !== networkConfig.hostPin)
        await clearNetworkReplicas(true);
      if (normalized.mode === 'client' && normalized.hostPin)
        await rebindOutbox(normalized.hostUrl, normalized.hostPin);
      if (next.mode !== 'host') {
        await stopLanHostAndDrain();
        if (await getLocalHotspot()) await stopLocalHotspot();
      }
      if (next.mode === 'standalone') {
        await disconnectHotspot();
        await disconnectDirect();
      }
      const changedAuthority = networkConfig.mode === 'client' || next.mode === 'client';
      setNetworkConfig(normalized);
      setNetworkStatus('offline');
      setNetworkError('');
      if (changedAuthority) setUser(null);
      setSession(next.mode === 'client' ? null : await getOpenSession());
      setHostAddress(address);
    },
    [user, networkConfig],
  );
  const setLicense = useCallback(async (token: string | null) => {
    const status = token === null ? await removeLicense() : await activateLicense(token);
    setLicenseStatus(status);
    setLicenseMode(await getLicenseMode());
    return status;
  }, []);

  // Re-check expiry every minute and whenever the app returns to foreground.
  useEffect(() => {
    if (!ready || networkConfig.mode === 'client') return undefined;
    const check = () =>
      void refreshLicense()
        .then(async (status) => {
          setLicenseStatus(status);
          setLicenseMode(await getLicenseMode());
        })
        .catch(() => undefined);
    const timer = setInterval(check, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [ready, networkConfig.mode]);

  const value = useMemo(
    () => ({
      ready,
      user,
      rememberedUsername,
      session,
      licenseMode,
      license,
      revision,
      networkConfig,
      hostAddress,
      networkStatus,
      networkError,
      offlineSession,
      outboxCount,
      login,
      logout,
      refresh,
      setLicense,
      configureNetwork,
    }),
    [
      offlineSession,
      outboxCount,
      ready,
      user,
      rememberedUsername,
      session,
      licenseMode,
      license,
      revision,
      networkConfig,
      hostAddress,
      networkStatus,
      networkError,
      login,
      logout,
      refresh,
      setLicense,
      configureNetwork,
    ],
  );
  return (
    <AppContext.Provider value={value}>
      {bootError ? (
        <SafeAreaView
          className="bg-background flex-1 justify-center gap-5 p-6"
          edges={['top', 'bottom']}
        >
          <Typography.Heading type="h3">No se pudo abrir la app</Typography.Heading>
          <Typography.Paragraph>{bootError}</Typography.Paragraph>
          <Button
            onPress={() => {
              setBootError('');
              setReady(false);
              setBootAttempt((attempt) => attempt + 1);
            }}
          >
            <Button.Label>Reintentar</Button.Label>
          </Button>
        </SafeAreaView>
      ) : (
        children
      )}
    </AppContext.Provider>
  );
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp debe usarse dentro de AppProvider.');
  return value;
}
