import {
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  TextField,
  Typography,
  useThemeColor,
} from 'heroui-native';
import { LockKeyhole } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { LanConnection } from '@/components/LanConnection';
import { PosterBackdrop, PosterBrand } from '@/components/PosterChrome';
import { Screen } from '@/components/Screen';
import { AnimatedView } from '@/components/ui/primitives/AnimatedView';
import { PasswordChangeRequired, useApp } from '@/lib/app-context';
import { poster } from '@/lib/branding';

export default function LoginScreen() {
  const { login, rememberedUsername } = useApp();
  const buttonForeground = useThemeColor('accent-foreground');
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
    <Screen keyboard safeTop scroll={false} branded>
      <View className="flex-1 overflow-hidden">
        <PosterBackdrop variant="full" />
        <ScrollView
          className="flex-1"
          contentContainerClassName="web:mx-auto web:w-full web:max-w-md grow justify-center gap-4 px-4 py-7"
          keyboardShouldPersistTaps="handled"
        >
          <AnimatedView
            entering={FadeInDown.springify().damping(15)}
            className="items-center gap-2 pb-2"
          >
            <PosterBrand large />
            <Typography.Paragraph style={{ color: poster.white, fontWeight: '700' }}>
              Tu negocio en tus manos
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm" style={{ color: poster.muted }}>
              Punto de venta en red local
            </Typography.Paragraph>
          </AnimatedView>
          <AnimatedView entering={FadeInUp.springify().delay(150)}>
            <Card className="gap-5 p-5">
              <Typography.Heading type="h3">Acceso a MipyPOS</Typography.Heading>
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
                <AnimatedView entering={FadeInDown.springify()} className="gap-4">
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
                </AnimatedView>
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
                <LockKeyhole color={buttonForeground} size={18} />
                <Button.Label>
                  {loading ? 'Ingresando…' : mustChange ? 'Guardar y entrar' : 'Iniciar sesión'}
                </Button.Label>
              </Button>
              <Typography.Paragraph type="body-sm" color="muted" align="center">
                Primer acceso: admin / admin123
              </Typography.Paragraph>
            </Card>
          </AnimatedView>
          <AnimatedView entering={FadeInUp.springify().delay(300)}>
            <LanConnection />
          </AnimatedView>
        </ScrollView>
      </View>
    </Screen>
  );
}
