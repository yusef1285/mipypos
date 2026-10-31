export declare const androidLegacyBackupRules: string;
export declare const androidDataExtractionRules: string;
export declare function applyAndroidPrivateBackupPolicy<
  T extends Record<string, string | undefined>,
>(
  attributes: T,
): T & {
  'android:allowBackup': 'false';
  'android:fullBackupContent': '@xml/mipypos_private_backup_rules';
  'android:dataExtractionRules': '@xml/mipypos_private_data_extraction_rules';
};
