import { Link } from 'expo-router';
import { Button, Typography } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApp } from '@/lib/app-context';
import { usePosRepository } from '@/lib/use-pos-repository';

export function DemoQuota({ resource }: { resource: 'sales' | 'products' }) {
  const { revision } = useApp();
  const { getDemoUsage } = usePosRepository();
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof getDemoUsage>>>();
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      getDemoUsage().then(
        (demoUsage) => {
          setUsage(demoUsage);
          setError('');
        },
        () => setError('No se pudo consultar el límite demo.'),
      ),
    [getDemoUsage],
  );
  useEffect(() => {
    void load();
    // Revision invalidates the external database result even though load does not read it.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [load, revision]);
  if (error)
    return (
      <View className="gap-2">
        <Typography.Paragraph>{error}</Typography.Paragraph>
        <Button variant="secondary" onPress={() => void load()}>
          <Button.Label>Reintentar</Button.Label>
        </Button>
      </View>
    );
  if (!usage || usage.mode === 'pro') return null;
  return (
    <View className="gap-2">
      <Typography.Paragraph className="text-warning">
        Demo: {Math.min(usage[resource], usage.limit)} de {usage.limit}{' '}
        {resource === 'sales' ? 'ventas realizadas' : 'productos agregados'} en total
      </Typography.Paragraph>
      {usage[resource] >= usage.limit ? (
        <Link href="/settings" asChild>
          <Button variant="secondary">
            <Button.Label>Activar licencia Pro</Button.Label>
          </Button>
        </Link>
      ) : null}
    </View>
  );
}
