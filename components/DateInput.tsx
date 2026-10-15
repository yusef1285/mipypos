import DateTimePicker from '@react-native-community/datetimepicker';
import { Button } from 'heroui-native';
import { useState } from 'react';
import { Platform, View } from 'react-native';
export interface DateInputProps {
  value: Date;
  onChange: (date: Date) => void;
  label: string;
}
export default function DateInput({ value, onChange, label }: DateInputProps) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2">
      <Button variant="secondary" onPress={() => setOpen(!open)}>
        <Button.Label>
          {label}: {value.toLocaleDateString('es-CU')}
        </Button.Label>
      </Button>
      {open ? (
        <DateTimePicker
          value={value}
          mode="date"
          onChange={(event, date) => {
            if (Platform.OS !== 'ios') setOpen(false);
            if (event.type !== 'dismissed' && date) onChange(date);
          }}
        />
      ) : null}
    </View>
  );
}
