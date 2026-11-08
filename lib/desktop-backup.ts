import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { parseBusinessArchive, type BusinessArchive } from '@/lib/business-archive';
import { createBusinessArchive } from '@/lib/database';
import { desktopBridge, getDesktopBridge } from '@/lib/desktop';

/** Same envelope the phones share, so a copy can move between Windows and Android. */
const envelopeSchema = z
  .object({
    app: z.literal('MipyPOS'),
    payload: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export async function encodeArchive(archive: BusinessArchive) {
  const payload = JSON.stringify(archive);
  const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);
  return JSON.stringify({ app: 'MipyPOS', payload, sha256 });
}

export async function decodeArchive(contents: string) {
  try {
    const envelope = envelopeSchema.parse(JSON.parse(contents) as unknown);
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      envelope.payload,
    );
    if (digest !== envelope.sha256)
      throw new Error('El archivo está incompleto o fue modificado. Vuelve a copiarlo.');
    return parseBusinessArchive(JSON.parse(envelope.payload) as unknown);
  } catch (error) {
    if (error instanceof Error && !(error instanceof z.ZodError) && !(error instanceof SyntaxError))
      throw error;
    throw new Error('No se pudo leer el archivo. Selecciona el JSON generado por MipyPOS.', {
      cause: error,
    });
  }
}

/** Writes a closing archive into Documentos\MipyPOS\Copias and returns its path. */
export async function saveDesktopBackup(username: string) {
  const archive = await createBusinessArchive(username);
  for (const product of archive.tables.products)
    if (typeof product.image_path === 'string' && !product.image_path.startsWith('data:'))
      product.image_path = null;
  const name = `mipypos-cierre-${archive.createdAt.replaceAll(':', '-').replace(/\..*$/, '')}.json`;
  return desktopBridge().backups.save(name, await encodeArchive(archive));
}

/** Best effort copy after each cash close on Windows; never blocks the close itself. */
export async function autoDesktopBackup(username: string) {
  if (!getDesktopBridge()) return null;
  try {
    return await saveDesktopBackup(username);
  } catch {
    return null;
  }
}

export async function pickDesktopArchive() {
  const contents = await desktopBridge().backups.pick();
  return contents === null ? null : decodeArchive(contents);
}
