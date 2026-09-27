import { Button, Card, Checkbox, Input, Label, TextField, Typography } from 'heroui-native';
import { LockKeyhole, Store } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';

export default function LoginScreen() {
  const { login, rememberedUsername } = useApp();
  const [username, setUsername] = useState(rememberedUsername);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(rememberedUsername));
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setUsername(rememberedUsername), 0);
    return () => clearTimeout(timer);
  }, [rememberedUsername]);
  const submit = async () => {
    try {
      setLoading(true);
      await login(username, password, remember);
    } catch (error) {
      Alert.alert(
        'No se pudo iniciar sesión',
        error instanceof Error ? error.message : 'Intenta de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <Screen keyboard>
      <View className="web:mx-auto web:w-full web:max-w-md min-h-[80vh] justify-center">
        <View className="mb-8 items-center gap-3">
          <View className="bg-accent rounded-3xl p-4">
            <Store color="white" size={34} />
          </View>
          <Typography.Heading type="h1">MipyPOS</Typography.Heading>
          <Typography.Paragraph color="muted">Punto de venta offline</Typography.Paragraph>
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
          <Checkbox isSelected={remember} onSelectedChange={setRemember}>
            <Checkbox.Indicator />
            <Typography.Paragraph>Recordar usuario</Typography.Paragraph>
          </Checkbox>
          <Button
            size="lg"
            isDisabled={!username || !password || loading}
            onPress={() => void submit()}
          >
            <LockKeyhole color="white" size={18} />
            <Button.Label>{loading ? 'Ingresando…' : 'Iniciar sesión'}</Button.Label>
          </Button>
          <Typography.Paragraph type="body-sm" color="muted" align="center">
            Primer acceso: admin / admin123
          </Typography.Paragraph>
        </Card>
      </View>
    </Screen>
  );
}
