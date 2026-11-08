import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { money } from '@/lib/format';
import type { DailyReport } from '@/lib/models';

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

// Builds a printable one-page summary (sales, payments, sellers, products) and opens the share
// sheet so the owner can send it by WhatsApp, Telegram or email.
export function dailyReportHtml(report: DailyReport, business: string, date = new Date()) {
  const rows = (items: string[][]) =>
    items.map((cells) => `<tr>${cells.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0}
    h2{font-size:15px;margin:18px 0 6px}table{width:100%;border-collapse:collapse;font-size:12px}
    td{border-bottom:1px solid #ddd;padding:4px}td:last-child{text-align:right}
    .muted{color:#555;font-size:12px}</style></head><body>
    <h1>${escape(business)} · Reporte del día</h1>
    <p class="muted">${escape(date.toLocaleDateString('es-CU', { dateStyle: 'full' }))}</p>
    <h2>Resumen</h2><table>${rows([
      ['Total de ventas', money(report.totalSales)],
      ['Operaciones', String(report.salesCount)],
      ['Efectivo', money(report.cash)],
      ['Transferencia', money(report.transfer)],
      ...(report.card > 0 ? [['Tarjeta histórica', money(report.card)]] : []),
    ])}</table>
    <h2>Por vendedor</h2><table>${rows(
      report.byUser.map((u) => [`${u.user} (${u.count})`, money(u.total)]),
    )}</table>
    <h2>Productos vendidos</h2><table>${rows(
      report.byProduct.map((p) => [`${p.product} · ${p.quantity} ${p.unit}`, money(p.total)]),
    )}</table>
    <p class="muted">Generado por MipyPOS. Documento interno, no es comprobante fiscal.</p>
    </body></html>`;
}

export async function shareDailyReportPdf(report: DailyReport, business: string) {
  const { uri } = await Print.printToFileAsync({ html: dailyReportHtml(report, business) });
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Este dispositivo no permite compartir archivos.');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'Enviar reporte del día',
  });
}
