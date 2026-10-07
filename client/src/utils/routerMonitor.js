export function durationSince(date) {
  if (!date) return '';
  const mins = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** Badge text + tone for a router's uptime-monitor state. */
export function routerMonitorStatus(r) {
  const m = r?.monitor || {};
  if (m.state === 'offline') {
    return {
      state: 'offline',
      label: 'Offline',
      detail: m.since ? `for ${durationSince(m.since)}` : '',
      dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]',
      pill: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
    };
  }
  if (m.state === 'online') {
    const warn = Boolean(String(m.reason || '').trim());
    return {
      state: 'online',
      label: warn ? 'Online · issue' : 'Online',
      detail: m.since ? `for ${durationSince(m.since)}` : '',
      dot: warn
        ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.55)]'
        : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]',
      pill: warn
        ? 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30'
        : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25',
    };
  }
  return {
    state: 'unknown',
    label: 'Checking…',
    detail: '',
    dot: 'bg-slate-600',
    pill: 'bg-slate-800 text-slate-400 ring-1 ring-slate-700',
  };
}
