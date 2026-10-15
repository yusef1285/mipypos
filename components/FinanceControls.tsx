import { Button, Chip, Input, Label, TextField, Typography, Skeleton } from 'heroui-native';
import * as Haptics from 'expo-haptics';
import { View } from 'react-native';
import DateInput from '@/components/DateInput';
import { PERIODS, type Period } from '@/lib/finance-periods';
export function FinanceField({
  label,
  value,
  onChange,
  decimal = false,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimal?: boolean;
  secret?: boolean;
}) {
  return (
    <TextField>
      <Label>{label}</Label>
      <Input
        value={value}
        onChangeText={onChange}
        secureTextEntry={secret}
        autoCapitalize="none"
        keyboardType={decimal ? 'decimal-pad' : 'default'}
      />
    </TextField>
  );
}
export function Choice<T extends string>({
  values,
  value,
  onChange,
}: {
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {values.map((item) => (
        <Chip
          key={item}
          variant={item === value ? 'primary' : 'soft'}
          onPress={() => {
            if (item !== value) {
              void Haptics.selectionAsync();
              onChange(item);
            }
          }}
        >
          <Chip.Label numberOfLines={1}>{item || 'Sin categoría'}</Chip.Label>
        </Chip>
      ))}
    </View>
  );
}
export function PeriodSelector({
  period,
  onPeriod,
  start,
  end,
  onStart,
  onEnd,
}: {
  period: Period;
  onPeriod: (period: Period) => void;
  start: Date;
  end: Date;
  onStart: (date: Date) => void;
  onEnd: (date: Date) => void;
}) {
  return (
    <View className="gap-3">
      <Choice values={PERIODS} value={period} onChange={onPeriod} />
      {period === 'Personalizado' ? (
        <View className="gap-3">
          <DateInput label="Desde" value={start} onChange={onStart} />
          <DateInput label="Hasta" value={end} onChange={onEnd} />
        </View>
      ) : null}
    </View>
  );
}
export function FinanceStatus({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (loading)
    return (
      <View className="gap-3">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </View>
    );
  return error ? (
    <View className="gap-3">
      <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph>
      <Button variant="secondary" onPress={retry}>
        <Button.Label>Reintentar</Button.Label>
      </Button>
    </View>
  ) : null;
}
export const numeric = (value: string) => Number(value.replace(',', '.'));
export function financeFailure(failure: unknown) {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  return failure instanceof Error
    ? failure.message
    : 'No se pudo completar la operación. Vuelve a intentarlo.';
}
