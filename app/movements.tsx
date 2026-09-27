import { Button, Card, Chip, Input, Typography, useThemeColor } from 'heroui-native';
import { Download, Filter, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { EmptyState } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { addArea, listAreas, listMovements, listProducts, listUsers } from '@/lib/database';
import { exportRows } from '@/lib/exports';
import { shortDate } from '@/lib/format';
import type { Area, Movimiento, Producto, Usuario } from '@/lib/models';
import { canAccess } from '@/lib/permissions';

export default function Movements() {
  const { user, licenseMode } = useApp();
  const [rows, setRows] = useState<Movimiento[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [products, setProducts] = useState<Producto[]>([]);
  const [users, setUsers] = useState<Usuario[]>([]);
  const [area, setArea] = useState('');
  const [product, setProduct] = useState<number>();
  const [username, setUsername] = useState('');
  const [newArea, setNewArea] = useState('');
  const accent = useThemeColor('accent');
  const load = useCallback(async () => {
    setRows(
      await listMovements({
        area: area || undefined,
        productId: product,
        user: username || undefined,
      }),
    );
  }, [area, product, username]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        setAreas(await listAreas());
        setProducts(await listProducts());
        setUsers(await listUsers());
        await load();
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  if (!user || !canAccess(user.role, 'movements')) return <AccessDenied />;
  const createArea = async () => {
    try {
      await addArea(newArea);
      setNewArea('');
      setAreas(await listAreas());
    } catch (error) {
      Alert.alert('No se pudo crear', error instanceof Error ? error.message : 'Error');
    }
  };
  return (
    <Screen
      title="Movimientos"
      onRefresh={load}
      action={
        <Button
          isIconOnly
          variant="secondary"
          onPress={() => void exportRows('movimientos', rows, 'csv', licenseMode)}
        >
          <Download color={accent} />
        </Button>
      }
    >
      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-2">
          <Filter color={accent} size={18} />
          <Typography.Paragraph className="font-semibold">Filtros</Typography.Paragraph>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Chip variant={!area ? 'primary' : 'soft'} onPress={() => setArea('')}>
            Todas las áreas
          </Chip>
          {areas.map((item) => (
            <Chip
              key={item.id}
              variant={area === item.name ? 'primary' : 'soft'}
              onPress={() => setArea(item.name)}
            >
              {item.name}
            </Chip>
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Chip variant={!product ? 'primary' : 'soft'} onPress={() => setProduct(undefined)}>
            Todos los productos
          </Chip>
          {products.map((item) => (
            <Chip
              key={item.id}
              variant={product === item.id ? 'primary' : 'soft'}
              onPress={() => setProduct(item.id)}
            >
              {item.name}
            </Chip>
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Chip variant={!username ? 'primary' : 'soft'} onPress={() => setUsername('')}>
            Todos los usuarios
          </Chip>
          {users.map((item) => (
            <Chip
              key={item.id}
              variant={username === item.username ? 'primary' : 'soft'}
              onPress={() => setUsername(item.username)}
            >
              {item.username}
            </Chip>
          ))}
        </View>
      </Card>
      {user.role === 'admin' ? (
        <Card className="flex-row gap-2 p-3">
          <Input
            className="flex-1"
            value={newArea}
            onChangeText={setNewArea}
            placeholder="Nueva área"
          />
          <Button isIconOnly isDisabled={!newArea} onPress={() => void createArea()}>
            <Plus color="white" />
          </Button>
        </Card>
      ) : null}
      {rows.length ? (
        rows.map((row) => (
          <Card key={row.id} className="p-4">
            <View className="flex-row items-center justify-between">
              <Chip
                size="sm"
                color={
                  row.type === 'entrada' ? 'success' : row.type === 'salida' ? 'danger' : 'accent'
                }
                variant="soft"
              >
                {row.type}
              </Chip>
              <Typography.Paragraph type="body-sm" color="muted">
                {shortDate(row.date)}
              </Typography.Paragraph>
            </View>
            <Typography.Paragraph className="mt-3 font-semibold">
              {row.product_name} · {row.quantity}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm" color="muted">
              {row.from_area ?? 'Exterior'} → {row.to_area ?? 'Exterior'} · {row.user}
            </Typography.Paragraph>
          </Card>
        ))
      ) : (
        <EmptyState title="No hay movimientos con estos filtros" />
      )}
    </Screen>
  );
}
