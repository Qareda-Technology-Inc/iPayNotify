import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Admin } from '../models/index.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { config } from '../config.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { attachOrganization } from '../middleware/attachOrganization.js';
import { smtpReadyForSend, isSmtpConfigured } from '../integrations/mail.js';
import {
  createAndDispatchLoginChallenge,
  verifyLoginChallenge,
  smsOtpGloballyAvailable,
} from '../services/adminLoginVerification.js';

export const authRouter = express.Router();

const SALT_ROUNDS = 10;

function signToken(admin) {
  const role = admin.role || 'super_admin';
  const payload = {
    sub: String(admin._id),
    email: admin.email,
    role,
  };
  if (
    (role === 'org_admin' || role === 'ticket_manager' || role === 'org_staff') &&
    admin.organizationId
  ) {
    payload.organizationId = String(admin.organizationId);
  }
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

authRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const count = await Admin.countDocuments();
    res.json({
      needsAdminSetup: count === 0,
      loginVerification: {
        enabled: config.adminLoginVerify,
        emailReady: smtpReadyForSend(),
        smsProviderReady: smsOtpGloballyAvailable(),
      },
    });
  })
);

authRouter.get(
  '/email-status',
  asyncHandler(async (_req, res) => {
    res.json({
      configured: isSmtpConfigured(),
      ready: smtpReadyForSend(),
      mock: config.smtp.mock,
    });
  })
);

authRouter.post(
  '/setup',
  asyncHandler(async (req, res) => {
    const existing = await Admin.countDocuments();
    if (existing > 0) {
      return res.status(403).json({ error: 'An administrator account already exists' });
    }
    const { email, password, phone: phoneRaw, fullName: fullNameRaw } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const fullName = String(fullNameRaw || '').trim();
    if (!fullName) {
      return res.status(400).json({ error: 'fullName is required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    let phone = '';
    if (phoneRaw != null && String(phoneRaw).trim()) {
      const n = normalizeGhanaMsisdn(String(phoneRaw).trim());
      if (!n) {
        return res.status(400).json({ error: 'Invalid phone (Ghana 0XX… or 233…)' });
      }
      phone = n;
    }
    const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
    const admin = await Admin.create({
      email: String(email).toLowerCase().trim(),
      fullName,
      passwordHash,
      phone,
      role: 'super_admin',
      organizationId: null,
    });
    const token = signToken(admin);
    res.status(201).json({
      token,
      admin: { id: admin._id, email: admin.email, fullName: admin.fullName || '', role: admin.role },
    });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const admin = await Admin.findOne({
      email: String(email).toLowerCase().trim(),
    });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const ok = await bcrypt.compare(String(password), admin.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const role = admin.role || 'super_admin';
    if (config.adminLoginVerify && role === 'org_admin') {
      try {
        const ch = await createAndDispatchLoginChallenge(admin);
        return res.json({
          step: 'verify',
          challengeId: ch.challengeId,
          sentEmail: ch.sentEmail,
          sentSms: ch.sentSms,
          sameCodeOnBothChannels: ch.sameCodeOnBothChannels,
          expiresInSec: ch.expiresInSec,
        });
      } catch (e) {
        const status = e.status && Number(e.status) >= 400 ? e.status : 500;
        return res.status(status).json({ error: e.message || 'Verification failed' });
      }
    }

    const token = signToken(admin);
    res.json({
      token,
      admin: {
        id: admin._id,
        email: admin.email,
        fullName: admin.fullName || '',
        role: admin.role || 'super_admin',
        organizationId: admin.organizationId || null,
      },
    });
  })
);

authRouter.post(
  '/login/verify',
  asyncHandler(async (req, res) => {
    if (!config.adminLoginVerify) {
      return res.status(400).json({ error: 'Login verification is not enabled on this server' });
    }
    const { challengeId, code, emailCode } = req.body || {};
    const effectiveCode = code != null && String(code).trim() !== '' ? code : emailCode;
    if (!challengeId) {
      return res.status(400).json({ error: 'challengeId is required' });
    }
    let adminId;
    try {
      const r = await verifyLoginChallenge({ challengeId, code: effectiveCode });
      adminId = r.adminId;
    } catch (e) {
      const status = e.status && Number(e.status) >= 400 ? e.status : 500;
      return res.status(status).json({ error: e.message || 'Verification failed' });
    }
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(400).json({ error: 'Invalid challenge' });
    }
    const token = signToken(admin);
    res.json({
      token,
      admin: {
        id: admin._id,
        email: admin.email,
        fullName: admin.fullName || '',
        role: admin.role || 'super_admin',
        organizationId: admin.organizationId || null,
      },
    });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  attachOrganization,
  asyncHandler(async (req, res) => {
    const row = await Admin.findById(req.admin.id).select('email role organizationId fullName phone').lean();
    res.json({
      admin: {
        id: req.admin.id,
        email: row?.email || req.admin.email,
        fullName: String(row?.fullName || '').trim(),
        phone: row?.phone || '',
        role: row?.role || req.admin.role || 'super_admin',
        organizationId: row?.organizationId != null ? row.organizationId : req.admin.organizationId || null,
      },
      organizationId: req.organizationId,
      organizationName: req.organizationName || null,
      organizationSlug: req.organizationSlug || null,
    });
  })
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const admin = await Admin.findById(req.admin.id);
    if (!admin) {
      return res.status(404).json({ error: 'Account not found' });
    }
    const ok = await bcrypt.compare(String(currentPassword), admin.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    admin.passwordHash = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
    await admin.save();
    res.json({ ok: true });
  })
);
