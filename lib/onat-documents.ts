import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { exportRows } from '@/lib/exports';
import type { LicenseMode } from '@/lib/models';
import { activeRecords } from '@/lib/onat';
import {
  ONAT_DISCLAIMER,
  type FiscalData,
  type FiscalFilter,
  type FiscalRecordInput,
  type Obligation,
} from '@/lib/onat-models';

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
const escapeHtml = (s: string | number | null | undefined) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function fiscalExportRows(data: FiscalData, filter: FiscalFilter) {
  const rows = activeRecords(data.records).filter(
    (r) =>
      r.kind === 'obligation' &&
      r.taxpayerId === filter.taxpayerId &&
      (r.value as Obligation).start <= filter.end &&
      (r.value as Obligation).end >= filter.start,
  );
  return rows.map((r) => {
    const o = r.value as Obligation;
    const payments = activeRecords(data.records).filter(
      (p) => p.kind === 'payment' && (p.value as FiscalRecordInput).obligationId === r.id,
    );
    const paid = payments.reduce((s, p) => s + (p.value as FiscalRecordInput).amount, 0);
    return {
      Contribuyente: o.profile.name,
      NIT: o.profile.nit,
      Ámbito: o.scope,
      Socio: o.beneficiary,
      Impuesto: o.name,
      Desde: o.start,
      Hasta: o.end,
      Vencimiento: o.due,
      Base: o.calculation.base,
      Gravable: o.calculation.taxable,
      Estimado: o.calculation.tax,
      Anticipos: o.calculation.credits,
      Pagado: paid,
      Pendiente: Math.max(0, o.calculation.tax - paid),
      Diferencia: paid - o.calculation.tax,
      Cálculo: o.calculation.explanation,
      Fuente: o.rule.sourceUrl,
      Verificación: o.rule.verifiedOn,
      Aviso: ONAT_DISCLAIMER,
    };
  });
}
export function fiscalReportHtml(data: FiscalData, filter: FiscalFilter) {
  const rows = fiscalExportRows(data, filter);
  return `<!doctype html><html lang="es"><meta charset="utf-8"><style>body{font-family:Arial;font-size:12px;padding:24px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #bbb;text-align:left}h1{font-size:22px}</style><h1>MipyPOS ONAT</h1><p>${escapeHtml(ONAT_DISCLAIMER)}</p><p>${escapeHtml(filter.start)} — ${escapeHtml(filter.end)} · CUP</p>${rows
    .map(
      (r) =>
        `<h2>${escapeHtml(r.Impuesto)}</h2><p>${escapeHtml(r.Contribuyente)} · NIT ${escapeHtml(r.NIT)} · ${escapeHtml(r.Ámbito)} ${escapeHtml(r.Socio)}</p><table>${Object.entries(
          r,
        )
          .filter(([k]) => !['Aviso', 'Contribuyente', 'NIT'].includes(k))
          .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
          .join('')}</table>`,
    )
    .join('')}</html>`;
}
export async function exportFiscalReport(
  data: FiscalData,
  filter: FiscalFilter,
  format: 'PDF' | 'Excel' | 'Impresión',
  mode: LicenseMode,
) {
  const rows = fiscalExportRows(data, filter);
  if (!rows.length) throw new Error('Confirma una estimación antes de exportar.');
  if (format === 'Excel') return exportRows('mipypos-onat', rows, 'xlsx', mode);
  const html = fiscalReportHtml(data, filter);
  if (format === 'Impresión' || Platform.OS === 'web') return Print.printAsync({ html });
  const file = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('No se puede compartir el reporte en este dispositivo.');
  return Sharing.shareAsync(file.uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Resumen tributario de preparación',
  });
}
