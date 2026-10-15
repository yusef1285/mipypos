// Tracks existing, unsent carts without creating another stock ledger.
export interface DraftProduct {
  productId: number;
}
const drafts = new Map<string, readonly DraftProduct[]>();
export function trackSaleDraft(owner: string, items: readonly DraftProduct[]) {
  if (items.length)
    drafts.set(
      owner,
      items.map((item) => ({ ...item })),
    );
  else drafts.delete(owner);
}
export function clearSaleDraft(owner: string) {
  drafts.delete(owner);
}
export function assertProductNotInDraft(productId: number) {
  if ([...drafts.values()].some((items) => items.some((item) => item.productId === productId)))
    throw new Error(
      'Retira el producto de la venta sin cobrar antes de registrar el consumo interno.',
    );
}
