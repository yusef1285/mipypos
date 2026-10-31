import { Button, Card, Typography } from 'heroui-native';
import { useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import DateInput from '@/components/DateInput';
import { Choice, FinanceField, numeric } from '@/components/FinanceControls';
import { localDate } from '@/components/OnatProfileForm';
import {
  BASE_NAMES,
  FISCAL_CATEGORIES,
  LEGAL_REFERENCE,
  TAX_NAMES,
  type FiscalRule,
  type OnatCommand,
  type RuleVersion,
} from '@/lib/onat-models';
import { todayFiscal } from '@/lib/use-onat';

export function OnatRuleForm({
  initial,
  submit,
  busy,
}: {
  initial?: RuleVersion;
  submit: (v: OnatCommand) => void;
  busy: boolean;
}) {
  const [v, set] = useState<FiscalRule>(
    initial?.value ?? {
      ruleKey: randomUUID(),
      name: 'Ingresos personales',
      categories: ['TCP'],
      activities: [],
      municipalities: [],
      scope: 'Empresa',
      base: 'Ingresos',
      method: 'Porcentaje',
      rate: 0,
      fixed: 0,
      bands: [],
      exempt: 0,
      bonusPercent: 0,
      allowCost: false,
      frequency: 'Mensual',
      dueDay: 1,
      dueMonths: 1,
      effectiveFrom: todayFiscal(),
      effectiveTo: null,
      sourceUrl: LEGAL_REFERENCE.url,
      disposition: '',
      article: '',
      verifiedOn: null,
      verificationNote: '',
      notes: '',
    },
  );
  const [rate, setRate] = useState(String(v.rate)),
    [fixed, setFixed] = useState(String(v.fixed)),
    [exempt, setExempt] = useState(String(v.exempt)),
    [bonus, setBonus] = useState(String(v.bonusPercent)),
    [day, setDay] = useState(String(v.dueDay)),
    [months, setMonths] = useState(String(v.dueMonths));
  const [activities, setActivities] = useState(v.activities.join('; ')),
    [municipalities, setMunicipalities] = useState(v.municipalities.join('; '));
  const [bands, setBands] = useState(
    v.bands.map((b) => ({ limit: b.upTo === null ? '' : String(b.upTo), rate: String(b.rate) })),
  );
  const [step, setStep] = useState('Aplicación');
  const [advanceKeys, setAdvanceKeys] = useState((v.advanceRuleKeys ?? []).join('; '));
  const split = (s: string) =>
    s
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <View className="gap-4">
      <Typography.Heading type="h3">
        {initial ? 'Nueva vigencia del impuesto' : 'Configurar regla fiscal'}
      </Typography.Heading>
      <Typography.Paragraph color="muted">
        No hay tasas precargadas. Registra la normativa aplicable antes de confirmar cálculos.
      </Typography.Paragraph>
      <Choice
        values={['Aplicación', 'Cálculo', 'Vigencia y fuente']}
        value={step}
        onChange={setStep}
      />
      {step === 'Aplicación' ? (
        <Card className="gap-4 p-4">
          <Choice
            values={TAX_NAMES}
            value={
              TAX_NAMES.includes(v.name as (typeof TAX_NAMES)[number])
                ? (v.name as (typeof TAX_NAMES)[number])
                : 'Otro tributo'
            }
            onChange={(name) => set({ ...v, name })}
          />
          <FinanceField
            label="Nombre del impuesto o contribución"
            value={v.name}
            onChange={(name) => set({ ...v, name })}
          />
          <Typography.Paragraph>Contribuyentes afectados</Typography.Paragraph>
          {FISCAL_CATEGORIES.map((category) => (
            <Button
              key={category}
              variant={v.categories.includes(category) ? 'primary' : 'secondary'}
              onPress={() =>
                set({
                  ...v,
                  categories: v.categories.includes(category)
                    ? v.categories.filter((c) => c !== category)
                    : [...v.categories, category],
                })
              }
            >
              <Button.Label>{category}</Button.Label>
            </Button>
          ))}
          <FinanceField
            label="Actividades aplicables (separadas por ;)"
            value={activities}
            onChange={setActivities}
          />
          <FinanceField
            label="Municipios aplicables (separados por ;)"
            value={municipalities}
            onChange={setMunicipalities}
          />
          <Typography.Paragraph color="muted">
            Un campo vacío aplica a todas las actividades o municipios del perfil. Revisa antes de
            guardar.
          </Typography.Paragraph>
          <Choice
            values={['Empresa', 'Socio']}
            value={v.scope}
            onChange={(scope) => set({ ...v, scope })}
          />
          <Choice
            values={['Diaria', 'Mensual', 'Trimestral', 'Anual', 'Personalizada']}
            value={v.frequency}
            onChange={(frequency) => set({ ...v, frequency })}
          />
        </Card>
      ) : step === 'Cálculo' ? (
        <Card className="gap-4 p-4">
          <Choice values={BASE_NAMES} value={v.base} onChange={(base) => set({ ...v, base })} />
          <Choice
            values={['Porcentaje', 'Escala', 'Cuota fija']}
            value={v.method}
            onChange={(method) => set({ ...v, method })}
          />
          {v.method === 'Porcentaje' ? (
            <FinanceField label="Tipo impositivo (%)" value={rate} onChange={setRate} decimal />
          ) : v.method === 'Cuota fija' ? (
            <FinanceField label="Cuota (CUP)" value={fixed} onChange={setFixed} decimal />
          ) : (
            <View className="gap-3">
              <Typography.Paragraph>
                Tramos marginales: último límite vacío = sin límite.
              </Typography.Paragraph>
              {bands.map((band, i) => (
                <View key={i} className="gap-2">
                  <FinanceField
                    label={`Límite superior del tramo ${i + 1}`}
                    value={band.limit}
                    decimal
                    onChange={(limit) =>
                      setBands(bands.map((b, j) => (i === j ? { ...b, limit } : b)))
                    }
                  />
                  <FinanceField
                    label="Porcentaje del tramo"
                    value={band.rate}
                    decimal
                    onChange={(rate) =>
                      setBands(bands.map((b, j) => (i === j ? { ...b, rate } : b)))
                    }
                  />
                  <Button variant="ghost" onPress={() => setBands(bands.filter((_, j) => i !== j))}>
                    <Button.Label>Quitar tramo</Button.Label>
                  </Button>
                </View>
              ))}
              <Button
                variant="secondary"
                onPress={() => setBands([...bands, { limit: '', rate: '0' }])}
              >
                <Button.Label>Añadir tramo</Button.Label>
              </Button>
            </View>
          )}
          <FinanceField label="Mínimo exento (CUP)" value={exempt} onChange={setExempt} decimal />
          <FinanceField label="Bonificación (%)" value={bonus} onChange={setBonus} decimal />
          <Button variant="secondary" onPress={() => set({ ...v, allowCost: !v.allowCost })}>
            <Button.Label>
              {v.allowCost ? 'Costo vendido deducible: sí' : 'Costo vendido deducible: no'}
            </Button.Label>
          </Button>
          <FinanceField
            label="Impuestos anticipados a descontar (claves separadas por ;)"
            value={advanceKeys}
            onChange={setAdvanceKeys}
          />
          <Typography.Paragraph color="muted">
            Solo descuenta pagos confirmados vinculados a las reglas seleccionadas. El contador debe
            comprobar que esta compensación corresponde.
          </Typography.Paragraph>
          <FinanceField label="Día de vencimiento" value={day} onChange={setDay} decimal />
          <FinanceField
            label="Meses después del período"
            value={months}
            onChange={setMonths}
            decimal
          />
          <Typography.Paragraph color="muted">
            Si vence en días hábiles o tiene una fórmula especial, no uses esta regla: requiere
            validación adicional.
          </Typography.Paragraph>
        </Card>
      ) : (
        <Card className="gap-4 p-4">
          <DateInput
            label="Vigente desde"
            value={new Date(`${v.effectiveFrom}T12:00:00`)}
            onChange={(date) => set({ ...v, effectiveFrom: localDate(date) })}
          />
          <Button
            variant="secondary"
            onPress={() => set({ ...v, effectiveTo: v.effectiveTo ? null : todayFiscal() })}
          >
            <Button.Label>{v.effectiveTo ? 'Sin fecha final' : 'Añadir fecha final'}</Button.Label>
          </Button>
          {v.effectiveTo ? (
            <DateInput
              label="Vigente hasta"
              value={new Date(`${v.effectiveTo}T12:00:00`)}
              onChange={(date) => set({ ...v, effectiveTo: localDate(date) })}
            />
          ) : null}
          <FinanceField
            label="Fuente legal oficial (URL)"
            value={v.sourceUrl}
            onChange={(sourceUrl) => set({ ...v, sourceUrl })}
          />
          <FinanceField
            label="Disposición, número y año"
            value={v.disposition}
            onChange={(disposition) => set({ ...v, disposition })}
          />
          <FinanceField
            label="Artículo o apartado"
            value={v.article}
            onChange={(article) => set({ ...v, article })}
          />
          <FinanceField
            label="Exenciones, condiciones y observaciones"
            value={v.notes}
            onChange={(notes) => set({ ...v, notes })}
          />
          <FinanceField
            label="Evidencia de verificación y aplicabilidad"
            value={v.verificationNote}
            onChange={(verificationNote) => set({ ...v, verificationNote })}
          />
          <Button
            variant="secondary"
            onPress={() => set({ ...v, verifiedOn: v.verifiedOn ? null : todayFiscal() })}
          >
            <Button.Label>
              {v.verifiedOn ? 'Marcar sin verificar' : 'Registrar comprobación del contador'}
            </Button.Label>
          </Button>
          {v.verifiedOn ? (
            <DateInput
              label="Última verificación"
              value={new Date(`${v.verifiedOn}T12:00:00`)}
              onChange={(date) => set({ ...v, verifiedOn: localDate(date) })}
            />
          ) : null}
        </Card>
      )}
      <Button
        isDisabled={busy}
        onPress={() =>
          submit({
            action: 'rule',
            commandId: randomUUID(),
            replacesId: initial?.id ?? null,
            value: {
              ...v,
              rate: numeric(rate),
              fixed: numeric(fixed),
              exempt: numeric(exempt),
              bonusPercent: numeric(bonus),
              dueDay: numeric(day),
              dueMonths: numeric(months),
              activities: split(activities),
              advanceRuleKeys: split(advanceKeys),
              municipalities: split(municipalities),
              bands: bands.map((b) => ({
                upTo: b.limit ? numeric(b.limit) : null,
                rate: numeric(b.rate),
              })),
            },
          })
        }
      >
        <Button.Label>{busy ? 'Guardando…' : 'Guardar versión de regla'}</Button.Label>
      </Button>
    </View>
  );
}
