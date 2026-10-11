import type { ReactNode } from 'react';
import { PackageOpen } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Card, Chip, Typography, useThemeColor } from 'heroui-native';
import { View } from 'react-native';

export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'accent',
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: 'accent' | 'success' | 'warning';
}) {
  const color = useThemeColor(tone);
  return (
    <Card className="min-w-36 flex-1 p-4">
      <View className="mb-4 flex-row items-center justify-between">
        <View
          className={`rounded-xl p-2 ${tone === 'accent' ? 'bg-accent-soft' : tone === 'success' ? 'bg-success-soft' : 'bg-warning-soft'}`}
        >
          <Icon color={color} size={20} />
        </View>
      </View>
      <Typography.Heading type="h3">{value}</Typography.Heading>
      <Typography.Paragraph type="body-sm" color="muted">
        {label}
      </Typography.Paragraph>
    </Card>
  );
}

export function SectionTitle({ children, badge }: { children: string; badge?: string | number }) {
  return (
    <View className="flex-row items-center justify-between">
      <Typography.Heading type="h4">{children}</Typography.Heading>
      {badge !== undefined ? (
        <Chip size="sm" color="accent" variant="soft">
          {String(badge)}
        </Chip>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  const color = useThemeColor('muted');
  return (
    <Card className="items-center gap-3 p-8">
      <PackageOpen color={color} size={26} />
      <Typography.Paragraph color="muted">{title}</Typography.Paragraph>
      {action}
    </Card>
  );
}
