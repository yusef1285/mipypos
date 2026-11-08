import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
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
import { BadgeCheck, Copy, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { useApp } from '@/lib/app-context';
import { getDeviceCode } from '@/lib/license';
import { planLabel, type LicenseStatus } from '@/lib/license-token';

const date = (value: string) =>
  new Date(value).toLocaleDateString('es-CU', { day: '2-digit', month: 'short', year: 'numeric' });

function describe(status: LicenseStatus) {
  switch (status.state) {
    case 'active':
      return {
        title: `Licencia ${planLabel[status.payload.plan].toLowerCase()} activa`,
        detail: `Vence el ${date(status.payload.exp)} (${status.daysLeft} ${status.daysLeft === 1 ? 'día' : 'días'}).`,
        tone: status.expiringSoon ? 'text-warning' : 'text-success',
      };
    case 'expired':
      return {
        title: 'Licencia vencida',
        detail: `Venció el ${date(status.payload.exp)}. Tus datos se conservan; activa una licencia nueva para seguir vendiendo sin límites.`,
        tone: 'text-danger',
      };
    case 'clock':
      return { title: 'Fecha del teléfono incorrecta', detail: status.reason, tone: 'text-danger' };
    case 'invalid':
      return { title: 'Licencia no válida', detail: status.reason, tone: 'text-danger' };
    default:
      return {
        title: 'MipyPOS Demo',
        detail: 'Máximo 5 ventas y 5 productos en total. Sin impresión ni XLSX.',
        tone: 'text-warning',
      };
  }
}

export function LicensePanel() {
  const { user, license, licenseMode, networkConfig, setLicense } = useApp();
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const accent = useThemeColor('accent');
  useEffect(() => {
    void getDeviceCode().then(setCode);
  }, []);
  if (!user) return null;
  const admin = user.role === 'admin';
  const client = networkConfig.mode === 'client';
  const info = client
    ? {
        title: `MipyPOS ${licenseMode === 'pro' ? 'Pro' : 'Demo'}`,
        detail: 'Este terminal usa la licencia del administrador al que está conectado.',
        tone: licenseMode === 'pro' ? 'text-success' : 'text-warning',
      }
    : describe(license);
  const activate = async () => {
    setSaving(true);
    try {
      const status = await setLicense(token);
      setToken('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (status.state === 'active')
        Alert.alert(
          'Licencia activada',
          `MipyPOS Pro activo hasta el ${date(status.payload.exp)}.`,
        );
    } catch (failure) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'No se pudo activar',
        failure instanceof Error ? failure.message : 'Licencia inválida.',
      );
    } finally {
      setSaving(false);
    }
  };
  const remove = () =>
    Alert.alert('Quitar licencia', 'El dispositivo volverá al modo demo. Tus datos se conservan.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: () => void setLicense(null),
      },
    ]);
  return (
    <>
      <Card className="flex-row items-center gap-4 p-4">
        <View className="bg-accent-soft rounded-xl p-3">
          {licenseMode === 'pro' ? (
            <BadgeCheck color={accent} size={27} />
          ) : (
            <ShieldCheck color={accent} size={27} />
          )}
        </View>
        <View className="flex-1">
          <Typography.Paragraph className="font-semibold">{info.title}</Typography.Paragraph>
          <Typography.Paragraph type="body-sm" className={info.tone}>
            {info.detail}
          </Typography.Paragraph>
          {!client && license.state === 'active' && license.payload.customer ? (
            <Typography.Paragraph type="body-sm" color="muted">
              A nombre de {license.payload.customer}
            </Typography.Paragraph>
          ) : null}
        </View>
        <Chip color={licenseMode === 'pro' ? 'success' : 'warning'} variant="soft">
          {licenseMode === 'pro' ? 'Pro' : 'Demo'}
        </Chip>
      </Card>
      {!client ? (
        <Card className="gap-3 p-4">
          <Typography.Paragraph type="body-sm" color="muted">
            Código de este dispositivo (envíalo para recibir una licencia exclusiva):
          </Typography.Paragraph>
          <View className="flex-row items-center justify-between gap-2">
            <Typography.Heading type="h4" selectable>
              {code}
            </Typography.Heading>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!code}
              onPress={() =>
                void Clipboard.setStringAsync(code).then(() =>
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
                )
              }
            >
              <Copy color={accent} size={16} />
              <Button.Label>Copiar</Button.Label>
            </Button>
          </View>
          {admin ? (
            <>
              <TextField>
                <Label>{licenseMode === 'pro' ? 'Renovar o cambiar licencia' : 'Licencia'}</Label>
                <Input
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  numberOfLines={4}
                  value={token}
                  onChangeText={setToken}
                  placeholder="MIPY1.…"
                />
              </TextField>
              <View className="flex-row gap-2">
                <Button
                  className="flex-1"
                  variant="secondary"
                  onPress={() =>
                    void Clipboard.getStringAsync().then((text) => setToken(text.trim()))
                  }
                >
                  <Button.Label>Pegar</Button.Label>
                </Button>
                <Button
                  className="flex-1"
                  isDisabled={!token.trim() || saving}
                  onPress={() => void activate()}
                >
                  <Button.Label>Activar</Button.Label>
                </Button>
              </View>
              {license.state !== 'none' ? (
                <Button size="sm" variant="ghost" onPress={remove}>
                  <Button.Label className="text-danger">Quitar licencia</Button.Label>
                </Button>
              ) : null}
            </>
          ) : (
            <Typography.Paragraph type="body-sm" color="muted">
              Solo un administrador puede activar o renovar la licencia.
            </Typography.Paragraph>
          )}
        </Card>
      ) : null}
    </>
  );
}
