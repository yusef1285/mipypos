// Remove historical/current costs from non-administrative LAN responses, including nested snapshots.
export function redactCosts<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key: string, item: unknown) =>
      key === 'unit_cost' || key === 'cost' ? undefined : item,
    ),
  ) as T;
}
