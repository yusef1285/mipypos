import { Button, Card, Typography } from 'heroui-native';
import { useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import DateInput from '@/components/DateInput';
import { Choice, FinanceField, numeric } from '@/components/FinanceControls';
import { FISCAL_CATEGORIES, type FiscalProfile, type OnatCommand } from '@/lib/onat-models';
import { todayFiscal } from '@/lib/use-onat';

export function OnatProfileForm({
  initial,
  taxpayerId,
  submit,
  busy,
}: {
  initial?: FiscalProfile;
  taxpayerId: string;
  submit: (v: OnatCommand) => void;
  busy: boolean;
}) {
  const today = todayFiscal();
  const [v, set] = useState<FiscalProfile>(
    initial ?? {
      taxpayerId,
      name: '',
      nit: '',
      category: 'TCP',
      province: '',
      municipality: '',
      address: '',
      activity: '',
      secondaryActivities: '',
      regime: '',
      startDate: today,
      fiscalPeriod: 'Año natural',
      registration: '',
      accountant: '',
      source: taxpayerId === 'default' ? 'POS' : 'Manual',
      reservePercent: 0,
      reserveBase: 'Ingresos',
      effectiveFrom: today,
    },
  );
  const [step, setStep] = useState(0);
  const [reserve, setReserve] = useState(String(v.reservePercent));
  const field = (
    key:
      | 'name'
      | 'nit'
      | 'province'
      | 'municipality'
      | 'address'
      | 'activity'
      | 'secondaryActivities'
      | 'regime'
      | 'fiscalPeriod'
      | 'registration'
      | 'accountant',
    label: string,
  ) => (
    <FinanceField label={label} value={v[key]} onChange={(value) => set({ ...v, [key]: value })} />
  );
  return (
    <View className="gap-4">
      <Typography.Heading type="h3">
        {initial ? 'Nueva versión del perfil' : 'Perfil tributario'}
      </Typography.Heading>
      <Choice
        values={['Contribuyente', 'Actividad y régimen', 'Reservas']}
        value={['Contribuyente', 'Actividad y régimen', 'Reservas'][step]}
        onChange={(label) =>
          setStep(['Contribuyente', 'Actividad y régimen', 'Reservas'].indexOf(label))
        }
      />
      {step === 0 ? (
        <Card className="gap-4 p-4">
          <Choice
            values={FISCAL_CATEGORIES}
            value={v.category}
            onChange={(category) => set({ ...v, category })}
          />
          {field('name', 'Nombre o razón social')}
          {field('nit', 'NIT')}
          {field('province', 'Provincia')}
          {field('municipality', 'Municipio')}
          {field('address', 'Dirección fiscal')}
        </Card>
      ) : step === 1 ? (
        <Card className="gap-4 p-4">
          {field('activity', 'Actividad principal')}
          {field('secondaryActivities', 'Actividades secundarias')}
          {field('regime', 'Régimen tributario')}
          {field('fiscalPeriod', 'Período fiscal')}
          {field('registration', 'Inscripción y obligaciones')}
          {field('accountant', 'Contador o responsable')}
          <DateInput
            label="Inicio de operaciones"
            value={new Date(`${v.startDate}T12:00:00`)}
            onChange={(date) => set({ ...v, startDate: localDate(date) })}
          />
          <DateInput
            label="Configuración vigente desde"
            value={new Date(`${v.effectiveFrom}T12:00:00`)}
            onChange={(date) => set({ ...v, effectiveFrom: localDate(date) })}
          />
        </Card>
      ) : (
        <Card className="gap-4 p-4">
          <Typography.Paragraph>
            Las reservas son una planificación: no retiran dinero de caja.
          </Typography.Paragraph>
          <Choice
            values={['POS', 'Manual']}
            value={v.source}
            onChange={(source) => set({ ...v, source })}
          />
          <Typography.Paragraph color="muted">
            Solo un contribuyente puede reutilizar las ventas del POS. Los demás mantienen bases
            independientes.
          </Typography.Paragraph>
          <FinanceField
            label="Reserva sugerida (%)"
            value={reserve}
            onChange={setReserve}
            decimal
          />
          <Choice
            values={['Ingresos', 'Utilidad fiscal']}
            value={v.reserveBase}
            onChange={(reserveBase) => set({ ...v, reserveBase })}
          />
          <Typography.Paragraph color="muted">
            La sugerencia sobre utilidad no sustituye una base imponible verificada.
          </Typography.Paragraph>
        </Card>
      )}
      {step < 2 ? (
        <Button onPress={() => setStep(step + 1)}>
          <Button.Label>Continuar</Button.Label>
        </Button>
      ) : (
        <Button
          isDisabled={busy}
          onPress={() =>
            submit({
              action: 'profile',
              commandId: randomUUID(),
              value: { ...v, reservePercent: numeric(reserve) },
            })
          }
        >
          <Button.Label>{busy ? 'Guardando…' : 'Guardar perfil'}</Button.Label>
        </Button>
      )}
    </View>
  );
}
export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
