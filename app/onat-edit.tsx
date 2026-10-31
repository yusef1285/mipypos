import { useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useCallback } from 'react';
import { randomUUID } from 'expo-crypto';
import { Button, Typography } from 'heroui-native';
import { AccessDenied } from '@/components/AccessDenied';
import { Screen } from '@/components/Screen';
import { FinanceStatus } from '@/components/FinanceControls';
import { OnatProfileForm } from '@/components/OnatProfileForm';
import { OnatRuleForm } from '@/components/OnatRuleForm';
import { OnatRecordForm } from '@/components/OnatRecordForm';
import { fiscalMonth, useOnat } from '@/lib/use-onat';
import { goBackOrReplace } from '@/lib/navigation';
import type { OnatCommand } from '@/lib/onat-models';

export default function OnatEdit() {
  const params = useLocalSearchParams<{
    mode?: string;
    taxpayer?: string;
    rule?: string;
    obligation?: string;
    new?: string;
  }>();
  const taxpayer = params.taxpayer ?? 'default';
  const model = useOnat({ taxpayerId: taxpayer, ...fiscalMonth() });
  const { load } = model;
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  if (!model.allowed) return <AccessDenied />;
  const mode = params.mode ?? 'profile';
  const submit = (command: OnatCommand) =>
    void model
      .save(command)
      .then(() => goBackOrReplace('/onat'))
      .catch(() => undefined);
  const profile = model.data?.profiles.find((p) => p.value.taxpayerId === taxpayer);
  const rule = model.data?.rules.find((r) => r.id === params.rule);
  return (
    <Screen keyboard>
      <Stack.Screen options={{ headerBackButtonDisplayMode: 'minimal', headerLeft: undefined }} />
      <FinanceStatus loading={model.loading} error={model.error} retry={() => void model.load()} />
      {!model.loading && model.data ? (
        <>
          {mode === 'profile' ? (
            <OnatProfileForm
              initial={params.new === '1' ? undefined : profile?.value}
              taxpayerId={params.new === '1' ? randomUUID() : taxpayer}
              submit={submit}
              busy={model.busy}
            />
          ) : mode === 'rule' ? (
            <OnatRuleForm initial={rule} submit={submit} busy={model.busy} />
          ) : mode === 'record' ? (
            <OnatRecordForm
              data={model.data}
              taxpayerId={taxpayer}
              obligationId={params.obligation}
              submit={submit}
              busy={model.busy}
            />
          ) : (
            <Typography.Paragraph>Selecciona una herramienta fiscal.</Typography.Paragraph>
          )}
        </>
      ) : null}
      <Button variant="ghost" onPress={() => goBackOrReplace('/onat')}>
        <Button.Label>Volver a MipyPOS ONAT</Button.Label>
      </Button>
    </Screen>
  );
}
