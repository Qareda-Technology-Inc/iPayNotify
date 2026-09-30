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

function planParts(v, opts = {}) {
  const pkg = opts.packageName || v.packageId?.name || v.profileName || '';
  const time = formatSeconds(v.elapsedSeconds) || formatSeconds(v.timeLimitSeconds);
  const data = formatBytes(v.dataLimitBytes);
  return {
    pkg: String(pkg || ''),
    detail: [time, data].filter(Boolean).join(' · '),
  };
}

function spacedCode(code) {
  const raw = String(code || '').trim();
  return raw.length === 6 ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw;
}

const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const SOFT = [148, 163, 184];

function fill(doc, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function stroke(doc, rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}
function ink(doc, rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}
function font(doc, family, style, size) {
  doc.setFont(family, style);
  doc.setFontSize(size);
}

/** Text clipped to a width with an ellipsis (jsPDF maxWidth wraps instead of cutting). */
function fit(doc, text, maxW) {
  let s = String(text || '');
  if (!s || doc.getTextWidth(s) <= maxW) return s;
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/** Light dashed cut line around each card. */
function cutFrame(doc, x, y, w, h) {
  stroke(doc, [203, 213, 225]);
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([1, 1], 0);
  doc.rect(x, y, w, h, 'S');
  doc.setLineDashPattern([], 0);
}

/* ---------- designs (sizes in mm) ---------- */

function drawGrid(doc, v, x, y, w, h, ctx) {
  cutFrame(doc, x, y, w, h);
  fill(doc, INK);
  doc.rect(x, y, w, 4.5, 'F');
  ink(doc, [255, 255, 255]);
  font(doc, 'helvetica', 'bold', 5.8);
  doc.text(fit(doc, ctx.title, w - 4), x + 2, y + 3.2);
  const hasVenue = Boolean(ctx.venue);
  ink(doc, [5, 150, 105]);
  font(doc, 'courier', 'bold', 13);
  doc.text(spacedCode(v.code), x + w / 2, y + (hasVenue ? 10.8 : 11.8), { align: 'center' });
  ink(doc, MUTED);
  font(doc, 'helvetica', 'normal', 5.2);
  const line = [ctx.plan.pkg, ctx.plan.detail].filter(Boolean).join(' · ');
  if (line) {
    doc.text(fit(doc, line, w - 4), x + w / 2, y + (hasVenue ? 14.8 : 16.2), { align: 'center' });
  }
  if (hasVenue) {
    ink(doc, SOFT);
    font(doc, 'helvetica', 'normal', 4.6);
    doc.text(fit(doc, ctx.venue, w - 4), x + w / 2, y + 18.2, { align: 'center' });
  }
}

function drawTicket(doc, v, x, y, w, h, ctx) {
  const accent = [234, 88, 12];
  cutFrame(doc, x, y, w, h);
  fill(doc, accent);
  doc.rect(x, y, 9, h, 'F');
  ink(doc, [255, 255, 255]);
  font(doc, 'helvetica', 'bold', 6.5);
  doc.text(fit(doc, ctx.title, h - 4), x + 5.8, y + h - 2, { angle: 90 });
  stroke(doc, [254, 215, 170]);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([0.8, 0.8], 0);
  doc.line(x + 11, y + 2, x + 11, y + h - 2);
  doc.setLineDashPattern([], 0);
  ink(doc, SOFT);
  font(doc, 'helvetica', 'bold', 5);
  doc.text('ACCESS CODE', x + 13.5, y + 6);
  ink(doc, accent);
  font(doc, 'courier', 'bold', 16);
  doc.text(spacedCode(v.code), x + 13.5, y + 14.5);
  ink(doc, INK);
  font(doc, 'helvetica', 'bold', 6.5);
  if (ctx.plan.pkg) doc.text(fit(doc, ctx.plan.pkg, w - 16), x + 13.5, y + 20.5);
  ink(doc, MUTED);
  font(doc, 'helvetica', 'normal', 6);
  if (ctx.plan.detail) doc.text(fit(doc, ctx.plan.detail, w - 16), x + 13.5, y + 24.5);
  if (ctx.venue) {
    ink(doc, SOFT);
    font(doc, 'helvetica', 'normal', 5);
    doc.text(fit(doc, ctx.venue, w - 16), x + 13.5, y + h - 2);
  }
}

function drawStrip(doc, v, x, y, w, h, ctx) {
  cutFrame(doc, x, y, w, h);
  fill(doc, INK);
  doc.rect(x, y, 26, h, 'F');
  ink(doc, [255, 255, 255]);
  font(doc, 'helvetica', 'bold', 6.5);
  const titleLines = doc.splitTextToSize(ctx.title, 22).slice(0, 2);
  doc.text(titleLines, x + 2.5, y + h / 2 - (titleLines.length - 1) * 1.4 + 1);
  ink(doc, SOFT);
  font(doc, 'helvetica', 'bold', 4.8);
  doc.text('CODE', x + 29, y + 5.5);
  ink(doc, [5, 150, 105]);
  font(doc, 'courier', 'bold', 14);
  doc.text(spacedCode(v.code), x + 29, y + 13);
  const rightX = x + w - 2.5;
  ink(doc, INK);
  font(doc, 'helvetica', 'bold', 6);
  if (ctx.plan.pkg) doc.text(fit(doc, ctx.plan.pkg, 30), rightX, y + 6, { align: 'right' });
  ink(doc, MUTED);
  font(doc, 'helvetica', 'normal', 5.5);
  if (ctx.plan.detail) doc.text(fit(doc, ctx.plan.detail, 30), rightX, y + 10.5, { align: 'right' });
  if (ctx.venue) {
    ink(doc, SOFT);
    font(doc, 'helvetica', 'normal', 5);
    doc.text(fit(doc, ctx.venue, 30), rightX, y + h - 2.5, { align: 'right' });
  }
}

function drawMini(doc, v, x, y, w, h, ctx) {
  cutFrame(doc, x, y, w, h);
  ink(doc, MUTED);
  font(doc, 'helvetica', 'bold', 4.5);
  doc.text(fit(doc, ctx.title.toUpperCase(), w - 3), x + w / 2, y + 3.8, { align: 'center' });
  ink(doc, INK);
  font(doc, 'courier', 'bold', 11);
  doc.text(spacedCode(v.code), x + w / 2, y + 10, { align: 'center' });
  ink(doc, MUTED);
  font(doc, 'helvetica', 'normal', 4.5);
  const line = ctx.plan.detail || ctx.plan.pkg;
  if (line) doc.text(fit(doc, line, w - 3), x + w / 2, y + h - 2.5, { align: 'center' });
}

function drawClassic(doc, v, x, y, w, h, ctx) {
  cutFrame(doc, x, y, w, h);
  stroke(doc, INK);
  doc.setLineWidth(0.4);
  doc.roundedRect(x + 1.2, y + 1.2, w - 2.4, h - 2.4, 1.2, 1.2, 'S');
  ink(doc, INK);
  font(doc, 'helvetica', 'bold', 7);
  doc.text(fit(doc, ctx.title, w - 8), x + w / 2, y + 6, { align: 'center' });
  stroke(doc, [226, 232, 240]);
  doc.setLineWidth(0.2);
  doc.line(x + 5, y + 7.8, x + w - 5, y + 7.8);
  fill(doc, [241, 245, 249]);
  doc.roundedRect(x + 5, y + 9.5, w - 10, 8, 1, 1, 'F');
  ink(doc, INK);
  font(doc, 'courier', 'bold', 13);
  doc.text(spacedCode(v.code), x + w / 2, y + 15.2, { align: 'center' });
  ink(doc, MUTED);
  font(doc, 'helvetica', 'normal', 5.5);
  const line = [ctx.plan.pkg, ctx.plan.detail].filter(Boolean).join(' · ');
  if (line) doc.text(fit(doc, line, w - 11), x + w / 2, y + 21.5, { align: 'center' });
  if (ctx.venue) {
    ink(doc, SOFT);
    font(doc, 'helvetica', 'normal', 5);
    doc.text(fit(doc, ctx.venue, w - 8), x + w / 2, y + h - 3, { align: 'center' });
  }
}

function drawBadge(doc, v, x, y, w, h, ctx) {
  const bg = [79, 70, 229];
  fill(doc, bg);
  doc.roundedRect(x, y, w, h, 2, 2, 'F');
  ink(doc, [199, 210, 254]);
  font(doc, 'helvetica', 'bold', 5.5);
  doc.text(fit(doc, ctx.title.toUpperCase(), w - 6), x + 3, y + 5);
  fill(doc, [255, 255, 255]);
  doc.roundedRect(x + 3, y + 7.5, w - 6, 9, 1.2, 1.2, 'F');
  ink(doc, bg);
  font(doc, 'courier', 'bold', 14);
  doc.text(spacedCode(v.code), x + w / 2, y + 14, { align: 'center' });
  ink(doc, [255, 255, 255]);
  font(doc, 'helvetica', 'bold', 5.8);
  if (ctx.plan.pkg) doc.text(fit(doc, ctx.plan.pkg, w - 6), x + 3, y + 20.5);
  ink(doc, [224, 231, 255]);
  font(doc, 'helvetica', 'normal', 5.2);
  const tail = [ctx.plan.detail, ctx.venue].filter(Boolean).join(' · ');
  if (tail) doc.text(fit(doc, tail, w - 6), x + 3, y + 24);
}

/** Fixed card sizes (mm), laid out and centred on A4 portrait. */
const LAYOUTS = {
  grid: { w: 38, h: 20, cols: 5, rows: 13, gapX: 2, gapY: 1.5, draw: drawGrid },
  ticket: { w: 64, h: 30, cols: 3, rows: 9, gapX: 2, gapY: 1.5, draw: drawTicket },
  strip: { w: 92, h: 18, cols: 2, rows: 14, gapX: 3, gapY: 1.5, draw: drawStrip },
  mini: { w: 30, h: 16, cols: 6, rows: 16, gapX: 1.5, gapY: 1.2, draw: drawMini },
  classic: { w: 46, h: 28, cols: 4, rows: 9, gapX: 2, gapY: 2, draw: drawClassic },
  badge: { w: 46, h: 27, cols: 4, rows: 10, gapX: 2, gapY: 1.5, draw: drawBadge },
};

export const VOUCHER_LAYOUTS = Object.fromEntries(
  Object.entries(LAYOUTS).map(([id, l]) => [id, { w: l.w, h: l.h, perPage: l.cols * l.rows }])
);

/**
 * Printable hotspot vouchers on A4.
 * @param {object[]} rows
 * @param {{ title?: string, venue?: string, packageName?: string, filename?: string, design?: string }} [opts]
 */
export function downloadVouchersPdf(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && (r.code || r.id)) : [];
  if (!list.length) {
    throw new Error('No vouchers to export');
  }

  const title = String(opts.title || 'Wi-Fi Access').trim() || 'Wi-Fi Access';
  const venue = String(opts.venue || '').trim();
  const packageName = String(opts.packageName || '').trim();
  const design = LAYOUTS[opts.design] ? opts.design : 'grid';
  const L = LAYOUTS[design];
  const filename =
    String(opts.filename || '').trim() || `hotspot-vouchers-${design}-${Date.now()}.pdf`;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const blockW = L.cols * L.w + (L.cols - 1) * L.gapX;
  const blockH = L.rows * L.h + (L.rows - 1) * L.gapY;
  const left = (pageW - blockW) / 2;
  const top = (pageH - blockH) / 2;
  const perPage = L.cols * L.rows;

  list.forEach((v, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage();
    const idx = i % perPage;
    const col = idx % L.cols;
    const row = Math.floor(idx / L.cols);
    const x = left + col * (L.w + L.gapX);
    const y = top + row * (L.h + L.gapY);
    const plan = planParts(v, { ...opts, packageName });
    L.draw(doc, v, x, y, L.w, L.h, { title, venue, plan });
  });

  doc.save(filename);
}
