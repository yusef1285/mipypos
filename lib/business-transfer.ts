import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { createBusinessArchive, restoreBusinessArchive } from '@/lib/database';
import { parseBusinessArchive, type BusinessArchive } from '@/lib/business-archive';
import { z } from 'zod';
import { markArchiveShared } from '@/lib/backup-reminder';
import { getDesktopBridge } from '@/lib/desktop';
import { pickDesktopArchive, saveDesktopBackup } from '@/lib/desktop-backup';

const envelopeSchema = z
  .object({
    app: z.literal('MipyPOS'),
    payload: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export async function shareBusinessArchive(username: string) {
  const desktop = getDesktopBridge();
  if (desktop) {
    const path = await saveDesktopBackup(username);
    await desktop.backups.openFolder();
    await markArchiveShared();
    return path;
  }
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Este dispositivo no permite compartir archivos.');
  const archive = await createBusinessArchive(username);
  for (const product of archive.tables.products) {
    if (
      typeof product.image_path === 'string' &&
      product.image_path &&
      !product.image_path.startsWith('data:')
    ) {
      const file = new File(product.image_path);
      if (!file.exists)
        throw new Error(
          `No se encontró la imagen de ${String(product.name)}. Corrígela antes de trasladar el negocio.`,
        );
      const extension = file.extension.toLowerCase();
      product.image_path = `data:image/${extension === '.png' ? 'png' : 'jpeg'};base64,${await file.base64()}`;
    }
  }
  const payload = JSON.stringify(archive);
  const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);
  const file = new File(
    Paths.document,
    `mipypos-cierre-${archive.createdAt.replaceAll(':', '-')}.json`,
  );
  file.create({ overwrite: true });
  await file.write(JSON.stringify({ app: 'MipyPOS', payload, sha256 }));
  if (file.size > 150 * 1024 * 1024)
    throw new Error(
      'El cierre supera los 150 MB que puede recibir otro teléfono. No se compartió el archivo.',
    );
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Enviar negocio cerrado',
  });
  await markArchiveShared();
  return file.uri;
}
export async function pickBusinessArchive(): Promise<BusinessArchive | null> {
  if (getDesktopBridge()) return pickDesktopArchive();
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const file = new File(result.assets[0].uri);
  if (file.size > 150 * 1024 * 1024) throw new Error('El archivo supera los 150 MB permitidos.');
  try {
    const envelope = envelopeSchema.parse(JSON.parse(await file.text()) as unknown);
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      envelope.payload,
    );
    if (digest !== envelope.sha256)
      throw new Error('El archivo está incompleto o fue modificado. Vuelve a enviarlo.');
    return parseBusinessArchive(JSON.parse(envelope.payload) as unknown);
  } catch (error) {
    if (error instanceof Error && !(error instanceof z.ZodError) && !(error instanceof SyntaxError))
      throw error;
    throw new Error(
      'No se pudo leer el archivo de cierre. Selecciona el JSON generado por MipyPOS.',
      { cause: error },
    );
  }
}
export async function receiveBusinessArchive(value: BusinessArchive, username: string) {
  const archive = parseBusinessArchive(value);
  const created: File[] = [];
  try {
    for (const product of archive.tables.products) {
      if (product.image_path === null) continue;
      // Windows keeps validated images inline; the web renderer has no app document folder.
      if (getDesktopBridge()) {
        if (
          typeof product.image_path !== 'string' ||
          !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(product.image_path)
        )
          throw new Error('Una imagen del archivo no es válida.');
        continue;
      }
      if (
        typeof product.image_path !== 'string' ||
        !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(product.image_path)
      )
        throw new Error('Una imagen del archivo no es válida.');
      if (typeof product.id !== 'number' || !Number.isSafeInteger(product.id) || product.id <= 0)
        throw new Error('La imagen no pertenece a un producto válido.');
      const [header, base64] = product.image_path.split(',');
      const file = new File(
        Paths.document,
        `received-${Crypto.randomUUID()}-${product.id}.${header.includes('png') ? 'png' : 'jpg'}`,
      );
      await LegacyFileSystem.writeAsStringAsync(file.uri, base64, {
        encoding: LegacyFileSystem.EncodingType.Base64,
      });
      created.push(file);
      product.image_path = file.uri;
    }
    return await restoreBusinessArchive(archive, username);
  } catch (error) {
    for (const file of created) if (file.exists) file.delete();
    throw error;
  }
}
