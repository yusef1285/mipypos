// Remove historical/current costs from non-administrative LAN responses, including nested snapshots.
export function redactCosts(value: unknown): unknown {
  const redacted: unknown = JSON.parse(
    JSON.stringify(value, (key: string, item: unknown) =>
      key === 'unit_cost' || key === 'cost' ? undefined : item,
    ),
  );
  return redacted;
}
