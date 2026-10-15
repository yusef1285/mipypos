import { Typography, useThemeColor } from 'heroui-native';
import { View } from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import type { FinanceGroup } from '@/lib/finance-models';
import { money } from '@/lib/format';
export function FinanceChart({
  rows,
  field,
  label,
}: {
  rows: FinanceGroup[];
  field: 'net' | 'profit' | 'margin';
  label: string;
}) {
  const [accent, muted, border] = useThemeColor(['accent', 'muted', 'border']);
  const values = rows.map((row) => row[field]);
  const valid = values.filter((v): v is number => v !== null);
  const min = Math.min(0, ...valid);
  const max = Math.max(1, ...valid);
  const y = (v: number) => 100 - ((v - min) / (max - min)) * 80;
  const x = (i: number) => 12 + (i * 276) / Math.max(rows.length - 1, 1);
  const segments: string[] = [];
  let points: string[] = [];
  values.forEach((value, i) => {
    if (value === null) {
      if (points.length) segments.push(points.join(' '));
      points = [];
    } else points.push(`${x(i)},${y(value)}`);
  });
  if (points.length) segments.push(points.join(' '));
  return (
    <View className="gap-2">
      <Typography.Heading type="h4">{label}</Typography.Heading>
      {valid.length ? (
        <>
          <Typography.Paragraph color="muted" type="body-sm">
            {field === 'margin'
              ? `${min.toFixed(1)} % a ${Math.max(...valid).toFixed(1)} %`
              : `${money(min)} a ${money(Math.max(...valid))}`}
          </Typography.Paragraph>
          <Svg
            width="100%"
            height={120}
            viewBox="0 0 300 120"
            accessibilityLabel={label}
            accessible
          >
            <Line x1={12} x2={288} y1={y(0)} y2={y(0)} stroke={border} />
            {segments.map((segment) => (
              <Polyline
                key={segment}
                points={
                  segment.split(' ').length === 1
                    ? `${segment} ${Number(segment.split(',')[0]) + 2},${segment.split(',')[1]}`
                    : segment
                }
                stroke={accent}
                fill="none"
                strokeWidth={2}
              />
            ))}
          </Svg>
          <View className="flex-row justify-between">
            <Typography.Paragraph type="body-sm" style={{ color: muted }}>
              {rows[0]?.key}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm" style={{ color: muted }}>
              {rows[rows.length - 1]?.key}
            </Typography.Paragraph>
          </View>
        </>
      ) : (
        <Typography.Paragraph color="muted">
          Sin datos con costo conocido en este período.
        </Typography.Paragraph>
      )}
    </View>
  );
}
