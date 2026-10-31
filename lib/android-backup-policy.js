// Expo loads config-plugin dependencies through Node, without a TypeScript hook.
// Keep this runtime module CommonJS; android-backup-policy.d.ts supplies its types.
// Raw SQLite snapshots, credentials and operation journals must remain on the
// device. Business transfer/export is the explicit, sanitized movement path.
const credentialDomains = ['root', 'file', 'database', 'sharedpref', 'external'];
const extractionDomains = [
  ...credentialDomains,
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
];
/** @param {readonly string[]} domains */
const excludes = (domains) =>
  domains.map((domain) => `    <exclude domain="${domain}" path="." />`).join('\n');

const androidLegacyBackupRules = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludes(credentialDomains)}
</full-backup-content>
`;

// Android 12+ vendors may still permit device-to-device migration even when
// allowBackup is false. Exclude every domain from both extraction channels.
const androidDataExtractionRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludes(extractionDomains)}
  </cloud-backup>
  <device-transfer>
${excludes(extractionDomains)}
  </device-transfer>
</data-extraction-rules>
`;

/**
 * @template {Record<string, string | undefined>} T
 * @param {T} attributes
 */
function applyAndroidPrivateBackupPolicy(attributes) {
  return {
    ...attributes,
    'android:allowBackup': 'false',
    'android:fullBackupContent': '@xml/mipypos_private_backup_rules',
    'android:dataExtractionRules': '@xml/mipypos_private_data_extraction_rules',
  };
}

exports.androidLegacyBackupRules = androidLegacyBackupRules;
exports.androidDataExtractionRules = androidDataExtractionRules;
exports.applyAndroidPrivateBackupPolicy = applyAndroidPrivateBackupPolicy;
