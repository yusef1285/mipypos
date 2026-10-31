import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  TextField,
  Typography,
  useThemeColor,
} from 'heroui-native';
import { BadgeCheck, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { LanConnection } from '@/components/LanConnection';
import { RecoveryBackupControls } from '@/components/RecoveryBackupControls';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { getDeviceInfo, validateLicenseKey } from '@/lib/license';

interface DeviceInfo {
  id: string;
  brand: string;
  model: string;
  os: string;
  version: string;
}
export default function Settings() {
  const { user, licenseMode, setLicense, logout } = useApp();
  const [license, setLicenseKey] = useState('');
  const [device, setDevice] = useState<DeviceInfo>();
  const [saving, setSaving] = useState(false);
  const accent = useThemeColor('accent');
  useEffect(() => {
    void getDeviceInfo().then(setDevice);
  }, []);
  if (!user) return null;
  const activate = async () => {
    try {
      setSaving(true);
      if (!(await validateLicenseKey(license)))
        throw new Error('La licencia no es válida para este dispositivo.');
      await setLicense('pro', license);
      setLicenseKey('');
      Alert.alert('Licencia activada', 'MipyPOS Pro está activo en este dispositivo.');
    } catch (error) {
      Alert.alert(
        'No se pudo activar',
        error instanceof Error ? error.message : 'Licencia inválida.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Screen title="Configuración" keyboard>
      <Card className="flex-row items-center gap-4 p-4">
        <View className="bg-accent-soft rounded-xl p-3">
          {licenseMode === 'pro' ? (
            <BadgeCheck color={accent} size={27} />
          ) : (
            <ShieldCheck color={accent} size={27} />
          )}
        </View>
        <View className="flex-1">
          <Typography.Paragraph className="font-semibold">
            MipyPOS {licenseMode === 'pro' ? 'Pro' : 'Demo'}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm" color="muted">
            {licenseMode === 'pro'
              ? 'Todas las funciones activas'
              : 'Máximo 5 ventas y 5 productos en total. Sin impresión ni XLSX.'}
          </Typography.Paragraph>
        </View>
        <Chip color={licenseMode === 'pro' ? 'success' : 'warning'} variant="soft">
          {licenseMode}
        </Chip>
      </Card>
      {licenseMode === 'demo' ? (
        <Card className="gap-4 p-4">
          <TextField>
            <Label>Licencia Pro</Label>
            <Input
              autoCapitalize="characters"
              value={license}
              onChangeText={setLicenseKey}
              placeholder="MP-XXXXXX-XXXXXX-XXXXXX"
            />
          </TextField>
          <Button isDisabled={!license || saving} onPress={() => void activate()}>
            <Button.Label>Activar en este dispositivo</Button.Label>
          </Button>
        </Card>
      ) : (
        <Card className="bg-success-soft p-4">
          <Typography.Paragraph className="text-success">
            Licencia validada para este dispositivo. El modo Pro permanece protegido.
          </Typography.Paragraph>
        </Card>
      )}
      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-2">
          <MonitorSmartphone color={accent} size={20} />
          <Typography.Heading type="h4">Dispositivo</Typography.Heading>
        </View>
        <Row label="Modelo" value={`${device?.brand ?? ''} ${device?.model ?? ''}`} />
        <Row label="Sistema" value={device?.os ?? ''} />
        <Row label="Identificador" value={device?.id ?? ''} />
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
