import crypto from 'crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject, vi } from 'vitest';
import '../../src/models/index.js';
import { blockUnexpectedFetch } from '../helpers/network.js';
import { resetRateLimits } from '../../src/middleware/rateLimit.js';

beforeAll(async () => {
  const base = inject('mongoUri').replace(/\/?(\?.*)?$/, '');
  await mongoose.connect(`${base}/test_${crypto.randomBytes(4).toString('hex')}`);
  /* A running server has its indexes built; tests rely on the unique ones (ledger, references). */
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetRateLimits();
  blockUnexpectedFetch();
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

blockUnexpectedFetch();
