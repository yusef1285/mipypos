import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { z } from 'zod';
import { loadDatabaseAnchor, reserveDatabaseCreation } from '@/lib/recovery-anchor';

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
  const anchor = await loadDatabaseAnchor();
  if (selector && anchor?.phase === 'ready' && selector.authorityId !== anchor.authorityId)
    throw new Error(
      'La identidad del selector no coincide con este negocio. Los archivos se conservan.',
    );
  if (!selector) {
    if (Platform.OS !== 'web') {
      // expo-file-system (new API) requires file:// URIs; SQLite.defaultDatabaseDirectory
      // is a plain absolute path (/data/user/0/<pkg>/files/SQLite), which throws
      // "URI is not absolute". Build the URI from the same documents directory instead.
      const folder = new Directory(Paths.document, 'SQLite');
      const entries = folder.exists ? folder.list() : [];
      if (entries.some((entry) => entry.name.startsWith('mipypos.restored.')))
        throw new Error(
          'Falta el registro de recuperación y existen bases conservadas. No se abrirá una versión antigua; tus archivos necesitan revisión.',
        );
      if (!new File(folder, 'mipypos.db').exists) {
        if (anchor || entries.some((entry) => entry.name.startsWith('mipypos.')))
          throw new Error(
            'No se encontró la base instalada. No se creará una base vacía ni se utilizará una copia antigua automáticamente.',
          );
        await reserveDatabaseCreation();
      }
    }
    return { fileName: 'mipypos.db' };
  }
  if (Platform.OS === 'web')
    throw new Error('La recuperación privada debe completarse en el teléfono.');
  const selected = selector.phase === 'committed' ? selector.candidate : selector.previous;
  if (!new File(new Directory(Paths.document, 'SQLite'), selected).exists)
    throw new Error('No se encontró la base de recuperación activa. No se creará una base vacía.');
  return { fileName: selected, authorityId: selector.authorityId };
}
