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
  todayIso,
  useBusinessCommand,
  useBusinessData,
} from '@/components/BusinessKit';
import { Choice, FinanceField, FinanceStatus } from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { EmptyState, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { IsoDateField } from '@/components/IsoDateField';
import { useApp } from '@/lib/app-context';
import type { Partner, PartnerMovement, PaymentMethod } from '@/lib/business-models';
import { shortDate } from '@/lib/format';
import { canAccess } from '@/lib/permissions';

const kinds = {
  contribution: 'Aporte',
  withdrawal: 'Retiro',
  dividend: 'Dividendo',
  reversal: 'Anulación',
} as const;
const kindKeys = ['contribution', 'withdrawal', 'dividend'] as const;
type Kind = (typeof kindKeys)[number];

export default function Partners() {
  const { user } = useApp();
  const { data, error, loading, load } = useBusinessData();
  const { busy, run } = useBusinessCommand(load);
  const [editing, setEditing] = useState<Partner | null>();
  const [name, setName] = useState('');
  const [doc, setDoc] = useState('');
  const [share, setShare] = useState('');
  const [joined, setJoined] = useState(todayIso());
  const [selected, setSelected] = useState<number>();
  const [kind, setKind] = useState<Kind>('contribution');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [voiding, setVoiding] = useState<string>();
  if (!user || !canAccess(user.role, 'business')) return <AccessDenied />;
  const admin = user.role === 'admin';
  const base = data?.baseCurrency ?? 'CUP';
  const start = (row: Partner | null) => {
    setEditing(row);
    setName(row?.name ?? '');
    setDoc(row?.document ?? '');
    setShare(row ? String(row.share_percent) : '');
    setJoined(row?.joined_at ?? todayIso());
  };
  // Same rule as the consolidated report: dividends do not change contributed capital.
  const effect = (m: PartnerMovement): number => {
    if (m.kind === 'contribution') return m.base_amount;
    if (m.kind === 'withdrawal') return -m.base_amount;
    if (m.kind !== 'reversal') return 0;
    const original = data?.partnerMovements.find((x) => x.id === m.reverses_id);
    return original ? -effect(original) : 0;
  };
  const capital = (id: number) =>
    (data?.partnerMovements ?? [])
      .filter((m) => m.partner_id === id)
      .reduce((sum, m) => sum + effect(m), 0);
  const currencies = [
    { value: '', label: `${base} (base)` },
    ...(data?.currencies ?? [])
      .filter((c) => c.code !== base)
      .map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })),
  ];
  const reversed = (m: PartnerMovement) =>
    (data?.partnerMovements ?? []).some((x) => x.reverses_id === m.id);
  const shareTotal = (data?.partners ?? [])
    .filter((p) => p.active === 1)
    .reduce((sum, p) => sum + p.share_percent, 0);
  return (
    <Screen
      title="Socios"
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
        <FormCard title={editing ? 'Editar socio' : 'Socio nuevo'}>
          <FinanceField label="Nombre" value={name} onChange={setName} />
          <FinanceField label="CI" value={doc} onChange={setDoc} />
          <FinanceField label="Participación (%)" decimal value={share} onChange={setShare} />
          <IsoDateField label="Ingreso" value={joined} onChange={setJoined} />
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              isDisabled={busy || !name.trim() || !share}
              onPress={() =>
                void run({
                  action: 'partner.save',
                  id: editing?.id,
                  name,
                  document: doc,
                  sharePercent: parseAmount(share),
                  joinedAt: joined,
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
            void run({ action: 'partner.void', movementId: voiding, reason }).then(
              (ok) => ok && setVoiding(undefined),
            )
          }
        />
      ) : null}
      {data ? (
        <>
          <SectionTitle badge={`${shareTotal} %`}>Socios</SectionTitle>
          {data.partners.length ? (
            data.partners.map((row) => (
              <Card key={row.id} className="gap-2 p-4">
                <View className="flex-row items-center justify-between gap-2">
                  <Typography.Paragraph className="flex-1 font-semibold">
                    {row.name}
                  </Typography.Paragraph>
                  <Chip size="sm" variant="soft">
                    {row.share_percent} %
                  </Chip>
                </View>
                <Row label="Capital neto aportado" value={amount(capital(row.id), base)} />
                <View className="flex-row gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => setSelected(selected === row.id ? undefined : row.id)}
                  >
                    <Button.Label>{selected === row.id ? 'Ocultar' : 'Movimientos'}</Button.Label>
                  </Button>
                  {admin ? (
                    <Button size="sm" variant="ghost" onPress={() => start(row)}>
                      <Button.Label>Editar</Button.Label>
                    </Button>
                  ) : null}
                </View>
                {selected === row.id ? (
                  <View className="gap-3">
                    {admin && row.active ? (
                      <>
                        <Choice
                          values={kindKeys.map((k) => kinds[k])}
                          value={kinds[kind]}
                          onChange={(v) =>
                            setKind(kindKeys.find((k) => kinds[k] === v) ?? 'contribution')
                          }
                        />
                        <FinanceField label="Importe" decimal value={value} onChange={setValue} />
                        <FinanceSelect
                          label="Moneda"
                          options={currencies}
                          value={currency}
                          onChange={setCurrency}
                        />
                        <Choice
                          values={methods.map((m) => methodLabel[m])}
                          value={methodLabel[method]}
                          onChange={(v) =>
                            setMethod(methods.find((m) => methodLabel[m] === v) ?? 'cash')
                          }
                        />
                        <FinanceField label="Nota" value={note} onChange={setNote} />
                        <Button
                          isDisabled={busy || !value}
                          onPress={() =>
                            void run({
                              action: 'partner.movement',
                              partnerId: row.id,
                              kind,
                              amount: parseAmount(value),
                              currency: currency || undefined,
                              method,
                              note,
                            }).then((ok) => {
                              if (!ok) return;
                              setValue('');
                              setNote('');
                            })
                          }
                        >
                          <Button.Label>Registrar movimiento</Button.Label>
                        </Button>
                      </>
                    ) : null}
                    {data.partnerMovements
                      .filter((m) => m.partner_id === row.id)
                      .slice(0, 30)
                      .map((m) => (
                        <View key={m.id} className="border-border gap-1 border-t pt-2">
                          <Row
                            label={`${shortDate(m.date)} · ${kinds[m.kind]} · ${methodLabel[m.method]}`}
                            value={amount(m.amount, m.currency)}
                            tone={reversed(m) ? 'line-through' : undefined}
                          />
                          {m.note ? (
                            <Typography.Paragraph type="body-sm" color="muted">
                              {m.note}
                            </Typography.Paragraph>
                          ) : null}
                          {admin && m.kind !== 'reversal' && !reversed(m) ? (
                            <Button size="sm" variant="ghost" onPress={() => setVoiding(m.id)}>
                              <Button.Label className="text-danger">Anular</Button.Label>
                            </Button>
                          ) : null}
                        </View>
                      ))}
                  </View>
                ) : null}
              </Card>
            ))
          ) : (
            <EmptyState title="No hay socios registrados." />
          )}
        </>
      ) : null}
    </Screen>
  );
}
