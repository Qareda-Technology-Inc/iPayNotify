import { jsPDF } from 'jspdf';

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v < 1048576) return `${Math.round(v / 1024)} KB`;
  if (v < 1073741824) return `${(v / 1048576).toFixed(v % 1048576 === 0 ? 0 : 1)} MB`;
  return `${(v / 1073741824).toFixed(v % 1073741824 === 0 ? 0 : 1)} GB`;
}

function formatSeconds(total) {
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = Math.floor(n / 86400);
  const h = Math.floor((n % 86400) / 3600);
  const m = Math.floor((n % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(' ') : null;
}

function planLine(v, opts = {}) {
  const pkg = opts.packageName || v.packageId?.name || v.profileName || '';
  const data = formatBytes(v.dataLimitBytes);
  const elapsed = formatSeconds(v.elapsedSeconds);
  const paused = formatSeconds(v.timeLimitSeconds);
  const bits = [];
  if (pkg) bits.push(String(pkg));
  if (data) bits.push(data);
  if (elapsed) bits.push(elapsed);
  else if (paused) bits.push(paused);
  return bits.join(' · ');
}

/**
 * Printable tear-off hotspot vouchers — 7 rows × 5 columns per A4 sheet (35 vouchers).
 * @param {object[]} rows voucher rows (generated or recent list)
 * @param {{ title?: string, venue?: string, packageName?: string, server?: string, filename?: string }} [opts]
 */
export function downloadVouchersPdf(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && (r.code || r.id)) : [];
  if (!list.length) {
    throw new Error('No vouchers to export');
  }

  const title = String(opts.title || 'Wi‑Fi Access').trim() || 'Wi‑Fi Access';
  const venue = String(opts.venue || '').trim();
  const packageName = String(opts.packageName || '').trim();
  const filename =
    String(opts.filename || '').trim() || `hotspot-vouchers-${Date.now()}.pdf`;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const cols = 5;
  const rowsPerPage = 7;
  const marginX = 6;
  const marginY = 8;
  const gapX = 2.5;
  const gapY = 2.5;
  const cardW = (pageW - marginX * 2 - gapX * (cols - 1)) / cols;
  const cardH = (pageH - marginY * 2 - gapY * (rowsPerPage - 1)) / rowsPerPage;
  const perPage = cols * rowsPerPage;

  const drawCard = (v, x, y) => {
    const code = String(v.code || '').trim();
    const spaced =
      code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
    const plan = planLine(v, { ...opts, packageName: packageName || opts.packageName });

    doc.setDrawColor(15, 23, 42);
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cardW, cardH, 0.8, 0.8, 'FD');

    doc.setFillColor(15, 23, 42);
    doc.rect(x, y, cardW, 5.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.text(title, x + 1.8, y + 3.7, { maxWidth: cardW - 3.5 });

    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4.5);
    doc.text('CODE', x + 1.8, y + 9);

    doc.setFont('courier', 'bold');
    doc.setFontSize(code.length > 6 ? 9 : 12);
    doc.setTextColor(5, 150, 105);
    doc.text(spaced || '—', x + 1.8, y + 15.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4.5);
    doc.setTextColor(71, 85, 105);
    if (plan) {
      doc.text(plan, x + 1.8, y + 20, { maxWidth: cardW - 3.5 });
    }
    if (venue) {
      doc.setTextColor(148, 163, 184);
      doc.text(venue, x + 1.8, y + cardH - 2.5, { maxWidth: cardW - 3.5 });
    }
  };

  list.forEach((v, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage();
    const idx = i % perPage;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = marginX + col * (cardW + gapX);
    const y = marginY + row * (cardH + gapY);
    drawCard(v, x, y);
  });

  doc.save(filename);
}
