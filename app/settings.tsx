import { Button, Card, Typography, useThemeColor } from 'heroui-native';
import { LogOut, MonitorSmartphone } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { LanConnection } from '@/components/LanConnection';
import { RecoveryBackupControls } from '@/components/RecoveryBackupControls';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { LicensePanel } from '@/components/LicensePanel';
import { getDeviceInfo } from '@/lib/license';

interface DeviceInfo {
  id: string;
  code: string;
  brand: string;
  model: string;
  os: string;
  version: string;
}
export default function Settings() {
  const { user, logout } = useApp();
  const [device, setDevice] = useState<DeviceInfo>();
  const accent = useThemeColor('accent');
  useEffect(() => {
    void getDeviceInfo().then(setDevice);
  }, []);
  if (!user) return null;
  return (
    <Screen title="Configuración" keyboard>
      <LicensePanel />
      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-2">
          <MonitorSmartphone color={accent} size={20} />
          <Typography.Heading type="h4">Dispositivo</Typography.Heading>
        </View>
        <Row label="Modelo" value={`${device?.brand ?? ''} ${device?.model ?? ''}`} />
        <Row label="Sistema" value={device?.os ?? ''} />
        <Row label="Código" value={device?.code ?? ''} />
        <Row label="Versión" value={device?.version ?? '1.0.0'} />
      </Card>
      <RecoveryBackupControls />
      <LanConnection allowHost />
      <Button variant="danger-soft" size="lg" onPress={logout}>
        <LogOut className="text-danger" size={19} />
        <Button.Label>Cerrar sesión</Button.Label>
      </Button>
    </Screen>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="border-border flex-row justify-between gap-4 border-b py-2">
      <Typography.Paragraph color="muted">{label}</Typography.Paragraph>
      <Typography.Paragraph className="flex-1 text-right" numberOfLines={1}>
        {value}
      </Typography.Paragraph>
    </View>
  );
}
