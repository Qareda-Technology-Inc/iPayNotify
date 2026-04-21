import express from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Admin, Organization, Router } from '../models/index.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config } from '../config.js';
import { sendSmtpMail, smtpReadyForSend } from '../integrations/mail.js';
import { buildAdminSignInOtpEmail, buildSmtpTestEmail } from '../templates/email/index.js';

const SALT = 10;

const router = express.Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

router.get(
  '/organizations',
  asyncHandler(async (_req, res) => {
    const list = await Organization.find().sort({ name: 1 }).lean();
    res.json(list);
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
    const admins = await Admin.countDocuments({ organizationId: orgId, role: 'org_admin' });
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

/** Organisation-scoped admins (org_admin) */
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
      role: 'org_admin',
    })
      .select('email phone role organizationId createdAt updatedAt')
      .sort({ email: 1 })
      .lean();
    res.json(list);
  })
);

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
    const password = req.body?.password;
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
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    const existing = await Admin.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'An administrator with this email already exists' });
    }
    const passwordHash = await bcrypt.hash(String(password), SALT);
    const doc = await Admin.create({
      email,
      phone,
      passwordHash,
      role: 'org_admin',
      organizationId: org._id,
    });
    res.status(201).json({
      _id: doc._id,
      email: doc.email,
      phone: doc.phone || '',
      role: doc.role,
      organizationId: doc.organizationId,
      createdAt: doc.createdAt,
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
      role: 'org_admin',
    });
    if (!doc) return res.status(404).json({ error: 'Administrator not found' });
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
    await doc.save();
    res.json({
      _id: doc._id,
      email: doc.email,
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
      role: 'org_admin',
    });
    if (!r) return res.status(404).json({ error: 'Administrator not found' });
    res.status(204).end();
  })
);

export const superAdminApiRouter = router;
