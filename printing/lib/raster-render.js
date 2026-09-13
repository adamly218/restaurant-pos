'use strict';

/**
 * Canvas-based receipt rasterizer (no Puppeteer).
 * Mirrors preview / bill layout structure for consistent cross-printer output.
 */

const {
  formatMoney,
  normalizeConfig,
  normalizeSections,
  formatPrintingTimestamp,
  decodeImageInput,
  resolvePaperWidthPx,
} = require('./receipt-helpers');
const { mapOrderToTemp, mapOrderToFinal, mapOrderToDelivery, mapOrderToRefund } = require('./order-mapping');
const { computeSummary, formatNum } = require('./summary-mapping');

const LINE_H = 18;
const PAD_X = 8;
const FONT_NORMAL = '12px "Courier New", Courier, monospace';
const FONT_BOLD = 'bold 12px "Courier New", Courier, monospace';
const FONT_MEDIUM = 'bold 14px "Courier New", Courier, monospace';
const FONT_LARGE = 'bold 16px "Courier New", Courier, monospace';

/**
 * @param {string|null|undefined} name
 * @param {string|null|undefined} valueType
 * @param {number|null|undefined} rate
 * @param {string} [fallback]
 */
function formatDiscountMinimal(name, valueType, rate, fallback) {
  const label = fallback || 'Discount';
  const n = Number(rate || 0);
  const isPercent = valueType === 'percent' || (!valueType && n > 0);
  if (name && valueType === 'fixed_amount' && n > 0) return `${label} (${n} ${name})`;
  if (name && isPercent && n > 0) return `${label} (${n}% ${name})`;
  if (name) return `${label} (${name})`;
  if (isPercent && n > 0) return `${label} (${n}%)`;
  return label;
}

class ReceiptCanvas {
  /**
   * @param {number} width
   * @param {{ threshold?: number }} [opts]
   */
  constructor(width, opts) {
    const { createCanvas } = require('canvas');
    this.width = Math.max(8, Math.ceil(width / 8) * 8);
    this.threshold = opts && opts.threshold != null ? opts.threshold : 180;
    this.ops = [];
    this._estimatedH = 24;
    this._createCanvas = createCanvas;
  }

  _grow(h) {
    this._estimatedH += h;
  }

  feed(n) {
    const lines = Math.max(0, Number(n) || 0);
    this.ops.push({ type: 'feed', n: lines });
    this._grow(lines * LINE_H);
  }

  divider() {
    this.ops.push({ type: 'divider' });
    this._grow(LINE_H);
  }

  text(content, opts) {
    const o = opts || {};
    this.ops.push({
      type: 'text',
      content: String(content || ''),
      align: o.align || 'left',
      bold: !!o.bold,
      size: o.size || 'normal',
    });
    this._grow(o.size === 'large' ? 22 : o.size === 'medium' ? 20 : LINE_H);
  }

  row(left, right, opts) {
    this.ops.push({
      type: 'row',
      left: String(left || ''),
      right: String(right || ''),
      bold: !!(opts && opts.bold),
    });
    this._grow(LINE_H);
  }

  /**
   * @param {string|Buffer} input
   * @param {{ maxSide?: number }} [opts]
   */
  image(input, opts) {
    this.ops.push({ type: 'image', input, maxSide: (opts && opts.maxSide) || 150 });
    this._grow(((opts && opts.maxSide) || 150) + 8);
  }

  /**
   * @param {string} value
   * @param {{ size?: number }} [opts]
   */
  qr(value, opts) {
    if (!value) return;
    this.ops.push({ type: 'qr', value: String(value), size: (opts && opts.size) || 4 });
    this._grow(160);
  }

