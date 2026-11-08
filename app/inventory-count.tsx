import { Button, Card, Input, Typography } from 'heroui-native';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { quantityText } from '@/components/BusinessKit';
import { FinanceField, financeFailure, numeric } from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { EmptyState } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import type { Area, AreaStock, Producto } from '@/lib/models';
import { canAccess } from '@/lib/permissions';
import { usePosRepository } from '@/lib/use-pos-repository';

// Physical count: only lines with a typed quantity are sent; differences become audited adjustments.
export default function InventoryCount() {
  const { user, refresh } = useApp();
  const { listAreas, listAreaStock, listProducts, executeBusinessCommand } = usePosRepository();
  const [areas, setAreas] = useState<Area[]>([]);
  const [stock, setStock] = useState<AreaStock[]>([]);
  const [products, setProducts] = useState<Producto[]>([]);
  const [area, setArea] = useState('');
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('Conteo físico');
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(80);
  const load = useCallback(async () => {
    try {
      const [a, s, p] = await Promise.all([listAreas(), listAreaStock(), listProducts('')]);
      setAreas(a);
      setStock(s);
      setProducts(p);
    } catch (failure) {
      Alert.alert('No se pudo cargar el inventario', financeFailure(failure));
    }
  }, [listAreaStock, listAreas, listProducts]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  if (!user || !canAccess(user.role, 'transfers')) return <AccessDenied />;
  const areaId = Number(area);
  const system = (productId: number) =>
    stock.find((row) => row.area_id === areaId && row.product_id === productId)?.quantity ?? 0;
  const visible = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const lines = Object.entries(counted)
    .filter(([, value]) => value.trim())
    .map(([productId, value]) => ({ productId: Number(productId), counted: numeric(value) }));
  const differences = lines.filter(
    (line) => Math.abs(line.counted - system(line.productId)) > 0.0005,
  );
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await executeBusinessCommand(
        { commandId: randomUUID(), action: 'inventory.count', areaId, lines, reason },
        user.username,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Conteo aplicado', `${differences.length} diferencia(s) ajustada(s).`);
      setCounted({});
      await refresh();
      await load();
    } catch (failure) {
      Alert.alert('No se pudo aplicar el conteo', financeFailure(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Conteo físico" keyboard>
      <Typography.Paragraph color="muted">
        Escribe lo que contaste. Solo se ajustan los productos con cantidad escrita; cada diferencia
        queda en Movimientos y en Auditoría.
      </Typography.Paragraph>
      <FinanceSelect
        label="Área"
        value={area}
        onChange={(value) => {
          setArea(value);
          setCounted({});
        }}
        options={areas.map((a) => ({ value: String(a.id), label: a.name }))}
      />
      {area ? (
        <>
          <Input value={search} onChangeText={setSearch} placeholder="Buscar producto" />
          {visible.length ? (
            visible.slice(0, limit).map((product) => {
              const value = counted[product.id] ?? '';
              const diff = value.trim() ? numeric(value) - system(product.id) : 0;
              return (
                <Card key={product.id} className="flex-row items-center gap-3 p-3">
                  <View className="flex-1">
                    <Typography.Paragraph className="font-semibold">
                      {product.name}
                    </Typography.Paragraph>
                    <Typography.Paragraph type="body-sm" color="muted">
                      Sistema: {quantityText(system(product.id))} {product.unit}
                      {value.trim() && Math.abs(diff) > 0.0005
                        ? ` · diferencia ${diff > 0 ? '+' : ''}${quantityText(diff)}`
                        : ''}
                    </Typography.Paragraph>
                  </View>
                  <Input
                    className="w-24"
                    keyboardType="decimal-pad"
                    placeholder="Contado"
                    value={value}
                    onChangeText={(text) => setCounted((c) => ({ ...c, [product.id]: text }))}
                  />
                </Card>
              );
            })
          ) : (
            <EmptyState title="No hay productos" />
          )}
          {visible.length > limit ? (
            <Button variant="secondary" onPress={() => setLimit((value) => value + 80)}>
              <Button.Label>Mostrar más ({visible.length - limit} restantes)</Button.Label>
            </Button>
          ) : null}
          <FinanceField label="Motivo" value={reason} onChange={setReason} />
          <Button isDisabled={busy || !lines.length} onPress={() => void submit()}>
            <Button.Label>
              {busy
                ? 'Aplicando…'
                : `Aplicar conteo (${lines.length} contados, ${differences.length} diferencias)`}
            </Button.Label>
          </Button>
        </>
      ) : null}
    </Screen>
  );
}
