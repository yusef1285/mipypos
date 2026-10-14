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
import { Pencil, Plus, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { EmptyState } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import type { Usuario, UserRole } from '@/lib/models';
import { canAccess } from '@/lib/permissions';

const roles: UserRole[] = ['admin', 'supervisor', 'seller', 'storekeeper', 'auditor'];
export default function Users() {
  const { user } = useApp();
  const { deleteUser, listUsers, saveUser } = usePosRepository();
  const [rows, setRows] = useState<Usuario[]>([]);
  const [editing, setEditing] = useState<number>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('seller');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accent, danger] = useThemeColor(['accent', 'danger']);
  const load = useCallback(async () => {
    if (!user || !canAccess(user.role, 'users')) return;
    try {
      setRows(await listUsers());
    } catch (failure) {
      Alert.alert(
        'No se pudieron cargar los usuarios',
        failure instanceof Error ? failure.message : 'Vuelve a intentarlo.',
      );
    }
  }, [listUsers, user]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  if (!user || !canAccess(user.role, 'users')) return <AccessDenied />;
  const start = (row?: Usuario) => {
    setEditing(row?.id);
    setUsername(row?.username ?? '');
    setPassword('');
    setRole(row?.role ?? 'seller');
    setShow(true);
  };
  const save = async () => {
    try {
      setSaving(true);
      await saveUser({ id: editing, username, password: password || undefined, role });
      setShow(false);
      await load();
    } catch (error) {
      Alert.alert(
        'No se pudo guardar',
        error instanceof Error ? error.message : 'Revisa los datos.',
      );
    } finally {
      setSaving(false);
    }
  };
  const remove = (id: number) =>
    Alert.alert('Eliminar usuario', 'Se revocará su acceso al dispositivo.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            try {
              await deleteUser(id, user.id);
              await load();
            } catch (error) {
              Alert.alert('No se pudo eliminar', error instanceof Error ? error.message : 'Error');
            }
          })(),
      },
    ]);
  return (
    <Screen
      title="Usuarios"
      keyboard
      action={
        <Button isIconOnly onPress={() => start()}>
          <Plus color="white" />
        </Button>
      }
    >
      {show ? (
        <Card className="gap-4 p-4">
          <Typography.Heading type="h4">
            {editing ? 'Editar usuario' : 'Usuario nuevo'}
          </Typography.Heading>
          <TextField>
            <Label>Usuario</Label>
            <Input autoCapitalize="none" value={username} onChangeText={setUsername} />
          </TextField>
          <TextField>
            <Label>{editing ? 'Nueva contraseña (opcional)' : 'Contraseña'}</Label>
            <Input secureTextEntry value={password} onChangeText={setPassword} />
          </TextField>
          <View className="flex-row flex-wrap gap-2">
            {roles.map((value) => (
              <Chip
                key={value}
                variant={role === value ? 'primary' : 'soft'}
                onPress={() => setRole(value)}
              >
                {value}
              </Chip>
            ))}
          </View>
          <Button
            isDisabled={!username || (!editing && password.length < 6) || saving}
            onPress={() => void save()}
          >
            <Button.Label>Guardar usuario</Button.Label>
          </Button>
        </Card>
      ) : null}
      {rows.length ? (
        rows.map((row) => (
          <Card key={row.id} className="flex-row items-center gap-3 p-4">
            <View className="flex-1">
              <Typography.Paragraph className="font-semibold">{row.username}</Typography.Paragraph>
              <Chip size="sm" variant="soft">
                {row.role}
              </Chip>
            </View>
            <Button size="sm" isIconOnly variant="ghost" onPress={() => start(row)}>
              <Pencil color={accent} size={18} />
            </Button>
            <Button size="sm" isIconOnly variant="ghost" onPress={() => remove(row.id)}>
              <Trash2 color={danger} size={18} />
            </Button>
          </Card>
        ))
      ) : (
        <EmptyState title="No hay usuarios" />
      )}
    </Screen>
  );
}