  /**
   * @returns {Promise<Buffer>}
   */
  async toPng() {
    const { loadImage } = require('canvas');
    const height = Math.max(32, this._estimatedH + 16);
    const canvas = this._createCanvas(this.width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.width, height);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';

    let y = 8;
    const innerW = this.width - PAD_X * 2;

    const fontFor = (size, bold) => {
      if (size === 'large') return FONT_LARGE;
      if (size === 'medium') return FONT_MEDIUM;
      return bold ? FONT_BOLD : FONT_NORMAL;
    };

    const drawTextLine = (str, align, font) => {
      ctx.font = font;
      const metrics = ctx.measureText(str);
      let x = PAD_X;
      if (align === 'center') x = Math.floor((this.width - metrics.width) / 2);
      else if (align === 'right') x = this.width - PAD_X - metrics.width;
      ctx.fillText(str, Math.max(0, x), y);
      y += sizeLineHeight(font);
    };

    const sizeLineHeight = (font) => {
      if (font === FONT_LARGE) return 22;
      if (font === FONT_MEDIUM) return 20;
      return LINE_H;
    };

    for (const op of this.ops) {
      if (op.type === 'feed') {
        y += op.n * LINE_H;
        continue;
      }
      if (op.type === 'divider') {
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.moveTo(PAD_X, y + 8);
        ctx.lineTo(this.width - PAD_X, y + 8);
        ctx.stroke();
        ctx.setLineDash([]);
        y += LINE_H;
        continue;
      }
      if (op.type === 'text') {
        drawTextLine(op.content, op.align, fontFor(op.size, op.bold));
        continue;
      }
      if (op.type === 'row') {
        ctx.font = op.bold ? FONT_BOLD : FONT_NORMAL;
        const left = op.left;
        const right = op.right;
        ctx.fillText(left, PAD_X, y);
        const rw = ctx.measureText(right).width;
        ctx.fillText(right, this.width - PAD_X - rw, y);
        y += LINE_H;
        continue;
      }
      if (op.type === 'image') {
        try {
          const decoded = decodeImageInput(op.input);
          if (!decoded) continue;
          const img = await loadImage(decoded.buf);
          const maxSide = op.maxSide || 150;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height), innerW / img.width);
          const w = Math.max(1, Math.floor(img.width * scale));
          const h = Math.max(1, Math.floor(img.height * scale));
          const x = Math.floor((this.width - w) / 2);
          ctx.drawImage(img, x, y, w, h);
          y += h + 6;
        } catch (e) {
          console.warn('[raster] image draw failed', e && e.message);
        }
        continue;
      }
      if (op.type === 'qr') {
        try {
          const qr = require('qr-image');
          const qrPng = qr.imageSync(op.value, { type: 'png', size: op.size || 4, margin: 1 });
          const img = await loadImage(qrPng);
          const maxSide = 140;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height), innerW / img.width);
          const w = Math.max(1, Math.floor(img.width * scale));
          const h = Math.max(1, Math.floor(img.height * scale));
          const x = Math.floor((this.width - w) / 2);
          ctx.drawImage(img, x, y, w, h);
          y += h + 6;
        } catch (e) {
          console.warn('[raster] qr draw failed', e && e.message);
          drawTextLine(op.value.slice(0, 42), 'center', FONT_NORMAL);
        }
      }
    }

    // Crop to used height (plus padding), width unchanged
    const usedH = Math.max(32, Math.ceil((y + 8) / 8) * 8);
    const out = this._createCanvas(this.width, usedH);
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, this.width, usedH);
    octx.drawImage(canvas, 0, 0);

    // Force mono via threshold
    const imageData = octx.getImageData(0, 0, this.width, usedH);
    const d = imageData.data;
    const th = this.threshold;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = lum < th ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    octx.putImageData(imageData, 0, 0);
    return out.toBuffer('image/png');
  }
}

function paintSections(rc, sections) {
  normalizeSections(sections)
    .filter((s) => s.enabled)
    .forEach((section) => {
      if (section.type === 'image' && section.content) {
        rc.image(section.content, { maxSide: 150 });
      } else if (section.type === 'text' && section.content) {
        rc.text(section.content, {
          align: section.align || 'center',
          size: section.size || 'normal',
          bold: section.size === 'medium' || section.size === 'large',
        });
      }
    });
}

function paintBranding(rc, cfg) {
  if (cfg.showLogo && cfg.logo) {
    rc.image(cfg.logo, { maxSide: 150 });
  }
  paintSections(rc, cfg.headerSections);
}

