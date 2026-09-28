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

function spacedCode(code) {
  const raw = String(code || '').trim();
  return raw.length === 6 ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw;
}

function sheetLayout(doc, cols, rows, marginX, marginY, gapX, gapY) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const cardW = (pageW - marginX * 2 - gapX * (cols - 1)) / cols;
  const cardH = (pageH - marginY * 2 - gapY * (rows - 1)) / rows;
  return { cardW, cardH, cols, rows, marginX, marginY, gapX, gapY, perPage: cols * rows };
}

function drawGridCard(doc, v, x, y, cardW, cardH, ctx) {
  const code = spacedCode(v.code);
  doc.setDrawColor(15, 23, 42);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, cardW, cardH, 0.8, 0.8, 'FD');
  doc.setFillColor(15, 23, 42);
  doc.rect(x, y, cardW, 5.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.text(ctx.title, x + 1.8, y + 3.7, { maxWidth: cardW - 3.5 });
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.5);
  doc.text('CODE', x + 1.8, y + 9);
  doc.setFont('courier', 'bold');
  doc.setFontSize(code.length > 7 ? 9 : 12);
  doc.setTextColor(5, 150, 105);
  doc.text(code || '—', x + 1.8, y + 15.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.5);
  doc.setTextColor(71, 85, 105);
  if (ctx.plan) doc.text(ctx.plan, x + 1.8, y + 20, { maxWidth: cardW - 3.5 });
  if (ctx.venue) {
    doc.setTextColor(148, 163, 184);
    doc.text(ctx.venue, x + 1.8, y + cardH - 2.5, { maxWidth: cardW - 3.5 });
  }
}

function drawTicketCard(doc, v, x, y, cardW, cardH, ctx) {
  const code = spacedCode(v.code);
  doc.setDrawColor(234, 88, 12);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');
  doc.setFillColor(234, 88, 12);
  doc.rect(x, y, 8, cardH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(ctx.title, x + 12, y + 8, { maxWidth: cardW - 16 });
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('ACCESS CODE', x + 12, y + 16);
  doc.setFont('courier', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(234, 88, 12);
  doc.text(code || '—', x + 12, y + 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  if (ctx.plan) doc.text(ctx.plan, x + 12, y + 36, { maxWidth: cardW - 16 });
  if (ctx.venue) {
    doc.setTextColor(100, 116, 139);
    doc.text(ctx.venue, x + 12, y + cardH - 5, { maxWidth: cardW - 16 });
  }
}

function drawStripCard(doc, v, x, y, cardW, cardH, ctx) {
  const code = spacedCode(v.code);
  doc.setDrawColor(15, 23, 42);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, cardW, cardH, 1.2, 1.2, 'FD');
  doc.setFillColor(15, 23, 42);
  doc.rect(x, y, 42, cardH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(ctx.title, x + 3, y + cardH / 2 + 1, { maxWidth: 36 });
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('CODE', x + 48, y + 8);
  doc.setFont('courier', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(5, 150, 105);
  doc.text(code || '—', x + 48, y + cardH / 2 + 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const right = [ctx.plan, ctx.venue].filter(Boolean).join('\n');
  if (right) {
    doc.text(right, x + cardW - 4, y + 10, { align: 'right', maxWidth: 70 });
  }
}

const LAYOUTS = {
  grid: {
    cols: 5,
    rows: 7,
    marginX: 6,
    marginY: 8,
    gapX: 2.5,
    gapY: 2.5,
    draw: drawGridCard,
  },
  ticket: {
    cols: 2,
    rows: 5,
    marginX: 10,
    marginY: 10,
    gapX: 6,
    gapY: 4,
    draw: drawTicketCard,
  },
  strip: {
    cols: 1,
    rows: 7,
    marginX: 12,
    marginY: 12,
    gapX: 0,
    gapY: 3,
    draw: drawStripCard,
  },
};

/**
 * Printable hotspot vouchers.
 * design: grid (35/page) | ticket (10/page) | strip (7/page)
 * @param {object[]} rows
 * @param {{ title?: string, venue?: string, packageName?: string, filename?: string, design?: string }} [opts]
 */
export function downloadVouchersPdf(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && (r.code || r.id)) : [];
  if (!list.length) {
    throw new Error('No vouchers to export');
  }

  const title = String(opts.title || 'Wi‑Fi Access').trim() || 'Wi‑Fi Access';
  const venue = String(opts.venue || '').trim();
  const packageName = String(opts.packageName || '').trim();
  const design = LAYOUTS[opts.design] ? opts.design : 'grid';
  const layout = LAYOUTS[design];
  const filename =
    String(opts.filename || '').trim() || `hotspot-vouchers-${design}-${Date.now()}.pdf`;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const sheet = sheetLayout(
    doc,
    layout.cols,
    layout.rows,
    layout.marginX,
    layout.marginY,
    layout.gapX,
    layout.gapY
  );

  list.forEach((v, i) => {
    if (i > 0 && i % sheet.perPage === 0) doc.addPage();
    const idx = i % sheet.perPage;
    const col = idx % sheet.cols;
    const row = Math.floor(idx / sheet.cols);
    const x = sheet.marginX + col * (sheet.cardW + sheet.gapX);
    const y = sheet.marginY + row * (sheet.cardH + sheet.gapY);
    const plan = planLine(v, { ...opts, packageName: packageName || opts.packageName });
    layout.draw(doc, v, x, y, sheet.cardW, sheet.cardH, { title, venue, plan });
  });

  doc.save(filename);
}
