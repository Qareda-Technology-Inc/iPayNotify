import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Admin, Organization } from '../models/index.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';
import { assertOrgLimit } from './orgLimitsService.js';
import { issueAdminInvite, inviteAcceptUrl } from './adminInviteService.js';
import { logOrgAudit } from './orgAuditService.js';

const SALT = 10;
export const ORG_SCOPED_ADMIN_ROLES = ['org_admin', 'ticket_manager', 'org_staff'];
export const ORG_INVITE_ROLES = ['org_admin', 'org_staff'];

function mapAdmin(doc) {
  return {
    _id: doc._id,
    email: doc.email,
    fullName: doc.fullName || '',
    phone: doc.phone || '',
    role: doc.role,
    status: doc.status,
    organizationId: doc.organizationId,
    inviteExpiresAt: doc.inviteExpiresAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listOrgTeam(organizationId) {
  return Admin.find({
    organizationId,
    role: { $in: ORG_SCOPED_ADMIN_ROLES },
  })
    .select('email phone fullName role status organizationId inviteExpiresAt createdAt updatedAt')
    .sort({ email: 1 })
    .lean();
}

export async function inviteOrgTeamMember(organizationId, body, actor) {
  const org = await Organization.findById(organizationId).lean();
  if (!org) {
    const e = new Error('Organisation not found');
    e.status = 404;
    throw e;
  }
  const email = String(body?.email || '')
    .toLowerCase()
    .trim();
  const role = ORG_INVITE_ROLES.includes(String(body?.role || '').trim())
    ? String(body.role).trim()
    : 'org_admin';
  const fullName = String(body?.fullName || '').trim();
  let phone = '';
  if (body?.phone != null && String(body.phone).trim()) {
    const n = normalizeGhanaMsisdn(String(body.phone).trim());
    if (!n) {
      const e = new Error('Invalid phone (Ghana 0XX… or 233…)');
      e.status = 400;
      throw e;
    }
    phone = n;
  }
  if (!email) {
    const e = new Error('email is required');
    e.status = 400;
    throw e;
  }
  if (!fullName) {
    const e = new Error('fullName is required');
    e.status = 400;
    throw e;
  }
  const existing = await Admin.findOne({ email });
  if (existing) {
    const e = new Error('An administrator with this email already exists');
    e.status = 400;
    throw e;
  }
  await assertOrgLimit(org._id, 'admins');
  const doc = await Admin.create({
    email,
    fullName,
    phone,
    passwordHash: '',
    role,
    organizationId: org._id,
    status: 'invited',
  });
  const { emailSent, rawToken } = await issueAdminInvite(doc, { orgName: org.name });
  void logOrgAudit({
    organizationId: org._id,
    actorEmail: actor?.email,
    action: 'admin.invite',
    meta: { email: doc.email, role: doc.role, emailSent },
  });
  return {
    ...mapAdmin(doc),
    emailSent,
    acceptUrl: inviteAcceptUrl(rawToken),
  };
}

export async function resendOrgTeamInvite(organizationId, adminId, actor) {
  const org = await Organization.findById(organizationId).lean();
  if (!org) {
    const e = new Error('Organisation not found');
    e.status = 404;
    throw e;
  }
  const doc = await Admin.findOne({
    _id: adminId,
    organizationId,
    role: { $in: ORG_SCOPED_ADMIN_ROLES },
  });
  if (!doc) {
    const e = new Error('Administrator not found');
    e.status = 404;
    throw e;
  }
  if (doc.status !== 'invited') {
    const e = new Error('Only invited (pending) admins can be re-invited');
    e.status = 400;
    throw e;
  }
  const { emailSent, rawToken } = await issueAdminInvite(doc, { orgName: org.name });
  void logOrgAudit({
    organizationId,
    actorEmail: actor?.email,
    action: 'admin.resend_invite',
    meta: { email: doc.email, emailSent },
  });
  return {
    _id: doc._id,
    email: doc.email,
    status: doc.status,
    inviteExpiresAt: doc.inviteExpiresAt,
    emailSent,
    acceptUrl: inviteAcceptUrl(rawToken),
  };
}

export async function updateOrgTeamMember(organizationId, adminId, body, actorAdminId, actorEmail) {
  if (!mongoose.isValidObjectId(String(adminId))) {
    const e = new Error('Invalid id');
    e.status = 400;
    throw e;
  }
  const doc = await Admin.findOne({
    _id: adminId,
    organizationId,
    role: { $in: ORG_SCOPED_ADMIN_ROLES },
  });
  if (!doc) {
    const e = new Error('Administrator not found');
    e.status = 404;
    throw e;
  }
  if (body?.role != null) {
    const role = String(body.role).trim();
    if (!ORG_INVITE_ROLES.includes(role)) {
      const e = new Error('Invalid role');
      e.status = 400;
      throw e;
    }
    if (role !== doc.role) {
      if (actorAdminId && String(actorAdminId) === String(doc._id)) {
        const e = new Error('You cannot change your own access level');
        e.status = 400;
        throw e;
      }
      if (doc.role === 'org_admin' && doc.status === 'active') {
        const otherAdmins = await Admin.countDocuments({
          organizationId,
          role: 'org_admin',
          status: { $ne: 'invited' },
          _id: { $ne: doc._id },
        });
        if (otherAdmins === 0) {
          const e = new Error('This is the only active organisation admin. Make someone else an admin first.');
          e.status = 400;
          throw e;
        }
      }
    }
    doc.role = role;
  }
  if (body?.email != null) {
    const email = String(body.email).toLowerCase().trim();
    if (!email) {
      const e = new Error('email cannot be empty');
      e.status = 400;
      throw e;
    }
    const clash = await Admin.findOne({ email, _id: { $ne: doc._id } });
    if (clash) {
      const e = new Error('Email already in use');
      e.status = 400;
      throw e;
    }
    doc.email = email;
  }
  if (body?.password != null && String(body.password).length > 0) {
    if (String(body.password).length < 8) {
      const e = new Error('password must be at least 8 characters');
      e.status = 400;
      throw e;
    }
    doc.passwordHash = await bcrypt.hash(String(body.password), SALT);
    doc.status = 'active';
    doc.inviteTokenHash = '';
    doc.inviteExpiresAt = null;
  }
  if (body?.phone !== undefined) {
    const raw = body.phone;
    if (raw == null || String(raw).trim() === '') {
      doc.phone = '';
    } else {
      const n = normalizeGhanaMsisdn(String(raw).trim());
      if (!n) {
        const e = new Error('Invalid phone (Ghana 0XX… or 233…)');
        e.status = 400;
        throw e;
      }
      doc.phone = n;
    }
  }
  if (body?.fullName !== undefined) {
    const fn = String(body.fullName || '').trim();
    if (!fn) {
      const e = new Error('fullName cannot be empty');
      e.status = 400;
      throw e;
    }
    doc.fullName = fn;
  }
  const changed = doc.modifiedPaths().filter((p) => p !== 'passwordHash' && p !== 'inviteTokenHash');
  await doc.save();
  if (changed.length) {
    void logOrgAudit({
      organizationId,
      actorEmail,
      action: 'admin.update',
      meta: { email: doc.email, changed, role: doc.role },
    });
  }
  return mapAdmin(doc);
}

export async function removeOrgTeamMember(organizationId, adminId, actorAdminId, actorEmail) {
  if (String(adminId) === String(actorAdminId)) {
    const e = new Error('You cannot delete your own account from this screen');
    e.status = 400;
    throw e;
  }
  if (!mongoose.isValidObjectId(String(adminId))) {
    const e = new Error('Invalid id');
    e.status = 400;
    throw e;
  }
  const target = await Admin.findOne({
    _id: adminId,
    organizationId,
    role: { $in: ORG_SCOPED_ADMIN_ROLES },
  });
  if (!target) {
    const e = new Error('Administrator not found');
    e.status = 404;
    throw e;
  }
  if (target.role === 'org_admin' && target.status === 'active') {
    const otherAdmins = await Admin.countDocuments({
      organizationId,
      role: 'org_admin',
      status: { $ne: 'invited' },
      _id: { $ne: target._id },
    });
    if (otherAdmins === 0) {
      const e = new Error('Cannot remove the last active organisation admin');
      e.status = 400;
      throw e;
    }
  }
  await Admin.deleteOne({ _id: target._id });
  void logOrgAudit({
    organizationId,
    actorEmail,
    action: 'admin.remove',
    meta: { email: target.email, role: target.role },
  });
  return true;
}
