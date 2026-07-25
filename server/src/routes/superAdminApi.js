import express from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Admin, Organization, Router, WithdrawalRequest } from '../models/index.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config } from '../config.js';
import { sendSmtpMail, smtpReadyForSend } from '../integrations/mail.js';
import { buildAdminSignInOtpEmail, buildSmtpTestEmail } from '../templates/email/index.js';
import { issueAdminInvite } from '../services/adminInviteService.js';
import {
  markWithdrawalPaid,
  rejectWithdrawal,
  getWalletSummary,
} from '../services/orgWalletService.js';
import { sanitizeBillingForClient } from '../services/orgBillingService.js';
import {
  getPlatformSettingsPublic,
  updateDefaultPlatformFeeBps,
} from '../services/platformSettingsService.js';

const SALT = 10;

const router = express.Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

router.get(
  '/organizations',
  asyncHandler(async (_req, res) => {
    const list = await Organization.find().sort({ name: 1 }).lean();
    const out = [];
    for (const o of list) {
      out.push({
        ...o,
        walletBalanceCents: Number(o.walletBalanceCents) || 0,
        billing: await sanitizeBillingForClient(o.billing),
      });
    }
    res.json(out);
  })
);

router.get(
  '/platform-settings',
  asyncHandler(async (_req, res) => {
    res.json(await getPlatformSettingsPublic());
  })
);

router.patch(
  '/platform-settings',
  asyncHandler(async (req, res) => {
    const raw = req.body?.defaultPlatformFeeBps ?? req.body?.platformFeeBps;
    const percent = req.body?.defaultPlatformFeePercent ?? req.body?.platformFeePercent;
    let bps;
    if (raw != null && String(raw).trim() !== '') {
      bps = Number(raw);
    } else if (percent != null && String(percent).trim() !== '') {
      bps = Number(percent) * 100;
    } else {
      return res.status(400).json({ error: 'defaultPlatformFeePercent (or defaultPlatformFeeBps) is required' });
    }
    try {
      await updateDefaultPlatformFeeBps(bps);
      res.json(await getPlatformSettingsPublic());
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Update failed' });
    }
  })
);

router.post(
  '/organizations',
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const slug = String(req.body?.slug || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
      return res.status(400).json({
        error: 'slug is required (1–40 chars: lowercase letters, numbers, hyphens; not at ends)',
      });
    }
    const status = ['active', 'trial', 'past_due', 'suspended'].includes(req.body?.status)
      ? req.body.status
      : 'active';
    try {
      const doc = await Organization.create({ name, slug, status });
      res.status(201).json(doc);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(400).json({ error: 'An organisation with this slug already exists' });
      }
      throw e;
    }
  })
);

router.patch(
  '/organizations/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const doc = await Organization.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Organisation not found' });
    if (req.body.name != null) doc.name = String(req.body.name).trim() || doc.name;
    if (req.body.status != null && ['active', 'trial', 'past_due', 'suspended'].includes(req.body.status)) {
      doc.status = req.body.status;
    }
    if (req.body.slug != null) {
      const slug = String(req.body.slug)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
      if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
        return res.status(400).json({ error: 'Invalid slug' });
      }
      doc.slug = slug;
    }
    try {
      await doc.save();
    } catch (e) {
      if (e.code === 11000) {
        return res.status(400).json({ error: 'Slug already in use' });
      }
      throw e;
    }
    res.json(doc.toObject());
  })
);

router.delete(
  '/organizations/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const orgId = req.params.id;
    const admins = await Admin.countDocuments({
      organizationId: orgId,
      role: { $in: ORG_SCOPED_ADMIN_ROLES },
    });
    if (admins > 0) {
      return res.status(400).json({
        error: `Remove or reassign ${admins} organisation administrator(s) before deleting this organisation.`,
      });
    }
    const routers = await Router.countDocuments({ organizationId: orgId });
    if (routers > 0) {
      return res.status(400).json({
        error: `This organisation still has ${routers} router(s). Remove or reassign them first.`,
      });
    }
    const r = await Organization.findByIdAndDelete(orgId);
    if (!r) return res.status(404).json({ error: 'Organisation not found' });
    res.status(204).end();
  })
);

/** Existing + inviteable org roles (ticket_manager kept for legacy accounts only). */
const ORG_SCOPED_ADMIN_ROLES = ['org_admin', 'ticket_manager', 'org_staff'];
const ORG_INVITE_ROLES = ['org_admin', 'org_staff'];

/** Organisation-scoped admins */
router.get(
  '/organizations/:orgId/admins',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.orgId)) {
      return res.status(400).json({ error: 'Invalid organisation id' });
    }
    const org = await Organization.findById(req.params.orgId).select('_id').lean();
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    const list = await Admin.find({
      organizationId: req.params.orgId,
      role: { $in: ORG_SCOPED_ADMIN_ROLES },
    })
      .select('email phone fullName role status organizationId inviteExpiresAt createdAt updatedAt')
      .sort({ email: 1 })
      .lean();
    res.json(list);
  })
);

