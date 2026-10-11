export const PRODUCT_UNITS = [
  'u',
  'caja',
  'paquete',
  'kg',
  'lb',
  'g',
  'oz',
  't',
  'l',
  'ml',
] as const;
export const fractionalUnit = (unit: string) =>
  ['kg', 'lb', 'g', 'oz', 't', 'l', 'ml'].includes(unit.trim().toLowerCase());
export const roundQuantity = (value: number) => Math.round(value * 1000) / 1000;
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function validateQuantity(quantity: number, decimals: number, allowZero = false) {
  if (!Number.isFinite(quantity) || (allowZero ? quantity < 0 : quantity <= 0))
    throw new Error('Introduce una cantidad válida.');
  const factor = 10 ** decimals;
  if (Math.abs(quantity * factor - Math.round(quantity * factor)) > 0.000001)
    throw new Error(
      decimals === 0 ? 'Esta unidad requiere cantidades enteras.' : 'Usa como máximo 3 decimales.',
    );
}
