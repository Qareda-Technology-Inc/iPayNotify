import mongoose from 'mongoose';
import { MessageTemplate } from '../models/index.js';

function orgClause(organizationId) {
  if (
    organizationId == null ||
    !String(organizationId).trim() ||
    !mongoose.isValidObjectId(String(organizationId).trim())
  ) {
    return {};
  }
  return { organizationId: String(organizationId).trim() };
}

export async function listMessageTemplates(filter = {}, organizationId) {
  return MessageTemplate.find({ ...filter, ...orgClause(organizationId) })
    .sort({ category: 1, name: 1 })
    .lean();
}

export async function getMessageTemplate(id, organizationId) {
  return MessageTemplate.findOne({ _id: id, ...orgClause(organizationId) }).lean();
}

export async function createMessageTemplate(data) {
  return MessageTemplate.create(data);
}

export async function updateMessageTemplate(id, patch, { organizationId } = {}) {
  const allowed = new Set(['name', 'category', 'body', 'description', 'isActive']);
  const doc = await MessageTemplate.findOne({ _id: id, ...orgClause(organizationId) });
  if (!doc) return null;
  for (const k of allowed) {
    if (patch[k] !== undefined) doc[k] = patch[k];
  }
  await doc.save();
  return doc.toObject();
}

export async function deleteMessageTemplate(id, { organizationId } = {}) {
  const r = await MessageTemplate.findOneAndDelete({ _id: id, ...orgClause(organizationId) });
  return Boolean(r);
}

/** Replace {{key}} in body. */
export function renderMessageBody(body, vars) {
  let out = String(body ?? '');
  const map = { ...vars };
  for (const [k, v] of Object.entries(map)) {
    const safe = v == null ? '' : String(v);
    out = out.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(k)}\\s*\\}\\}`, 'gi'), safe);
  }
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
