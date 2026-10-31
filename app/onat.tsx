import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Linking, View } from 'react-native';
import { Button, Card, Chip, Typography } from 'heroui-native';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { AccessDenied } from '@/components/AccessDenied';
import { Screen } from '@/components/Screen';
import {
  Choice,
  FinanceField,
  FinanceStatus,
  financeFailure,
  numeric,
} from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { FinanceChart } from '@/components/FinanceChart';
import { EmptyState } from '@/components/pos-ui';
import { OnatCalendar } from '@/components/OnatCalendar';
import DateInput from '@/components/DateInput';
import { localDate } from '@/components/OnatProfileForm';
import { useApp } from '@/lib/app-context';
import { activeRecords } from '@/lib/onat';
import { calculateTax, fiscalStatus, ruleWarnings } from '@/lib/onat-engine';
import { exportFiscalReport, openFiscalAttachment } from '@/lib/onat-documents';
import { scheduleFiscalReminder, cancelFiscalReminder } from '@/lib/onat-notifications';
import {
  LEGAL_REFERENCE,
  ONAT_DISCLAIMER,
  type FiscalRecordInput,
  type Obligation,
  type FiscalRecord,
} from '@/lib/onat-models';
import { useOnat, fiscalMonth, todayFiscal } from '@/lib/use-onat';
import { goBackOrReplace } from '@/lib/navigation';
import { money } from '@/lib/format';
import type { FinanceGroup } from '@/lib/finance-models';

const sections = ['Resumen', 'Calendario', 'Reglas', 'Registros', 'Simulador'] as const;
const fulfilled = (o: { value: Obligation; declared: boolean; paid: number }) =>
  o.value.name === 'Declaración jurada' ? o.declared : o.paid >= o.value.calculation.tax;
