import { Button, Card, Chip, Typography } from 'heroui-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import {
  FormCard,
  Row,
  parseAmount,
  todayIso,
  useBusinessCommand,
  useBusinessData,
} from '@/components/BusinessKit';
import { FinanceField, FinanceStatus } from '@/components/FinanceControls';
import { EmptyState, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import { canAccess } from '@/lib/permissions';

export default function Currencies() {
  const { user } = useApp();
  const { data, error, loading, load } = useBusinessData();
  const { busy, run } = useBusinessCommand(load);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [rateFor, setRateFor] = useState<string>();
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(todayIso());
  const [source, setSource] = useState('');
  if (!user || !canAccess(user.role, 'business')) return <AccessDenied />;
  const admin = user.role === 'admin';
  const base = data?.baseCurrency ?? 'CUP';
  const latest = (c: string) => data?.rates.find((r) => r.code === c);
  return (
    <Screen
      title="Monedas y tasas"
      keyboard
      onRefresh={load}
      action={
        admin ? (
          <Button size="sm" onPress={() => setAdding((v) => !v)}>
            <Button.Label>{adding ? 'Cerrar' : 'Nueva'}</Button.Label>
          </Button>
        ) : null
      }
    >
      <FinanceStatus loading={loading && !data} error={error} retry={() => void load()} />
      <Card className="gap-1 p-4">
        <Typography.Paragraph type="body-sm" color="muted">
          Moneda base de la contabilidad
        </Typography.Paragraph>
        <Typography.Heading type="h3">{base}</Typography.Heading>
        <Typography.Paragraph type="body-sm" color="muted">
          Los importes en otras monedas se convierten con la tasa vigente del día del registro. El
          efectivo en divisas se informa aparte del arqueo en {base}.
        </Typography.Paragraph>
      </Card>
      {adding && admin ? (
        <FormCard title="Registrar moneda">
          <FinanceField label="Código (USD, EUR, MLC)" value={code} onChange={setCode} />
          <FinanceField label="Nombre" value={name} onChange={setName} />
          <FinanceField label="Símbolo" value={symbol} onChange={setSymbol} />
          <Button
            isDisabled={busy || !code || !name || !symbol}
            onPress={() =>
              void run({ action: 'currency.save', code, name, symbol, decimals: 2 }).then((ok) => {
                if (!ok) return;
                setAdding(false);
                setCode('');
                setName('');
                setSymbol('');
              })
            }
          >
            <Button.Label>Guardar moneda</Button.Label>
          </Button>
        </FormCard>
      ) : null}
      {rateFor && admin ? (
        <FormCard title={`Tasa de ${rateFor} en ${base}`}>
          <FinanceField
            label={`1 ${rateFor} = ? ${base}`}
            decimal
            value={rate}
            onChange={setRate}
          />
          <FinanceField label="Vigente desde (AAAA-MM-DD)" value={date} onChange={setDate} />
          <FinanceField label="Fuente (opcional)" value={source} onChange={setSource} />
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              isDisabled={busy || !rate}
              onPress={() =>
                void run({
                  action: 'currency.rate',
                  code: rateFor,
                  rate: parseAmount(rate),
                  effectiveDate: date,
                  source,
                }).then((ok) => {
                  if (!ok) return;
                  setRateFor(undefined);
                  setRate('');
                })
              }
            >
              <Button.Label>Registrar tasa</Button.Label>
            </Button>
            <Button className="flex-1" variant="secondary" onPress={() => setRateFor(undefined)}>
              <Button.Label>Cancelar</Button.Label>
            </Button>
          </View>
        </FormCard>
      ) : null}
      {data ? (
        <>
          <SectionTitle badge={data.currencies.length}>Monedas</SectionTitle>
          {data.currencies.length ? (
            data.currencies.map((c) => {
              const current = latest(c.code);
              return (
                <Card key={c.code} className="gap-2 p-4">
                  <View className="flex-row items-center justify-between gap-2">
                    <Typography.Paragraph className="flex-1 font-semibold">
                      {c.code} · {c.name} ({c.symbol})
                    </Typography.Paragraph>
                    {c.code === base ? (
                      <Chip size="sm" variant="soft" color="accent">
                        Base
                      </Chip>
                    ) : null}
                  </View>
                  {c.code !== base ? (
                    current ? (
                      <Row
                        label={`Última tasa (${current.effective_date})`}
                        value={`${current.rate} ${base}`}
                      />
                    ) : (
                      <Typography.Paragraph type="body-sm" className="text-warning">
                        Sin tasa registrada; no se puede operar en esta moneda.
                      </Typography.Paragraph>
                    )
                  ) : null}
                  {admin ? (
                    <View className="flex-row flex-wrap gap-2">
                      {c.code !== base ? (
                        <Button size="sm" variant="secondary" onPress={() => setRateFor(c.code)}>
                          <Button.Label>Nueva tasa</Button.Label>
                        </Button>
                      ) : null}
                      {c.code !== base ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          isDisabled={busy}
                          onPress={() =>
                            Alert.alert(
                              'Cambiar moneda base',
                              'Solo es posible antes de registrar tasas o importes.',
                              [
                                { text: 'Cancelar', style: 'cancel' },
                                {
                                  text: 'Cambiar',
                                  onPress: () =>
                                    void run({ action: 'currency.setBase', code: c.code }),
                                },
                              ],
                            )
                          }
                        >
                          <Button.Label>Usar como base</Button.Label>
                        </Button>
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              );
            })
          ) : (
            <EmptyState
              title={`Solo se usa ${base}. Registra divisas si cobras o pagas en ellas.`}
            />
          )}
          {data.rates.length ? (
            <>
              <SectionTitle>Historial de tasas</SectionTitle>
              <Card className="gap-2 p-4">
                {data.rates.slice(0, 40).map((r) => (
                  <Row
                    key={r.id}
                    label={`${r.effective_date} · ${r.code}${r.source ? ` · ${r.source}` : ''}`}
                    value={`${r.rate} ${base}`}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
