import express from 'express';
import mongoose from 'mongoose';
import { User, PppoeAccount, RemoteAccessSubscription } from '../models/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireRoles } from '../middleware/requireRoles.js';

export const usersRouter = express.Router();

usersRouter.use(requireRoles('super_admin', 'org_admin', 'org_staff', 'ticket_manager'));

const USER_WRITABLE = new Set([
  'email',
  'phone',
  'fullName',
  'balanceCents',
  'autoRenewalEnabled',
  'paymentMethodRef',
]);

function pickUserPayload(body) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const k of USER_WRITABLE) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const lim = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    res.json(
      await User.find({ organizationId: req.organizationId })
        .sort({ createdAt: -1 })
        .limit(lim)
        .lean()
    );
  })
);

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const doc = await User.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
    }).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  })
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const doc = await User.create({
      ...pickUserPayload(req.body),
      organizationId: req.organizationId,
    });
    res.status(201).json(doc);
  })
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const doc = await User.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.organizationId },
      pickUserPayload(req.body),
      {
        new: true,
      }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  })
);

usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const uid = req.params.id;
    await PppoeAccount.updateMany(
      { userId: uid, organizationId: req.organizationId },
      { $set: { userId: null } }
    );
    await RemoteAccessSubscription.updateMany(
      { userId: uid, organizationId: req.organizationId },
      { $set: { userId: null } }
    );
    const doc = await User.findOneAndDelete({
      _id: uid,
      organizationId: req.organizationId,
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  })
);
