import type { captureReceipt as captureNativeReceipt } from './receipt-camera';

export async function captureReceipt(
  _fromLibrary = false,
): Promise<Awaited<ReturnType<typeof captureNativeReceipt>>> {
  throw new Error('La lectura offline de comprobantes requiere la compilación Android de MipyPOS.');
}