export default function OnatScreen() {
  const { licenseMode } = useApp();
  const [taxpayer, setTaxpayer] = useState('default');
  const [range, setRange] = useState(fiscalMonth);
  const [period, setPeriod] = useState('Mes');
  const filter = { taxpayerId: taxpayer, ...range };
  const model = useOnat(filter);
  const { load } = model;
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const [section, setSection] = useState<(typeof sections)[number]>('Resumen');
  const [scope, setScope] = useState<'Empresa' | 'Socio'>('Empresa');
  const [ruleId, setRuleId] = useState(''),
    [base, setBase] = useState('0'),
    [beneficiary, setBeneficiary] = useState('');
  const [simulation, setSimulation] = useState('20'),
    [deductions, setDeductions] = useState('0');
  const [simulationResult, setSimulationResult] = useState('');
  const [voidId, setVoidId] = useState(''),
    [reason, setReason] = useState('');
  const [reminderId, setReminderId] = useState(''),
    [reminderDate, setReminderDate] = useState(() => new Date(Date.now() + 86400000));
  const [actionBusy, setActionBusy] = useState(false),
    [localError, setLocalError] = useState('');
  if (!model.allowed) return <AccessDenied />;
  const data = model.data;
  const profiles =
    data?.profiles.filter(
      (p, i, list) => list.findIndex((x) => x.value.taxpayerId === p.value.taxpayerId) === i,
    ) ?? [];
  const profile = data?.profiles
    .filter((p) => p.value.taxpayerId === taxpayer && p.value.effectiveFrom <= range.start)
    .sort(
      (a, b) =>
        b.value.effectiveFrom.localeCompare(a.value.effectiveFrom) || b.date.localeCompare(a.date),
    )[0];
  const all = activeRecords(data?.records ?? []);
  const payments = all.filter((r) => r.kind === 'payment');
  const paidFor = (id: string) =>
    payments
      .filter((r) => (r.value as FiscalRecordInput).obligationId === id)
      .reduce((s, r) => s + (r.value as FiscalRecordInput).amount, 0);
  const obligations = all
    .filter((r) => r.kind === 'obligation' && r.taxpayerId === taxpayer)
    .map((r) => ({
      id: r.id,
      value: r.value as Obligation,
      paid: paidFor(r.id),
      declared: all.some(
        (d) => d.kind === 'declaration' && (d.value as FiscalRecordInput).obligationId === r.id,
      ),
    }));
  const filtered = obligations.filter(
    (o) => o.value.scope === scope && o.value.start <= range.end && o.value.end >= range.start,
  );
  const total = filtered.reduce((s, o) => s + o.value.calculation.tax, 0),
    paid = filtered.reduce((s, o) => s + o.paid, 0),
    pending = filtered.reduce((s, o) => s + Math.max(0, o.value.calculation.tax - o.paid), 0);
  const provisions = all
    .filter(
      (r) =>
        r.kind === 'provision' &&
        r.taxpayerId === taxpayer &&
        (r.value as FiscalRecordInput).date <= range.end,
    )
    .reduce((s, r) => s + (r.value as FiscalRecordInput).amount, 0);
  const paidToDate = payments
    .filter((r) => r.taxpayerId === taxpayer && (r.value as FiscalRecordInput).date <= range.end)
    .reduce((s, r) => s + (r.value as FiscalRecordInput).amount, 0);
  const available = Math.max(0, provisions - paidToDate);
  const rule = data?.rules.find((r) => r.id === ruleId);
  const calendarObligations = obligations.filter((o) => o.value.scope === scope);
  const relevant = calendarObligations.filter((o) =>
    ['Vencida', 'Próxima'].includes(fiscalStatus(o.value.due, fulfilled(o))),
  );
  const openEdit = (mode: string, extra: Record<string, string> = {}) =>
    router.push({ pathname: '/onat-edit', params: { mode, taxpayer, ...extra } });
  const run = async (action: () => Promise<unknown>) => {
    setActionBusy(true);
    setLocalError('');
    try {
      await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setLocalError(financeFailure(e));
    } finally {
      setActionBusy(false);
    }
  };
  const changePeriod = (p: string) => {
    setPeriod(p);
    const d = new Date(),
      y = d.getFullYear(),
      m = d.getMonth();
    if (p === 'Día') setRange({ start: todayFiscal(), end: todayFiscal() });
    if (p === 'Mes') setRange(fiscalMonth());
    if (p === 'Trimestre') {
      const q = Math.floor(m / 3) * 3;
      setRange({ start: localDate(new Date(y, q, 1)), end: localDate(new Date(y, q + 3, 0)) });
    }
    if (p === 'Año') setRange({ start: `${y}-01-01`, end: `${y}-12-31` });
  };
  const list: FiscalRecord[] =
    section === 'Registros'
      ? (data?.records ?? []).filter((r) => r.taxpayerId === taxpayer && r.kind !== 'obligation')
      : section === 'Reglas'
        ? []
        : section === 'Calendario'
          ? all
              .filter(
                (r) =>
                  r.kind === 'obligation' &&
                  r.taxpayerId === taxpayer &&
                  (r.value as Obligation).scope === scope,
              )
              .sort((a, b) =>
                (a.value as Obligation).due.localeCompare((b.value as Obligation).due),
              )
          : [];
  const previousStart = new Date(
    Date.parse(`${range.start}T12:00:00Z`) -
      (Date.parse(`${range.end}T12:00:00Z`) - Date.parse(`${range.start}T12:00:00Z`) + 86400000),
  )
    .toISOString()
    .slice(0, 10);
  const previousTax = obligations
    .filter(
      (o) => o.value.scope === scope && o.value.end < range.start && o.value.start >= previousStart,
    )
    .reduce((s, o) => s + o.value.calculation.tax, 0);
  const timelineMap = new Map<string, number>();
  for (const o of filtered)
    timelineMap.set(o.value.end, (timelineMap.get(o.value.end) ?? 0) + o.value.calculation.tax);
  const chart: FinanceGroup[] = Array.from(timelineMap, ([key, net]) => ({
    key,
    name: key,
    net,
    profit: null,
    margin: null,
    gross: net,
    discounts: 0,
    returns: 0,
    knownCost: 0,
    units: 0,
    operations: 1,
    average: net,
    missingCostLines: 0,
  })).sort((a, b) => a.key.localeCompare(b.key));
  const header = (
    <View className="gap-5 pb-5">
      <Typography.Heading type="h2">MipyPOS ONAT</Typography.Heading>
      <Typography.Paragraph>
        Gestión tributaria y fiscal para negocios cubanos.
      </Typography.Paragraph>
      <Typography.Paragraph color="muted">
        Tus obligaciones tributarias bajo control
      </Typography.Paragraph>
      <FinanceStatus
        loading={model.loading}
        error={model.error || localError}
        retry={() => void model.load()}
      />
      {!model.loading && data ? (
        <>
          {!profiles.length ? (
            <EmptyState
              title="Configura el contribuyente para comenzar"
              action={
                <Button onPress={() => openEdit('profile')}>
                  <Button.Label>Configurar perfil fiscal</Button.Label>
                </Button>
              }
            />
          ) : (
            <>
              <FinanceSelect
                label="Contribuyente"
                options={profiles.map((p) => ({
                  value: p.value.taxpayerId,
                  label: `${p.value.name} · ${p.value.nit}`,
                }))}
                value={taxpayer}
                onChange={(value) => {
                  setTaxpayer(value);
                  setRuleId('');
                }}
              />
              <View className="flex-row flex-wrap gap-2">
                <Button variant="secondary" onPress={() => openEdit('profile')}>
                  <Button.Label>Editar perfil</Button.Label>
                </Button>
                <Button variant="ghost" onPress={() => openEdit('profile', { new: '1' })}>
                  <Button.Label>Otro contribuyente</Button.Label>
                </Button>
              </View>
              <Choice
                values={['Día', 'Mes', 'Trimestre', 'Año', 'Personalizado']}
                value={period}
                onChange={changePeriod}
              />
              <DateInput
                label="Desde"
                value={new Date(`${range.start}T12:00:00`)}
                onChange={(d) => {
                  setPeriod('Personalizado');
                  setRange({ ...range, start: localDate(d) });
                }}
              />
              <DateInput
                label="Hasta"
                value={new Date(`${range.end}T12:00:00`)}
                onChange={(d) => {
                  setPeriod('Personalizado');
                  setRange({ ...range, end: localDate(d) });
                }}
              />
              <Choice values={['Empresa', 'Socio']} value={scope} onChange={setScope} />
              <Choice values={sections} value={section} onChange={setSection} />
              {data.warnings.map((w) => (
                <Typography.Paragraph key={w} color="muted" type="body-sm">
                  {w}
                </Typography.Paragraph>
              ))}
              {section === 'Resumen' ? (
                <>
                  <Card className="gap-3 p-5">
                    <Typography.Paragraph>
                      Pendiente estimado · {scope.toLowerCase()}
                    </Typography.Paragraph>
                    <Typography.Heading type="h2">{money(pending)}</Typography.Heading>
                    <View className="flex-row gap-3">
                      <View className="flex-1">
                        <Typography.Paragraph color="muted">Estimado</Typography.Paragraph>
                        <Typography.Paragraph>{money(total)}</Typography.Paragraph>
                      </View>
                      <View className="flex-1">
                        <Typography.Paragraph color="muted">Pagado</Typography.Paragraph>
                        <Typography.Paragraph>{money(paid)}</Typography.Paragraph>
                      </View>
                    </View>
                  </Card>
                  <Typography.Paragraph>
                    Período anterior: {money(previousTax)} estimados · ingresos{' '}
                    {money(data.previousIncome)}. Período actual: ingresos{' '}
                    {money(data.economy.income)}.
                  </Typography.Paragraph>
                  <Card className="gap-3 p-4">
                    <Typography.Heading type="h4">Planificación de reservas</Typography.Heading>
                    <Typography.Paragraph>
                      Acumuladas: {money(provisions)} · disponibles estimadas: {money(available)}
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      Por reservar: {money(Math.max(0, pending - available))} · cobertura{' '}
                      {pending ? Math.min(100, (available / pending) * 100).toFixed(1) : '100'} %
                    </Typography.Paragraph>
                    <Typography.Paragraph color="muted">
                      Disponible es reserva menos pagos registrados; no representa un saldo
                      bancario.
                    </Typography.Paragraph>
                    <Typography.Paragraph>
                      Sugerencia del período:{' '}
                      {money(
                        ((profile?.value.reserveBase === 'Utilidad fiscal'
                          ? Math.max(0, data.economy.income - data.economy.knownCost)
                          : data.economy.income) *
                          (profile?.value.reservePercent ?? 0)) /
                          100,
                      )}
                    </Typography.Paragraph>
                    <Button variant="secondary" onPress={() => openEdit('record')}>
                      <Button.Label>Registrar pago o reserva</Button.Label>
                    </Button>
                  </Card>
                  <Typography.Heading type="h4">
                    Obligaciones que requieren atención
                  </Typography.Heading>
                  {relevant.length ? (
                    relevant.map((o) => (
                      <View key={o.id} className="gap-1">
                        <Typography.Paragraph>
                          {o.value.name} · {o.value.due}
                        </Typography.Paragraph>
                        <Typography.Paragraph
                          className={
                            fiscalStatus(o.value.due, fulfilled(o)) === 'Vencida'
                              ? 'text-danger'
                              : 'text-warning'
                          }
                        >
                          {fiscalStatus(o.value.due, fulfilled(o))} ·{' '}
                          {money(Math.max(0, o.value.calculation.tax - o.paid))}
                        </Typography.Paragraph>
                      </View>
                    ))
                  ) : (
                    <Typography.Paragraph color="muted">
                      No hay obligaciones próximas o vencidas registradas.
                    </Typography.Paragraph>
                  )}
                  {chart.length ? (
                    <FinanceChart rows={chart} field="net" label="Evolución de estimaciones" />
                  ) : null}
                  {filtered.length ? (
                    <Card className="gap-2 p-4">
                      <Typography.Heading type="h4">Distribución por impuesto</Typography.Heading>
                      {Array.from(new Set(filtered.map((o) => o.value.name))).map((name) => (
                        <Typography.Paragraph key={name}>
                          {name}:{' '}
                          {money(
                            filtered
                              .filter((o) => o.value.name === name)
                              .reduce((s, o) => s + o.value.calculation.tax, 0),
                          )}
                        </Typography.Paragraph>
                      ))}
                    </Card>
                  ) : null}
                  <Typography.Heading type="h4">
                    Confirmar estimación del período
                  </Typography.Heading>
                  {data.rules.length ? (
                    <>
                      <FinanceSelect
                        label="Regla y vigencia"
                        options={data.rules.map((r) => ({
                          value: r.id,
                          label: `${r.value.name} · ${r.value.effectiveFrom} · ${r.value.verifiedOn ? 'verificación registrada' : 'sin verificar'}`,
                        }))}
                        value={ruleId}
                        onChange={setRuleId}
                      />
                      {rule && profile
                        ? ruleWarnings(rule.value, filter, profile.value).map((w) => (
                            <Typography.Paragraph key={w} className="text-warning">
                              {w}
                            </Typography.Paragraph>
                          ))
                        : null}
                      {rule?.value.scope === 'Socio' ? (
                        <FinanceField
                          label="Socio (identificador o NIT)"
                          value={beneficiary}
                          onChange={setBeneficiary}
                        />
                      ) : null}
                      {rule?.value.base === 'Base manual' ? (
                        <FinanceField
                          label="Base manual comprobada (CUP)"
                          value={base}
                          onChange={setBase}
                          decimal
                        />
                      ) : null}
                      <Button
                        isDisabled={model.busy || !rule}
                        onPress={() =>
                          Alert.alert(
                            'Confirmar estimación',
                            'Se guardarán la base económica, el perfil y la regla utilizada sin alterar caja.',
                            [
                              { text: 'Cancelar', style: 'cancel' },
                              {
                                text: 'Confirmar',
                                onPress: () =>
                                  void model
                                    .save({
                                      action: 'estimate',
                                      commandId: randomUUID(),
                                      filter,
                                      ruleId,
                                      manualBase: numeric(base),
                                      beneficiary: rule?.value.scope === 'Socio' ? beneficiary : '',
                                    })
                                    .then(() => model.load())
                                    .catch(() => undefined),
                              },
                            ],
                          )
                        }
                      >
                        <Button.Label>
                          {model.busy ? 'Calculando…' : 'Calcular y guardar estimación'}
                        </Button.Label>
                      </Button>
                    </>
                  ) : (
                    <EmptyState
                      title="Añade una regla verificada para estimar impuestos"
                      action={
                        <Button onPress={() => openEdit('rule')}>
                          <Button.Label>Configurar regla</Button.Label>
                        </Button>
                      }
                    />
                  )}
                  <View className="gap-2">
                    {(['PDF', 'Excel', 'Impresión'] as const).map((format) => (
                      <Button
                        key={format}
                        variant="secondary"
                        isDisabled={actionBusy || model.busy || !filtered.length}
                        onPress={() =>
                          void run(async () => {
                            await model.save({
                              action: 'export',
                              commandId: randomUUID(),
                              filter,
                              format,
                              scope,
                            });
                            await exportFiscalReport(data, filter, format, licenseMode, scope);
                          })
                        }
                      >
                        <Button.Label>
                          {actionBusy
                            ? 'Preparando…'
                            : format === 'Impresión'
                              ? 'Imprimir resumen'
                              : `Exportar ${format}`}
                        </Button.Label>
                      </Button>
                    ))}
                  </View>
                </>
              ) : null}
              {section === 'Calendario' ? (
                <OnatCalendar month={range.start.slice(0, 7)} obligations={calendarObligations} />
              ) : null}
              {section === 'Reglas' ? (
                <>
                  <Button onPress={() => openEdit('rule')}>
                    <Button.Label>Crear regla tributaria</Button.Label>
                  </Button>
                  <FinanceSelect
                    label="Reglas históricas y futuras"
                    options={data.rules.map((r) => ({
                      value: r.id,
                      label: `${r.value.name} · ${r.value.effectiveFrom}`,
                    }))}
                    value={ruleId}
                    onChange={setRuleId}
                  />
                  {rule ? (
                    <Card className="gap-3 p-4">
                      <Typography.Heading type="h4">{rule.value.name}</Typography.Heading>
                      <Typography.Paragraph>
                        {rule.value.scope} · {rule.value.base} · {rule.value.method} ·{' '}
                        {rule.value.frequency}
                      </Typography.Paragraph>
                      <Typography.Paragraph color="muted" type="body-sm">
                        Clave para anticipos: {rule.value.ruleKey}
                      </Typography.Paragraph>
                      <Typography.Paragraph>
                        {rule.value.disposition} · {rule.value.article}
                      </Typography.Paragraph>
                      <Typography.Paragraph>
                        {rule.value.verifiedOn
                          ? `Comprobación registrada por ${rule.actor}: ${rule.value.verifiedOn}`
                          : 'Sin verificación: no permite confirmar cálculos'}
                      </Typography.Paragraph>
                      <Typography.Paragraph>
                        {rule.value.verificationNote || rule.value.notes}
                      </Typography.Paragraph>
                      <Button
                        variant="secondary"
                        onPress={() => openEdit('rule', { rule: rule.id })}
                      >
                        <Button.Label>Crear nueva vigencia</Button.Label>
                      </Button>
                      <Button
                        variant="ghost"
                        onPress={() => void Linking.openURL(rule.value.sourceUrl)}
                      >
                        <Button.Label>Consultar fuente (requiere internet)</Button.Label>
                      </Button>
                    </Card>
                  ) : (
                    <Typography.Paragraph color="muted">
                      Selecciona una regla para revisar su fuente e historial.
                    </Typography.Paragraph>
                  )}
                  <Card className="gap-2 p-4">
                    <Typography.Paragraph>{LEGAL_REFERENCE.title}</Typography.Paragraph>
                    <Typography.Paragraph color="muted">
                      {LEGAL_REFERENCE.note}
                    </Typography.Paragraph>
                    <Button
                      variant="ghost"
                      onPress={() => void Linking.openURL(LEGAL_REFERENCE.url)}
                    >
                      <Button.Label>Abrir referencia oficial</Button.Label>
                    </Button>
                  </Card>
                </>
              ) : null}
              {section === 'Registros' ? (
                <Button onPress={() => openEdit('record')}>
                  <Button.Label>Registrar pago, gasto o constancia</Button.Label>
                </Button>
              ) : null}
              {section === 'Simulador' ? (
                <Card className="gap-4 p-4">
                  <Typography.Heading type="h4">
                    Escenario sin modificar el negocio
                  </Typography.Heading>
                  <FinanceSelect
                    label="Regla"
                    options={data.rules.map((r) => ({ value: r.id, label: r.value.name }))}
                    value={ruleId}
                    onChange={setRuleId}
                  />
                  <FinanceField
                    label="Variación de ventas (%)"
                    value={simulation}
                    onChange={setSimulation}
                    decimal
                  />
                  <FinanceField
                    label="Gastos deducibles de prueba (CUP)"
                    value={deductions}
                    onChange={setDeductions}
                    decimal
                  />
                  <FinanceField
                    label="Base manual de prueba (CUP)"
                    value={base}
                    onChange={setBase}
                    decimal
                  />
                  <Button
                    isDisabled={!rule}
                    onPress={() => {
                      try {
                        if (!rule) return;
                        const economy = {
                          ...data.economy,
                          income: data.economy.income * (1 + numeric(simulation) / 100),
                          deductions: numeric(deductions),
                          manualBase: numeric(base),
                        };
                        const result = calculateTax(rule.value, economy);
                        setSimulationResult(
                          `Impuesto de prueba: ${money(result.tax)}. Después de costos, deducciones e impuesto: ${money(economy.income - economy.knownCost - economy.deductions - result.tax)}. Estimación no oficial; la regla puede no estar verificada.`,
                        );
                        setLocalError('');
                      } catch (e) {
                        setLocalError(financeFailure(e));
                      }
                    }}
                  >
                    <Button.Label>Simular</Button.Label>
                  </Button>
                  {simulationResult ? (
                    <Typography.Paragraph>{simulationResult}</Typography.Paragraph>
                  ) : null}
                </Card>
              ) : null}
            </>
          )}
          <Typography.Paragraph color="muted" type="body-sm">
            {ONAT_DISCLAIMER}
          </Typography.Paragraph>
        </>
      ) : null}
      {voidId ? (
        <Card className="gap-3 p-4">
          <Typography.Heading type="h4">Anulación justificada</Typography.Heading>
          <FinanceField label="Motivo" value={reason} onChange={setReason} />
          <Button
            isDisabled={model.busy || !reason.trim()}
            onPress={() =>
              void model
                .save({ action: 'void', commandId: randomUUID(), recordId: voidId, reason })
                .then(async () => {
                  setVoidId('');
                  setReason('');
                  await model.load();
                })
                .catch(() => undefined)
            }
          >
            <Button.Label>Confirmar anulación</Button.Label>
          </Button>
          <Button variant="ghost" onPress={() => setVoidId('')}>
            <Button.Label>Cancelar</Button.Label>
          </Button>
        </Card>
      ) : null}
      {reminderId ? (
        <Card className="gap-3 p-4">
          <DateInput label="Recordar a las 09:00" value={reminderDate} onChange={setReminderDate} />
          <Button
            isDisabled={actionBusy}
            onPress={() =>
              void run(async () => {
                const obligation = obligations.find((o) => o.id === reminderId);
                if (!obligation || fulfilled(obligation))
                  throw new Error(
                    'La obligación ya está cumplida o anulada. Actualiza el calendario.',
                  );
                const d = new Date(reminderDate);
                d.setHours(9, 0, 0, 0);
                await scheduleFiscalReminder(reminderId, d);
                setReminderId('');
              })
            }
          >
            <Button.Label>Programar recordatorio</Button.Label>
          </Button>
          <Button
            variant="ghost"
            onPress={() =>
              void run(async () => {
                await cancelFiscalReminder(reminderId);
                setReminderId('');
              })
            }
          >
            <Button.Label>Quitar recordatorio</Button.Label>
          </Button>
        </Card>
      ) : null}
      <Button variant="ghost" onPress={() => goBackOrReplace('/more')}>
        <Button.Label>Volver al menú</Button.Label>
      </Button>
    </View>
  );
  return (
    <Screen scroll={false} keyboard>
      <FlatList
        data={list}
        keyExtractor={(r) => r.id}
        contentContainerClassName="gap-3 px-4 pb-8 pt-4 web:mx-auto web:w-full web:max-w-5xl"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={
          !model.loading &&
          data &&
          profiles.length &&
          ['Calendario', 'Registros'].includes(section) ? (
            <EmptyState
              title={
                section === 'Calendario'
                  ? 'Aquí aparecerán las obligaciones confirmadas'
                  : 'Aquí aparecerán tus registros fiscales'
              }
              action={
                <Button
                  variant="secondary"
                  onPress={() =>
                    section === 'Calendario' ? setSection('Resumen') : openEdit('record')
                  }
                >
                  <Button.Label>
                    {section === 'Calendario' ? 'Crear estimación' : 'Crear registro'}
                  </Button.Label>
                </Button>
              }
            />
          ) : undefined
        }
        renderItem={({ item: r }) => {
          const o = r.kind === 'obligation' ? (r.value as Obligation) : null;
          const v = r.value as FiscalRecordInput;
          const cancelled = (data?.records ?? []).some(
            (a) => a.kind === 'void' && (a.value as { recordId: string }).recordId === r.id,
          );
          const p = obligations.find((a) => a.id === r.id);
          const status = o ? fiscalStatus(o.due, p ? fulfilled(p) : false) : '';
          return (
            <Card className="gap-3 p-4">
              <Typography.Heading type="h4">
                {o?.name ??
                  {
                    payment: 'Pago tributario',
                    provision: 'Reserva',
                    expense: 'Gasto',
                    payroll: 'Salario',
                    dividend: 'Dividendo',
                    declaration: 'Constancia',
                    void: 'Anulación',
                    export: 'Exportación',
                  }[r.kind] ??
                  r.kind}
              </Typography.Heading>
              <Typography.Paragraph color="muted" type="body-sm">
                {r.date.slice(0, 10)} · {r.actor}
                {cancelled ? ' · Anulado' : ''}
              </Typography.Paragraph>
              {o ? (
                <>
                  <Chip
                    size="sm"
                    color={
                      status === 'Cumplida'
                        ? 'success'
                        : status === 'Vencida'
                          ? 'danger'
                          : status === 'Próxima'
                            ? 'warning'
                            : 'default'
                    }
                    variant="soft"
                  >
                    <Chip.Label>{status}</Chip.Label>
                  </Chip>
                  <Typography.Paragraph>
                    {o.start} — {o.end} · vence {o.due} · {o.beneficiary || o.scope}
                  </Typography.Paragraph>
                  <Typography.Paragraph>
                    Base: {money(o.calculation.base)} · estimado: {money(o.calculation.tax)} ·
                    pagado: {money(p?.paid ?? 0)}
                  </Typography.Paragraph>
                  <Typography.Paragraph color="muted" type="body-sm">
                    {o.calculation.explanation}
                  </Typography.Paragraph>
                  <Button
                    variant="secondary"
                    onPress={() => openEdit('record', { obligation: r.id })}
                  >
                    <Button.Label>Registrar pago o constancia</Button.Label>
                  </Button>
                  <Button
                    variant="ghost"
                    onPress={() => {
                      setReminderId(r.id);
                      setReminderDate(new Date(`${o.due}T09:00:00`));
                    }}
                  >
                    <Button.Label>Recordatorio local</Button.Label>
                  </Button>
                </>
              ) : r.kind === 'void' ? (
                <Typography.Paragraph>
                  {(r.value as { reason: string }).reason}
                </Typography.Paragraph>
              ) : r.kind === 'export' ? (
                <Typography.Paragraph>Solicitud de preparación registrada.</Typography.Paragraph>
              ) : (
                <>
                  <Typography.Paragraph>
                    {money(v.amount)} · {v.method}
                  </Typography.Paragraph>
                  <Typography.Paragraph>{v.notes}</Typography.Paragraph>
                  {v.reference ? (
                    <Typography.Paragraph>Referencia: {v.reference}</Typography.Paragraph>
                  ) : null}
                  {v.attachment ? (
                    <Button
                      variant="secondary"
                      isDisabled={actionBusy}
                      onPress={() =>
                        void run(() => openFiscalAttachment(v.attachment!, v.attachmentName))
                      }
                    >
                      <Button.Label>Ver comprobante</Button.Label>
                    </Button>
                  ) : null}
                </>
              )}
              {!cancelled && !['void', 'export'].includes(r.kind) ? (
                <Button
                  variant="ghost"
                  onPress={() => {
                    setVoidId(r.id);
                    setReason('');
                  }}
                >
                  <Button.Label>Anular con motivo</Button.Label>
                </Button>
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}
