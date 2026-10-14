import { Card, Typography } from 'heroui-native';
import { View } from 'react-native';
import { z } from 'zod';
import { money } from '@/lib/format';
import type { CashClosureRecord } from '@/lib/models';
const detailSchema = z.object({
  cashCount: z.number(),
  expectedCash: z.number(),
  transferCount: z.number(),
  withdrawalCount: z.number(),
  withdrawalTotal: z.number(),
  cashDifference: z.number(),
  transferDifference: z.number(),
  withdrawalDifference: z.number(),
  totalDifference: z.number(),
  inventory: z.array(
    z.object({
      productName: z.string(),
      physicalStock: z.number(),
      expectedStock: z.number(),
      difference: z.number(),
      unit: z.string(),
    }),
  ),
  approvals: z.array(
    z.object({ id: z.number(), authorized_by: z.string(), reason: z.string(), date: z.string() }),
  ),
  withdrawals: z
    .array(
      z.object({
        id: z.number(),
        amount: z.number(),
        reason: z.string(),
        username: z.string(),
        authorized_by: z.string(),
        date: z.string(),
      }),
    )
    .default([]),
});
export function CashClosureRow({ item }: { item: CashClosureRecord }) {
  let detail: z.infer<typeof detailSchema> | undefined;
  try {
    detail = detailSchema.parse(JSON.parse(item.detail) as unknown);
  } catch {
    detail = undefined;
  }
  return (
    <Card className="gap-2 p-4">
      <Typography.Heading type="h4">Cierre #{item.session_id}</Typography.Heading>
      <Typography.Paragraph type="body-sm" color="muted">
        {new Date(item.date).toLocaleString()} · {item.authorized_by}
      </Typography.Paragraph>
      {detail ? (
        <>
          <Typography.Paragraph>
            Efectivo: {money(detail.cashCount)} · Esperado: {money(detail.expectedCash)}
          </Typography.Paragraph>
          <Typography.Paragraph>Transferencias: {money(detail.transferCount)}</Typography.Paragraph>
          <Typography.Paragraph>
            Extracciones: {money(detail.withdrawalTotal)} · Comprobadas:{' '}
            {money(detail.withdrawalCount)}
          </Typography.Paragraph>
          <Typography.Paragraph>
            Diferencias: efectivo {money(detail.cashDifference)}, transferencias{' '}
            {money(detail.transferDifference)}, extracciones {money(detail.withdrawalDifference)}
          </Typography.Paragraph>
          {detail.withdrawals.map((withdrawal) => (
            <View key={withdrawal.id} className="gap-1 pt-2">
              <Typography.Paragraph>
                Extracción #{withdrawal.id}: {money(withdrawal.amount)} · {withdrawal.username}
              </Typography.Paragraph>
              <Typography.Paragraph>{withdrawal.reason}</Typography.Paragraph>
              <Typography.Paragraph type="body-sm" color="muted">
                Autorizó: {withdrawal.authorized_by} · {new Date(withdrawal.date).toLocaleString()}
              </Typography.Paragraph>
            </View>
          ))}
          {detail.inventory
            .filter((product) => Math.abs(product.difference) > 0.0001)
            .map((product) => (
              <Typography.Paragraph key={product.productName}>
                {product.productName}: contado {product.physicalStock} / esperado{' '}
                {product.expectedStock} {product.unit} · Diferencia {product.difference}
              </Typography.Paragraph>
            ))}
          {detail.approvals.map((approval) => (
            <View key={approval.id} className="gap-1 pt-2">
              <Typography.Paragraph className="font-semibold">
                Autorizó: {approval.authorized_by}
              </Typography.Paragraph>
              <Typography.Paragraph>{approval.reason}</Typography.Paragraph>
            </View>
          ))}
          {!detail.approvals.length ? (
            <Typography.Paragraph className="text-success">Sin diferencias</Typography.Paragraph>
          ) : null}
        </>
      ) : (
        <Typography.Paragraph className="text-danger">
          No se pudo leer el detalle de este cierre.
        </Typography.Paragraph>
      )}
    </Card>
  );
}
