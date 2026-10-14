import type { Payment, SaleSettlement, TransferReceipt } from '@/lib/models';
import { roundMoney } from '@/lib/units';

export function receiptAmount(text: string): number | null {
  // Only labelled amounts: never guess from a phone, card, balance or reference number.
  const matches = [
    ...text.matchAll(
      /(?:importe|monto|cantidad|transferiste|transferido|transferencia\s+(?:de|por))\s*[:-]?\s*(?:CUP|\$)?\s*(\d[\d., ]*)\s*(?:CUP|pesos|\$)?/gi,
    ),
  ];
  const values = matches
    .map((match) => {
      let raw = match[1].trim().replaceAll(' ', '');
      if (raw.includes(',') && raw.includes('.'))
        raw =
          raw.lastIndexOf(',') > raw.lastIndexOf('.')
            ? raw.replaceAll('.', '').replace(',', '.')
            : raw.replaceAll(',', '');
      else if (/[,.]\d{3}$/.test(raw)) raw = raw.replaceAll(',', '').replaceAll('.', '');
      else raw = raw.replace(',', '.');
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? roundMoney(value) : null;
    })
    .filter((value): value is number => value !== null);
  return new Set(values).size === 1 ? values[0] : null;
}
export function validateSettlement(payments: Payment[], settlement?: SaleSettlement) {
  // Legacy sales/retries without this field remain readable. New UI always supplies it.
  if (!settlement) return null;
  const cash = payments.find((payment) => payment.type === 'cash')?.amount ?? 0;
  const transfer = payments.find((payment) => payment.type === 'transfer')?.amount ?? 0;
  const received = settlement.cashReceived;
  if (
    cash > 0 &&
    (typeof received !== 'number' ||
      !Number.isFinite(received) ||
      received < cash ||
      Math.abs(received - roundMoney(received)) > 0.000001)
  )
    throw new Error(
      'El efectivo recibido debe cubrir la parte en efectivo, con hasta dos decimales.',
    );
  if (!cash && received !== null) throw new Error('Esta venta no recibe efectivo.');
  let receipt: TransferReceipt | null = null;
  if (transfer > 0) {
    receipt = settlement.transferReceipt;
    if (
      !receipt ||
      typeof receipt.ci !== 'string' ||
      !/^\d{11}$/.test(receipt.ci) ||
      typeof receipt.fullName !== 'string' ||
      !receipt.fullName.trim() ||
      receipt.fullName.length > 240 ||
      typeof receipt.address !== 'string' ||
      !receipt.address.trim() ||
      receipt.address.length > 240
    )
      throw new Error('Completa CI de 11 dígitos, nombre completo y dirección particular.');
    if (
      !receipt.reviewed ||
      !Number.isFinite(receipt.amount) ||
      Math.abs(receipt.amount - roundMoney(receipt.amount)) > 0.000001 ||
      Math.abs(receipt.amount - transfer) > 0.005
    )
      throw new Error(
        'Revisa el comprobante: su importe debe coincidir con el pago por transferencia.',
      );
    if (
      typeof receipt.rawText !== 'string' ||
      !receipt.rawText.trim() ||
      receipt.rawText.length > 20000 ||
      typeof receipt.imageBase64 !== 'string' ||
      !receipt.imageBase64.length ||
      receipt.imageBase64.length > 600000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(receipt.imageBase64)
    )
      throw new Error('Captura un comprobante legible y revisa sus datos.');
    if (
      typeof receipt.reference !== 'string' ||
      receipt.reference.length > 200 ||
      typeof receipt.receiptDate !== 'string' ||
      receipt.receiptDate.length > 100
    )
      throw new Error('Revisa la referencia y fecha del comprobante.');
  } else if (settlement.transferReceipt)
    throw new Error('Esta venta no tiene pago por transferencia.');
  return {
    cashReceived: received,
    changeDue: cash > 0 ? roundMoney(received! - cash) : 0,
    transferReceipt: receipt,
  };
}
