import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { buildPaymentWalledGardenTargets } from '../src/services/walledGardenSyncService.js';

describe('hotspot walled garden', () => {
  const saved = { api: config.publicApiUrl, render: process.env.RENDER_EXTERNAL_HOSTNAME };
  afterEach(() => {
    config.publicApiUrl = saved.api;
    if (saved.render === undefined) delete process.env.RENDER_EXTERNAL_HOSTNAME;
    else process.env.RENDER_EXTERNAL_HOSTNAME = saved.render;
  });

  it('lets customers reach the API before login', () => {
    config.publicApiUrl = 'https://api.example.test';
    expect(buildPaymentWalledGardenTargets().hosts).toContain('api.example.test');
  });

  it('uses the Render host when no API URL is configured', () => {
    config.publicApiUrl = '';
    process.env.RENDER_EXTERNAL_HOSTNAME = 'billing-api.onrender.com';
    expect(buildPaymentWalledGardenTargets().hosts).toContain('billing-api.onrender.com');
  });
});
