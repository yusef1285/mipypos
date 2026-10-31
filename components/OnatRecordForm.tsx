import { Button, Card, Typography } from 'heroui-native';
import { useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import DateInput from '@/components/DateInput';
import { Choice, FinanceField, financeFailure, numeric } from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { localDate } from '@/components/OnatProfileForm';
import { pickFiscalAttachment } from '@/lib/onat-documents';
import { activeRecords } from '@/lib/onat';
import {
  type FiscalData,
  type FiscalRecordInput,
  type Obligation,
  type OnatCommand,
} from '@/lib/onat-models';
import { todayFiscal } from '@/lib/use-onat';

const labels = {
  payment: 'Pago tributario',
  provision: 'Reserva',
  expense: 'Gasto fiscal',
  payroll: 'Salario',
  dividend: 'Dividendo',
  declaration: 'Constancia de declaración',
} as const;
export function OnatRecordForm({
  data,
  taxpayerId,
  obligationId,
  submit,
  busy,
}: {
  data: FiscalData;
  taxpayerId: string;
  obligationId?: string;
  submit: (v: OnatCommand) => void;
  busy: boolean;
}) {
  const [v, set] = useState<FiscalRecordInput>({
    taxpayerId,
    kind: 'payment',
    date: todayFiscal(),
    amount: 0,
    reference: '',
    operationCode: '',
    account: '',
    method: 'Transfermóvil',
    notes: '',
    obligationId: obligationId ?? null,
    beneficiary: '',
    deductionRuleId: null,
    attachment: null,
    attachmentName: '',
  });
  const [amount, setAmount] = useState(''),
    [error, setError] = useState(''),
    [attaching, setAttaching] = useState(false);
  const obligations = activeRecords(data.records).filter(
    (r) => r.kind === 'obligation' && r.taxpayerId === taxpayerId,
  );
  const obligation = obligations.find((o) => o.id === v.obligationId)?.value as
    | Obligation
    | undefined;
  return (
    <View className="gap-4">
      <Typography.Heading type="h3">Registrar movimiento fiscal</Typography.Heading>
      <Choice
        values={Object.values(labels)}
        value={labels[v.kind]}
        onChange={(label) =>
          set({
            ...v,
            kind: (Object.keys(labels) as Array<keyof typeof labels>).find(
              (k) => labels[k] === label,
            )!,
          })
        }
      />
      <Card className="gap-4 p-4">
        {['payment', 'declaration'].includes(v.kind) ? (
          <FinanceSelect
            label="Obligación"
            value={v.obligationId ?? ''}
            options={obligations.map((r) => ({
              value: r.id,
              label: `${(r.value as Obligation).name} · ${(r.value as Obligation).start} · ${(r.value as Obligation).beneficiary || 'Empresa'}`,
            }))}
            onChange={(obligationId) => set({ ...v, obligationId })}
          />
        ) : null}
        {obligation ? (
          <Typography.Paragraph>
            Estimado: {obligation.calculation.tax.toFixed(2)} CUP · período {obligation.start} —{' '}
            {obligation.end}
          </Typography.Paragraph>
        ) : null}
        <DateInput
          label={v.kind === 'payment' ? 'Fecha de pago' : 'Fecha del registro'}
          value={new Date(`${v.date}T12:00:00`)}
          onChange={(date) => set({ ...v, date: localDate(date) })}
        />
        {v.kind !== 'declaration' ? (
          <FinanceField label="Importe (CUP)" value={amount} onChange={setAmount} decimal />
        ) : null}
        {v.kind === 'payment' ? (
          <>
            <Choice
              values={['Efectivo', 'Transfermóvil', 'Banca electrónica', 'Transferencia', 'Otro']}
              value={v.method}
              onChange={(method) => set({ ...v, method })}
            />
            <FinanceField
              label="Referencia"
              value={v.reference}
              onChange={(reference) => set({ ...v, reference })}
            />
            <FinanceField
              label="Código de operación"
              value={v.operationCode}
              onChange={(operationCode) => set({ ...v, operationCode })}
            />
            <FinanceField
              label="Cuenta fiscal utilizada"
              value={v.account}
              onChange={(account) => set({ ...v, account })}
            />
            <Typography.Paragraph color="muted">
              Registra un pago ya realizado. MipyPOS no ejecuta transferencias ni modifica caja.
            </Typography.Paragraph>
          </>
        ) : null}
        {v.kind === 'dividend' ? (
          <FinanceField
            label="Socio receptor (identificador o NIT)"
            value={v.beneficiary}
            onChange={(beneficiary) => set({ ...v, beneficiary })}
          />
        ) : null}
        {v.kind === 'expense' ? (
          <>
            <FinanceSelect
              label="Deducible únicamente para esta regla"
              value={v.deductionRuleId ?? ''}
              options={[
                { value: '', label: 'No autorizado como deducible' },
                ...data.rules.map((r) => ({
                  value: r.id,
                  label: `${r.value.name} · ${r.value.effectiveFrom}`,
                })),
              ]}
              onChange={(deductionRuleId) =>
                set({ ...v, deductionRuleId: deductionRuleId || null })
              }
            />
            <Typography.Paragraph color="muted">
              No registres otra vez el costo vendido. La deducción necesita respaldo y revisión
              normativa.
            </Typography.Paragraph>
          </>
        ) : null}
        {v.kind === 'declaration' ? (
          <Typography.Paragraph>
            Esta constancia documenta una presentación realizada fuera de MipyPOS. Adjunta su
            justificante; la aplicación no presenta declaraciones.
          </Typography.Paragraph>
        ) : null}
        <FinanceField
          label="Motivo, justificación u observaciones"
          value={v.notes}
          onChange={(notes) => set({ ...v, notes })}
        />
        <Button
          variant="secondary"
          isDisabled={attaching || busy}
          onPress={() =>
            void (async () => {
              setAttaching(true);
              setError('');
              try {
                const a = await pickFiscalAttachment();
                if (a) set({ ...v, attachment: a.data, attachmentName: a.name });
              } catch (e) {
                setError(financeFailure(e));
              } finally {
                setAttaching(false);
              }
            })()
          }
        >
          <Button.Label>
            {attaching ? 'Adjuntando…' : v.attachmentName || 'Adjuntar comprobante'}
          </Button.Label>
        </Button>
        {v.attachment ? (
          <Button
            variant="ghost"
            onPress={() => set({ ...v, attachment: null, attachmentName: '' })}
          >
            <Button.Label>Quitar adjunto</Button.Label>
          </Button>
        ) : null}
        {error ? (
          <Typography.Paragraph className="text-danger">{error}</Typography.Paragraph>
        ) : null}
      </Card>
      <Button
        isDisabled={busy || attaching}
        onPress={() =>
          submit({
            action: 'record',
            commandId: randomUUID(),
            value: {
              ...v,
              amount: v.kind === 'declaration' ? 0 : numeric(amount),
              obligationId: ['payment', 'declaration'].includes(v.kind) ? v.obligationId : null,
              deductionRuleId: v.kind === 'expense' ? v.deductionRuleId : null,
            },
          })
        }
      >
        <Button.Label>{busy ? 'Guardando…' : 'Confirmar registro'}</Button.Label>
      </Button>
    </View>
  );
}
