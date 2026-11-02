import { PlatformSettings } from '../models/index.js';

const FALLBACK_FEE_BPS = 500;

function clampFeeBps(n) {
  return Math.max(0, Math.min(10_000, Math.round(Number(n))));
}

/** Ensure the singleton settings row exists. */
export async function ensurePlatformSettings() {
  /* Upsert: concurrent first requests on a fresh database must not race to insert the row. */
  return PlatformSettings.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default', defaultPlatformFeeBps: FALLBACK_FEE_BPS } },
    { upsert: true, new: true }
  );
}

export async function getDefaultPlatformFeeBps() {
  const doc = await ensurePlatformSettings();
  const n = Number(doc.defaultPlatformFeeBps);
  if (!Number.isFinite(n)) return FALLBACK_FEE_BPS;
  return clampFeeBps(n);
}

/**
 * Resolve fee for an org: org override → platform DB default.
 * @param {{ platformFeeBps?: number|null }|null|undefined} orgBilling
 */
export async function resolvePlatformFeeBps(orgBilling) {
  const override = orgBilling?.platformFeeBps;
  if (override != null && Number.isFinite(Number(override))) {
    return clampFeeBps(override);
  }
  return getDefaultPlatformFeeBps();
}

export async function updateDefaultPlatformFeeBps(feeBps) {
  const n = clampFeeBps(feeBps);
  if (!Number.isFinite(Number(feeBps)) || Number(feeBps) < 0 || Number(feeBps) > 10_000) {
    const e = new Error('defaultPlatformFeeBps must be 0–10000 (basis points)');
    e.status = 400;
    throw e;
  }
  const doc = await PlatformSettings.findOneAndUpdate(
    { key: 'default' },
    { $set: { defaultPlatformFeeBps: n } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
}

export async function getPlatformSettingsPublic() {
  const doc = await ensurePlatformSettings();
  const bps = clampFeeBps(doc.defaultPlatformFeeBps);
  return {
    defaultPlatformFeeBps: bps,
    defaultPlatformFeePercent: bps / 100,
    updatedAt: doc.updatedAt,
  };
}

const PAYOUT_DEFAULTS = {
  autoEnabled: false,
  maxAutoCents: 100_000,
  dailyAutoCents: 200_000,
  newNumberHoldHours: 48,
  firstNeedsApproval: true,
};

/** Limits for sending vendor withdrawals straight to MoMo. Cent amounts; 0 means no limit. */
export async function getPayoutSettings() {
  const doc = await ensurePlatformSettings();
  const p = doc.payouts || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d);
  return {
    autoEnabled: p.autoEnabled === true,
    maxAutoCents: num(p.maxAutoCents, PAYOUT_DEFAULTS.maxAutoCents),
    dailyAutoCents: num(p.dailyAutoCents, PAYOUT_DEFAULTS.dailyAutoCents),
    newNumberHoldHours: num(p.newNumberHoldHours, PAYOUT_DEFAULTS.newNumberHoldHours),
    firstNeedsApproval: p.firstNeedsApproval !== false,
  };
}

export async function updatePayoutSettings(body = {}) {
  const set = {};
  if (body.autoEnabled !== undefined) set['payouts.autoEnabled'] = Boolean(body.autoEnabled);
  if (body.firstNeedsApproval !== undefined) set['payouts.firstNeedsApproval'] = Boolean(body.firstNeedsApproval);
  for (const [field, max, label] of [
    ['maxAutoCents', 100_000_000, 'Largest automatic payout'],
    ['dailyAutoCents', 100_000_000, 'Daily automatic total'],
    ['newNumberHoldHours', 24 * 90, 'Wait after a number change'],
  ]) {
    if (body[field] === undefined) continue;
    const n = Math.round(Number(body[field]));
    if (body[field] === null || body[field] === '' || !Number.isFinite(n) || n < 0 || n > max) {
      const e = new Error(`${label} must be a number from 0 to ${field === 'newNumberHoldHours' ? max : max / 100}`);
      e.status = 400;
      throw e;
    }
    set[`payouts.${field}`] = n;
  }
  await ensurePlatformSettings();
  if (Object.keys(set).length) {
    await PlatformSettings.updateOne({ key: 'default' }, { $set: set });
  }
  return getPayoutSettings();
}
