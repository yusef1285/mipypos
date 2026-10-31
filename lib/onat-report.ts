import { activeRecords } from '@/lib/onat';
import {
  ONAT_DISCLAIMER,
  type FiscalData,
  type FiscalFilter,
  isFiscalRecordKind,
  type FiscalRecord,
  type Obligation,
} from '@/lib/onat-models';

const escapeHtml = (s: string | number | null | undefined) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function fiscalExportRows(
  data: FiscalData,
  filter: FiscalFilter,
  scope?: Obligation['scope'],
) {
  const active = activeRecords(data.records);
  const rows = active
    .filter(isFiscalRecordKind('obligation'))
    .filter(
      (r) =>
        r.taxpayerId === filter.taxpayerId &&
        (scope === undefined || r.value.scope === scope) &&
        r.value.start <= filter.end &&
        r.value.end >= filter.start,
    );
  return rows.map((r) => {
    const o = r.value;
    const paid = active
      .filter(isFiscalRecordKind('payment'))
      .filter((p) => p.value.obligationId === r.id)
      .reduce((sum, p) => sum + p.value.amount, 0);
    return {
      Contribuyente: o.profile.name,
      NIT: o.profile.nit,
      Ámbito: o.scope,
      Socio: o.beneficiary,
      Impuesto: o.name,
      Desde: o.start,
      Hasta: o.end,
      Vencimiento: o.due,
      Base: o.calculation.base,
      Gravable: o.calculation.taxable,
      Estimado: o.calculation.tax,
      Anticipos: o.calculation.credits,
      Pagado: paid,
      Pendiente: Math.max(0, o.calculation.tax - paid),
      Diferencia: paid - o.calculation.tax,
      Cálculo: o.calculation.explanation,
      Fuente: o.rule.sourceUrl,
      Verificación: o.rule.verifiedOn,
      Aviso: ONAT_DISCLAIMER,
    };
  });
}

export function fiscalReportHtml(
  data: FiscalData,
  filter: FiscalFilter,
  scope?: Obligation['scope'],
) {
  const rows = fiscalExportRows(data, filter, scope);
  return `<!doctype html><html lang="es"><meta charset="utf-8"><style>body{font-family:Arial;font-size:12px;padding:24px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #bbb;text-align:left}h1{font-size:22px}</style><h1>MipyPOS ONAT</h1><p>${escapeHtml(ONAT_DISCLAIMER)}</p><p>${escapeHtml(filter.start)} — ${escapeHtml(filter.end)} · CUP</p>${rows
    .map(
      (r) =>
        `<h2>${escapeHtml(r.Impuesto)}</h2><p>${escapeHtml(r.Contribuyente)} · NIT ${escapeHtml(r.NIT)} · ${escapeHtml(r.Ámbito)} ${escapeHtml(r.Socio)}</p><table>${Object.entries(
          r,
        )
          .filter(([k]) => !['Aviso', 'Contribuyente', 'NIT'].includes(k))
          .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
          .join('')}</table>`,
    )
    .join('')}</html>`;
}

export function inactiveFiscalObligationIds(records: FiscalRecord[]): string[] {
  const active = activeRecords(records);
  const activeIds = new Set(active.map((r) => r.id));
  return records
    .filter((r) => {
      if (r.kind !== 'obligation') return false;
      if (!activeIds.has(r.id)) return true;
      const obligation = r.value;
      const linked = active.filter(
        (p) => (p.kind === 'payment' || p.kind === 'declaration') && p.value.obligationId === r.id,
      );
      if (obligation.name === 'Declaración jurada')
        return linked.some((p) => p.kind === 'declaration');
      const paid = linked
        .filter(isFiscalRecordKind('payment'))
        .reduce((sum, p) => sum + p.value.amount, 0);
      return paid >= obligation.calculation.tax;
    })
    .map((r) => r.id);
}
