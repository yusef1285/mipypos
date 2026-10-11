import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { money, shortDate } from '@/lib/format';
import type { LineaVenta, Venta } from '@/lib/models';

const safe = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export async function createThermalTicket(sale: Venta, lines: LineaVenta[], mode: 'demo' | 'pro') {
  if (mode !== 'pro') throw new Error('La impresión de tickets requiere modo Pro.');
  const html = `<html><head><meta name="viewport" content="width=device-width"><style>@page{size:80mm auto;margin:4mm}body{font-family:monospace;width:72mm;font-size:12px;color:#111}h1{text-align:center;font-size:18px}.row{display:flex;justify-content:space-between;border-bottom:1px dashed #aaa;padding:5px 0}.total{font-size:16px;font-weight:bold;margin-top:12px}.center{text-align:center}</style></head><body><h1>MipyPOS</h1><p class="center">Ticket #${sale.id}<br>${shortDate(sale.date)}<br>Atendido por ${safe(sale.user)}</p>${lines.map((line) => `<div class="row"><span>${safe(line.name)} x${line.quantity} ${safe(line.unit)}</span><span>${money(line.subtotal)}</span></div>`).join('')}<div class="row total"><span>TOTAL</span><span>${money(sale.total)}</span></div><p>Pago: ${safe(sale.method)}</p><p class="center">Gracias por su compra</p></body></html>`;
  const { uri } = await Print.printToFileAsync({ html, width: 302 });
  await Sharing.shareAsync(uri, { dialogTitle: `Ticket ${sale.id}`, mimeType: 'application/pdf' });
  return uri;
}
