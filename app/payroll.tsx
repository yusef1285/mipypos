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
  monthStartIso,
  parseAmount,
  todayIso,
  useBusinessCommand,
  useBusinessData,
} from '@/components/BusinessKit';
import { Choice, FinanceField, FinanceStatus } from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { EmptyState, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import type { Employee, PaymentMethod, PayrollRun } from '@/lib/business-models';
import { canAccess } from '@/lib/permissions';

const periods = { monthly: 'Mensual', biweekly: 'Quincenal', weekly: 'Semanal' } as const;
const periodKeys = ['monthly', 'biweekly', 'weekly'] as const;
const status: Record<PayrollRun['status'], string> = {
  draft: 'Borrador',
  approved: 'Aprobada',
  paid: 'Pagada',
  void: 'Anulada',
};
const NONE = 'none';

export default function Payroll() {
  const { user } = useApp();
  const { data, error, loading, load } = useBusinessData();
  const { busy, run } = useBusinessCommand(load);
  const [editing, setEditing] = useState<Employee | null>();
  const [emp, setEmp] = useState({
    name: '',
    document: '',
    position: '',
    branch: NONE,
    salary: '',
    period: 'monthly' as Employee['pay_period'],
    start: todayIso(),
  });
  const [creating, setCreating] = useState(false);
  const [periodStart, setPeriodStart] = useState(monthStartIso());
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [contribution, setContribution] = useState('0');
  const [extras, setExtras] = useState<Record<number, { bonus: string; deduction: string }>>({});
  const [paying, setPaying] = useState<string>();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [voiding, setVoiding] = useState<string>();
  const [open, setOpen] = useState<string>();
  if (!user || !canAccess(user.role, 'business')) return <AccessDenied />;
  const admin = user.role === 'admin';
  const base = data?.baseCurrency ?? 'CUP';
  const branchOptions = [
    { value: NONE, label: 'Principal' },
    ...(data?.branches ?? []).map((b) => ({ value: String(b.id), label: b.name })),
  ];
  const active = (data?.employees ?? []).filter((e) => e.active === 1);
  const startEmployee = (row: Employee | null) => {
    setEditing(row);
    setEmp({
      name: row?.name ?? '',
      document: row?.document ?? '',
      position: row?.position ?? '',
      branch: row?.branch_id == null ? NONE : String(row.branch_id),
      salary: row ? String(row.base_salary) : '',
      period: row?.pay_period ?? 'monthly',
      start: row?.start_date ?? todayIso(),
    });
  };
  const set = (key: keyof typeof emp) => (v: string) => setEmp((e) => ({ ...e, [key]: v }));
  const extra = (id: number) => extras[id] ?? { bonus: '', deduction: '' };
  const setExtra = (id: number, key: 'bonus' | 'deduction', v: string) =>
    setExtras((x) => ({ ...x, [id]: { ...extra(id), [key]: v } }));
  return (
    <Screen
      title="Nómina"
      keyboard
      onRefresh={load}
      action={
        admin ? (
          <Button size="sm" onPress={() => startEmployee(null)}>
            <Button.Label>Trabajador</Button.Label>
          </Button>
        ) : null
      }
    >
      <FinanceStatus loading={loading && !data} error={error} retry={() => void load()} />
      <Typography.Paragraph type="body-sm" color="muted">
        La nómina calcula bruto, deducciones y aporte con los datos que indiques. No aplica tablas
        legales automáticas; valida tasas y retenciones con tu contador.
      </Typography.Paragraph>
      {editing !== undefined && admin ? (
        <FormCard title={editing ? 'Editar trabajador' : 'Trabajador nuevo'}>
          <FinanceField label="Nombre" value={emp.name} onChange={set('name')} />
          <FinanceField label="CI" value={emp.document} onChange={set('document')} />
          <FinanceField label="Cargo" value={emp.position} onChange={set('position')} />
          <FinanceSelect
            label="Sucursal"
            options={branchOptions}
            value={emp.branch}
            onChange={set('branch')}
          />
          <FinanceField
            label={`Salario base (${base})`}
            decimal
            value={emp.salary}
            onChange={set('salary')}
          />
          <Choice
            values={periodKeys.map((k) => periods[k])}
            value={periods[emp.period]}
            onChange={(v) =>
              setEmp((e) => ({
                ...e,
                period: periodKeys.find((k) => periods[k] === v) ?? 'monthly',
              }))
            }
          />
          <FinanceField label="Alta (AAAA-MM-DD)" value={emp.start} onChange={set('start')} />
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              isDisabled={busy || !emp.name.trim()}
              onPress={() =>
                void run({
                  action: 'employee.save',
                  id: editing?.id,
                  name: emp.name,
                  document: emp.document,
                  position: emp.position,
                  branchId: emp.branch === NONE ? null : Number(emp.branch),
                  baseSalary: emp.salary.trim() ? parseAmount(emp.salary) : 0,
                  payPeriod: emp.period,
                  startDate: emp.start,
                  endDate: editing?.end_date ?? null,
                  active: editing ? editing.active === 1 : true,
                }).then((ok) => ok && setEditing(undefined))
              }
            >
              <Button.Label>Guardar</Button.Label>
            </Button>
            {editing ? (
              <Button
                className="flex-1"
                variant="ghost"
                isDisabled={busy}
                onPress={() =>
                  void run({
                    action: 'employee.save',
                    id: editing.id,
                    name: editing.name,
                    document: editing.document,
                    position: editing.position,
                    branchId: editing.branch_id,
                    baseSalary: editing.base_salary,
                    payPeriod: editing.pay_period,
                    startDate: editing.start_date,
                    endDate: editing.active ? todayIso() : null,
                    active: editing.active !== 1,
                  }).then((ok) => ok && setEditing(undefined))
                }
              >
                <Button.Label>{editing.active ? 'Dar de baja' : 'Reactivar'}</Button.Label>
              </Button>
            ) : null}
            <Button className="flex-1" variant="secondary" onPress={() => setEditing(undefined)}>
              <Button.Label>Cancelar</Button.Label>
            </Button>
          </View>
        </FormCard>
      ) : null}
      {voiding ? (
        <ReasonForm
          title="Motivo de la anulación de la nómina"
          busy={busy}
          onCancel={() => setVoiding(undefined)}
          onSubmit={(reason) =>
            void run({ action: 'payroll.void', runId: voiding, reason }).then(
              (ok) => ok && setVoiding(undefined),
            )
          }
        />
      ) : null}
      {data ? (
        <>
          <SectionTitle badge={data.employees.length}>Trabajadores</SectionTitle>
          {data.employees.length ? (
            data.employees.map((row) => (
              <Card key={row.id} className="gap-1 p-4">
                <View className="flex-row items-center justify-between gap-2">
                  <Typography.Paragraph className="flex-1 font-semibold">
                    {row.name}
                  </Typography.Paragraph>
                  {!row.active ? (
                    <Chip size="sm" variant="soft">
                      Baja
                    </Chip>
                  ) : null}
                </View>
                <Row
                  label={`${row.position || 'Sin cargo'} · ${periods[row.pay_period]}`}
                  value={amount(row.base_salary, base)}
                />
                {admin ? (
                  <Button size="sm" variant="ghost" onPress={() => startEmployee(row)}>
                    <Button.Label>Editar</Button.Label>
                  </Button>
                ) : null}
              </Card>
            ))
          ) : (
            <EmptyState title="Registra a tus trabajadores para preparar la nómina." />
          )}
          <SectionTitle badge={data.payrollRuns.length}>Nóminas</SectionTitle>
          {admin && active.length ? (
            creating ? (
              <FormCard title="Preparar nómina">
                <FinanceField
                  label="Desde (AAAA-MM-DD)"
                  value={periodStart}
                  onChange={setPeriodStart}
                />
                <FinanceField
                  label="Hasta (AAAA-MM-DD)"
                  value={periodEnd}
                  onChange={setPeriodEnd}
                />
                <FinanceField
                  label="Aporte del empleador (%)"
                  decimal
                  value={contribution}
                  onChange={setContribution}
                />
                {active.map((e) => (
                  <View key={e.id} className="border-border gap-2 border-t pt-2">
                    <Row label={e.name} value={amount(e.base_salary, base)} />
                    <View className="flex-row gap-2">
                      <View className="flex-1">
                        <FinanceField
                          label="Bonos"
                          decimal
                          value={extra(e.id).bonus}
                          onChange={(v) => setExtra(e.id, 'bonus', v)}
                        />
                      </View>
                      <View className="flex-1">
                        <FinanceField
                          label="Deducciones"
                          decimal
                          value={extra(e.id).deduction}
                          onChange={(v) => setExtra(e.id, 'deduction', v)}
                        />
                      </View>
                    </View>
                  </View>
                ))}
                <View className="flex-row gap-2">
                  <Button
                    className="flex-1"
                    isDisabled={busy}
                    onPress={() =>
                      void run(
                        {
                          action: 'payroll.create',
                          periodStart,
                          periodEnd,
                          contributionRate: parseAmount(contribution || '0'),
                          note: '',
                          lines: active.map((e) => ({
                            employeeId: e.id,
                            base: e.base_salary,
                            bonuses: extra(e.id).bonus ? parseAmount(extra(e.id).bonus) : 0,
                            deductions: extra(e.id).deduction
                              ? parseAmount(extra(e.id).deduction)
                              : 0,
                          })),
                        },
                        'Nómina creada en borrador. Revísala y apruébala.',
                      ).then((ok) => {
                        if (!ok) return;
                        setCreating(false);
                        setExtras({});
                      })
                    }
                  >
                    <Button.Label>Crear borrador</Button.Label>
                  </Button>
                  <Button className="flex-1" variant="secondary" onPress={() => setCreating(false)}>
                    <Button.Label>Cancelar</Button.Label>
                  </Button>
                </View>
              </FormCard>
            ) : (
              <Button variant="secondary" onPress={() => setCreating(true)}>
                <Button.Label>Preparar nómina</Button.Label>
              </Button>
            )
          ) : null}
          {data.payrollRuns.length ? (
            data.payrollRuns.map((r) => (
              <Card key={r.id} className="gap-2 p-4">
                <View className="flex-row items-center justify-between gap-2">
                  <Typography.Paragraph className="flex-1 font-semibold">
                    {r.period_start} → {r.period_end}
                  </Typography.Paragraph>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={
                      r.status === 'paid' ? 'success' : r.status === 'void' ? 'default' : 'warning'
                    }
                  >
                    {status[r.status]}
                  </Chip>
                </View>
                <Row label="Bruto" value={amount(r.gross_total, base)} />
                <Row label="Deducciones" value={amount(r.deductions_total, base)} />
                <Row label="Neto a pagar" value={amount(r.net_total, base)} />
                <Row
                  label={`Aporte empleador (${r.contribution_rate} %)`}
                  value={amount(r.contribution_total, base)}
                />
                {r.void_reason ? (
                  <Typography.Paragraph type="body-sm" className="text-danger">
                    Anulada: {r.void_reason}
                  </Typography.Paragraph>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => setOpen(open === r.id ? undefined : r.id)}
                >
                  <Button.Label>{open === r.id ? 'Ocultar detalle' : 'Ver detalle'}</Button.Label>
                </Button>
                {open === r.id
                  ? data.payrollLines
                      .filter((l) => l.run_id === r.id)
                      .map((l) => (
                        <Row key={l.id} label={l.employee_name} value={amount(l.net, base)} />
                      ))
                  : null}
                {paying === r.id ? (
                  <View className="gap-2">
                    <Choice
                      values={methods.map((m) => methodLabel[m])}
                      value={methodLabel[method]}
                      onChange={(v) =>
                        setMethod(methods.find((m) => methodLabel[m] === v) ?? 'cash')
                      }
                    />
                    <Button
                      isDisabled={busy}
                      onPress={() =>
                        void run({ action: 'payroll.pay', runId: r.id, method }).then(
                          (ok) => ok && setPaying(undefined),
                        )
                      }
                    >
                      <Button.Label>Confirmar pago</Button.Label>
                    </Button>
                  </View>
                ) : null}
                {admin && r.status !== 'void' ? (
                  <View className="flex-row flex-wrap gap-2">
                    {r.status === 'draft' ? (
                      <Button
                        size="sm"
                        isDisabled={busy}
                        onPress={() => void run({ action: 'payroll.approve', runId: r.id })}
                      >
                        <Button.Label>Aprobar</Button.Label>
                      </Button>
                    ) : null}
                    {r.status === 'approved' && paying !== r.id ? (
                      <Button size="sm" onPress={() => setPaying(r.id)}>
                        <Button.Label>Pagar</Button.Label>
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onPress={() => setVoiding(r.id)}>
                      <Button.Label className="text-danger">Anular</Button.Label>
                    </Button>
                  </View>
                ) : null}
              </Card>
            ))
          ) : (
            <EmptyState title="Aún no hay nóminas." />
          )}
        </>
      ) : null}
    </Screen>
  );
}