function paintFiscal(rc, qrcodes, qrcode) {
  const items = [];
  if (Array.isArray(qrcodes) && qrcodes.length) {
    qrcodes.forEach((item) => {
      if (item == null) return;
      if (typeof item === 'string') {
        const v = item.trim();
        if (v) items.push({ value: v, description: '', logo: '' });
        return;
      }
      const value = String(item.value ?? item.qrcode ?? '').trim();
      if (!value) return;
      items.push({
        value,
        description: String(item.description ?? '').trim(),
        logo: item.logo != null ? String(item.logo).trim() : '',
      });
    });
  } else if (qrcode) {
    items.push({ value: String(qrcode).trim(), description: '', logo: '' });
  }
  items.forEach((it) => {
    if (it.logo) rc.image(it.logo, { maxSide: 80 });
    rc.qr(it.value);
    if (it.description) rc.text(it.description, { align: 'center' });
  });
}

/**
 * @param {Object} bill
 * @param {Object} config
 * @param {Object} opts
 * @returns {Promise<Buffer>}
 */
async function renderBillRaster(bill, config, opts) {
  const cfg = normalizeConfig(config || {});
  const o = opts || {};
  const L = cfg.labels || {};
  const sym = cfg.currencySymbol ?? '$';
  const width = resolvePaperWidthPx(cfg);
  const rc = new ReceiptCanvas(width, { threshold: cfg.rasterThreshold });

  const topFeed = Math.max(0, Number(cfg.topMargin) || 0);
  if (topFeed) rc.feed(topFeed);

  paintBranding(rc, cfg);
  rc.text(o.title || L.bill || 'Bill', { align: 'center', size: 'medium', bold: true });
  rc.feed(1);
  if (cfg.showVatNumber && cfg.vatNumber) {
    rc.text(`${cfg.vatName}: ${cfg.vatNumber}`, { align: 'center' });
  }
  rc.row(`${L.invoice || 'Invoice#'} ${bill.orderId || ''}`, bill.date || '');
  rc.row(bill.table || '', bill.userName || '');
  if (o.address) rc.text(`${L.address || 'Address'}: ${String(o.address).slice(0, 40)}`);
  if (o.phone) rc.text(`${L.phone || 'Phone'}: ${String(o.phone)}`);
  if (o.customerName) rc.text(`${L.customer || 'Customer'}: ${String(o.customerName)}`);
  if (o.deliveryTime) rc.text(`${L.deliveryTime || 'Delivery'}: ${String(o.deliveryTime)}`);
  rc.divider();

  (bill.items || []).forEach((it) => {
    const name = (it.name || it.title || '').slice(0, 28);
    const qty = it.qty != null ? it.qty : 1;
    const lineTotal = it.total != null ? Number(it.total) : (it.price || 0) * qty;
    rc.row(`${name} x${qty}`, formatMoney(lineTotal, sym));
    if (Array.isArray(it.modifiers)) {
      it.modifiers.forEach((m) => {
        const mn = (m.name || m.title || '').slice(0, 26);
        if (mn) rc.text(`  > ${mn}`);
      });
    }
  });
  rc.divider();

  rc.row(`${L.items || 'Items'} (${bill.itemsCount || 0})`, formatMoney(bill.itemsTotal, sym));
  if (bill.tax != null && Number(bill.tax) !== 0) {
    rc.row(`${L.tax || 'Tax'} (${bill.taxLabel || L.tax || 'Tax'})`, formatMoney(bill.tax, sym));
  }
  if (Array.isArray(bill.discountLines) && bill.discountLines.length === 1) {
    const d = bill.discountLines[0];
    rc.row(
      formatDiscountMinimal(d.rawName, d.valueType, d.rate, L.discount || 'Discount'),
      '-' + formatMoney(d.amount, sym)
    );
  } else if (Array.isArray(bill.discountLines) && bill.discountLines.length > 1) {
    rc.row(L.discount || 'Discount', '-' + formatMoney(bill.discountAmount, sym));
    bill.discountLines.forEach((d) => {
      rc.row(
        '  ' + formatDiscountMinimal(d.rawName, d.valueType, d.rate, L.discount || 'Discount'),
        '-' + formatMoney(d.amount, sym)
      );
    });
  } else if (bill.discountAmount != null && Number(bill.discountAmount) !== 0) {
    rc.row(L.discount || 'Discount', '-' + formatMoney(bill.discountAmount, sym));
  }
  if (bill.extra != null && Number(bill.extra) !== 0) {
    rc.row(L.extra || 'Extra', formatMoney(bill.extra, sym));
  }
  if (bill.tip != null && Number(bill.tip) !== 0) {
    rc.row(L.tip || 'Tip', formatMoney(bill.tip, sym));
  }
  if (o.showDeliveryLine && bill.deliveryCharges != null && Number(bill.deliveryCharges) !== 0) {
    rc.row(L.deliveryCharges || 'Delivery Charges', formatMoney(bill.deliveryCharges, sym));
  }
  rc.row(L.total || 'Total', formatMoney(bill.total, sym), { bold: true });

  if (o.showPayments && Array.isArray(bill.payments)) {
    bill.payments.forEach((p) => {
      rc.row(`${L.payment || 'Payment'} ${p.name || ''}`.trim(), formatMoney(p.amount, sym));
    });
  }
  if (o.showChange && bill.change != null) {
    rc.row(L.change || 'Change', formatMoney(bill.change, sym));
  }

  const notes = o.notes || bill.note || bill.notes;
  if (notes) {
    rc.feed(1);
    rc.text(`${L.notes || 'Notes'}: ${String(notes).slice(0, 80)}`);
  }
  if (o.thankYou) {
    rc.feed(1);
    rc.text(String(o.thankYou), { align: 'center' });
  }

  paintFiscal(rc, o.qrcodes, o.qrcode);
  paintSections(rc, cfg.footerSections);
  rc.feed(1);
  rc.text(formatPrintingTimestamp(cfg), { align: 'center' });

  const bottomFeed = Math.max(0, Number(cfg.bottomMargin) || 0);
  if (bottomFeed) rc.feed(bottomFeed);

  return rc.toPng();
}

