export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error('El CSV no contiene datos.');
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  const required = ['name', 'stock', 'price_cash'];
  if (required.some((field) => !headers.includes(field)))
    throw new Error(`El CSV debe incluir: ${required.join(', ')}.`);
  return rows
    .slice(1)
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
    );
}
