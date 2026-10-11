import type { ConfigContext, ExpoConfig } from '@expo/config';

type ExpoPlugins = NonNullable<ExpoConfig['plugins']>;

export default ({ config }: ConfigContext): ExpoConfig => {
  const nativePlugins: ExpoPlugins =
    process.env.EXPO_PLATFORM === 'native'
      ? [['expo-dev-client', { launchMode: 'most-recent' }]]
      : [];

  return {
    ...config,
    name: 'MipyPOS',
    slug: 'mipypos',
    version: process.env.BILT_APP_VERSION ?? '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    scheme: 'mipypos',
    runtimeVersion: {
      policy: 'appVersion',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      infoPlist: {
        NSLocalNetworkUsageDescription: 'Conecta MipyPOS al administrador por Wi-Fi sin internet.',
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoads: true },
        ITSAppUsesNonExemptEncryption: false,
      },
      supportsTablet: true,
      bundleIdentifier: process.env.BILT_IOS_BUNDLE_ID ?? 'me.bilt.mipypos',
    },
    android: {
      permissions: [
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.ACCESS_WIFI_STATE',
      ],
      package: process.env.BILT_ANDROID_PACKAGE ?? 'me.bilt.mipypos',
      icon: './assets/logo_mipypos_512.png',
      adaptiveIcon: {
        foregroundImage: './assets/logo_mipypos_512.png',
        backgroundColor: '#071A2A',
      },
    },
    web: {
      bundler: 'metro',
      // 'single' = SPA export: one index.html + client routing, so edge serving
      // needs only a single 404→index.html fallback rule.
      output: 'single',
      favicon: './assets/logo_mipypos_512.png',
    },
    extra: {
      appStoreAppId: process.env.BILT_APP_STORE_APP_ID,
    },
    plugins: [
      [
        'expo-router',
        {
          headers: {
            'Cross-Origin-Embedder-Policy': 'credentialless',
            'Cross-Origin-Opener-Policy': 'same-origin',
          },
        },
      ],
      'expo-font',
      'expo-splash-screen',
      'expo-sqlite',
      'expo-sharing',
      [
        'expo-camera',
        {
          cameraPermission: 'Permite a MipyPOS leer el QR del administrador.',
          recordAudioAndroid: false,
        },
      ],
      ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
      ...nativePlugins,
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  };
};
