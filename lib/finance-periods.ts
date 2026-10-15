import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  subDays,
  subWeeks,
  subMonths,
} from 'date-fns';
import type { FinanceFilter } from '@/lib/finance-models';
export const PERIODS = [
  'Hoy',
  'Ayer',
  'Semana actual',
  'Semana anterior',
  'Mes actual',
  'Mes anterior',
  'Año',
  'Personalizado',
] as const;
export type Period = (typeof PERIODS)[number];
export function periodRange(
  period: Period,
  start: Date,
  end: Date,
  today = new Date(),
): FinanceFilter {
  let from = today;
  let to = today;
  if (period === 'Ayer') from = to = subDays(today, 1);
  if (period === 'Semana actual' || period === 'Semana anterior') {
    const date = period === 'Semana anterior' ? subWeeks(today, 1) : today;
    from = startOfWeek(date, { weekStartsOn: 1 });
    to = endOfWeek(date, { weekStartsOn: 1 });
  }
  if (period === 'Mes actual' || period === 'Mes anterior') {
    const date = period === 'Mes anterior' ? subMonths(today, 1) : today;
    from = startOfMonth(date);
    to = endOfMonth(date);
  }
  if (period === 'Año') {
    from = startOfYear(today);
    to = today;
  }
  if (period === 'Personalizado') {
    from = start;
    to = end;
  }
  return { start: startOfDay(from).toISOString(), end: endOfDay(to).toISOString() };
}
