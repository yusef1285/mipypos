import { Label, TextField } from 'heroui-native';
import { useThemeColor } from 'heroui-native';
import type { DateInputProps } from './DateInput';
export default function DateInput({ value, onChange, label }: DateInputProps) {
  const [foreground, background, border] = useThemeColor(['foreground', 'background', 'border']);
  const date = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return (
    <TextField>
      <Label>{label}</Label>
      <input
        aria-label={label}
        type="date"
        value={date}
        onChange={(event) => {
          if (event.target.value) onChange(new Date(`${event.target.value}T12:00:00`));
        }}
        style={{
          color: foreground,
          background,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: 12,
          fontSize: 16,
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </TextField>
  );
}