/** Invite org-scoped admin by email (they set their own password). */
router.post(
  '/organizations/:orgId/admins',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.orgId)) {
      return res.status(400).json({ error: 'Invalid organisation id' });
    }
    const org = await Organization.findById(req.params.orgId).lean();
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    const email = String(req.body?.email || '')
      .toLowerCase()
      .trim();
    const role = ORG_INVITE_ROLES.includes(String(req.body?.role || '').trim())
      ? String(req.body.role).trim()
      : 'org_admin';
    const phoneRaw = req.body?.phone;
    let phone = '';
    if (phoneRaw != null && String(phoneRaw).trim()) {
      const n = normalizeGhanaMsisdn(String(phoneRaw).trim());
      if (!n) {
        return res.status(400).json({ error: 'Invalid phone (Ghana 0XX… or 233…)' });
      }
      phone = n;
    }
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    const fullName = String(req.body?.fullName || '').trim();
    if (!fullName) {
      return res.status(400).json({ error: 'fullName is required' });
    }
    const existing = await Admin.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'An administrator with this email already exists' });
    }
    const doc = await Admin.create({
      email,
      fullName,
      phone,
      passwordHash: '',
      role,
      organizationId: org._id,
      status: 'invited',
    });
    const { emailSent } = await issueAdminInvite(doc, { orgName: org.name });
    res.status(201).json({
      _id: doc._id,
      email: doc.email,
      fullName: doc.fullName || '',
      phone: doc.phone || '',
      role: doc.role,
      status: doc.status,
      organizationId: doc.organizationId,
      inviteExpiresAt: doc.inviteExpiresAt,
      emailSent,
      createdAt: doc.createdAt,
    });
  })
);

router.post(
  '/organizations/:orgId/admins/:adminId/resend-invite',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.orgId) || !mongoose.isValidObjectId(req.params.adminId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const org = await Organization.findById(req.params.orgId).lean();
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    const doc = await Admin.findOne({
      _id: req.params.adminId,
      organizationId: req.params.orgId,
      role: { $in: ORG_SCOPED_ADMIN_ROLES },
    });
    if (!doc) return res.status(404).json({ error: 'Administrator not found' });
    if (doc.status !== 'invited') {
      return res.status(400).json({ error: 'Only invited (pending) admins can be re-invited' });
    }
    const { emailSent } = await issueAdminInvite(doc, { orgName: org.name });
    res.json({
      _id: doc._id,
      email: doc.email,
      status: doc.status,
      inviteExpiresAt: doc.inviteExpiresAt,
      emailSent,
    });
  })
);

router.patch(
  '/organizations/:orgId/admins/:adminId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.orgId) || !mongoose.isValidObjectId(req.params.adminId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const doc = await Admin.findOne({
      _id: req.params.adminId,
      organizationId: req.params.orgId,
      role: { $in: ORG_SCOPED_ADMIN_ROLES },
    });
    if (!doc) return res.status(404).json({ error: 'Administrator not found' });
    if (req.body.role != null) {
      const role = String(req.body.role).trim();
      if (!ORG_INVITE_ROLES.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      doc.role = role;
    }
    if (req.body.email != null) {
      const email = String(req.body.email).toLowerCase().trim();
      if (!email) return res.status(400).json({ error: 'email cannot be empty' });
      const clash = await Admin.findOne({ email, _id: { $ne: doc._id } });
      if (clash) return res.status(400).json({ error: 'Email already in use' });
      doc.email = email;
    }
    if (req.body.password != null && String(req.body.password).length > 0) {
      if (String(req.body.password).length < 8) {
        return res.status(400).json({ error: 'password must be at least 8 characters' });
      }
      doc.passwordHash = await bcrypt.hash(String(req.body.password), SALT);
      doc.status = 'active';
      doc.inviteTokenHash = '';
      doc.inviteExpiresAt = null;
    }
    if (req.body.phone !== undefined) {
      const raw = req.body.phone;
      if (raw == null || String(raw).trim() === '') {
        doc.phone = '';
      } else {
        const n = normalizeGhanaMsisdn(String(raw).trim());
        if (!n) {
          return res.status(400).json({ error: 'Invalid phone (Ghana 0XX… or 233…)' });
        }
        doc.phone = n;
      }
    }
    if (req.body.fullName !== undefined) {
      const fn = String(req.body.fullName || '').trim();
      if (!fn) return res.status(400).json({ error: 'fullName cannot be empty' });
      doc.fullName = fn;
    }
    await doc.save();
    res.json({
      _id: doc._id,
      email: doc.email,
      fullName: doc.fullName || '',
      phone: doc.phone || '',
      role: doc.role,
      organizationId: doc.organizationId,
      updatedAt: doc.updatedAt,
    });
  })
);

