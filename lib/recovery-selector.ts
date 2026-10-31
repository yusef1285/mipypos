import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { z } from 'zod';

const KEY = 'mipypos.recovery.selector.v1';
const fileName = z.string().regex(/^mipypos(?:\.restored\.[0-9a-f-]{36})?\.db$/);
const selectorSchema = z
  .object({
    version: z.literal(1),
    phase: z.enum(['prepared', 'committed']),
    previous: fileName,
    candidate: fileName,
    authorityId: z.string().min(1),
    restoreId: z.string().uuid(),
    createdAt: z.string().datetime(),
  })
  .refine(
    (selector) =>
      selector.previous !== selector.candidate &&
      selector.candidate === `mipypos.restored.${selector.restoreId}.db`,
    { message: 'La generación no corresponde al identificador de restauración.' },
  );
export type RecoverySelector = z.infer<typeof selectorSchema>;

export async function loadRecoverySelector(): Promise<RecoverySelector | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw === null) return null;
  try {
    return selectorSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      'El registro de recuperación necesita revisión. No se abrirá otra base de datos.',
      { cause: error },
    );
  }
}
export async function saveRecoverySelector(selector: RecoverySelector) {
  const encoded = JSON.stringify(selectorSchema.parse(selector));
  await AsyncStorage.setItem(KEY, encoded);
  if ((await AsyncStorage.getItem(KEY)) !== encoded)
    throw new Error('No se pudo confirmar el registro de recuperación. Los archivos se conservan.');
}

// A single durable record is the activation point. Before commitment the old
// generation remains authoritative. No db/WAL/SHM file is renamed or removed.
export async function resolveDatabaseFile(): Promise<{ fileName: string; authorityId?: string }> {
  const selector = await loadRecoverySelector();
  if (!selector) {
    if (Platform.OS !== 'web') {
      const directory: unknown = SQLite.defaultDatabaseDirectory;
      if (typeof directory !== 'string')
        throw new Error('No se pudo verificar la carpeta de datos. No se abrirá otra base.');
      const folder = new Directory(directory);
      if (
        folder.exists &&
        folder.list().some((entry) => entry.name.startsWith('mipypos.restored.'))
      )
        throw new Error(
          'Falta el registro de recuperación y existen bases conservadas. No se abrirá una versión antigua; tus archivos necesitan revisión.',
        );
    }
    return { fileName: 'mipypos.db' };
  }
  if (Platform.OS === 'web')
    throw new Error('La recuperación privada debe completarse en el teléfono.');
  const selected = selector.phase === 'committed' ? selector.candidate : selector.previous;
  const directory: unknown = SQLite.defaultDatabaseDirectory;
  if (typeof directory !== 'string' || !new File(directory, selected).exists)
    throw new Error('No se encontró la base de recuperación activa. No se creará una base vacía.');
  return { fileName: selected, authorityId: selector.authorityId };
}
