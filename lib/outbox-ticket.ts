import type { LineaVenta, Producto, Venta } from '@/lib/models';
import type { OutboxSale } from '@/lib/network/sale-outbox';
import type { TicketNumbering } from '@/lib/ticket';
import { roundMoney } from '@/lib/units';

/** Provisional ticket for a sale queued while the administrator was unreachable. */
export function outboxTicket(
  entry: OutboxSale,
  products: readonly Producto[] = [],
): { sale: Venta; lines: LineaVenta[]; numbering: TicketNumbering } {
  const byId = new Map(products.map((product) => [product.id, product]));
  const cash = entry.command.payments.find((payment) => payment.type === 'cash')?.amount ?? 0;
  const received = entry.command.settlement?.cashReceived ?? null;
  return {
    sale: {
      id: 0,
      session_id: entry.command.sessionId,
      user: entry.username,
      seller_id: null,
      date: entry.createdAt,
      total: entry.total,
      method: entry.command.method,
      payments: entry.command.payments,
      settlement: entry.command.settlement
        ? {
            ...entry.command.settlement,
            changeDue: received === null ? 0 : roundMoney(received - cash),
          }
        : null,
    },
    lines: entry.command.items.map((item, index) => {
      const meta = entry.lines[index];
      const product = byId.get(item.productId);
      const price = meta?.price ?? product?.price_cash ?? 0;
      return {
        id: index + 1,
        sale_id: 0,
        product_id: item.productId,
        name: meta?.name ?? product?.name ?? `Producto ${item.productId}`,
        quantity: item.quantity,
        price,
        subtotal: roundMoney(price * item.quantity),
        area_id: item.areaId,
        unit: product?.unit ?? '',
        unit_cost: null,
        category: product?.category ?? '',
      };
    }),
    numbering: { label: `T-${entry.localNumber} (pendiente)`, branchName: 'Venta sin conexión' },
  };
}
