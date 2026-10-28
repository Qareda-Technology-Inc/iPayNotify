import { createRequire } from 'module';
import { afterEach, describe, expect, it } from 'vitest';
import { withRouterSsh } from '../src/mikrotik/rosSshAdapter.js';
import { isSshAuthFailure } from '../src/mikrotik/rosSsh.js';

const require = createRequire(import.meta.url);
const { Server, utils } = require('ssh2');

let server;

afterEach(() => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve())));

/** In-process SSH server standing in for RouterOS; accepts only admin / good-pass. */
function startSshServer(keyType) {
  const { private: hostKey } = utils.generateKeyPairSync(keyType, keyType === 'rsa' ? { bits: 2048 } : {});
  server = new Server({ hostKeys: [hostKey] }, (client) => {
    client
      .on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === 'admin' && ctx.password === 'good-pass') ctx.accept();
        else ctx.reject(['password']);
      })
      .on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const router = (port, password) => ({
  host: '127.0.0.1',
  sshPort: port,
  transport: 'ssh',
  apiUser: 'admin',
  apiPassword: password,
});

describe('MikroTik SSH login', () => {
  it('connects to a router whose host key is ed25519', async () => {
    const port = await startSshServer('ed25519');
    await expect(withRouterSsh(router(port, 'good-pass'), async () => 'connected')).resolves.toBe('connected');
  });

  it('reports a wrong password as a login failure and keeps the router reason', async () => {
    const port = await startSshServer('ed25519');
    const err = await withRouterSsh(router(port, 'wrong'), async () => 'connected').catch((e) => e);
    expect(err.message).toMatch(/^SSH login failed for "admin"/);
    expect(err.message).toMatch(/router said: All configured authentication methods failed/);
  });

  it('does not call an algorithm mismatch a password problem', () => {
    const mismatch = new Error('Handshake failed: no matching host key format');
    expect(isSshAuthFailure(mismatch)).toBe(false);
    expect(isSshAuthFailure(new Error('All configured authentication methods failed'))).toBe(true);
    expect(isSshAuthFailure(new Error('connect ETIMEDOUT 10.66.54.18:22'))).toBe(false);
  });
});