async function renderTempRaster(data, config) {
  const cfg = normalizeConfig(config || {});
  const order = data && data.order;
  if (!order) throw new Error('data.order is required for temp raster');
  const bill = mapOrderToTemp(order, {
    labels: cfg.labels,
    timezone: cfg.timezone,
    locale: cfg.locale,
    showInclusivePrices: !!cfg.showInclusivePrices,
  });
  return renderBillRaster(bill, cfg, {
    title: bill.title,
    notes: bill.note || undefined,
    showPayments: false,
    showChange: false,
    showDeliveryLine: false,
    qrcodes: data && data.qrcodes,
    qrcode: data && data.qrcode,
  });
}

async function renderFinalRaster(data, config) {
  const cfg = normalizeConfig(config || {});
  const order = data && data.order;
  if (!order) throw new Error('data.order is required for final raster');
  const bill = mapOrderToFinal(order, {
    duplicate: !!data.duplicate,
    labels: cfg.labels,
    timezone: cfg.timezone,
    locale: cfg.locale,
    showInclusivePrices: !!cfg.showInclusivePrices,
  });
  return renderBillRaster(bill, cfg, {
    title: bill.title,
    thankYou: bill.thankYou,
    showPayments: true,
    showChange: true,
    showDeliveryLine: false,
    qrcodes: data && data.qrcodes,
    qrcode: data && data.qrcode,
  });
}

async function renderDeliveryRaster(data, config) {
  const cfg = normalizeConfig(config || {});
  const order = data && data.order;
  if (!order) throw new Error('data.order is required for delivery raster');
  const bill = mapOrderToDelivery(order, {
    labels: cfg.labels,
    timezone: cfg.timezone,
    locale: cfg.locale,
    showInclusivePrices: !!cfg.showInclusivePrices,
  });
  return renderBillRaster(bill, cfg, {
    title: bill.title,
    address: bill.address,
    phone: bill.phone,
    customerName: bill.customerName,
    deliveryTime: bill.deliveryTime,
    notes: bill.notes || undefined,
    showPayments: true,
    showChange: true,
    showDeliveryLine: true,
    qrcodes: data && data.qrcodes,
    qrcode: data && data.qrcode,
  });
}

