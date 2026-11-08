import { Button, Card, Chip, Typography } from 'heroui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import {
  FormCard,
  ReasonForm,
  Row,
  amount,
  methodLabel,
  methods,
  parseAmount,
  useBusinessCommand,
  useBusinessData,
} from '@/components/BusinessKit';
import { Choice, FinanceField, FinanceStatus } from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { EmptyState, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { IsoDateField } from '@/components/IsoDateField';
import { useApp } from '@/lib/app-context';
import type { Party, PaymentMethod } from '@/lib/business-models';
import { shortDate } from '@/lib/format';
import { canAccess } from '@/lib/permissions';

const kinds = { client: 'Cliente', supplier: 'Proveedor', both: 'Cliente y proveedor' } as const;
const kindKeys = ['client', 'supplier', 'both'] as const;
const sides = { receivable: 'Por cobrar', payable: 'Por pagar' } as const;
type Side = keyof typeof sides;

export default function Parties() {
  const { user } = useApp();
  const { data, error, loading, load } = useBusinessData();
  const { busy, run } = useBusinessCommand(load);
  const [editing, setEditing] = useState<Party | null>();
  const [form, setForm] = useState({
    kind: 'client' as Party['kind'],
    name: '',
    document: '',
    phone: '',
    email: '',
    address: '',
    creditLimit: '',
    notes: '',
  });
  const [selected, setSelected] = useState<number>();
  const [op, setOp] = useState<'charge' | 'payment'>('charge');
  const [side, setSide] = useState<Side>('receivable');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [voiding, setVoiding] = useState<string>();
  if (!user || !canAccess(user.role, 'business')) return <AccessDenied />;
  const admin = user.role === 'admin';
  const base = data?.baseCurrency ?? 'CUP';
  const start = (row: Party | null) => {
    setEditing(row);
    setForm({
      kind: row?.kind ?? 'client',
      name: row?.name ?? '',
      document: row?.document ?? '',
      phone: row?.phone ?? '',
      email: row?.email ?? '',
      address: row?.address ?? '',
      creditLimit: row ? String(row.credit_limit) : '',
      notes: row?.notes ?? '',
    });
  };
  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));
  const balance = (id: number) => data?.balances.find((b) => b.partyId === id);
  const party = data?.parties.find((p) => p.id === selected);
  const allowedSides: Side[] = !party
    ? []
    : party.kind === 'client'
      ? ['receivable']
      : party.kind === 'supplier'
        ? ['payable']
        : ['receivable', 'payable'];
  const currencies = [
    { value: '', label: `${base} (base)` },
    ...(data?.currencies ?? [])
      .filter((c) => c.code !== base)
      .map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })),
  ];
  const select = (row: Party) => {
    setSelected(row.id === selected ? undefined : row.id);
    setSide(row.kind === 'supplier' ? 'payable' : 'receivable');
    setValue('');
    setReference('');
    setDueDate('');
  };
  const submit = () => {
    if (!party) return;
    const common = {
      partyId: party.id,
      side,
      amount: parseAmount(value),
      currency: currency || undefined,
      reference,
      note: '',
    };
    void run(
      op === 'charge'
        ? { action: 'ledger.charge', ...common, dueDate: dueDate || undefined }
        : { action: 'ledger.payment', ...common, method },
      op === 'charge' ? 'Cargo registrado.' : 'Pago registrado.',
    ).then((ok) => ok && setValue(''));
  };
  return (
    <Screen
      title="Clientes y proveedores"
      keyboard
      onRefresh={load}
      action={
        admin ? (
          <Button size="sm" onPress={() => start(null)}>
            <Button.Label>Nuevo</Button.Label>
          </Button>
        ) : null
      }
    >
      <FinanceStatus loading={loading && !data} error={error} retry={() => void load()} />
      {editing !== undefined && admin ? (
        <FormCard title={editing ? 'Editar ficha' : 'Ficha nueva'}>
          <Choice
            values={kindKeys.map((k) => kinds[k])}
            value={kinds[form.kind]}
            onChange={(label) =>
              setForm((f) => ({ ...f, kind: kindKeys.find((k) => kinds[k] === label) ?? 'client' }))
            }
          />
          <FinanceField label="Nombre" value={form.name} onChange={set('name')} />
          <FinanceField label="CI / NIT" value={form.document} onChange={set('document')} />
          <FinanceField label="Teléfono" value={form.phone} onChange={set('phone')} />
          <FinanceField label="Correo" value={form.email} onChange={set('email')} />
          <FinanceField label="Dirección" value={form.address} onChange={set('address')} />
          <FinanceField
            label={`Límite de crédito en ${base} (0 = sin límite)`}
            decimal
            value={form.creditLimit}
            onChange={set('creditLimit')}
          />
          <FinanceField label="Notas" value={form.notes} onChange={set('notes')} />
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              isDisabled={busy || !form.name.trim()}
              onPress={() =>
                void run({
                  action: 'party.save',
                  id: editing?.id,
                  kind: form.kind,
                  name: form.name,
                  document: form.document,
                  phone: form.phone,
                  email: form.email,
                  address: form.address,
                  creditLimit: form.creditLimit.trim() ? parseAmount(form.creditLimit) : 0,
                  notes: form.notes,
                  active: editing ? editing.active === 1 : true,
                }).then((ok) => ok && setEditing(undefined))
              }
            >
              <Button.Label>Guardar</Button.Label>
            </Button>
            <Button className="flex-1" variant="secondary" onPress={() => setEditing(undefined)}>
              <Button.Label>Cancelar</Button.Label>
            </Button>
          </View>
        </FormCard>
      ) : null}
      {voiding ? (
        <ReasonForm
          title="Motivo de la anulación"
          busy={busy}
          onCancel={() => setVoiding(undefined)}
          onSubmit={(reason) =>
            void run({ action: 'ledger.void', entryId: voiding, reason }).then(
              (ok) => ok && setVoiding(undefined),
            )
          }
        />
      ) : null}
      {data ? (
        <>
          <SectionTitle badge={data.parties.length}>Fichas</SectionTitle>
          {data.parties.length ? (
            data.parties.map((row) => {
              const b = balance(row.id);
              return (
                <Card key={row.id} className="gap-2 p-4">
                  <View className="flex-row items-center justify-between gap-2">
                    <Typography.Paragraph className="flex-1 font-semibold">
                      {row.name}
                    </Typography.Paragraph>
                    <Chip size="sm" variant="soft">
                      {kinds[row.kind]}
                    </Chip>
                  </View>
                  {row.kind !== 'supplier' ? (
                    <Row label="Por cobrar" value={amount(b?.receivable ?? 0, base)} />
                  ) : null}
                  {row.kind !== 'client' ? (
                    <Row label="Por pagar" value={amount(b?.payable ?? 0, base)} />
                  ) : null}
                  {b?.overdue ? (
                    <Row label="Vencido" value={amount(b.overdue, base)} tone="text-danger" />
                  ) : null}
                  {row.credit_limit > 0 ? (
                    <Row label="Límite de crédito" value={amount(row.credit_limit, base)} />
                  ) : null}
                  <View className="flex-row gap-2">
                    <Button size="sm" variant="secondary" onPress={() => select(row)}>
                      <Button.Label>{selected === row.id ? 'Ocultar' : 'Cuenta'}</Button.Label>
                    </Button>
                    {admin ? (
                      <Button size="sm" variant="ghost" onPress={() => start(row)}>
                        <Button.Label>Editar</Button.Label>
                      </Button>
                    ) : null}
                  </View>
                  {selected === row.id ? (
                    <View className="gap-3">
                      {admin ? (
                        <>
                          <Choice
                            values={['Cargo', 'Pago']}
                            value={op === 'charge' ? 'Cargo' : 'Pago'}
                            onChange={(v) => setOp(v === 'Cargo' ? 'charge' : 'payment')}
                          />
                          {allowedSides.length > 1 ? (
                            <Choice
                              values={allowedSides.map((s) => sides[s])}
                              value={sides[side]}
                              onChange={(v) =>
                                setSide(v === sides.payable ? 'payable' : 'receivable')
                              }
                            />
                          ) : null}
                          <FinanceField label="Importe" decimal value={value} onChange={setValue} />
                          <FinanceSelect
                            label="Moneda"
                            options={currencies}
                            value={currency}
                            onChange={setCurrency}
                          />
                          {op === 'payment' ? (
                            <Choice
                              values={methods.map((m) => methodLabel[m])}
                              value={methodLabel[method]}
                              onChange={(v) =>
                                setMethod(methods.find((m) => methodLabel[m] === v) ?? 'cash')
                              }
                            />
                          ) : (
                            <IsoDateField
                              optional
                              label="Vence"
                              value={dueDate}
                              onChange={setDueDate}
                            />
                          )}
                          <FinanceField
                            label="Referencia (factura, recibo)"
                            value={reference}
                            onChange={setReference}
                          />
                          <Button isDisabled={busy || !value} onPress={submit}>
                            <Button.Label>
                              {op === 'charge' ? 'Registrar cargo' : 'Registrar pago'}
                            </Button.Label>
                          </Button>
                        </>
                      ) : null}
                      {data.ledger
                        .filter((e) => e.party_id === row.id)
                        .slice(0, 30)
                        .map((entry) => {
                          const reversed = data.ledger.some((e) => e.reverses_id === entry.id);
                          return (
                            <View key={entry.id} className="border-border gap-1 border-t pt-2">
                              <Row
                                label={`${shortDate(entry.date)} · ${
                                  entry.kind === 'charge'
                                    ? 'Cargo'
                                    : entry.kind === 'payment'
                                      ? `Pago ${entry.method ? methodLabel[entry.method] : ''}`
                                      : 'Anulación'
                                } · ${sides[entry.side]}`}
                                value={amount(entry.amount, entry.currency)}
                                tone={reversed ? 'line-through' : undefined}
                              />
                              {entry.reference || entry.due_date ? (
                                <Typography.Paragraph type="body-sm" color="muted">
                                  {entry.reference}
                                  {entry.due_date ? ` · vence ${entry.due_date}` : ''}
                                </Typography.Paragraph>
                              ) : null}
                              {admin && entry.kind !== 'reversal' && !reversed ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onPress={() => setVoiding(entry.id)}
                                >
                                  <Button.Label className="text-danger">Anular</Button.Label>
                                </Button>
                              ) : null}
                            </View>
                          );
                        })}
                    </View>
                  ) : null}
                </Card>
              );
            })
          ) : (
            <EmptyState title="No hay clientes ni proveedores registrados." />
          )}
        </>
      ) : null}
    </Screen>
  );
}
