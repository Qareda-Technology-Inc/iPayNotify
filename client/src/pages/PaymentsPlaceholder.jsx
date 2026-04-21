export function PaymentsPlaceholder() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Payments</h2>
      <p className="text-sm text-slate-400">
        Paid transactions are stored when MTN MoMo callbacks succeed. A full payment ledger UI (filters,
        export, refunds) is not built yet — use the MoMo developer dashboard for reconciliation, or we can
        add a transactions list next.
      </p>
      <p className="text-xs text-slate-500">
        Callback path:{' '}
        <span className="font-mono text-slate-400">/api/payments/momo/callback</span>
      </p>
    </div>
  );
}
