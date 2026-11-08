import { Button, Card, Chip, Typography } from 'heroui-native';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import {
  listPairedPrinters,
  loadPrinter,
  printTestPage,
  printerSupported,
  savePrinter,
  type PrinterConfig,
} from '@/lib/bt-printer';

// Pick a paired ESC/POS printer (58 mm = 32 columns, 80 mm = 48 columns) and print a test page.
export function PrinterPanel() {
  const [config, setConfig] = useState<PrinterConfig | null>(null);
  const [paired, setPaired] = useState<{ name: string; address: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadPrinter().then(setConfig);
  }, []);
  if (!printerSupported()) return null;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (failure) {
      Alert.alert(
        'Impresora',
        failure instanceof Error ? failure.message : 'No se pudo completar.',
      );
    } finally {
      setBusy(false);
    }
  };
  const choose = async (next: PrinterConfig | null) => {
    setConfig(next);
    await savePrinter(next);
  };
  return (
    <Card className="gap-3 p-4">
      <Typography.Heading type="h4">Impresora Bluetooth</Typography.Heading>
      <Typography.Paragraph type="body-sm" color="muted">
        {config
          ? `Usando ${config.name} (${config.columns === 32 ? '58 mm' : '80 mm'}).`
          : 'Empareja la impresora térmica en los ajustes de Bluetooth del teléfono y búscala aquí.'}
      </Typography.Paragraph>
      <Button
        variant="secondary"
        isDisabled={busy}
        onPress={() => void run(async () => setPaired(await listPairedPrinters()))}
      >
        <Button.Label>{busy ? 'Buscando…' : 'Buscar impresoras emparejadas'}</Button.Label>
      </Button>
      <View className="flex-row flex-wrap gap-2">
        {paired.map((device) => (
          <Chip
            key={device.address}
            variant={config?.address === device.address ? 'primary' : 'soft'}
            onPress={() => void choose({ ...device, columns: config?.columns ?? 32 })}
          >
            <Chip.Label>{device.name}</Chip.Label>
          </Chip>
        ))}
      </View>
      {config ? (
        <>
          <View className="flex-row gap-2">
            {([32, 48] as const).map((columns) => (
              <Chip
                key={columns}
                variant={config.columns === columns ? 'primary' : 'soft'}
                onPress={() => void choose({ ...config, columns })}
              >
                <Chip.Label>{columns === 32 ? 'Papel 58 mm' : 'Papel 80 mm'}</Chip.Label>
              </Chip>
            ))}
          </View>
          <Button isDisabled={busy} onPress={() => void run(() => printTestPage(config))}>
            <Button.Label>Imprimir prueba</Button.Label>
          </Button>
          <Button variant="ghost" onPress={() => void choose(null)}>
            <Button.Label>Olvidar impresora</Button.Label>
          </Button>
        </>
      ) : null}
    </Card>
  );
}
