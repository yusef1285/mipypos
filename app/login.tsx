import { Button, Card, Checkbox, Input, Label, TextField, Typography } from 'heroui-native';
import { LockKeyhole } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useUniwind } from 'uniwind';

import { LanConnection } from '@/components/LanConnection';
import { BrandMark } from '@/components/BrandMark';
import { Screen } from '@/components/Screen';
import { AnimatedView } from '@/components/ui/primitives/AnimatedView';
import { LinearGradient } from '@/components/ui/primitives/LinearGradient';
import { PasswordChangeRequired, useApp } from '@/lib/app-context';

const LOGIN_GRADIENT = {
  light: ['#CCEFEB', '#E3F7F3', '#FAFEFD'],
  dark: ['#0C332E', '#0D2422', '#0F1A19'],
} as const;

export default function LoginScreen() {
  const { login, rememberedUsername } = useApp();
  const { theme } = useUniwind();
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
    <Screen keyboard safeTop scroll={false}>
      <View className="flex-1">
        <LinearGradient
          colors={LOGIN_GRADIENT[theme === 'dark' ? 'dark' : 'light']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.35, y: 1 }}
          className="absolute inset-0"
        />
        <View className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-accent opacity-[0.1]" />
        <View className="absolute -left-28 top-1/3 h-64 w-64 rounded-full bg-accent opacity-[0.08]" />
        <View className="absolute -bottom-24 right-4 h-56 w-56 rounded-full bg-success opacity-[0.07]" />
        <ScrollView
          className="flex-1"
          contentContainerClassName="web:mx-auto web:w-full web:max-w-md grow justify-center gap-5 px-4 py-8"
          keyboardShouldPersistTaps="handled"
        >
          <AnimatedView
            entering={FadeInDown.springify().damping(15)}
            className="items-center gap-3"
          >
            <BrandMark size={66} />
            <Typography.Heading type="h1">MipyPOS</Typography.Heading>
            <Typography.Paragraph color="muted">Punto de venta en red local</Typography.Paragraph>
          </AnimatedView>
          <AnimatedView entering={FadeInUp.springify().delay(150)}>
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
                <LockKeyhole color="white" size={18} />
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