async function renderRefundRaster(data, config) {
  const cfg = normalizeConfig(config || {});
  const L = cfg.labels || {};
  const sym = cfg.currencySymbol ?? '$';
  const refundOrder = data && data.order;
  const originalOrder = data && data.originalOrder;
  if (!refundOrder) throw new Error('data.order is required for refund raster');
  const bill = mapOrderToRefund(refundOrder, originalOrder, {
    showInclusivePrices: !!cfg.showInclusivePrices,
    timezone: cfg.timezone,
    locale: cfg.locale,
  });
  const width = resolvePaperWidthPx(cfg);
  const rc = new ReceiptCanvas(width, { threshold: cfg.rasterThreshold });
  const topFeed = Math.max(0, Number(cfg.topMargin) || 0);
  if (topFeed) rc.feed(topFeed);
  paintBranding(rc, cfg);
  rc.text(L.refundReceipt || 'REFUND RECEIPT', { align: 'center', bold: true, size: 'medium' });
  if (cfg.showVatNumber && cfg.vatNumber) {
    rc.text(`${cfg.vatName}: ${cfg.vatNumber}`, { align: 'center' });
  }
  rc.row(`${L.originalInvoice || 'Original Invoice#'} ${bill.originalOrderId || ''}`, '');
  rc.row(`${L.refundDate || 'Refund Date'}: ${bill.refundDate || ''}`, '');
  rc.divider();
  (bill.items || []).forEach((it) => {
    const name = (it.name || it.title || '').slice(0, 28);
    const qty = it.qty != null ? it.qty : 1;
    const lineTotal = it.total != null ? Number(it.total) : (it.price || 0) * qty;
    rc.row(`${name} x${qty}`, formatMoney(lineTotal, sym));
  });
  rc.divider();
  rc.row(`${L.items || 'Items'} (${bill.itemsCount || 0})`, formatMoney(bill.itemsTotal, sym));
  if (bill.tax != null && Number(bill.tax) !== 0) {
    rc.row(L.tax || 'Tax', formatMoney(bill.tax, sym));
  }
  if (bill.discountAmount != null && Number(bill.discountAmount) !== 0) {
    rc.row(L.discount || 'Discount', '-' + formatMoney(bill.discountAmount, sym));
  }
  if (bill.extra != null && Number(bill.extra) !== 0) {
    rc.row(L.extra || 'Extra', formatMoney(bill.extra, sym));
  }
  if (bill.tip != null && Number(bill.tip) !== 0) {
    rc.row(L.tip || 'Tip', formatMoney(bill.tip, sym));
  }
  rc.row(L.refundTotal || 'Refund Total', formatMoney(bill.total, sym), { bold: true });
  paintSections(rc, cfg.footerSections);
  rc.feed(1);
  rc.text(formatPrintingTimestamp(cfg), { align: 'center' });
  const bottomFeed = Math.max(0, Number(cfg.bottomMargin) || 0);
  if (bottomFeed) rc.feed(bottomFeed);
  return rc.toPng();
}

