export function money(cents) {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format((Number(cents) || 0) / 100);
}

export const PERIOD_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
];

function dayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayEnd(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function rangeFor(preset, customFrom, customTo) {
  const now = new Date();
  switch (preset) {
    case 'yesterday': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return { from: dayStart(y), to: dayEnd(y) };
    }
    case '7d':
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), to: dayEnd(now) };
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: dayEnd(now) };
    case 'lastMonth':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: dayEnd(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'year':
      return { from: new Date(now.getFullYear(), 0, 1), to: dayEnd(now) };
    case 'custom': {
      const f = customFrom ? new Date(`${customFrom}T00:00:00`) : dayStart(now);
      const t = customTo ? new Date(`${customTo}T00:00:00`) : now;
      return { from: dayStart(f), to: dayEnd(t) };
    }
    default:
      return { from: dayStart(now), to: dayEnd(now) };
  }
}

export function rangeLabel(range) {
  return `${range.from.toLocaleDateString()}${
    isoDate(range.from) !== isoDate(range.to) ? ` – ${range.to.toLocaleDateString()}` : ''
  }`;
}

export function downloadCsv(filename, header, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const ghs = (cents) => (Number(cents || 0) / 100).toFixed(2);
