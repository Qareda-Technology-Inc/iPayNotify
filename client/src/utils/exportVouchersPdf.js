import { jsPDF } from 'jspdf';

/* ---------- formatting ---------- */

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

function formatPrice(pkg) {
  const cents = Number(pkg?.priceCents);
  if (!Number.isFinite(cents) || cents <= 0) return '';
  const amount = cents / 100;
  return `${pkg.currency || 'GHS'} ${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

function spacedCode(code) {
  const raw = String(code || '').trim();
  return raw.length === 6 ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw;
}

function cardContext(v, opts) {
  const pkgDoc = v.packageId && typeof v.packageId === 'object' ? v.packageId : null;
  const pkg = pkgDoc?.name || v.packageName || opts.packageName || v.profileName || '';
  const time = formatSeconds(v.elapsedSeconds) || formatSeconds(v.timeLimitSeconds);
  const data = formatBytes(v.dataLimitBytes);
  const r = v.routerId;
  const venue = (r && typeof r === 'object' ? String(r.comment || r.name || '').trim() : '') || opts.venue || '';
  return {
    title: opts.title,
    code: spacedCode(v.code),
    pkg: String(pkg),
    detail: [time, data].filter(Boolean).join(' · '),
    price: opts.showPrice === false ? '' : formatPrice(pkgDoc || v),
    venue,
  };
}

/* ---------- painters: same drawing calls produce PDF or SVG (units mm, font sizes pt) ---------- */

const PT_TO_MM = 0.3528;

function hexRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function pdfPainter(doc) {
  const setFont = (o = {}) => {
    doc.setFont(o.mono ? 'courier' : 'helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size || 6);
  };
  return {
    fill: (c) => doc.setFillColor(...hexRgb(c)),
    stroke: (c) => doc.setDrawColor(...hexRgb(c)),
    lw: (w) => doc.setLineWidth(w),
    dash: (pattern) => doc.setLineDashPattern(pattern || [], 0),
    rect: (x, y, w, h, mode = 'F') => doc.rect(x, y, w, h, mode),
    rrect: (x, y, w, h, r, mode = 'F') => doc.roundedRect(x, y, w, h, r, r, mode),
    line: (x1, y1, x2, y2) => doc.line(x1, y1, x2, y2),
    circle: (cx, cy, r, mode = 'F') => doc.circle(cx, cy, r, mode),
    tri: (x1, y1, x2, y2, x3, y3, mode = 'F') => doc.triangle(x1, y1, x2, y2, x3, y3, mode),
    text: (s, x, y, o = {}) => {
      setFont(o);
      doc.setTextColor(...hexRgb(o.color || '#0f172a'));
      doc.text(String(s), x, y, { align: o.align || 'left', ...(o.angle ? { angle: o.angle } : {}) });
    },
    width: (s, o = {}) => {
      setFont(o);
      return doc.getTextWidth(String(s));
    },
  };
}

let measureCtx;
function svgPainter() {
  const parts = [];
  let fillC = '#000000';
  let strokeC = '#000000';
  let lineW = 0.2;
  let dashA = null;
  const paint = (mode) => {
    const f = mode.includes('F') ? fillC : 'none';
    const s = mode.includes('S') || mode === 'FD' || mode === 'DF' ? strokeC : 'none';
    return `fill="${f}" stroke="${s}" stroke-width="${lineW}"${dashA && s !== 'none' ? ` stroke-dasharray="${dashA.join(' ')}"` : ''}`;
  };
  const fontFamily = (o) => (o.mono ? "'Courier New',Courier,monospace" : 'Helvetica,Arial,sans-serif');
  const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    parts,
    fill: (c) => (fillC = c),
    stroke: (c) => (strokeC = c),
    lw: (w) => (lineW = w),
    dash: (p) => (dashA = p && p.length ? p : null),
    rect: (x, y, w, h, mode = 'F') => parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${paint(mode)}/>`),
    rrect: (x, y, w, h, r, mode = 'F') =>
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${paint(mode)}/>`),
    line: (x1, y1, x2, y2) => parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${paint('S')}/>`),
    circle: (cx, cy, r, mode = 'F') => parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" ${paint(mode)}/>`),
    tri: (x1, y1, x2, y2, x3, y3, mode = 'F') =>
      parts.push(`<polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}" ${paint(mode)}/>`),
    text: (s, x, y, o = {}) => {
      const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
      const rot = o.angle ? ` transform="rotate(${-o.angle} ${x} ${y})"` : '';
      parts.push(
        `<text x="${x}" y="${y}" font-family="${fontFamily(o)}" font-size="${(o.size || 6) * PT_TO_MM}" font-weight="${o.bold ? 700 : 400}" fill="${o.color || '#0f172a'}" text-anchor="${anchor}"${rot}>${escText(s)}</text>`
      );
    },
    width: (s, o = {}) => {
      const sizeMm = (o.size || 6) * PT_TO_MM;
      if (typeof document === 'undefined') return String(s).length * sizeMm * (o.mono ? 0.6 : 0.52);
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = `${o.bold ? 700 : 400} ${sizeMm * 10}px ${fontFamily(o)}`;
      return measureCtx.measureText(String(s)).width / 10;
    },
  };
}

