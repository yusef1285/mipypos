import * as Haptics from 'expo-haptics';
import { Link } from 'expo-router';
import { Button, Skeleton, Typography } from 'heroui-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { CashClosureRow } from '@/components/CashClosureRow';
import { AccessDenied } from '@/components/AccessDenied';
import { EmptyState } from '@/components/pos-ui';
import { Screen } from '@/components/Screen';
import { useApp } from '@/lib/app-context';
import type { CashClosureRecord } from '@/lib/models';
import { canAccess } from '@/lib/permissions';
import { usePosRepository } from '@/lib/use-pos-repository';

export default function CashHistory() {
  const { user } = useApp();
  const { listCashClosures } = usePosRepository();
  const [items, setItems] = useState<CashClosureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!user || !canAccess(user.role, 'cash')) return Promise.resolve();
    return listCashClosures()
      .then(
        (closures) => {
          setItems(closures);
          setError('');
        },
        (failure: unknown) => {
          setError(
            failure instanceof Error ? failure.message : 'No se pudieron cargar los cierres.',
          );
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        },
      )
      .finally(() => setLoading(false));
  }, [user, listCashClosures]);
  const reload = () => {
    setLoading(true);
    setError('');
    void load();
  };
  useEffect(() => {
    void load();
  }, [load]);
  if (!user || !canAccess(user.role, 'cash')) return <AccessDenied />;
  return (
    <Screen scroll={false}>
      <FlatList
        data={loading || error ? [] : items}
        keyExtractor={(item) => String(item.session_id)}
        renderItem={({ item }) => <CashClosureRow item={item} />}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshing={loading}
        onRefresh={reload}
        ListEmptyComponent={
          loading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : error ? (
            <View className="gap-3">
              <Typography.Paragraph>{error}</Typography.Paragraph>
              <Button onPress={reload}>
                <Button.Label>Reintentar</Button.Label>
              </Button>
            </View>
          ) : (
            <EmptyState
              title="Los próximos cierres aparecerán aquí"
              action={
                <Link href="/cash" asChild>
                  <Button>
                    <Button.Label>Ir a caja</Button.Label>
                  </Button>
                </Link>
              }
            />
          )
        }
        ListFooterComponent={
          <Link href="/cash" asChild>
            <Button variant="secondary">
              <Button.Label>Volver a caja</Button.Label>
            </Button>
          </Link>
        }
      />
    </Screen>
  );
}
