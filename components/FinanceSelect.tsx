import { Button, Dialog, Label } from 'heroui-native';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, View, useWindowDimensions } from 'react-native';
import { FinanceField } from '@/components/FinanceControls';
import { EmptyState } from '@/components/pos-ui';
export function FinanceSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { height } = useWindowDimensions();
  return (
    <Dialog isOpen={open} onOpenChange={setOpen}>
      <View className="gap-2">
        <Label>{label}</Label>
        <Button
          variant="secondary"
          onPress={() => {
            setSearch('');
            setOpen(true);
          }}
        >
          <Button.Label numberOfLines={1}>
            {options.find((o) => o.value === value)?.label ?? 'Seleccionar'}
          </Button.Label>
        </Button>
      </View>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="gap-3"
          >
            <Dialog.Title>{label}</Dialog.Title>
            <FinanceField label="Buscar" value={search} onChange={setSearch} />
            <FlatList
              style={{ height: Math.max(120, Math.min(360, height - 340)) }}
              data={options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: o }) => (
                <Button
                  className="my-1"
                  variant={value === o.value ? 'primary' : 'ghost'}
                  onPress={() => {
                    if (value !== o.value) void Haptics.selectionAsync();
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Button.Label numberOfLines={2}>{o.label}</Button.Label>
                </Button>
              )}
              ListEmptyComponent={
                <EmptyState
                  title="No hay resultados"
                  action={
                    <Button variant="secondary" onPress={() => setSearch('')}>
                      <Button.Label>Limpiar búsqueda</Button.Label>
                    </Button>
                  }
                />
              }
            />
            <Button variant="secondary" onPress={() => setOpen(false)}>
              <Button.Label>Cerrar</Button.Label>
            </Button>
          </KeyboardAvoidingView>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
