import { Button, Card, Input, Label, TextField, Typography } from 'heroui-native';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Boxes,
  CircleCheck,
  LockKeyhole,
  ReceiptText,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { BanknoteThumbnail } from '@/components/BanknoteThumbnail';
import { MetricCard } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';
import * as Haptics from 'expo-haptics';
import { money, parsePositiveNumber } from '@/lib/format';
import { CASH_DENOMINATIONS } from '@/lib/models';
import type { CashClosurePreview } from '@/lib/models';
import { canAccess } from '@/lib/permissions';

const isZero = (value: number) => Math.abs(value) <= 0.005;

function StepHeader({ step }: { step: number }) {
  const labels = ['Efectivo', 'Conciliación', 'Inventario', 'Confirmación'];
  return (
    <View className="gap-2">
      <View className="flex-row gap-2">
        {labels.map((label, index) => (
          <View
            key={label}
            className={`h-1 flex-1 rounded-full ${index + 1 <= step ? 'bg-accent' : 'bg-default'}`}
          />
        ))}
      </View>
      <Typography.Paragraph type="body-sm" color="muted">
        Paso {step} de 4 · {labels[step - 1]}
      </Typography.Paragraph>
    </View>
  );
}

export default function Cash() {
  const { user, session, refresh } = useApp();
  const { closeCashSession, getCashClosurePreview, openCashSession } = usePosRepository();
  const [loadError, setLoadError] = useState('');
  const [fund, setFund] = useState('0');
  const [preview, setPreview] = useState<CashClosurePreview | null>(null);
  const [step, setStep] = useState(0);
  const [billCounts, setBillCounts] = useState<Record<number, string>>({});
  const [coins, setCoins] = useState('0');
  const [transfer, setTransfer] = useState('');
  const [physicalCounts, setPhysicalCounts] = useState<Record<number, string>>({});
  const [productIndex, setProductIndex] = useState(0);
  const [adminNameOverride, setAdminNameOverride] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user || !canAccess(user.role, 'cash')) return;
    if (session) setPreview(await getCashClosurePreview(session.id));
    else setPreview(null);
    setLoadError('');
  }, [session, user, getCashClosurePreview]);

  useEffect(() => {
    if (step !== 0) return undefined;
    const timer = setTimeout(
      () =>
        void load().catch((error: unknown) => {
          setLoadError(error instanceof Error ? error.message : 'No se pudo cargar la caja.');
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }),
      0,
    );
    return () => clearTimeout(timer);
  }, [load, step]);

  const adminName = adminNameOverride ?? (user?.role === 'admin' ? user.username : '');

  const cashCount = useMemo(
    () =>
      CASH_DENOMINATIONS.reduce(
        (total, denomination) => total + denomination * (Number(billCounts[denomination]) || 0),
        Number(coins.replace(',', '.')) || 0,
      ),
    [billCounts, coins],
  );
  const expectedCash = (preview?.fund ?? 0) + (preview?.cashSales ?? 0);
  const transferCount = Number(transfer.replace(',', '.')) || 0;
  const cashDifference = cashCount - expectedCash;
  const transferDifference = transferCount - (preview?.transferSales ?? 0);
  const totalDifference = cashDifference + transferDifference;
  const currentProduct = preview?.products[productIndex];
  const currentPhysical = currentProduct
    ? Number(physicalCounts[currentProduct.productId]?.replace(',', '.'))
    : Number.NaN;
  const currentProductDifference = currentProduct
    ? currentPhysical - currentProduct.expectedStock
    : 0;

  if (!user || !canAccess(user.role, 'cash')) return <AccessDenied />;

  const open = async () => {
    try {
      setSaving(true);
      const initialFund = fund.trim() ? parsePositiveNumber(fund, 'El fondo inicial') : 0;
      await openCashSession(initialFund, user.username);
      setFund('0');
      await refresh();
    } catch (error) {
      Alert.alert(
        'No se pudo abrir la caja',
        error instanceof Error ? error.message : 'Revisa el fondo.',
      );
    } finally {
      setSaving(false);
    }
  };

  const beginClosure = async () => {
    try {
      setSaving(true);
      await load();
      setBillCounts({});
      setCoins('0');
      setTransfer('');
      setPhysicalCounts({});
      setProductIndex(0);
      setAdminPassword('');
      setStep(1);
    } catch (error) {
      Alert.alert(
        'No se pudo iniciar el cierre',
        error instanceof Error ? error.message : 'Inténtalo nuevamente.',
      );
    } finally {
      setSaving(false);
    }
  };

  const goToInventory = () => {
    if (
      !transfer.trim() ||
      !Number.isFinite(Number(transfer.replace(',', '.'))) ||
      Number(transfer.replace(',', '.')) < 0
    ) {
      Alert.alert('Falta el conteo', 'Introduce el total comprobado de transferencias.');
      return;
    }
    if (!isZero(cashDifference) || !isZero(transferDifference) || !isZero(totalDifference)) {
      Alert.alert(
        'Existen diferencias',
        'Revisa el efectivo y las transferencias antes de continuar.',
      );
      return;
    }
    if (!preview?.products.length) setStep(4);
    else setStep(3);
  };

  const confirmProduct = () => {
    if (!currentProduct || !Number.isFinite(currentPhysical) || currentPhysical < 0) {
      Alert.alert('Conteo requerido', 'Introduce la cantidad física de este producto.');
      return;
    }
    if (Math.abs(currentProductDifference) > 0.0001) {
      Alert.alert(
        'Diferencia de inventario',
        'El conteo físico no coincide. Revisa este producto.',
      );
      return;
    }
    if (productIndex < (preview?.products.length ?? 0) - 1) setProductIndex(productIndex + 1);
    else setStep(4);
  };

  const close = async () => {
    if (!preview || !session) return;
    try {
      setSaving(true);
      const latest = await getCashClosurePreview(session.id);
      if (JSON.stringify(latest) !== JSON.stringify(preview)) {
        setPreview(latest);
        setStep(1);
        setPhysicalCounts({});
        setProductIndex(0);
        setAdminPassword('');
        throw new Error(
          'Hubo nuevas ventas o movimientos durante el conteo. Vuelve a conciliar y contar antes de cerrar.',
        );
      }
      await closeCashSession(session.id, {
        denominations: CASH_DENOMINATIONS.map((denomination) => ({
          denomination,
          quantity: Number(billCounts[denomination]) || 0,
        })),
        coinsCount: Number(coins.replace(',', '.')),
        transferCount,
        products: preview.products.map((product) => ({
          productId: product.productId,
          physicalStock: Number(physicalCounts[product.productId]?.replace(',', '.')),
        })),
        adminUsername: adminName,
        adminPassword,
      });
      setStep(0);
      setAdminPassword('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
      Alert.alert('Caja cerrada', 'El turno quedó conciliado y cerrado definitivamente.');
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'No se pudo cerrar',
        error instanceof Error ? error.message : 'Revisa los datos.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!session)
    return (
      <Screen title="Apertura de caja" keyboard>
        <Card className="items-center gap-3 p-6">
          <View className="bg-accent-soft rounded-full p-4">
            <Banknote className="text-accent" size={32} />
          </View>
          <Typography.Heading type="h3">Iniciar jornada</Typography.Heading>
          <Typography.Paragraph color="muted" align="center">
            Se capturará automáticamente el stock inicial.
          </Typography.Paragraph>
        </Card>
        <TextField>
          <Label>Fondo inicial (CUP)</Label>
          <Input
            value={fund}
            onChangeText={setFund}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        </TextField>
        <Button size="lg" isDisabled={saving} onPress={() => void open()}>
          <Button.Label>Abrir caja</Button.Label>
        </Button>
      </Screen>
    );

  if (loadError)
    return (
      <Screen title="Caja">
        <Typography.Paragraph>{loadError}</Typography.Paragraph>
        <Button
          onPress={() =>
            void load().catch((error: unknown) =>
              setLoadError(error instanceof Error ? error.message : 'No se pudo cargar la caja.'),
            )
          }
        >
          <Button.Label>Reintentar</Button.Label>
        </Button>
      </Screen>
    );

  if (!preview)
    return (
      <Screen title={`Caja #${session.id}`}>
        <Card className="items-center gap-3 p-6">
          <Typography.Paragraph color="muted">Cargando datos de caja…</Typography.Paragraph>
        </Card>
      </Screen>
    );

  if (step === 1)
    return (
      <Screen title="Cierre de caja" keyboard>
        <StepHeader step={1} />
        <Card className="gap-4 p-4">
          <View className="flex-row items-center gap-3">
            <Banknote className="text-accent" size={22} />
            <Typography.Heading type="h4">Conteo de billetes</Typography.Heading>
          </View>
          <View className="flex-row flex-wrap gap-3">
            {CASH_DENOMINATIONS.map((denomination) => (
              <View key={denomination} className="min-w-0 flex-1 basis-32 gap-2">
                <BanknoteThumbnail denomination={denomination} />
                <TextField>
                  <Label>{money(denomination)}</Label>
                  <Input
                    value={billCounts[denomination] ?? ''}
                    onChangeText={(value) =>
                      setBillCounts((current) => ({ ...current, [denomination]: value }))
                    }
                    keyboardType="number-pad"
                    placeholder="0 billetes"
                  />
                </TextField>
              </View>
            ))}
          </View>
        </Card>
        <TextField>
          <Label>Monedas contadas (CUP)</Label>
          <Input value={coins} onChangeText={setCoins} keyboardType="decimal-pad" />
        </TextField>
        <MetricCard label="Efectivo contado" value={money(cashCount)} icon={Banknote} />
        <View className="flex-row gap-3">
          <Button variant="secondary" className="flex-1" onPress={() => setStep(0)}>
            <ArrowLeft size={18} />
            <Button.Label>Cancelar</Button.Label>
          </Button>
          <Button
            className="flex-1"
            onPress={() => {
              if (
                !Number.isFinite(Number(coins.replace(',', '.'))) ||
                Number(coins.replace(',', '.')) < 0 ||
                CASH_DENOMINATIONS.some(
                  (denomination) =>
                    !Number.isInteger(Number(billCounts[denomination] || 0)) ||
                    Number(billCounts[denomination] || 0) < 0,
                )
              ) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                Alert.alert('Conteo inválido', 'Introduce cantidades enteras de billetes.');
                return;
              }
              void Haptics.selectionAsync();
              setStep(2);
            }}
          >
            <Button.Label>Continuar</Button.Label>
            <ArrowRight color="white" size={18} />
          </Button>
        </View>
      </Screen>
    );

  if (step === 2)
    return (
      <Screen title="Cierre de caja" keyboard>
        <StepHeader step={2} />
        <Card className="gap-4 p-4">
          <TextField>
            <Label>Transferencias comprobadas (CUP)</Label>
            <Input
              value={transfer}
              onChangeText={setTransfer}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </TextField>
          <View className="bg-default gap-2 rounded-xl p-4">
            <Typography.Paragraph type="body-sm">
              Efectivo esperado: {money(expectedCash)}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm">
              Diferencia de efectivo: {money(cashDifference)}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm">
              Transferencias esperadas: {money(preview.transferSales)}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm">
              Diferencia de transferencias: {money(transferDifference)}
            </Typography.Paragraph>
            <Typography.Paragraph className="font-semibold">
              Diferencia total: {money(totalDifference)}
            </Typography.Paragraph>
          </View>
        </Card>
        <View className="flex-row gap-3">
          <Button variant="secondary" className="flex-1" onPress={() => setStep(1)}>
            <ArrowLeft size={18} />
            <Button.Label>Atrás</Button.Label>
          </Button>
          <Button className="flex-1" onPress={goToInventory}>
            <Button.Label>Conciliar</Button.Label>
            <ArrowRight color="white" size={18} />
          </Button>
        </View>
      </Screen>
    );

  if (step === 3 && currentProduct)
    return (
      <Screen title="Conteo físico" keyboard>
        <StepHeader step={3} />
        <Typography.Paragraph color="muted">
          Producto {productIndex + 1} de {preview.products.length}
        </Typography.Paragraph>
        <Card className="gap-4 p-5">
          <View className="flex-row items-center gap-3">
            <View className="bg-accent-soft rounded-full p-3">
              <Boxes className="text-accent" size={24} />
            </View>
            <Typography.Heading type="h3" className="flex-1">
              {currentProduct.productName}
            </Typography.Heading>
          </View>
          <View className="bg-default gap-1 rounded-xl p-4">
            <Typography.Paragraph type="body-sm">
              Inicio: {currentProduct.openingStock}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm">
              Entradas: +{currentProduct.entries}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm">
              Salidas: −{currentProduct.exits}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-sm">
              Vendidos: −{currentProduct.sold}
            </Typography.Paragraph>
            <Typography.Paragraph className="font-semibold">
              Stock esperado: {currentProduct.expectedStock}
            </Typography.Paragraph>
          </View>
          <TextField>
            <Label>Cantidad física ({currentProduct.unit}, todas las áreas)</Label>
            <Input
              value={physicalCounts[currentProduct.productId] ?? ''}
              onChangeText={(value) =>
                setPhysicalCounts((current) => ({
                  ...current,
                  [currentProduct.productId]: value,
                }))
              }
              keyboardType="decimal-pad"
              placeholder="Cantidad contada"
            />
          </TextField>
          {Number.isFinite(currentPhysical) ? (
            <Typography.Paragraph
              className={`font-semibold ${Math.abs(currentProductDifference) <= 0.0001 ? 'text-success' : 'text-danger'}`}
            >
              Diferencia: {currentProductDifference}
            </Typography.Paragraph>
          ) : null}
        </Card>
        <View className="flex-row gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onPress={() => {
              if (productIndex === 0) setStep(2);
              else setProductIndex(productIndex - 1);
            }}
          >
            <ArrowLeft size={18} />
            <Button.Label>Atrás</Button.Label>
          </Button>
          <Button className="flex-1" onPress={confirmProduct}>
            <Button.Label>
              {productIndex === preview.products.length - 1 ? 'Finalizar conteo' : 'Siguiente'}
            </Button.Label>
            <ArrowRight color="white" size={18} />
          </Button>
        </View>
      </Screen>
    );

  if (step === 4)
    return (
      <Screen title="Confirmar cierre" keyboard>
        <StepHeader step={4} />
        <Card className="bg-success-soft flex-row items-center gap-3 p-4">
          <CircleCheck className="text-success" size={24} />
          <Typography.Paragraph className="flex-1 font-semibold">
            Dinero e inventario conciliados
          </Typography.Paragraph>
        </Card>
        {!preview.products.length ? (
          <Typography.Paragraph color="muted">
            No hubo productos vendidos; no se requiere conteo físico.
          </Typography.Paragraph>
        ) : null}
        <Card className="gap-3 p-4">
          <View className="flex-row items-center gap-3">
            <ReceiptText className="text-accent" size={22} />
            <Typography.Heading type="h4">Resumen</Typography.Heading>
          </View>
          <Typography.Paragraph>Efectivo: {money(cashCount)}</Typography.Paragraph>
          <Typography.Paragraph>Transferencias: {money(transferCount)}</Typography.Paragraph>
          <Typography.Paragraph>Tarjetas: {money(preview.cardSales)}</Typography.Paragraph>
          <Typography.Paragraph className="font-semibold">
            Ventas: {money(preview.salesTotal)}
          </Typography.Paragraph>
        </Card>
        <Card className="gap-4 p-4">
          <TextField>
            <Label>Usuario administrador</Label>
            <Input autoCapitalize="none" value={adminName} onChangeText={setAdminNameOverride} />
          </TextField>
          <TextField>
            <Label>Contraseña</Label>
            <Input secureTextEntry value={adminPassword} onChangeText={setAdminPassword} />
          </TextField>
        </Card>
        <View className="flex-row flex-wrap gap-3">
          <Button
            variant="secondary"
            isDisabled={saving}
            onPress={() => {
              setStep(0);
              setPreview(null);
            }}
          >
            <Button.Label>Reiniciar cierre</Button.Label>
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            isDisabled={saving}
            onPress={() => setStep(preview.products.length ? 3 : 2)}
          >
            <ArrowLeft size={18} />
            <Button.Label>Atrás</Button.Label>
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            isDisabled={!adminName.trim() || !adminPassword || saving}
            onPress={() => void close()}
          >
            <LockKeyhole color="white" size={18} />
            <Button.Label>Cerrar turno</Button.Label>
          </Button>
        </View>
      </Screen>
    );

  return (
    <Screen title={`Caja #${session.id}`} onRefresh={load}>
      <Card className="bg-success-soft flex-row items-center gap-3 p-4">
        <CircleCheck className="text-success" size={23} />
        <Typography.Paragraph className="font-semibold">Sesión activa</Typography.Paragraph>
      </Card>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard label="Ventas" value={money(preview.salesTotal)} icon={Banknote} />
        <MetricCard label="Efectivo esperado" value={money(expectedCash)} icon={CircleCheck} />
      </View>
      <Button size="lg" isDisabled={saving} onPress={() => void beginClosure()}>
        <ReceiptText color="white" size={19} />
        <Button.Label>Iniciar cierre guiado</Button.Label>
      </Button>
    </Screen>
  );
}
