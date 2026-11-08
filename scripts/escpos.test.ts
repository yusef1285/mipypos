import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asciiText, escposTicket, toBase64 } from '../lib/escpos';
import type { LineaVenta, Venta } from '../lib/models';

const sale: Venta = {
  id: 7,
  session_id: 1,
  user: 'cajera',
  seller_id: 2,
  date: '2026-11-07T15:00:00.000Z',
  total: 1250,
  method: 'cash',
  payments: [{ type: 'cash', amount: 1250 }],
  settlement: { cashReceived: 1500, transferReceipt: null, changeDue: 250 },
};
const lines: LineaVenta[] = [
  {
    id: 1,
    sale_id: 7,
    product_id: 1,
    name: 'Café molido ñandú',
    quantity: 2,
    price: 500,
    subtotal: 1000,
    area_id: 1,
    unit: 'u',
    unit_cost: null,
    category: '',
  },
  {
    id: 2,
    sale_id: 7,
    product_id: 2,
    name: 'Azúcar',
    quantity: 1,
    price: 250,
    subtotal: 250,
    area_id: 1,
    unit: 'kg',
    unit_cost: null,
    category: '',
  },
];

void test('folds accents so cheap printers never print garbage', () => {
  assert.equal(asciiText('Café ñandú ÁÉÍÓÚ'), 'Cafe nandu AEIOU');
  assert.equal(asciiText('€'), '?');
});

void test('ticket is pure ASCII, starts with init and ends with cut', () => {
  const bytes = escposTicket(sale, lines, { label: 'A-12', branchName: 'Centro' }, 32);
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x1b, 0x40]);
  assert.deepEqual(Array.from(bytes.slice(-4)), [0x1d, 0x56, 0x42, 0x00]);
  const printable = String.fromCharCode(...bytes.filter((b) => b >= 0x20 || b === 0x0a));
  assert.match(printable, /Cafe molido nandu/);
  assert.match(printable, /Ticket A-12/);
  for (const row of printable.split('\n')) assert.ok(row.length <= 34, row);
});

void test('base64 matches Node encoding', () => {
  for (const size of [0, 1, 2, 3, 4, 5, 100]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (i * 37) % 256);
    assert.equal(toBase64(data), Buffer.from(data).toString('base64'));
  }
});
