import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

import type { LicenseMode } from '@/lib/models';
import { escapeCsvCell } from '@/lib/csv';

export type ExportFormat = 'csv' | 'xlsx' | 'txt';

const cellText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return JSON.stringify(value);
};
const escapeCell = escapeCsvCell;
const getCellValue = (row: object, key: string): unknown =>
  Object.entries(row).find(([entryKey]) => entryKey === key)?.[1];

export async function exportRows(
  name: string,
  rows: object[],
  format: ExportFormat,
  mode: LicenseMode,
) {
  if (!rows.length) throw new Error('No hay datos para exportar.');
  if (format === 'xlsx' && mode !== 'pro')
    throw new Error('La exportación XLSX requiere modo Pro.');
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `${name}-${stamp}.${format}`);
  if (file.exists) file.delete();
  file.create();
  if (format === 'xlsx') {
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'MipyPOS');
    const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    await file.write(new Uint8Array(data));
  } else {
    const keys = Object.keys(rows[0]);
    const content =
      format === 'csv'
        ? [
            keys.map(escapeCell).join(','),
            ...rows.map((row) => keys.map((key) => escapeCell(getCellValue(row, key))).join(',')),
          ].join('\n')
        : rows
            .map((row) =>
              keys.map((key) => `${key}: ${cellText(getCellValue(row, key))}`).join(' | '),
            )
            .join('\n');
    await file.write(content);
  }
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('No se puede compartir archivos en este dispositivo.');
  await Sharing.shareAsync(file.uri, { dialogTitle: 'Exportar desde MipyPOS' });
  return file.uri;
}
