import { Card, Typography } from 'heroui-native';
import { LockKeyhole } from 'lucide-react-native';
import { View } from 'react-native';

import { Screen } from '@/components/Screen';

export function AccessDenied() {
  return (
    <Screen>
      <Card className="mt-24 items-center gap-3 p-8">
        <View className="bg-danger-soft rounded-full p-4">
          <LockKeyhole className="text-danger" size={28} />
        </View>
        <Typography.Heading type="h3">Acceso restringido</Typography.Heading>
        <Typography.Paragraph color="muted" align="center">
          Tu rol no tiene permiso para este módulo.
        </Typography.Paragraph>
      </Card>
    </Screen>
  );
}
