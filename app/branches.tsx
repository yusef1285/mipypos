import { Button, Card, Chip, Typography } from 'heroui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { AccessDenied } from '@/components/AccessDenied';
import { FormCard, useBusinessCommand, useBusinessData } from '@/components/BusinessKit';
import { FinanceField, FinanceStatus } from '@/components/FinanceControls';
import { FinanceSelect } from '@/components/FinanceSelect';
import { EmptyState, SectionTitle } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import type { Branch } from '@/lib/business-models';
import { canAccess } from '@/lib/permissions';

const NONE = 'none';

export default function Branches() {
  const { user } = useApp();
  const { data, error, loading, load } = useBusinessData();
  const { busy, run } = useBusinessCommand(load);
  const [editing, setEditing] = useState<Branch | null>();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [prefix, setPrefix] = useState('');
  if (!user || !canAccess(user.role, 'business')) return <AccessDenied />;
  const admin = user.role === 'admin';
  const start = (row: Branch | null) => {
    setEditing(row);
    setName(row?.name ?? '');
    setCode(row?.code ?? '');
    setAddress(row?.address ?? '');
    setPrefix(row?.ticket_prefix ?? '');
  };
  const branchOptions = [
    { value: NONE, label: 'Principal (sin sucursal)' },
    ...(data?.branches ?? [])
      .filter((b) => b.active === 1)
      .map((b) => ({ value: String(b.id), label: `${b.code} · ${b.name}` })),
  ];
  const toId = (value: string) => (value === NONE ? null : Number(value));
  return (
    <Screen
      title="Sucursales"
      keyboard
      onRefresh={load}
      action={
        admin ? (
          <Button size="sm" onPress={() => start(null)}>
            <Button.Label>Nueva</Button.Label>
          </Button>
        ) : null
      }
    >
      <FinanceStatus loading={loading && !data} error={error} retry={() => void load()} />
      {editing !== undefined && admin ? (
        <FormCard title={editing ? 'Editar sucursal' : 'Sucursal nueva'}>
          <FinanceField label="Nombre" value={name} onChange={setName} />
          <FinanceField label="Código (ej. CENTRO)" value={code} onChange={setCode} />
          <FinanceField label="Dirección" value={address} onChange={setAddress} />
          <FinanceField label="Prefijo de ticket (opcional)" value={prefix} onChange={setPrefix} />
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              isDisabled={busy || !name.trim() || !code.trim()}
              onPress={() =>
                void run({
                  action: 'branch.save',
                  id: editing?.id,
                  name,
                  code,
                  address,
                  ticketPrefix: prefix,
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
      {data ? (
        <>
          <SectionTitle badge={data.branches.length}>Sucursales registradas</SectionTitle>
          {data.branches.length ? (
            data.branches.map((row) => (
              <Card key={row.id} className="gap-2 p-4">
                <View className="flex-row items-center justify-between gap-2">
                  <Typography.Paragraph className="flex-1 font-semibold">
                    {row.code} · {row.name}
                  </Typography.Paragraph>
                  <Chip size="sm" variant="soft" color={row.active ? 'success' : 'default'}>
                    {row.active ? 'Activa' : 'Inactiva'}
                  </Chip>
                </View>
                {row.address ? (
                  <Typography.Paragraph type="body-sm" color="muted">
                    {row.address}
                  </Typography.Paragraph>
                ) : null}
                <Typography.Paragraph type="body-sm" color="muted">
                  Tickets: {row.ticket_prefix || row.code}-000001
                </Typography.Paragraph>
                {admin ? (
                  <View className="flex-row gap-2">
                    <Button size="sm" variant="secondary" onPress={() => start(row)}>
                      <Button.Label>Editar</Button.Label>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isDisabled={busy}
                      onPress={() =>
                        void run({
                          action: 'branch.save',
                          id: row.id,
                          name: row.name,
                          code: row.code,
                          address: row.address,
                          ticketPrefix: row.ticket_prefix,
                          active: row.active !== 1,
                        })
                      }
                    >
                      <Button.Label>{row.active ? 'Desactivar' : 'Activar'}</Button.Label>
                    </Button>
                  </View>
                ) : null}
              </Card>
            ))
          ) : (
            <EmptyState title="Aún no hay sucursales. Todo se registra en la principal." />
          )}
          <SectionTitle>Este dispositivo</SectionTitle>
          <Card className="gap-3 p-4">
            <Typography.Paragraph type="body-sm" color="muted">
              Las ventas de este equipo se numeran y consolidan en la sucursal elegida.
            </Typography.Paragraph>
            {admin ? (
              <FinanceSelect
                label="Sucursal del dispositivo"
                options={branchOptions}
                value={data.deviceBranchId == null ? NONE : String(data.deviceBranchId)}
                onChange={(value) =>
                  void run({ action: 'branch.setDevice', branchId: toId(value) })
                }
              />
            ) : (
              <Typography.Paragraph>
                {branchOptions.find((o) => o.value === String(data.deviceBranchId ?? NONE))
                  ?.label ?? 'Principal'}
              </Typography.Paragraph>
            )}
          </Card>
          <SectionTitle badge={data.areas.length}>Áreas por sucursal</SectionTitle>
          {data.areas.map((area) => (
            <Card key={area.area_id} className="gap-2 p-4">
              {admin ? (
                <FinanceSelect
                  label={area.area_name}
                  options={branchOptions}
                  value={area.branch_id == null ? NONE : String(area.branch_id)}
                  onChange={(value) =>
                    void run({
                      action: 'branch.assignArea',
                      areaId: area.area_id,
                      branchId: toId(value),
                    })
                  }
                />
              ) : (
                <Typography.Paragraph>
                  {area.area_name}:{' '}
                  {branchOptions.find((o) => o.value === String(area.branch_id ?? NONE))?.label}
                </Typography.Paragraph>
              )}
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
