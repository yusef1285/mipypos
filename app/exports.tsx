import { Button, Card, Chip, Typography, useThemeColor } from 'heroui-native';
import { Banknote, Boxes, FileDown, PackageCheck, Repeat2, ShoppingBag } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import { exportRows, type ExportFormat } from '@/lib/exports';
import { canAccess } from '@/lib/permissions';

const exports = [
  { type: 'sales' as const, label: 'Ventas del día', icon: ShoppingBag },
  { type: 'movements' as const, label: 'Movimientos del día', icon: Repeat2 },
  { type: 'inventory' as const, label: 'Inventario', icon: Boxes },
  { type: 'sold' as const, label: 'Productos vendidos', icon: PackageCheck },
  { type: 'cash' as const, label: 'Cierres de caja', icon: Banknote },
];
export default function Exports() {
  const { user, licenseMode } = useApp();
  const { getExportRows } = usePosRepository();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [loading, setLoading] = useState('');
  const accent = useThemeColor('accent');
  if (!user || !canAccess(user.role, 'exports')) return <AccessDenied />;
  const run = async (type: (typeof exports)[number]['type'], label: string) => {
    try {
      setLoading(type);
      const rows = await getExportRows(type);
      await exportRows(label.toLowerCase().replaceAll(' ', '-'), rows, format, licenseMode);
    } catch (error) {
      Alert.alert(
        'No se pudo exportar',
        error instanceof Error ? error.message : 'Error de exportación.',
      );
    } finally {
      setLoading('');
    }
  };
  return (
    <Screen title="Exportaciones">
      <View className="flex-row gap-2">
        {(['csv', 'xlsx', 'txt'] as ExportFormat[]).map((value) => (
          <Chip
            key={value}
            variant={format === value ? 'primary' : 'soft'}
            disabled={value === 'xlsx' && licenseMode !== 'pro'}
            onPress={() => setFormat(value)}
          >
            {value.toUpperCase()}
          </Chip>
        ))}
      </View>
      {licenseMode === 'demo' ? (
        <Card className="bg-warning-soft p-4">
          <Typography.Paragraph className="text-warning">
            XLSX está disponible con licencia Pro.
          </Typography.Paragraph>
        </Card>
      ) : null}
      {exports.map((item) => (
        <Card key={item.type} className="flex-row items-center gap-4 p-4">
          <View className="bg-accent-soft rounded-xl p-3">
            <item.icon color={accent} size={22} />
          </View>
          <Typography.Paragraph className="flex-1 font-semibold">{item.label}</Typography.Paragraph>
          <Button
            isIconOnly
            variant="secondary"
            isDisabled={Boolean(loading)}
            onPress={() => void run(item.type, item.label)}
          >
            <FileDown color={accent} size={19} />
          </Button>
        </Card>
      ))}
    </Screen>
  );
}
