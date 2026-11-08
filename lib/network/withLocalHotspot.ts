import {
  withAppBuildGradle,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  AndroidConfig,
  type ConfigPlugin,
} from 'expo/config-plugins';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  androidLegacyBackupRules,
  androidDataExtractionRules,
  applyAndroidPrivateBackupPolicy,
} from '../android-backup-policy.js';

const withLocalHotspot: ConfigPlugin = (config) => {
  config = withAndroidManifest(config, (mod) => {
    const permissions = mod.modResults.manifest['uses-permission'] ?? [];
    for (const name of [
      'android.permission.CHANGE_WIFI_STATE',
      'android.permission.CHANGE_NETWORK_STATE',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.NEARBY_WIFI_DEVICES',
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
      'android.permission.BLUETOOTH_CONNECT',
    ]) {
      const existing = permissions.find((permission) => permission.$['android:name'] === name);
      if (!existing)
        permissions.push({
          $: {
            'android:name': name,
            ...(name.endsWith('ACCESS_FINE_LOCATION') ? { 'android:maxSdkVersion': '32' } : {}),
            // Legacy Bluetooth permissions only apply up to Android 11; 12+ uses BLUETOOTH_CONNECT.
            ...(name.endsWith('.BLUETOOTH') || name.endsWith('BLUETOOTH_ADMIN')
              ? { 'android:maxSdkVersion': '30' }
              : {}),
            ...(name.endsWith('NEARBY_WIFI_DEVICES')
              ? { 'android:usesPermissionFlags': 'neverForLocation' }
              : {}),
          },
        });
    }
    mod.modResults.manifest['uses-permission'] = permissions;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$ = applyAndroidPrivateBackupPolicy(application.$);
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    const ocrDependency = 'implementation("com.google.mlkit:text-recognition:16.0.1")';
    if (!mod.modResults.contents.includes(ocrDependency))
      mod.modResults.contents = mod.modResults.contents.replace(
        /dependencies\s*\{/,
        `$&\n    ${ocrDependency}`,
      );
    const dependency = 'implementation("org.nanohttpd:nanohttpd:2.3.1")';
    if (!mod.modResults.contents.includes(dependency)) {
      if (!/dependencies\s*\{/.test(mod.modResults.contents))
        throw new Error('No se pudo añadir el servidor TLS a Gradle.');
      mod.modResults.contents = mod.modResults.contents.replace(
        /dependencies\s*\{/,
        `$&\n    ${dependency}`,
      );
    }
    return mod;
  });
  config = withMainApplication(config, (mod) => {
    const marker = 'com.mipypos.lan.MipyLanPackage';
    if (mod.modResults.contents.includes(marker)) return mod;
    if (mod.modResults.language === 'kt') {
      const match = /PackageList\(this\)\.packages\.apply\s*\{/;
      if (!match.test(mod.modResults.contents))
        throw new Error('No se pudo registrar MipyLanPackage en MainApplication.');
      mod.modResults.contents = mod.modResults.contents.replace(
        match,
        '$&\n              add(com.mipypos.lan.MipyLanPackage())',
      );
    } else {
      const match = /(List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);)/;
      if (!match.test(mod.modResults.contents))
        throw new Error('No se pudo registrar MipyLanPackage en MainApplication.');
      mod.modResults.contents = mod.modResults.contents.replace(
        match,
        '$1\n      packages.add(new com.mipypos.lan.MipyLanPackage());',
      );
    }
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const resources = join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      mkdirSync(resources, { recursive: true });
      writeFileSync(join(resources, 'mipypos_private_backup_rules.xml'), androidLegacyBackupRules);
      writeFileSync(
        join(resources, 'mipypos_private_data_extraction_rules.xml'),
        androidDataExtractionRules,
      );
      const directory = join(
        mod.modRequest.platformProjectRoot,
        'app/src/main/java/com/mipypos/lan',
      );
      mkdirSync(directory, { recursive: true });
      for (const file of [
        'MipyLanModule.java',
        'MipyLanPackage.java',
        'MipyTlsModule.java',
        'LanIdentity.java',
        'MipyReceiptModule.java',
        'MipyDirectModule.java',
        'MipyDiscoveryModule.java',
        'MipyPasswordModule.java',
        'MipyPrinterModule.java',
      ])
        writeFileSync(
          join(directory, file),
          readFileSync(join(mod.modRequest.projectRoot, 'lib/network/native', file), 'utf8'),
        );
      return mod;
    },
  ]);
};
export default withLocalHotspot;
