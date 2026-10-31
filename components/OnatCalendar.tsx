import { Button, Card, Typography, useThemeColor } from 'heroui-native';
import { useState } from 'react';
import { View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { fiscalStatus } from '@/lib/onat-engine';
import type { Obligation } from '@/lib/onat-models';

export function OnatCalendar({
  month,
  obligations,
}: {
  month: string;
  obligations: Array<{ id: string; value: Obligation; paid: number; declared: boolean }>;
}) {
  const [selected, setSelected] = useState('');
  const [accent] = useThemeColor(['accent']);
  const year = Number(month.slice(0, 4)),
    m = Number(month.slice(5, 7));
  const days = new Date(year, m, 0).getDate();
  const offset = (new Date(year, m - 1, 1).getDay() + 6) % 7;
  const rows = Array.from({ length: Math.ceil((days + offset) / 7) }, (_, row) =>
    Array.from({ length: 7 }, (_, col) => row * 7 + col - offset + 1),
  );
  const fulfilled = (o: (typeof obligations)[number]) =>
    o.value.name === 'Declaración jurada' ? o.declared : o.paid >= o.value.calculation.tax;
  const color = (status: string) =>
    status === 'Cumplida'
      ? 'bg-success-soft text-success'
      : status === 'Vencida'
        ? 'bg-danger-soft text-danger'
        : status === 'Próxima'
          ? 'bg-warning-soft text-warning'
          : 'bg-default text-muted';
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <CalendarDays color={accent} size={20} />
        <Typography.Heading type="h4">Calendario · {month}</Typography.Heading>
      </View>
      <View className="flex-row">
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => (
          <View key={d} className="flex-1 items-center">
            <Typography.Paragraph type="body-sm">{d}</Typography.Paragraph>
          </View>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={i} className="flex-row gap-1">
          {row.map((day, j) => {
            if (day < 1 || day > days) return <View key={j} className="h-10 flex-1" />;
            const date = `${month}-${String(day).padStart(2, '0')}`;
            const items = obligations.filter((o) => o.value.due === date);
            const state = items.some((o) => fiscalStatus(date, fulfilled(o)) === 'Vencida')
              ? 'Vencida'
              : items.some((o) => fiscalStatus(date, fulfilled(o)) === 'Próxima')
                ? 'Próxima'
                : items.length && items.every(fulfilled)
                  ? 'Cumplida'
                  : 'Futura';
            return (
              <Button
                key={j}
                size="sm"
                variant="ghost"
                className={`h-10 min-w-0 flex-1 px-0 ${color(state)}`}
                onPress={() => setSelected(date)}
                accessibilityLabel={`${date}: ${items.length} obligaciones`}
              >
                <Button.Label>
                  {day}
                  {items.length ? ' ·' : ''}
                </Button.Label>
              </Button>
            );
          })}
        </View>
      ))}
      <Typography.Paragraph type="body-sm" color="muted">
        Verde: cumplida · amarillo: próxima · rojo: vencida · gris: futura o sin obligación.
      </Typography.Paragraph>
      {selected ? (
        <View className="gap-2">
          <Typography.Paragraph>{selected}</Typography.Paragraph>
          {obligations.filter((o) => o.value.due === selected).length ? (
            obligations
              .filter((o) => o.value.due === selected)
              .map((o) => (
                <Typography.Paragraph key={o.id}>
                  {o.value.name} · {fiscalStatus(o.value.due, fulfilled(o))}
                </Typography.Paragraph>
              ))
          ) : (
            <Typography.Paragraph color="muted">
              Sin obligaciones para este día.
            </Typography.Paragraph>
          )}
        </View>
      ) : null}
    </Card>
  );
}
