import { roundMoney } from '@/lib/units';
import type { FinanceEntry, FinanceGroup, FinanceTotals } from '@/lib/finance-models';
export function aggregateFinance(entries: FinanceEntry[]): FinanceTotals {
  const gross = roundMoney(entries.reduce((s, e) => s + e.gross, 0));
  const discounts = roundMoney(entries.reduce((s, e) => s + e.discounts, 0));
  const returns = roundMoney(entries.reduce((s, e) => s + e.returns, 0));
  const net = roundMoney(gross - discounts - returns);
  const knownCost = roundMoney(entries.reduce((s, e) => s + (e.cost ?? 0), 0));
  const missingQuantities = new Map<string, number>();
  for (const entry of entries)
    if (entry.cost === null)
      missingQuantities.set(entry.key, (missingQuantities.get(entry.key) ?? 0) + entry.quantity);
  const missingCostLines = [...missingQuantities.values()].filter(
    (quantity) => Math.abs(quantity) > 0.000001,
  ).length;
  const profit = missingCostLines ? null : roundMoney(net - knownCost);
  const operations = new Set(entries.map((e) => e.saleId)).size;
  return {
    gross,
    discounts,
    returns,
    net,
    knownCost,
    profit,
    margin: profit !== null && net > 0 ? (profit / net) * 100 : null,
    units: Math.round(entries.reduce((s, e) => s + e.quantity, 0) * 1000) / 1000,
    operations,
    average: operations ? roundMoney(net / operations) : 0,
    missingCostLines,
  };
}
export function groupFinance(
  entries: FinanceEntry[],
  key: (entry: FinanceEntry) => string,
  name: (entry: FinanceEntry) => string,
): FinanceGroup[] {
  const groups = new Map<string, FinanceEntry[]>();
  for (const entry of entries) {
    const id = key(entry);
    const values = groups.get(id) ?? [];
    values.push(entry);
    groups.set(id, values);
  }
  return [...groups.entries()].map(([id, values]) => ({
    key: id,
    name: name(values[0]),
    ...aggregateFinance(values),
  }));
}
export function inventoryByCategory(
  products: readonly { category: string; stock: number; unit_cost?: number | null }[],
) {
  const groups = new Map<
    string,
    { category: string; value: number; missingCostProducts: number }
  >();
  for (const product of products) {
    const group = groups.get(product.category) ?? {
      category: product.category,
      value: 0,
      missingCostProducts: 0,
    };
    if (product.unit_cost == null) {
      if (product.stock > 0) group.missingCostProducts++;
    } else group.value += product.stock * product.unit_cost;
    groups.set(product.category, group);
  }
  return [...groups.values()].map((group) => ({ ...group, value: roundMoney(group.value) }));
}
export function unitMargin(price: number, cost: number | null | undefined) {
  return cost == null
    ? null
    : {
        profit: roundMoney(price - cost),
        margin: price > 0 ? ((price - cost) / price) * 100 : null,
      };
}
