import {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  type ConfigPlugin,
} from 'expo/config-plugins';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const withLocalHotspot: ConfigPlugin = (config) => {
  config = withAndroidManifest(config, (mod) => {
    const permissions = mod.modResults.manifest['uses-permission'] ?? [];
    for (const name of [
      'android.permission.CHANGE_WIFI_STATE',
      'android.permission.CHANGE_NETWORK_STATE',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.NEARBY_WIFI_DEVICES',
    ]) {
      const existing = permissions.find((permission) => permission.$['android:name'] === name);
      if (!existing)
        permissions.push({
          $: {
            'android:name': name,
            ...(name.endsWith('ACCESS_FINE_LOCATION') ? { 'android:maxSdkVersion': '32' } : {}),
            ...(name.endsWith('NEARBY_WIFI_DEVICES')
              ? { 'android:usesPermissionFlags': 'neverForLocation' }
              : {}),
          },
        });
    }
    mod.modResults.manifest['uses-permission'] = permissions;
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
      const directory = join(
        mod.modRequest.platformProjectRoot,
        'app/src/main/java/com/mipypos/lan',
      );
      mkdirSync(directory, { recursive: true });
      for (const file of ['MipyLanModule.java', 'MipyLanPackage.java'])
        writeFileSync(
          join(directory, file),
          readFileSync(join(mod.modRequest.projectRoot, 'lib/network/native', file), 'utf8'),
        );
      return mod;
    },
  ]);
};
export default withLocalHotspot;