/* ---------- shared drawing helpers ---------- */

const INK = '#0f172a';
const MUTED = '#64748b';
const SOFT = '#94a3b8';
const WHITE = '#ffffff';

function fit(p, text, maxW, o) {
  let s = String(text || '');
  if (!s || p.width(s, o) <= maxW) return s;
  while (s.length > 1 && p.width(`${s}…`, o) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function txt(p, s, x, y, maxW, o) {
  if (!s) return;
  p.text(fit(p, s, maxW, o), x, y, o);
}

function cutFrame(p, x, y, w, h) {
  p.stroke('#cbd5e1');
  p.lw(0.15);
  p.dash([1, 1]);
  p.rect(x, y, w, h, 'S');
  p.dash(null);
}

const join = (...xs) => xs.filter(Boolean).join(' · ');

/* ---------- layouts ---------- */

const LAYOUTS = {
  band(p, x, y, w, h, k, c) {
    cutFrame(p, x, y, w, h);
    p.fill(c.h);
    p.rect(x, y, w, 4.5, 'F');
    const priceW = k.price ? p.width(k.price, { size: 5.4, bold: true }) + 2 : 0;
    txt(p, k.title, x + 2, y + 3.2, w - 4 - priceW, { size: 5.8, bold: true, color: WHITE });
    if (k.price) p.text(k.price, x + w - 2, y + 3.2, { size: 5.4, bold: true, color: WHITE, align: 'right' });
    const hasVenue = Boolean(k.venue);
    p.text(k.code, x + w / 2, y + (hasVenue ? 10.8 : 11.8), { size: 13, bold: true, mono: true, color: c.c, align: 'center' });
    txt(p, join(k.pkg, k.detail), x + w / 2, y + (hasVenue ? 14.8 : 16.2), w - 4, { size: 5.2, color: MUTED, align: 'center' });
    if (hasVenue) txt(p, k.venue, x + w / 2, y + 18.2, w - 4, { size: 4.6, color: SOFT, align: 'center' });
  },

  stub(p, x, y, w, h, k, c) {
    cutFrame(p, x, y, w, h);
    p.fill(c.h);
    p.rect(x, y, 9, h, 'F');
    txt(p, k.title, x + 5.8, y + h - 2, h - 4, { size: 6.5, bold: true, color: WHITE, angle: 90 });
    p.stroke(c.t);
    p.lw(0.3);
    p.dash([0.8, 0.8]);
    p.line(x + 11, y + 2, x + 11, y + h - 2);
    p.dash(null);
    p.text('ACCESS CODE', x + 13.5, y + 6, { size: 5, bold: true, color: SOFT });
    if (k.price) p.text(k.price, x + w - 2.5, y + 6, { size: 7, bold: true, color: c.c, align: 'right' });
    p.text(k.code, x + 13.5, y + 14.5, { size: 16, bold: true, mono: true, color: c.c });
    txt(p, k.pkg, x + 13.5, y + 20.5, w - 16, { size: 6.5, bold: true, color: INK });
    txt(p, k.detail, x + 13.5, y + 24.5, w - 16, { size: 6, color: MUTED });
    txt(p, k.venue, x + 13.5, y + h - 2, w - 16, { size: 5, color: SOFT });
  },

  strip(p, x, y, w, h, k, c) {
    cutFrame(p, x, y, w, h);
    p.fill(c.h);
    p.rect(x, y, 26, h, 'F');
    txt(p, k.title, x + 2.5, y + 7, 22, { size: 6.5, bold: true, color: WHITE });
    txt(p, k.venue, x + 2.5, y + 11.5, 22, { size: 4.8, color: '#cbd5e1' });
    p.text('CODE', x + 29, y + 5.5, { size: 4.8, bold: true, color: SOFT });
    p.text(k.code, x + 29, y + 13, { size: 14, bold: true, mono: true, color: c.c });
    const rx = x + w - 2.5;
    txt(p, k.pkg, rx, y + 5.5, 30, { size: 6, bold: true, color: INK, align: 'right' });
    txt(p, k.detail, rx, y + 9.5, 30, { size: 5.5, color: MUTED, align: 'right' });
    if (k.price) p.text(k.price, rx, y + 14.5, { size: 7, bold: true, color: c.c, align: 'right' });
  },

  mini(p, x, y, w, h, k, c) {
    cutFrame(p, x, y, w, h);
    if (c.bar) {
      p.fill(c.h);
      p.rect(x, y, w, 1.3, 'F');
    }
    txt(p, String(k.title).toUpperCase(), x + w / 2, y + 4.3, w - 3, { size: 4.5, bold: true, color: c.bar ? c.h : MUTED, align: 'center' });
    p.text(k.code, x + w / 2, y + 10, { size: 11, bold: true, mono: true, color: c.c, align: 'center' });
    txt(p, k.price ? join(k.price, k.detail || k.pkg) : k.detail || k.pkg, x + w / 2, y + h - 2.5, w - 3, {
      size: 4.5,
      color: MUTED,
      align: 'center',
    });
  },

  frame(p, x, y, w, h, k, c) {
    cutFrame(p, x, y, w, h);
    p.stroke(c.h);
    p.lw(0.4);
    p.rrect(x + 1.2, y + 1.2, w - 2.4, h - 2.4, 1.2, 'S');
    txt(p, k.title, x + w / 2, y + 6, w - 8, { size: 7, bold: true, color: c.h, align: 'center' });
    p.stroke('#e2e8f0');
    p.lw(0.2);
    p.line(x + 5, y + 7.8, x + w - 5, y + 7.8);
    p.fill(c.t);
    p.rrect(x + 5, y + 9.5, w - 10, 8, 1, 'F');
    p.text(k.code, x + w / 2, y + 15.2, { size: 13, bold: true, mono: true, color: c.c, align: 'center' });
    txt(p, join(k.pkg, k.detail), x + w / 2, y + 21.5, w - 11, { size: 5.5, color: MUTED, align: 'center' });
    txt(p, join(k.price, k.venue), x + w / 2, y + h - 3, w - 8, { size: 5, bold: Boolean(k.price), color: k.price ? c.h : SOFT, align: 'center' });
  },

  solid(p, x, y, w, h, k, c) {
    p.fill(c.h);
    p.rrect(x, y, w, h, 2, 'F');
    const priceW = k.price ? p.width(k.price, { size: 6, bold: true }) + 2 : 0;
    txt(p, String(k.title).toUpperCase(), x + 3, y + 5, w - 6 - priceW, { size: 5.5, bold: true, color: c.t });
    if (k.price) p.text(k.price, x + w - 3, y + 5, { size: 6, bold: true, color: WHITE, align: 'right' });
    p.fill(WHITE);
    p.rrect(x + 3, y + 7.5, w - 6, 9, 1.2, 'F');
    p.text(k.code, x + w / 2, y + 14, { size: 14, bold: true, mono: true, color: c.h, align: 'center' });
    txt(p, k.pkg, x + 3, y + 20.5, w - 6, { size: 5.8, bold: true, color: WHITE });
    txt(p, join(k.detail, k.venue), x + 3, y + 24, w - 6, { size: 5.2, color: c.t });
  },

  split(p, x, y, w, h, k, c) {
    cutFrame(p, x, y, w, h);
    const lw = Math.round(w * 0.38);
    p.fill(c.h);
    p.rect(x, y, lw, h, 'F');
    const big = k.price || k.pkg;
    txt(p, big, x + lw / 2, y + 10, lw - 3, { size: 11, bold: true, color: c.p || WHITE, align: 'center' });
    txt(p, k.price ? k.pkg : '', x + lw / 2, y + 15, lw - 3, { size: 5.8, bold: true, color: WHITE, align: 'center' });
    txt(p, k.detail, x + lw / 2, y + 19.5, lw - 3, { size: 4.8, color: '#e2e8f0', align: 'center' });
    const rx = x + lw + (w - lw) / 2;
    txt(p, String(k.title).toUpperCase(), rx, y + 6, w - lw - 4, { size: 5, bold: true, color: c.c, align: 'center' });
    p.text(k.code, rx, y + 15, { size: 14, bold: true, mono: true, color: INK, align: 'center' });
    txt(p, k.venue, rx, y + h - 3, w - lw - 4, { size: 4.6, color: SOFT, align: 'center' });
  },

  outline(p, x, y, w, h, k, c) {
    p.stroke(c.h);
    p.lw(0.5);
    p.rrect(x + 0.3, y + 0.3, w - 0.6, h - 0.6, 2, 'S');
    p.fill(WHITE);
    p.circle(x + 0.3, y + h / 2, 1.8, 'FD');
    p.circle(x + w - 0.3, y + h / 2, 1.8, 'FD');
    const priceW = k.price ? p.width(k.price, { size: 6, bold: true }) + 2 : 0;
    txt(p, k.title, x + 4, y + 5, w - 8 - priceW, { size: 5.5, bold: true, color: c.c });
    if (k.price) p.text(k.price, x + w - 4, y + 5, { size: 6, bold: true, color: c.c, align: 'right' });
    p.text(k.code, x + w / 2, y + 13.5, { size: 14, bold: true, mono: true, color: INK, align: 'center' });
    p.stroke(c.h);
    p.lw(0.25);
    p.dash([0.6, 0.8]);
    p.line(x + 4, y + 16, x + w - 4, y + 16);
    p.dash(null);
    txt(p, join(k.pkg, k.detail), x + w / 2, y + 19.6, w - 8, { size: 5, color: MUTED, align: 'center' });
    txt(p, k.venue, x + w / 2, y + 22.4, w - 8, { size: 4.4, color: SOFT, align: 'center' });
  },

  ribbon(p, x, y, w, h, k, c) {
    cutFrame(p, x, y, w, h);
    p.fill(c.h);
    p.tri(x + w - 13, y, x + w, y, x + w, y + 13, 'F');
    txt(p, k.title, x + 3, y + 5.5, w - 17, { size: 6, bold: true, color: INK });
    p.text(k.code, x + w / 2, y + 14, { size: 14, bold: true, mono: true, color: c.c, align: 'center' });
    txt(p, join(k.pkg, k.price), x + w / 2, y + 19.3, w - 6, { size: 5.6, bold: true, color: INK, align: 'center' });
    txt(p, join(k.detail, k.venue), x + w / 2, y + 23.2, w - 6, { size: 4.8, color: MUTED, align: 'center' });
  },

  receipt(p, x, y, w, h, k, c) {
    cutFrame(p, x, y, w, h);
    txt(p, String(k.title).toUpperCase(), x + w / 2, y + 5.2, w - 4, { size: 6.5, bold: true, color: c.h, align: 'center' });
    p.stroke(SOFT);
    p.lw(0.2);
    p.dash([0.7, 0.7]);
    p.line(x + 2.5, y + 7.3, x + w - 2.5, y + 7.3);
    p.text('ACCESS CODE', x + w / 2, y + 10.6, { size: 4.5, color: SOFT, align: 'center' });
    p.text(k.code, x + w / 2, y + 16.6, { size: 14, bold: true, mono: true, color: c.c, align: 'center' });
    p.line(x + 2.5, y + 19.3, x + w - 2.5, y + 19.3);
    p.dash(null);
    const priceW = k.price ? p.width(k.price, { size: 6, bold: true }) + 2 : 0;
    txt(p, k.pkg, x + 2.5, y + 23.3, w - 5 - priceW, { size: 6, bold: true, color: INK });
    if (k.price) p.text(k.price, x + w - 2.5, y + 23.3, { size: 6, bold: true, color: c.h, align: 'right' });
    txt(p, k.detail, x + 2.5, y + 27, w - 5, { size: 5, color: MUTED });
    txt(p, k.venue, x + w / 2, y + 31.3, w - 4, { size: 4.6, color: SOFT, align: 'center' });
    p.text('Thank you', x + w / 2, y + h - 1.8, { size: 4.2, color: SOFT, align: 'center' });
  },
};

/* ---------- the 20 designs (sizes in mm, laid out and centred on A4 portrait) ---------- */

const SIZES = {
  band: { w: 38, h: 20, cols: 5, rows: 13, gapX: 2, gapY: 1.5 },
  stub: { w: 64, h: 30, cols: 3, rows: 9, gapX: 2, gapY: 1.5 },
  strip: { w: 92, h: 18, cols: 2, rows: 14, gapX: 3, gapY: 1.5 },
  mini: { w: 30, h: 16, cols: 6, rows: 16, gapX: 1.5, gapY: 1.2 },
  frame: { w: 46, h: 28, cols: 4, rows: 9, gapX: 2, gapY: 2 },
  solid: { w: 46, h: 27, cols: 4, rows: 10, gapX: 2, gapY: 1.5 },
  split: { w: 60, h: 26, cols: 3, rows: 10, gapX: 2, gapY: 1.5 },
  outline: { w: 46, h: 24, cols: 4, rows: 11, gapX: 2, gapY: 1.5 },
  ribbon: { w: 48, h: 26, cols: 4, rows: 10, gapX: 2, gapY: 1.5 },
  receipt: { w: 44, h: 36, cols: 4, rows: 7, gapX: 2, gapY: 2 },
};

/** h = main colour, c = code colour, t = tint, p = price colour on dark panels, bar = top accent bar. */
const DESIGNS = [
  { id: 'grid', name: 'Grid', layout: 'band', desc: 'Dark header bar.', c: { h: '#0f172a', c: '#059669', t: '#f1f5f9' } },
  { id: 'ocean', name: 'Ocean', layout: 'band', desc: 'Blue header bar.', c: { h: '#1d4ed8', c: '#1d4ed8', t: '#eff6ff' } },
  { id: 'ticket', name: 'Ticket', layout: 'stub', desc: 'Tear-off stub, orange edge.', c: { h: '#ea580c', c: '#ea580c', t: '#fed7aa' } },
  { id: 'forest', name: 'Forest', layout: 'stub', desc: 'Tear-off stub, green edge.', c: { h: '#15803d', c: '#15803d', t: '#bbf7d0' } },
  { id: 'strip', name: 'Strip', layout: 'strip', desc: 'Wide and easy to read.', c: { h: '#0f172a', c: '#059669', t: '#f1f5f9' } },
  { id: 'royal', name: 'Royal', layout: 'strip', desc: 'Wide, purple side panel.', c: { h: '#6d28d9', c: '#6d28d9', t: '#ede9fe' } },
  { id: 'mini', name: 'Mini', layout: 'mini', desc: 'Code only, smallest cut.', c: { h: '#0f172a', c: '#0f172a', t: '#f1f5f9' } },
  { id: 'pocket', name: 'Pocket', layout: 'mini', desc: 'Small, with a red top bar.', c: { h: '#e11d48', c: '#0f172a', t: '#ffe4e6', bar: true } },
  { id: 'classic', name: 'Classic', layout: 'frame', desc: 'Framed card, shaded code box.', c: { h: '#0f172a', c: '#0f172a', t: '#f1f5f9' } },
  { id: 'gold', name: 'Gold', layout: 'frame', desc: 'Framed card in gold.', c: { h: '#b45309', c: '#92400e', t: '#fef3c7' } },
  { id: 'badge', name: 'Badge', layout: 'solid', desc: 'Full-colour indigo card.', c: { h: '#4f46e5', c: '#4f46e5', t: '#c7d2fe' } },
  { id: 'sunset', name: 'Sunset', layout: 'solid', desc: 'Full-colour rose card.', c: { h: '#e11d48', c: '#e11d48', t: '#fecdd3' } },
  { id: 'split', name: 'Split', layout: 'split', desc: 'Price panel beside the code.', c: { h: '#0d9488', c: '#0f766e', t: '#ccfbf1' } },
  { id: 'carbon', name: 'Carbon', layout: 'split', desc: 'Dark price panel, lime price.', c: { h: '#111827', c: '#4d7c0f', t: '#ecfccb', p: '#a3e635' } },
  { id: 'coupon', name: 'Coupon', layout: 'outline', desc: 'Outlined coupon with notches.', c: { h: '#0284c7', c: '#0369a1', t: '#e0f2fe' } },
  { id: 'mint', name: 'Mint', layout: 'outline', desc: 'Green outlined coupon.', c: { h: '#059669', c: '#047857', t: '#d1fae5' } },
  { id: 'ribbon', name: 'Ribbon', layout: 'ribbon', desc: 'Red corner ribbon.', c: { h: '#dc2626', c: '#b91c1c', t: '#fee2e2' } },
  { id: 'promo', name: 'Promo', layout: 'ribbon', desc: 'Violet corner ribbon.', c: { h: '#7c3aed', c: '#6d28d9', t: '#ede9fe' } },
  { id: 'receipt', name: 'Receipt', layout: 'receipt', desc: 'Till-receipt style.', c: { h: '#111827', c: '#111827', t: '#f3f4f6' } },
  { id: 'cafe', name: 'Café', layout: 'receipt', desc: 'Receipt in coffee brown.', c: { h: '#6f4e37', c: '#6f4e37', t: '#f5ede3' } },
];

function designById(id) {
  return DESIGNS.find((d) => d.id === id) || DESIGNS[0];
}

/** Picker metadata: id, name, blurb (with size and per-sheet count). */
export const TICKET_DESIGNS = DESIGNS.map((d) => {
  const s = SIZES[d.layout];
  return { id: d.id, name: d.name, blurb: `${d.desc} ${s.w} × ${s.h} mm, ${s.cols * s.rows} per A4 sheet.` };
});

export const VOUCHER_LAYOUTS = Object.fromEntries(
  DESIGNS.map((d) => {
    const s = SIZES[d.layout];
    return [d.id, { w: s.w, h: s.h, perPage: s.cols * s.rows }];
  })
);

const SAMPLE_TICKET = {
  code: '482193',
  packageId: { name: 'Daily pass', priceCents: 500, currency: 'GHS' },
  elapsedSeconds: 86400,
  dataLimitBytes: 1073741824,
};

/**
 * One card as an SVG string (mm viewBox) — used for design previews.
 * @param {string} designId
 * @param {{ title?: string, venue?: string, row?: object, showPrice?: boolean }} [opts]
 */
export function renderTicketSvg(designId, opts = {}) {
  const d = designById(designId);
  const s = SIZES[d.layout];
  const p = svgPainter();
  const k = cardContext(opts.row || SAMPLE_TICKET, {
    title: String(opts.title || 'Wi-Fi Access').trim() || 'Wi-Fi Access',
    venue: opts.venue ?? 'Main hall',
    showPrice: opts.showPrice,
  });
  p.fill('#ffffff');
  p.rect(0, 0, s.w, s.h, 'F');
  LAYOUTS[d.layout](p, 0, 0, s.w, s.h, k, d.c);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 ${s.w + 1} ${s.h + 1}" width="${s.w * 4}" height="${s.h * 4}">${p.parts.join('')}</svg>`;
}

function isPrintable(v, now) {
  if (v.usedAt) return false;
  return !v.validUntil || new Date(v.validUntil).getTime() >= now;
}

/**
 * Printable hotspot tickets on A4. Used or expired tickets are skipped unless `includeUsed` is set.
 * Each card shows its own plan, price and router; `packageName` / `venue` are fallbacks.
 * @param {object[]} rows
 * @param {{ title?: string, venue?: string, packageName?: string, filename?: string, design?: string, includeUsed?: boolean, showPrice?: boolean }} [opts]
 * @returns {{ printed: number, skipped: number }}
 */
export function downloadVouchersPdf(rows, opts = {}) {
  const all = Array.isArray(rows) ? rows.filter((r) => r && (r.code || r.id)) : [];
  const now = Date.now();
  const list = opts.includeUsed ? all : all.filter((v) => isPrintable(v, now));
  if (!list.length) {
    throw new Error(
      all.length ? 'All selected tickets are used or expired — nothing to print.' : 'No tickets to export'
    );
  }

  const title = String(opts.title || 'Wi-Fi Access').trim() || 'Wi-Fi Access';
  const d = designById(opts.design);
  const L = SIZES[d.layout];
  const filename = String(opts.filename || '').trim() || `tickets-${d.id}-${Date.now()}.pdf`;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const p = pdfPainter(doc);
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
    const x = left + (idx % L.cols) * (L.w + L.gapX);
    const y = top + Math.floor(idx / L.cols) * (L.h + L.gapY);
    const k = cardContext(v, { title, venue: String(opts.venue || '').trim(), packageName: opts.packageName, showPrice: opts.showPrice });
    LAYOUTS[d.layout](p, x, y, L.w, L.h, k, d.c);
  });

  doc.save(filename);
  return { printed: list.length, skipped: all.length - list.length };
}
