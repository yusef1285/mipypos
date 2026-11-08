import { Typography } from 'heroui-native';
import type { PropsWithChildren, ReactNode } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';

import { useApp } from '@/lib/app-context';
import { SafeAreaView } from '@/components/ui/primitives/SafeAreaView';

interface ScreenProps extends PropsWithChildren {
  title?: string;
  action?: ReactNode;
  onRefresh?: () => Promise<void>;
  keyboard?: boolean;
  safeTop?: boolean;
  scroll?: boolean;
}

export function Screen({
  title,
  action,
  children,
  onRefresh,
  keyboard = false,
  safeTop = false,
  scroll = true,
}: ScreenProps) {
  const { license, licenseMode, user } = useApp();
  const content = scroll ? (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-5 px-4 pb-8 pt-4 web:mx-auto web:w-full web:max-w-5xl"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={false}
            onRefresh={() =>
              void onRefresh().catch((failure: unknown) =>
                Alert.alert(
                  'No se pudo actualizar',
                  failure instanceof Error ? failure.message : 'Vuelve a intentarlo.',
                ),
              )
            }
          />
        ) : undefined
      }
    >
      {title ? (
        <View className="flex-row items-center justify-between gap-3">
          <Typography.Heading type="h2" className="flex-1">
            {title}
          </Typography.Heading>
          {action}
        </View>
      ) : null}
      {children}
    </ScrollView>
  ) : (
    children
  );
  return (
    <SafeAreaView edges={safeTop ? ['top', 'bottom'] : ['bottom']} className="bg-background flex-1">
      {keyboard ? (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
      {user && licenseMode === 'demo' ? (
        <View
          pointerEvents="none"
          className="bg-warning-soft absolute right-3 bottom-3 rounded-lg px-3 py-1 opacity-80"
        >
          <Typography.Paragraph type="body-sm" className="text-warning font-semibold">
            DEMO
          </Typography.Paragraph>
        </View>
      ) : null}
      {user?.role === 'admin' && license.state === 'active' && license.expiringSoon ? (
        <View
          pointerEvents="none"
          className="bg-warning-soft absolute bottom-3 left-3 rounded-lg px-3 py-1 opacity-90"
        >
          <Typography.Paragraph type="body-sm" className="text-warning font-semibold">
            Licencia: {license.daysLeft} {license.daysLeft === 1 ? 'día' : 'días'}
          </Typography.Paragraph>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
