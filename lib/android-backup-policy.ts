// Raw SQLite snapshots, credentials and operation journals must remain on the
// device. Business transfer/export is the explicit, sanitized movement path.
const credentialDomains = ['root', 'file', 'database', 'sharedpref', 'external'] as const;
const extractionDomains = [
  ...credentialDomains,
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
] as const;
const excludes = (domains: readonly string[]) =>
  domains.map((domain) => `    <exclude domain="${domain}" path="." />`).join('\n');

export const androidLegacyBackupRules = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludes(credentialDomains)}
</full-backup-content>
`;

// Android 12+ vendors may still permit device-to-device migration even when
// allowBackup is false. Exclude every domain from both extraction channels.
export const androidDataExtractionRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludes(extractionDomains)}
  </cloud-backup>
  <device-transfer>
${excludes(extractionDomains)}
  </device-transfer>
</data-extraction-rules>
`;

export function applyAndroidPrivateBackupPolicy<T extends Record<string, string | undefined>>(
  attributes: T,
) {
  return {
    ...attributes,
    'android:allowBackup': 'false',
    'android:fullBackupContent': '@xml/mipypos_private_backup_rules',
    'android:dataExtractionRules': '@xml/mipypos_private_data_extraction_rules',
  };
}
