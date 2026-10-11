import { Button, Card, Chip, Input, Label, TextField, Typography } from 'heroui-native';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  PackageCheck,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { EmptyState, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import type { Area, MovementType, Producto } from '@/lib/models';
import { canAccess } from '@/lib/permissions';

export default function Inventory() {
  const { user, refresh } = useApp();
  const { listAreas, listProducts, listAreaStock, registerMovement } = usePosRepository();
  const [areaStock, setAreaStock] = useState<import('@/lib/models').AreaStock[]>([]);
  const [viewArea, setViewArea] = useState<number>();
  const [products, setProducts] = useState<Producto[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [type, setType] = useState<MovementType>('entrada');
  const [productId, setProductId] = useState<number>();
  const [quantity, setQuantity] = useState('');
  const [fromArea, setFromArea] = useState('');
  const [toArea, setToArea] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    if (!user || !canAccess(user.role, 'inventory')) return;
    try {
      setProducts(await listProducts());
      const nextAreas = await listAreas();
      setAreas(nextAreas);
      setAreaStock(await listAreaStock());
      setViewArea((current) => current ?? nextAreas[0]?.id);
    } catch (failure) {
      Alert.alert(
        'No se pudo cargar el inventario',
        failure instanceof Error ? failure.message : 'Vuelve a intentarlo.',
      );
    }
  }, [listProducts, listAreas, listAreaStock, user]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  if (!user || !canAccess(user.role, 'inventory')) return <AccessDenied />;
  const submit = async () => {
    try {
      setSaving(true);
      await registerMovement({
        type,
        productId: productId!,
        quantity: Number(quantity.replace(',', '.')),
        fromArea: fromArea || undefined,
        toArea: toArea || undefined,
        username: user.username,
      });
      setQuantity('');
      await refresh();
      await load();
      Alert.alert('Movimiento registrado');
    } catch (error) {
      Alert.alert(
        'No se pudo registrar',
        error instanceof Error ? error.message : 'Revisa los datos.',
      );
    } finally {
      setSaving(false);
    }
  };
  const icons = { entrada: ArrowDownToLine, salida: ArrowUpFromLine, traslado: ArrowLeftRight };
  return (
    <Screen title="Inventario" keyboard onRefresh={load}>
      <SectionTitle>Existencias por área</SectionTitle>
      <View className="flex-row flex-wrap gap-2">
        {areas.map((area) => (
          <Chip
            key={area.id}
            variant={viewArea === area.id ? 'primary' : 'soft'}
            onPress={() => setViewArea(area.id)}
          >
            <Chip.Label numberOfLines={1}>{area.name}</Chip.Label>
          </Chip>
        ))}
      </View>
      {products
        .filter((product) =>
          areaStock.some(
            (row) => row.area_id === viewArea && row.product_id === product.id && row.quantity > 0,
          ),
        )
        .map((product) => (
          <View key={product.id} className="flex-row justify-between gap-3">
            <Typography.Paragraph className="flex-1">{product.name}</Typography.Paragraph>
            <Typography.Paragraph>
              {areaStock.find((row) => row.area_id === viewArea && row.product_id === product.id)
                ?.quantity ?? 0}{' '}
              {product.unit}
            </Typography.Paragraph>
          </View>
        ))}
      {!areaStock.some((row) => row.area_id === viewArea && row.quantity > 0) ? (
        <EmptyState
          title="Esta área no tiene existencias"
          action={
            <Button
              variant="secondary"
              onPress={() => {
                setType('entrada');
                setToArea(areas.find((area) => area.id === viewArea)?.name ?? '');
              }}
            >
              <Button.Label>Registrar entrada</Button.Label>
            </Button>
          }
        />
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {(['entrada', 'salida', 'traslado'] as MovementType[]).map((value) => {
          const Icon = icons[value];
          return (
            <Chip
              key={value}
              className="flex-1"
              variant={type === value ? 'primary' : 'soft'}
              onPress={() => {
                setType(value);
                setFromArea('');
                setToArea('');
              }}
            >
              <Icon size={16} />
              {value[0].toUpperCase() + value.slice(1)}
            </Chip>
          );
        })}
      </View>
      <SectionTitle>Producto</SectionTitle>
      {products.length ? (
        <View className="flex-row flex-wrap gap-2">
          {products.map((product) => (
            <Chip
              key={product.id}
              variant={productId === product.id ? 'primary' : 'soft'}
              onPress={() => setProductId(product.id)}
            >
              {product.name} · {product.stock} {product.unit}
            </Chip>
          ))}
        </View>
      ) : (
        <EmptyState title="Primero crea un producto" />
      )}
      {type !== 'entrada' ? (
        <>
          <SectionTitle>Área de origen</SectionTitle>
          <View className="flex-row flex-wrap gap-2">
            {areas.map((area) => (
              <Chip
                key={area.id}
                variant={fromArea === area.name ? 'primary' : 'soft'}
                onPress={() => setFromArea(area.name)}
              >
                {area.name}
              </Chip>
            ))}
          </View>
        </>
      ) : null}
      {type !== 'salida' ? (
        <>
          <SectionTitle>Área de destino</SectionTitle>
          <View className="flex-row flex-wrap gap-2">
            {areas.map((area) => (
              <Chip
                key={area.id}
                variant={toArea === area.name ? 'primary' : 'soft'}
                onPress={() => setToArea(area.name)}
              >
                {area.name}
              </Chip>
            ))}
          </View>
        </>
      ) : null}
      <Card className="gap-4 p-4">
        <TextField>
          <Label>Cantidad</Label>
          <Input
            keyboardType="decimal-pad"
            value={quantity}
            onChangeText={setQuantity}
            placeholder="0"
          />
        </TextField>
        <Button
          size="lg"
          isDisabled={!productId || !quantity || saving}
          onPress={() => void submit()}
        >
          <PackageCheck color="white" size={19} />
          <Button.Label>Registrar {type}</Button.Label>
        </Button>
      </Card>
    </Screen>
  );
}