async function renderKitchenRaster(data, config) {
  const cfg = normalizeConfig(config || {});
  const order = data && data.order;
  if (!order) throw new Error('data.order is required for kitchen raster');
  const { getOrderId, getOrderCreatedAt, getOrderUserName, getOrderType } = require('./order-mapping');
  const width = resolvePaperWidthPx(cfg);
  const rc = new ReceiptCanvas(width, { threshold: cfg.rasterThreshold });
  const topFeed = Math.max(0, Number(cfg.topMargin) || 0);
  if (topFeed) rc.feed(topFeed);
  paintBranding(rc, cfg);
  rc.text(data.kitchenName || 'KOT', { align: 'center', size: 'medium', bold: true });
  rc.divider();
  const isAddOn = !!data.isAddOn;
  const orderId = getOrderId(order);
  const bannerLabel = isAddOn ? 'ADDON' : 'New Order';
  const orderPart = orderId ? `Order# ${orderId}` : '';
  const banner = orderPart && bannerLabel ? `${orderPart} | ${bannerLabel}` : orderPart || bannerLabel;
  if (banner) rc.text(banner, { align: 'center', bold: true });
  const table = data.table
    ? String(data.table.name || '') + String(data.table.number || '')
    : '';
  const orderType = getOrderType(order);
  if (table || orderType) {
    rc.row(table ? `Table: ${table}` : '', orderType ? `Order Type: ${orderType}` : '');
  }
  const orderTaker = getOrderUserName(order);
  const createdAt = getOrderCreatedAt(order, { timezone: cfg.timezone, locale: cfg.locale });
  if (orderTaker || createdAt) {
    rc.row(orderTaker ? `Order Taker: ${orderTaker}` : '', createdAt ? `Time: ${createdAt}` : '');
  }
  rc.divider();
  const items = Array.isArray(data.items) ? data.items : [];
  items.forEach((it) => {
    const dish = it.item || it.dish || {};
    const name = (dish.name || dish.title || '').slice(0, 28);
    const qty = it.quantity != null ? it.quantity : 1;
    rc.row(`${name} x${qty}`, '');
    if (it.comments) rc.text(`>> ${String(it.comments).slice(0, 26)}`);
  });
  rc.feed(1);
  rc.text(formatPrintingTimestamp(cfg), { align: 'center' });
  const bottomFeed = Math.max(0, Number(cfg.bottomMargin) || 0);
  if (bottomFeed) rc.feed(bottomFeed);
  return rc.toPng();
}

function pct(x, of) {
  const n = Number(of);
  return Number.isFinite(n) && n > 0 ? (Number(x) / n) * 100 : 0;
}

async function renderSummaryRaster(data, config) {
  const cfg = normalizeConfig(config || {});
  const L = cfg.labels || {};
  const sym = cfg.currencySymbol ?? '$';
  const s = computeSummary({
    ...(data || {}),
    timezone: cfg.timezone,
    locale: cfg.locale,
  });
  const width = resolvePaperWidthPx(cfg);
  const rc = new ReceiptCanvas(width, { threshold: cfg.rasterThreshold });
  const topFeed = Math.max(0, Number(cfg.topMargin) || 0);
  if (topFeed) rc.feed(topFeed);
  paintBranding(rc, cfg);
  const titleTemplate = L.summaryTitle || 'Daily sales summary — {{date}}';
  rc.text(titleTemplate.replace('{{date}}', s.date), { align: 'center', size: 'medium', bold: true });
  rc.divider();
  const sect = (t) => rc.text(t, { align: 'center', bold: true });
  sect(L.salesRevenue || '1. Sales revenue');
  rc.row(L.exclusiveSales || 'Exclusive sales', formatMoney(s.exclusiveSales, sym));
  rc.row(L.extras || 'Extras', formatMoney(s.totalExtras, sym));
  rc.row(L.grossSales || 'Gross sales', formatMoney(s.grossSales, sym));
  rc.row(L.itemDiscounts || 'Item discounts', formatMoney(s.itemDiscounts, sym));
  rc.row(L.subtotalDiscounts || 'Subtotal discounts', formatMoney(s.subtotalDiscounts, sym));
  rc.row(L.couponDiscounts || 'Coupon discounts', formatMoney(s.couponDiscounts, sym));
  rc.row(L.discountsMinus || '(−) Discounts', formatMoney(s.discounts, sym));
  rc.row(L.netSales || 'Net sales', formatMoney(s.netSales, sym));
  rc.divider();
  sect(L.surchargesTaxes || '2. Surcharges and taxes');
  rc.row(L.serviceCharges || 'Service charges', formatMoney(s.serviceCharges, sym));
  rc.row(L.taxes || 'Taxes', formatMoney(s.taxCollected, sym));
  rc.row(L.totalRevenue || 'Total revenue', formatMoney(s.totalRevenue, sym), { bold: true });
  rc.divider();
  sect(L.settlementCashier || '3. Settlement and cashier');
  rc.row(L.amountDueBeforeTips || 'Amount due (before tips)', formatMoney(s.amountDue, sym));
  rc.row(L.tips || 'Tips', formatMoney(s.tips, sym));
  rc.row(L.grandTotalDue || 'Grand total (due)', formatMoney(s.grandTotalDue, sym), { bold: true });
  rc.row(L.amountCollected || 'Amount collected', formatMoney(s.amountCollected, sym));
  rc.row(L.rounding || 'Rounding', formatMoney(s.rounding, sym));
  rc.row(L.changeVariance || 'Change / variance', formatMoney(s.changeGiven, sym));
  rc.divider();
  sect(L.operationalControls || '4. Operational controls');
  rc.row(L.voids || 'Voids', formatMoney(s.voids, sym));
  rc.row(L.refunds || 'Refunds', formatMoney(s.refunds, sym));
  rc.row(L.covers || 'Covers', formatNum(s.covers));
  rc.row(L.averageCover || 'Average cover', formatMoney(s.averageCover, sym));
  rc.row(L.ordersChecks || 'Orders / checks', formatNum(s.ordersCount));
  rc.row(L.averageOrderCheck || 'Average order / check', formatMoney(s.averageOrderCheck, sym));
  rc.divider();
  sect(L.productMix || '5. Product mix');
  const ex = s.exclusiveSales;
  if (!s.categoryMix || s.categoryMix.length === 0) {
    rc.text(L.noCategoryData || 'No category data for this date.', { align: 'center' });
  } else {
    s.categoryMix.forEach((category) => {
      const catShare = `${formatNum(pct(category.total, ex))}%`;
      rc.row(
        String(category.name),
        `${formatNum(category.quantity)} ${formatMoney(category.total, sym)} ${catShare}`,
        { bold: true }
      );
      (category.dishes || []).forEach((dish) => {
        const dishShare = `${formatNum(pct(dish.total, ex))}%`;
        rc.row(
          `  ${String(dish.name)}`,
          `${formatNum(dish.quantity)} ${formatMoney(dish.total, sym)} ${dishShare}`
        );
      });
    });
  }
  rc.divider();
  sect(L.paymentTypes || '6. Payment types');
  (s.paymentTypes || []).forEach((p) => {
    rc.row(String(p.name || ''), formatMoney(p.total, sym));
  });
  paintSections(rc, cfg.footerSections);
  rc.feed(1);
  rc.text(formatPrintingTimestamp(cfg), { align: 'center' });
  const bottomFeed = Math.max(0, Number(cfg.bottomMargin) || 0);
  if (bottomFeed) rc.feed(bottomFeed);
  return rc.toPng();
}

