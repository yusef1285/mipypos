import { Button } from 'heroui-native';
import { View } from 'react-native';

import DateInput from '@/components/DateInput';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (value: string) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

// Calendar picker that keeps the AAAA-MM-DD strings the business commands expect.
export function IsoDateField({
  label,
  value,
  onChange,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  if (optional && !value)
    return (
      <Button variant="secondary" onPress={() => onChange(iso(new Date()))}>
        <Button.Label>{label}: sin fecha (elegir)</Button.Label>
      </Button>
    );
  return (
    <View className="gap-2">
      <DateInput label={label} value={parse(value)} onChange={(date) => onChange(iso(date))} />
      {optional ? (
        <Button size="sm" variant="ghost" onPress={() => onChange('')}>
          <Button.Label>Quitar fecha</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}
