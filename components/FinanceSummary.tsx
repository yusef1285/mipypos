import { Typography } from 'heroui-native';
import { View } from 'react-native';
import { money } from '@/lib/format';
import type { FinanceTotals } from '@/lib/finance-models';
export function FinanceValue({ label, value }: { label: string; value: string }) {
  return (
    <View className="border-border gap-1 border-b py-3">
      <Typography.Paragraph color="muted" type="body-sm">
        {label}
      </Typography.Paragraph>
      <Typography.Paragraph className="font-semibold">{value}</Typography.Paragraph>
    </View>
  );
}
export function FinanceSummary({ totals }: { totals: FinanceTotals }) {
  return (
    <View>
      <FinanceValue label="Ventas brutas" value={money(totals.gross)} />
      <FinanceValue label="Descuentos" value={money(totals.discounts)} />
      <FinanceValue label="Devoluciones y anulaciones" value={money(totals.returns)} />
      <FinanceValue label="Ventas netas" value={money(totals.net)} />
      <FinanceValue
        label={
          totals.missingCostLines
            ? 'Costo conocido de mercancía vendida (parcial)'
            : 'Costo de mercancía vendida'
        }
        value={money(totals.knownCost)}
      />
      <FinanceValue
        label="Ganancia bruta"
        value={totals.profit === null ? 'Pendiente de costo' : money(totals.profit)}
      />
      <FinanceValue
        label="Margen bruto"
        value={totals.margin === null ? 'No calculable' : `${totals.margin.toFixed(2)} %`}
      />
      <FinanceValue label="Unidades vendidas" value={String(totals.units)} />
      <FinanceValue label="Operaciones con actividad" value={String(totals.operations)} />
      <FinanceValue label="Promedio por operación" value={money(totals.average)} />
      {totals.missingCostLines ? (
        <Typography.Paragraph className="text-warning mt-3">
          Hay operaciones sin costo histórico. La ganancia no se presenta como definitiva.
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