/**
 * Render a print type to one or more PNG buffers (chunked by rasterMaxHeightPx).
 * @param {string} printType
 * @param {Object} data
 * @param {Object} config
 * @returns {Promise<Buffer[]>}
 */
async function renderRasterPngs(printType, data, config) {
  const cfg = normalizeConfig(config || {});
  const t = String(printType || (data && data.printType) || 'final').toLowerCase();

  let png;
  if (t === 'temp') png = await renderTempRaster(data, cfg);
  else if (t === 'final') png = await renderFinalRaster(data, cfg);
  else if (t === 'delivery') png = await renderDeliveryRaster(data, cfg);
  else if (t === 'refund') png = await renderRefundRaster(data, cfg);
  else if (t === 'kitchen') png = await renderKitchenRaster(data, cfg);
  else if (t === 'summary') png = await renderSummaryRaster(data, cfg);
  else {
    const err = new Error(`Raster not supported for print type: ${t}`);
    err.code = 'RASTER_UNSUPPORTED';
    throw err;
  }

  const maxH = cfg.rasterMaxHeightPx || 0;
  if (!maxH || maxH <= 0) return [png];

  const { loadImage, createCanvas } = require('canvas');
  const img = await loadImage(png);
  if (img.height <= maxH) return [png];

  const chunks = [];
  for (let y = 0; y < img.height; y += maxH) {
    const h = Math.min(maxH, img.height - y);
    const c = createCanvas(img.width, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, y, img.width, h, 0, 0, img.width, h);
    chunks.push(c.toBuffer('image/png'));
  }
  return chunks;
}

module.exports = {
  ReceiptCanvas,
  renderRasterPngs,
  renderBillRaster,
  renderTempRaster,
  renderFinalRaster,
  renderDeliveryRaster,
  renderRefundRaster,
  renderKitchenRaster,
  renderSummaryRaster,
};
