import { Button, Card, Input, Label, TextField, Typography } from 'heroui-native';
import { Banknote, CircleCheck, LockKeyhole } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { MetricCard, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { authenticate, closeCashSession, getCashSummary, openCashSession } from '@/lib/database';
import { money } from '@/lib/format';
import type { CashSummary } from '@/lib/models';
import { canAccess } from '@/lib/permissions';

export default function Cash() {
  const { user, session, refresh } = useApp();
  const [fund, setFund] = useState('');
  const [cash, setCash] = useState('');
  const [transfer, setTransfer] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    if (session) setSummary(await getCashSummary(session.id));
    else setSummary(null);
  }, [session]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  if (!user || !canAccess(user.role, 'cash')) return <AccessDenied />;
  const open = async () => {
    try {
      setSaving(true);
      await openCashSession(Number(fund.replace(',', '.')), user.username);
      setFund('');
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
  const close = async () => {
    try {
      setSaving(true);
      const admin = await authenticate(adminName, adminPassword);
      if (!admin || admin.role !== 'admin')
        throw new Error('Las credenciales del administrador no son válidas.');
      await closeCashSession(
        session!.id,
        Number(cash.replace(',', '.')),
        Number(transfer.replace(',', '.')),
        admin,
      );
      setCash('');
      setTransfer('');
      setAdminName('');
      setAdminPassword('');
      await refresh();
      Alert.alert('Caja cerrada', 'El cierre quedó registrado de forma definitiva.');
    } catch (error) {
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
          <Label>Fondo inicial</Label>
          <Input
            value={fund}
            onChangeText={setFund}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        </TextField>
        <Button size="lg" isDisabled={!fund || saving} onPress={() => void open()}>
          <Button.Label>Abrir caja</Button.Label>
        </Button>
      </Screen>
    );
  return (
    <Screen title={`Caja #${session.id}`} onRefresh={load} keyboard>
      <Card className="bg-success-soft flex-row items-center gap-3 p-4">
        <CircleCheck className="text-success" size={23} />
        <View>
          <Typography.Paragraph className="font-semibold">Sesión activa</Typography.Paragraph>
          <Typography.Paragraph type="body-sm" color="muted">
            Todas las ventas se vinculan a esta caja
          </Typography.Paragraph>
        </View>
      </Card>
      <View className="flex-row flex-wrap gap-3">
        <MetricCard label="Ventas" value={money(summary?.salesTotal ?? 0)} icon={Banknote} />
        <MetricCard
          label="Efectivo esperado"
          value={money(summary?.expectedCash ?? session.fund)}
          icon={CircleCheck}
          tone="success"
        />
      </View>
      <SectionTitle>Cierre de caja</SectionTitle>
      <Card className="gap-4 p-4">
        <TextField>
          <Label>Conteo de efectivo</Label>
          <Input
            value={cash}
            onChangeText={setCash}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        </TextField>
        <TextField>
          <Label>Conteo de transferencias</Label>
          <Input
            value={transfer}
            onChangeText={setTransfer}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        </TextField>
        <View className="bg-default rounded-xl p-3">
          <Typography.Paragraph type="body-sm">
            Diferencia efectivo: {money((Number(cash) || 0) - (summary?.expectedCash ?? 0))}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm">
            Diferencia transferencias:{' '}
            {money((Number(transfer) || 0) - (summary?.transferSales ?? 0))}
          </Typography.Paragraph>
        </View>
      </Card>
      <SectionTitle>Confirmación administrativa</SectionTitle>
      <Card className="gap-4 p-4">
        <TextField>
          <Label>Usuario administrador</Label>
          <Input autoCapitalize="none" value={adminName} onChangeText={setAdminName} />
        </TextField>
        <TextField>
          <Label>Contraseña</Label>
          <Input secureTextEntry value={adminPassword} onChangeText={setAdminPassword} />
        </TextField>
        <Button
          variant="danger"
          size="lg"
          isDisabled={!cash || !transfer || !adminName || !adminPassword || saving}
          onPress={() => void close()}
        >
          <LockKeyhole color="white" size={18} />
          <Button.Label>Cerrar definitivamente</Button.Label>
        </Button>
      </Card>
    </Screen>
  );
}
