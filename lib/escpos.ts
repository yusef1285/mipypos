import { money, shortDate } from '@/lib/format';
import type { LineaVenta, Venta } from '@/lib/models';
import type { TicketNumbering } from '@/lib/ticket';

// Pure ESC/POS encoder (no native code) so it can be unit-tested with tsx.
const ESC = 0x1b;
const GS = 0x1d;

// Most cheap printers ship with code page 437/850 only; accents are folded to ASCII so tickets
// never print garbage, and ñ/Ñ become n/N.
export const asciiText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\n]/g, '?');

const pad = (left: string, right: string, width: number) => {
  const l = asciiText(left);
  const r = asciiText(right);
  const room = width - r.length - 1;
  const clipped = l.length > room ? l.slice(0, Math.max(0, room)) : l;
  return `${clipped}${' '.repeat(Math.max(1, width - clipped.length - r.length))}${r}`;
};

export function escposTicket(
  sale: Venta,
  lines: LineaVenta[],
  numbering: TicketNumbering | null | undefined,
  columns: 32 | 48 = 32,
  business = 'MipyPOS',
) {
  const out: number[] = [ESC, 0x40]; // initialize
  const text = (value: string) => {
    for (const char of asciiText(value)) out.push(char.charCodeAt(0));
  };
  const line = (value = '') => {
    text(value);
    out.push(0x0a);
  };
  const align = (mode: 0 | 1) => out.push(ESC, 0x61, mode);
  const bold = (on: boolean) => out.push(ESC, 0x45, on ? 1 : 0);
  const size = (big: boolean) => out.push(GS, 0x21, big ? 0x11 : 0x00);
  align(1);
  size(true);
  bold(true);
  line(business);
  size(false);
  bold(false);
  if (numbering) {
    line(numbering.branchName);
    line(`Ticket ${numbering.label}`);
  } else line(`Ticket #${sale.id}`);
  line(shortDate(sale.date));
  line(`Atendido por ${sale.user}`);
  align(0);
  line('-'.repeat(columns));
  for (const item of lines) {
    line(item.name.slice(0, columns));
    line(
      pad(`  ${item.quantity} ${item.unit} x ${money(item.price)}`, money(item.subtotal), columns),
    );
  }
  line('-'.repeat(columns));
  bold(true);
  line(pad('TOTAL', money(sale.total), columns));
  bold(false);
  line(`Pago: ${sale.method}`);
  if (sale.settlement?.cashReceived != null) {
    line(pad('Recibido', money(sale.settlement.cashReceived), columns));
    line(pad('Vuelto', money(sale.settlement.changeDue), columns));
  }
  if (sale.settlement?.transferReceipt) line(`Ref: ${sale.settlement.transferReceipt.reference}`);
  align(1);
  line();
  line('Gracias por su compra');
  line();
  line();
  line();
  out.push(GS, 0x56, 0x42, 0x00); // partial cut where supported; ignored otherwise
  return Uint8Array.from(out);
}

export function testPage(columns: 32 | 48) {
  const out: number[] = [ESC, 0x40, ESC, 0x61, 1];
  for (const char of asciiText(
    `MipyPOS\nPrueba de impresora\n${'-'.repeat(columns)}\n${columns} columnas\n\n\n\n`,
  ))
    out.push(char.charCodeAt(0));
  out.push(GS, 0x56, 0x42, 0x00);
  return Uint8Array.from(out);
}

export function toBase64(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=';
    result += i + 2 < bytes.length ? alphabet[c & 63] : '=';
  }
  return result;
}
