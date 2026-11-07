import { Link } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
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
import { randomUUID } from 'expo-crypto';
import { Download, ImagePlus, Pencil, Plus, ScanLine, Trash2, Upload } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { DemoQuota } from '@/components/DemoQuota';
import { EmptyState } from '@/components/pos-ui';
import { PRODUCT_BARCODES, QrScanner } from '@/components/QrScanner';
import type { ProductExtras } from '@/lib/business-models';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { parseCsv } from '@/lib/csv';
import { usePosRepository } from '@/lib/use-pos-repository';
import { exportRows } from '@/lib/exports';
import { money } from '@/lib/format';
import type { Producto } from '@/lib/models';
import { canAccess } from '@/lib/permissions';
import { PRODUCT_UNITS, fractionalUnit } from '@/lib/units';
import * as Haptics from 'expo-haptics';

const empty = {
  name: '',
  category: '',
  subcategory: '',
  unit: 'u',
  quantity_decimals: 0,
  stock: '',
  price_cash: '',
  price_transfer: '',
  image_path: null as string | null,
  barcode: '',
  min_stock: '',
  wholesale_price: '',
  wholesale_min_qty: '',
};
const decimal = (value: string) => Number(value.replace(',', '.'));
export default function Products() {
  const { user, licenseMode, refresh, networkConfig } = useApp();
  const {
    deleteProduct,
    getExportRows,
    importProducts,
    listProducts,
    saveProduct,
    listProductExtras,
    executeBusinessCommand,
  } = usePosRepository();
  const [extras, setExtras] = useState<ProductExtras[]>([]);
  const [scanning, setScanning] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const [limit, setLimit] = useState(80);
  const extraOf = useMemo(() => new Map(extras.map((e) => [e.product_id, e])), [extras]);
  const [products, setProducts] = useState<Producto[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<number>();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accent, danger] = useThemeColor(['accent', 'danger']);
  const load = useCallback(async () => {
    if (!user || !canAccess(user.role, 'products')) return;
    try {
      setProducts(await listProducts(search));
      setExtras(await listProductExtras().catch(() => []));
    } catch (failure) {
      Alert.alert(
        'No se pudieron cargar los productos',
        failure instanceof Error ? failure.message : 'Vuelve a intentarlo.',
      );
    }
  }, [search, listProducts, listProductExtras, user]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  if (!user || !canAccess(user.role, 'products')) return <AccessDenied />;
  const minimum = (p: Producto) => extraOf.get(p.id)?.min_stock || 5;
  const low = products.filter((p) => p.stock <= minimum(p));
  const term = search.trim();
  const byCode =
    term.length >= 4 ? products.filter((p) => extraOf.get(p.id)?.barcode === term) : [];
  const list = byCode.length ? byCode : onlyLow ? low : products;
  // Rendering thousands of cards at once freezes low-end phones; show them in pages.
  const shown = list.slice(0, limit);
  const edit = (p: Producto) => {
    setEditing(p.id);
    setForm({
      name: p.name,
      category: p.category,
      subcategory: p.subcategory,
      unit: p.unit,
      quantity_decimals: p.quantity_decimals,
      stock: String(p.stock),
      price_cash: String(p.price_cash),
      price_transfer: String(p.price_transfer),
      image_path: p.image_path,
      barcode: extraOf.get(p.id)?.barcode ?? '',
      min_stock: extraOf.get(p.id)?.min_stock ? String(extraOf.get(p.id)?.min_stock) : '',
      wholesale_price:
        extraOf.get(p.id)?.wholesale_price != null
          ? String(extraOf.get(p.id)?.wholesale_price)
          : '',
      wholesale_min_qty:
        extraOf.get(p.id)?.wholesale_min_qty != null
          ? String(extraOf.get(p.id)?.wholesale_min_qty)
          : '',
    });
    setShowForm(true);
  };
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      const source = new File(result.assets[0].uri);
      const directory = new Directory(Paths.document, 'product-images');
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
      const destination = new File(directory, `${Date.now()}${source.extension || '.jpg'}`);
      await source.copy(destination);
      setForm((current) => ({ ...current, image_path: destination.uri }));
    }
  };
  const save = async () => {
    try {
      setSaving(true);
      const wholesale = form.wholesale_price.trim() ? decimal(form.wholesale_price) : null;
      const wholesaleQty = form.wholesale_min_qty.trim() ? decimal(form.wholesale_min_qty) : null;
      if ((wholesale == null) !== (wholesaleQty == null))
        throw new Error('Indica el precio mayorista y la cantidad mínima, o deja ambos vacíos.');
      const productId = await saveProduct(
        {
          id: editing,
          name: form.name,
          category: form.category,
          subcategory: form.subcategory,
          unit: form.unit,
          quantity_decimals: form.quantity_decimals,
          stock: Number(form.stock.replace(',', '.')),
          price_cash: Number(form.price_cash.replace(',', '.')),
          price_transfer: Number(form.price_transfer.replace(',', '.')),
          image_path: form.image_path,
        },
        user.username,
      );
      const before = editing ? extraOf.get(editing) : undefined;
      const changed =
        (before?.barcode ?? '') !== form.barcode.trim() ||
        (before?.min_stock ?? 0) !== (form.min_stock.trim() ? decimal(form.min_stock) : 0) ||
        (before?.wholesale_price ?? null) !== wholesale ||
        (before?.wholesale_min_qty ?? null) !== wholesaleQty;
      if (changed)
        try {
          await executeBusinessCommand(
            {
              commandId: randomUUID(),
              action: 'product.extras',
              productId,
              barcode: form.barcode.trim(),
              minStock: form.min_stock.trim() ? decimal(form.min_stock) : 0,
              wholesalePrice: wholesale,
              wholesaleMinQty: wholesaleQty,
            },
            user.username,
          );
        } catch (failure) {
          Alert.alert(
            'Producto guardado sin datos extra',
            failure instanceof Error
              ? failure.message
              : 'Código, mínimo o precio mayorista no se guardaron.',
          );
        }
      setForm(empty);
      setEditing(undefined);
      setShowForm(false);
      await refresh();
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
  const importCsv = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const text = await new File(result.assets[0].uri).text();
      const count = await importProducts(parseCsv(text), user.username);
      await load();
      Alert.alert(
        'Importación completada',
        `${count} productos importados. Los duplicados se omitieron.`,
      );
    } catch (error) {
      Alert.alert(
        'No se pudo importar',
        error instanceof Error ? error.message : 'Archivo inválido.',
      );
    }
  };
  const exportCsv = async () => {
    try {
      await exportRows('productos', await getExportRows('inventory'), 'csv', licenseMode);
    } catch (failure) {
      Alert.alert(
        'No se pudo exportar',
        failure instanceof Error ? failure.message : 'Vuelve a intentarlo.',
      );
    }
  };
  const remove = (id: number) =>
    Alert.alert('Eliminar producto', 'Esta acción no se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            try {
              await deleteProduct(id);
              await load();
            } catch (error) {
              Alert.alert('No se pudo eliminar', error instanceof Error ? error.message : 'Error');
            }
          })(),
      },
    ]);
  return (
    <Screen
      title="Productos"
      keyboard
      onRefresh={load}
      action={
        <Button
          isIconOnly
          onPress={() => {
            setEditing(undefined);
            setForm(empty);
            setShowForm(!showForm);
          }}
        >
          <Plus color="white" />
        </Button>
      }
    >
      <DemoQuota resource="products" />
      <View className="flex-row gap-2">
        <Button className="flex-1" variant="secondary" onPress={() => void importCsv()}>
          <Upload color={accent} size={18} />
          <Button.Label>Importar CSV</Button.Label>
        </Button>
        <Button className="flex-1" variant="secondary" onPress={() => void exportCsv()}>
          <Download color={accent} size={18} />
          <Button.Label>Exportar</Button.Label>
        </Button>
      </View>
      {user.role === 'admin' ? <Link href="/investment">Inversión y costos</Link> : null}
      {showForm ? (
        <Card className="gap-4 p-4">
          <Typography.Heading type="h4">
            {editing ? 'Editar producto' : 'Producto nuevo'}
          </Typography.Heading>
          <TextField>
            <Label>Nombre</Label>
            <Input value={form.name} onChangeText={(name) => setForm((v) => ({ ...v, name }))} />
          </TextField>
          <TextField>
            <Label>Unidad de medida</Label>
            <Input
              value={form.unit}
              maxLength={20}
              onChangeText={(unit) =>
                setForm((v) => ({ ...v, unit, quantity_decimals: fractionalUnit(unit) ? 3 : 0 }))
              }
            />
          </TextField>
          <View className="flex-row flex-wrap gap-2">
            {PRODUCT_UNITS.map((unit) => (
              <Chip
                key={unit}
                variant={form.unit === unit ? 'primary' : 'soft'}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setForm((v) => ({ ...v, unit, quantity_decimals: fractionalUnit(unit) ? 3 : 0 }));
                }}
              >
                <Chip.Label>{unit}</Chip.Label>
              </Chip>
            ))}
          </View>
          <Chip
            variant={form.quantity_decimals ? 'primary' : 'soft'}
            onPress={() => {
              void Haptics.selectionAsync();
              setForm((v) => ({ ...v, quantity_decimals: v.quantity_decimals ? 0 : 3 }));
            }}
          >
            <Chip.Label>
              {form.quantity_decimals
                ? 'Cantidades decimales (hasta 3)'
                : 'Solo cantidades enteras'}
            </Chip.Label>
          </Chip>
          <View className="gap-3">
            <TextField className="flex-1">
              <Label>Categoría</Label>
              <Input
                value={form.category}
                onChangeText={(category) => setForm((v) => ({ ...v, category }))}
              />
            </TextField>
            <TextField className="flex-1">
              <Label>Subcategoría</Label>
              <Input
                value={form.subcategory}
                onChangeText={(subcategory) => setForm((v) => ({ ...v, subcategory }))}
              />
            </TextField>
          </View>
          <View className="flex-row gap-3">
            <TextField className="flex-1">
              <Label>Stock</Label>
              <Input
                editable={!editing}
                keyboardType="decimal-pad"
                value={form.stock}
                onChangeText={(stock) => setForm((v) => ({ ...v, stock }))}
              />
            </TextField>
            <TextField className="flex-1">
              <Label>Precio efectivo</Label>
              <Input
                keyboardType="decimal-pad"
                value={form.price_cash}
                onChangeText={(price_cash) => setForm((v) => ({ ...v, price_cash }))}
              />
            </TextField>
          </View>
          <TextField>
            <Label>Precio transferencia</Label>
            <Input
              keyboardType="decimal-pad"
              value={form.price_transfer}
              onChangeText={(price_transfer) => setForm((v) => ({ ...v, price_transfer }))}
            />
          </TextField>
          <View className="flex-row items-end gap-2">
            <TextField className="flex-1">
              <Label>Código de barras</Label>
              <Input
                value={form.barcode}
                maxLength={64}
                onChangeText={(barcode) => setForm((v) => ({ ...v, barcode }))}
              />
            </TextField>
            <Button
              isIconOnly
              variant="secondary"
              accessibilityLabel="Escanear código de barras"
              onPress={() => setScanning((value) => !value)}
            >
              <ScanLine color={accent} size={20} />
            </Button>
          </View>
          {scanning ? (
            <QrScanner
              types={PRODUCT_BARCODES}
              prompt="Permite la cámara para leer el código del producto."
              onCancel={() => setScanning(false)}
              onScan={async (barcode) => {
                setForm((v) => ({ ...v, barcode: barcode.trim() }));
                setScanning(false);
              }}
            />
          ) : null}
          <TextField>
            <Label>Stock mínimo (aviso de reposición)</Label>
            <Input
              keyboardType="decimal-pad"
              value={form.min_stock}
              placeholder="5"
              onChangeText={(min_stock) => setForm((v) => ({ ...v, min_stock }))}
            />
          </TextField>
          <View className="flex-row gap-3">
            <TextField className="flex-1">
              <Label>Precio mayorista</Label>
              <Input
                keyboardType="decimal-pad"
                value={form.wholesale_price}
                placeholder="Opcional"
                onChangeText={(wholesale_price) => setForm((v) => ({ ...v, wholesale_price }))}
              />
            </TextField>
            <TextField className="flex-1">
              <Label>Desde cantidad</Label>
              <Input
                keyboardType="decimal-pad"
                value={form.wholesale_min_qty}
                placeholder="Ej. 10"
                onChangeText={(wholesale_min_qty) => setForm((v) => ({ ...v, wholesale_min_qty }))}
              />
            </TextField>
          </View>
          {networkConfig.mode !== 'client' ? (
            <Button variant="secondary" onPress={() => void pickImage()}>
              <ImagePlus color={accent} size={18} />
              <Button.Label>
                {form.image_path ? 'Cambiar imagen' : 'Seleccionar imagen'}
              </Button.Label>
            </Button>
          ) : null}
          <Button isDisabled={saving || !form.name} onPress={() => void save()}>
            <Button.Label>Guardar producto</Button.Label>
          </Button>
        </Card>
      ) : null}
      <Input value={search} onChangeText={setSearch} placeholder="Buscar productos o código" />
      <Chip variant={onlyLow ? 'primary' : 'soft'} onPress={() => setOnlyLow((value) => !value)}>
        <Chip.Label>Por reponer ({low.length})</Chip.Label>
      </Chip>
      {shown.length ? (
        shown.map((product) => (
          <Card key={product.id} className="flex-row items-center gap-3 p-3">
            {product.image_path ? (
              <Image
                source={{ uri: product.image_path }}
                style={{ width: 52, height: 52, borderRadius: 12 }}
                resizeMode="cover"
              />
            ) : (
              <View className="bg-default h-13 w-13 items-center justify-center rounded-xl">
                <ImagePlus color={accent} size={20} />
              </View>
            )}
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Typography.Paragraph className="font-semibold">
                  {product.name}
                </Typography.Paragraph>
                {product.stock <= minimum(product) ? (
                  <Chip size="sm" color="warning" variant="soft">
                    Bajo
                  </Chip>
                ) : null}
              </View>
              <Typography.Paragraph type="body-sm" color="muted">
                {product.stock} {product.unit} · {money(product.price_cash)} / {product.unit}
                {product.stock <= minimum(product) ? ` · mínimo ${minimum(product)}` : ''}
              </Typography.Paragraph>
            </View>
            <Button size="sm" variant="ghost" isIconOnly onPress={() => edit(product)}>
              <Pencil color={accent} size={18} />
            </Button>
            <Button size="sm" variant="ghost" isIconOnly onPress={() => remove(product.id)}>
              <Trash2 color={danger} size={18} />
            </Button>
          </Card>
        ))
      ) : (
        <EmptyState title="No hay productos" />
      )}
      {list.length > shown.length ? (
        <Button variant="secondary" onPress={() => setLimit((value) => value + 80)}>
          <Button.Label>Mostrar más ({list.length - shown.length} restantes)</Button.Label>
        </Button>
      ) : null}
    </Screen>
  );
}
