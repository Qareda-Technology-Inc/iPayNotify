import { describe, expect, it } from 'vitest';
import { publicRenewUrl } from '../src/utils/renewLink.js';

describe('renew link in SMS', () => {
  it('carries the renew ID so the page opens on the bill', () => {
    expect(publicRenewUrl('QF7K2M9P')).toMatch(/\/portal\/renew\?id=QF7K2M9P$/);
  });

  it('falls back to the plain renew page without an ID', () => {
    expect(publicRenewUrl('')).toMatch(/\/portal\/renew$/);
  });
});
