import { describe, expect, it } from 'vitest';
import { Router } from '../src/models/index.js';
import { normalizeRouterForApi } from '../src/mikrotik/routeros.js';
import { normalizeRouterForSsh } from '../src/mikrotik/rosSsh.js';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../src/utils/secretBox.js';
import { createOrg, createRouter } from './helpers/fixtures.js';

describe('secretBox', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('p@ss:word');
    const b = encryptSecret('p@ss:word');
    expect(isEncryptedSecret(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('p@ss:word');
  });

  it('passes legacy plaintext and empty values through', () => {
    expect(decryptSecret('legacy')).toBe('legacy');
    expect(encryptSecret('')).toBe('');
    const once = encryptSecret('x');
    expect(encryptSecret(once)).toBe(once);
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptSecret('secret');
    const tampered = enc.slice(0, -4) + (enc.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => decryptSecret(tampered)).toThrow(/decrypt/);
  });
});

describe('router passwords at rest', () => {
  it('are stored encrypted and decrypted only when connecting', async () => {
    const router = await createRouter(await createOrg(), { apiPassword: 'api-pass', sshPassword: 'ssh-pass' });
    const raw = await Router.collection.findOne({ _id: router._id });
    expect(isEncryptedSecret(raw.apiPassword)).toBe(true);
    expect(isEncryptedSecret(raw.sshPassword)).toBe(true);

    const lean = await Router.findById(router._id).select('+sshPassword').lean();
    expect(normalizeRouterForApi(lean).apiPassword).toBe('api-pass');
    expect(normalizeRouterForSsh(lean).password).toBe('ssh-pass');
  });
});
