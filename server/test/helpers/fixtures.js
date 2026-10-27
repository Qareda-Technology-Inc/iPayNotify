import crypto from 'crypto';
import {
  Organization,
  PlanPackage,
  PlatformSettings,
  Router,
  Transaction,
} from '../../src/models/index.js';

const uid = () => crypto.randomBytes(4).toString('hex');

export async function createOrg(overrides = {}) {
  return Organization.create({ name: 'Test ISP', slug: `isp-${uid()}`, status: 'active', ...overrides });
}

/** Platform default fee (basis points); 500 = 5%. */
export async function setPlatformFee(bps) {
  await PlatformSettings.updateOne(
    { key: 'default' },
    { $set: { defaultPlatformFeeBps: bps } },
    { upsert: true }
  );
}

export async function createRouter(org, overrides = {}) {
  return Router.create({
    organizationId: org._id,
    name: `Site ${uid()}`,
    host: '10.255.0.2',
    apiUser: 'billing',
    apiPassword: 'router-pass',
    portalSlug: `site-${uid()}`,
    ...overrides,
  });
}

export async function createHotspotPackage(org, overrides = {}) {
  return PlanPackage.create({
    organizationId: org._id,
    name: '1 Day',
    kind: 'hotspot',
    activeProfile: 'default',
    priceCents: 500,
    currency: 'GHS',
    durationAmount: 1,
    durationUnit: 'day',
    ...overrides,
  });
}

export async function createPendingTx(org, overrides = {}) {
  const { meta, ...rest } = overrides;
  return Transaction.create({
    organizationId: org._id,
    amountCents: 500,
    currency: 'GHS',
    status: 'pending',
    kind: 'topup',
    provider: 'hubtel',
    clientReference: `QF-${crypto.randomBytes(12).toString('hex')}`,
    customerPhone: '233241234567',
    meta: { hubtelCheckout: true, ...meta },
    ...rest,
  });
}

/** Mongoose treats createdAt as immutable; age a row through the raw collection. */
export async function ageTransaction(tx, hours) {
  await Transaction.collection.updateOne(
    { _id: tx._id },
    { $set: { createdAt: new Date(Date.now() - hours * 3600_000) } }
  );
}

export async function reloadTx(tx) {
  return Transaction.findById(tx._id).lean();
}
