import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export const money = (value: number) =>
  new Intl.NumberFormat('es-CU', {
    style: 'currency',
    currency: 'CUP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export const shortDate = (value: string) =>
  format(parseISO(value), 'dd/MM/yyyy HH:mm', { locale: es });

export const dayRange = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
};

export function parsePositiveNumber(value: string, label: string) {
  const number = Number(value.replace(',', '.'));
  if (!Number.isFinite(number) || number < 0)
    throw new Error(`${label} debe ser un número válido.`);
  return number;
}
