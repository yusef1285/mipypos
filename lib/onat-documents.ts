import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { exportRows } from '@/lib/exports';
import type { LicenseMode } from '@/lib/models';
import type { FiscalData, FiscalFilter, Obligation } from '@/lib/onat-models';
import { fiscalExportRows, fiscalReportHtml } from '@/lib/onat-report';
export { fiscalExportRows, fiscalReportHtml } from '@/lib/onat-report';

export async function pickFiscalAttachment() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/jpeg', 'image/png', 'application/pdf'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset.size || asset.size > 700000)
    throw new Error('El comprobante debe pesar menos de 700 KB.');
  const file = new File(asset.uri);
  const encoded = await file.base64();
  const mime = asset.mimeType;
  if (!mime || !['image/jpeg', 'image/png', 'application/pdf'].includes(mime))
    throw new Error('Selecciona una imagen PNG/JPEG o un PDF.');
  return { data: `data:${mime};base64,${encoded}`, name: asset.name };
}
export async function openFiscalAttachment(data: string, name: string) {
  if (Platform.OS === 'web') {
    const response = await fetch(data);
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const [, mime, base64] = data.match(/^data:([^;]+);base64,(.+)$/) ?? [];
  if (!mime || !base64) throw new Error('El comprobante no es válido.');
  const file = new File(
    Paths.cache,
    `mipypos-onat-comprobante.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`,
  );
  if (file.exists) file.delete();
  file.create();
  await file.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('No se puede abrir el comprobante en este dispositivo.');
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: 'Comprobante fiscal' });
}
export async function exportFiscalReport(
  data: FiscalData,
  filter: FiscalFilter,
  format: 'PDF' | 'Excel' | 'Impresión',
  mode: LicenseMode,
  scope?: Obligation['scope'],
) {
  const rows = fiscalExportRows(data, filter, scope);
  if (!rows.length) throw new Error('Confirma una estimación antes de exportar.');
  if (format === 'Excel') return exportRows('mipypos-onat', rows, 'xlsx', mode);
  const html = fiscalReportHtml(data, filter, scope);
  if (format === 'Impresión' || Platform.OS === 'web') return Print.printAsync({ html });
  const file = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('No se puede compartir el reporte en este dispositivo.');
  return Sharing.shareAsync(file.uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Resumen tributario de preparación',
  });
}
