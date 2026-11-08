import { Button, Card, Checkbox, Input, Label, TextField, Typography } from 'heroui-native';
import { LockKeyhole } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { LanConnection } from '@/components/LanConnection';
import { BrandMark } from '@/components/BrandMark';
import { Screen } from '@/components/Screen';
import { PasswordChangeRequired, useApp } from '@/lib/app-context';

export default function LoginScreen() {
  const { login, rememberedUsername } = useApp();
  const [username, setUsername] = useState(rememberedUsername);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(rememberedUsername));
  const [loading, setLoading] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setUsername(rememberedUsername), 0);
    return () => clearTimeout(timer);
  }, [rememberedUsername]);
  const submit = async () => {
    try {
      setLoading(true);
      if (mustChange && newPassword !== confirmation)
        throw new Error('La confirmación no coincide con la nueva contraseña.');
      await login(username, password, remember, mustChange ? newPassword : undefined);
    } catch (error) {
      if (error instanceof PasswordChangeRequired) {
        setMustChange(true);
        return;
      }
      Alert.alert(
        'No se pudo iniciar sesión',
        error instanceof Error ? error.message : 'Intenta de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <Screen keyboard safeTop>
      <View className="web:mx-auto web:w-full web:max-w-md min-h-[80vh] justify-center">
        <View className="mb-8 items-center gap-3">
          <BrandMark size={66} />
          <Typography.Heading type="h1">MipyPOS</Typography.Heading>
          <Typography.Paragraph color="muted">Punto de venta en red local</Typography.Paragraph>
        </View>
        <Card className="gap-5 p-5">
          <TextField>
            <Label>Usuario</Label>
            <Input
              autoCapitalize="none"
              value={username}
              onChangeText={setUsername}
              placeholder="Ingresa tu usuario"
            />
          </TextField>
          <TextField>
            <Label>Contraseña</Label>
            <Input
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="Ingresa tu contraseña"
              onSubmitEditing={() => void submit()}
            />
          </TextField>
          {mustChange ? (
            <View className="gap-4">
              <Typography.Paragraph type="body-sm" className="text-warning">
                Es tu primer acceso: crea una contraseña propia de al menos 8 caracteres. La
                contraseña inicial deja de funcionar.
              </Typography.Paragraph>
              <TextField>
                <Label>Nueva contraseña</Label>
                <Input
                  secureTextEntry
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Mínimo 8 caracteres"
                />
              </TextField>
              <TextField>
                <Label>Confirmar contraseña</Label>
                <Input
                  secureTextEntry
                  value={confirmation}
                  onChangeText={setConfirmation}
                  placeholder="Repite la nueva contraseña"
                  onSubmitEditing={() => void submit()}
                />
              </TextField>
            </View>
          ) : null}
          <View className="flex-row items-center gap-3">
            <Checkbox
              accessibilityLabel="Recordar usuario"
              isSelected={remember}
              onSelectedChange={setRemember}
            >
              <Checkbox.Indicator />
            </Checkbox>
            <Typography.Paragraph className="flex-1">Recordar usuario</Typography.Paragraph>
          </View>
          <Button
            size="lg"
            isDisabled={!username || !password || loading || (mustChange && !newPassword)}
            onPress={() => void submit()}
          >
            <LockKeyhole color="white" size={18} />
            <Button.Label>
              {loading ? 'Ingresando…' : mustChange ? 'Guardar y entrar' : 'Iniciar sesión'}
            </Button.Label>
          </Button>
          <Typography.Paragraph type="body-sm" color="muted" align="center">
            Primer acceso: admin / admin123
          </Typography.Paragraph>
        </Card>
        <View className="mt-5">
          <LanConnection />
        </View>
      </View>
    </Screen>
  );
}