router.get(
  '/email-templates/sign-in-otp-preview',
  asyncHandler(async (_req, res) => {
    const brand = config.merchant.displayName || 'QareFi Billing';
    const sample = buildAdminSignInOtpEmail({
      brand,
      code: '000000',
      expiresMinutes: 10,
      appUrl: config.publicAppUrl,
    });
    res.json({
      id: 'admin_sign_in_otp',
      name: 'Organisation admin — sign-in verification',
      description: 'Sent when an org administrator signs in and ADMIN_LOGIN_VERIFY=true.',
      ...sample,
    });
  })
);

router.post(
  '/email-templates/test-smtp',
  asyncHandler(async (req, res) => {
    if (!smtpReadyForSend()) {
      return res.status(503).json({
        error:
          'SMTP is not ready. Set SMTP_HOST, SMTP_FROM, and auth if required (see server/.env.example). Use SMTP_MOCK=true to log only.',
      });
    }
    const to = String(req.body?.to || req.admin.email || '')
      .trim()
      .toLowerCase();
    if (!to) {
      return res.status(400).json({ error: 'to (email) is required' });
    }
    const brand = config.merchant.displayName || 'QareFi Billing';
    const mail = buildSmtpTestEmail({ brand, appUrl: config.publicAppUrl });
    const r = await sendSmtpMail({ to, subject: mail.subject, text: mail.text, html: mail.html });
    if (!r.ok) {
      return res.status(502).json({ error: r.error || r.reason || 'Send failed' });
    }
    res.json({ ok: true, mock: Boolean(r.mock), to });
  })
);

router.delete(
  '/organizations/:orgId/admins/:adminId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.orgId) || !mongoose.isValidObjectId(req.params.adminId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    if (String(req.params.adminId) === String(req.admin.id)) {
      return res.status(400).json({ error: 'You cannot delete your own account from this screen' });
    }
    const r = await Admin.findOneAndDelete({
      _id: req.params.adminId,
      organizationId: req.params.orgId,
      role: { $in: ORG_SCOPED_ADMIN_ROLES },
    });
    if (!r) return res.status(404).json({ error: 'Administrator not found' });
    res.status(204).end();
  })
);

router.get(
  '/organizations/:orgId/wallet',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.orgId)) {
      return res.status(400).json({ error: 'Invalid organisation id' });
    }
    res.json(await getWalletSummary(req.params.orgId));
  })
);

router.patch(
  '/organizations/:orgId/billing',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.orgId)) {
      return res.status(400).json({ error: 'Invalid organisation id' });
    }
    const doc = await Organization.findById(req.params.orgId);
    if (!doc) return res.status(404).json({ error: 'Organisation not found' });
    if (!doc.billing) doc.billing = {};
    const b = req.body || {};
    if (b.platformFeeBps !== undefined) {
      if (b.platformFeeBps === null || b.platformFeeBps === '') {
        doc.billing.platformFeeBps = null;
      } else {
        const n = Math.round(Number(b.platformFeeBps));
        if (!Number.isFinite(n) || n < 0 || n > 10_000) {
          return res.status(400).json({ error: 'platformFeeBps must be 0–10000' });
        }
        doc.billing.platformFeeBps = n;
      }
    }
    doc.markModified('billing');
    await doc.save();
    res.json({
      _id: doc._id,
      billing: await sanitizeBillingForClient(doc.billing),
      walletBalanceCents: Number(doc.walletBalanceCents) || 0,
    });
  })
);

router.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || 'pending').trim().toLowerCase();
    const q = {};
    if (status && status !== 'all') q.status = status;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = await WithdrawalRequest.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('organizationId', 'name slug')
      .lean();
    res.json(
      rows.map((w) => ({
        id: String(w._id),
        amountCents: w.amountCents,
        status: w.status,
        destinationNote: w.destinationNote || '',
        processNote: w.processNote || '',
        createdAt: w.createdAt,
        processedAt: w.processedAt || null,
        organization: w.organizationId
          ? {
              id: String(w.organizationId._id || w.organizationId),
              name: w.organizationId.name || '',
              slug: w.organizationId.slug || '',
            }
          : null,
      }))
    );
  })
);

router.post(
  '/withdrawals/:id/pay',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    try {
      const result = await markWithdrawalPaid(req.params.id, {
        processedByAdminId: req.admin?.id,
        processNote: req.body?.processNote,
      });
      res.json({
        ok: true,
        duplicate: Boolean(result.duplicate),
        withdrawal: {
          id: String(result.withdrawal._id),
          status: result.withdrawal.status,
          amountCents: result.withdrawal.amountCents,
        },
      });
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Pay failed' });
    }
  })
);

router.post(
  '/withdrawals/:id/reject',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    try {
      const result = await rejectWithdrawal(req.params.id, {
        processedByAdminId: req.admin?.id,
        processNote: req.body?.processNote,
      });
      res.json({
        ok: true,
        duplicate: Boolean(result.duplicate),
        withdrawal: {
          id: String(result.withdrawal._id),
          status: result.withdrawal.status,
          amountCents: result.withdrawal.amountCents,
        },
      });
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Reject failed' });
    }
  })
);

export const superAdminApiRouter = router;
