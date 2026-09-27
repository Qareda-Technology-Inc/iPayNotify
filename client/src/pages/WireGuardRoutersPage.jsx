import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, resolveApiUrl } from '../api.js';
import { getToken } from '../authStorage.js';

function statusBadge(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'active') return 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30';
  if (s === 'error') return 'bg-red-500/15 text-red-200 ring-red-500/30';
  if (s === 'disabled') return 'bg-slate-500/15 text-slate-300 ring-slate-500/30';
  return 'bg-amber-500/15 text-amber-100 ring-amber-500/30';
}

function shortKey(k) {
  const s = String(k || '');
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

/**
 * @param {{ mode?: 'vpn' | 'routers' }} props
 * - vpn: platform VPN status, VPS SSH, phone/laptop clients
 * - routers: MikroTik peer onboarding + registered router peers
 */
export function WireGuardRoutersPage({ mode = 'routers' }) {
  const isVpn = mode === 'vpn';

  const [items, setItems] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busyId, setBusyId] = useState('');

  const [siteName, setSiteName] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [lanSubnet, setLanSubnet] = useState('');
  const [tunnelIp, setTunnelIp] = useState('');
  const [creating, setCreating] = useState(false);
  const [dlSiteName, setDlSiteName] = useState('');
  const [dlLanSubnet, setDlLanSubnet] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [sshKeyBusy, setSshKeyBusy] = useState(false);

  const [phoneLabel, setPhoneLabel] = useState('');
  const [phoneIncludeLan, setPhoneIncludeLan] = useState(true);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneBundle, setPhoneBundle] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const data = await apiFetch('/api/super-admin/wireguard/peers');
      setItems(Array.isArray(data?.items) ? data.items : []);
      setCfg(data?.config || null);
    } catch (e) {
      setErr(e.message || 'Failed to load WireGuard peers');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const routerPeers = useMemo(
    () => items.filter((p) => p.kind !== 'client'),
    [items]
  );
  const phonePeers = useMemo(
    () => items.filter((p) => p.kind === 'client'),
    [items]
  );
  const tablePeers = isVpn ? phonePeers : routerPeers;

  async function generateSshKey(rotate = false) {
    if (rotate && !window.confirm('Replace the existing SSH key? You must update authorized_keys on the VPS.')) {
      return;
    }
    setSshKeyBusy(true);
    setErr('');
    setInfo('');
    try {
      const r = await apiFetch('/api/super-admin/wireguard/vps-ssh-key', {
        method: 'POST',
        body: JSON.stringify({ rotate }),
      });
      await load();
      if (r?.publicKey) {
        try {
          await navigator.clipboard.writeText(r.publicKey);
          setInfo(
            'Public key copied. Paste it into the VPS authorized_keys (replace any old qarefi-billing line), then retry Add router.'
          );
        } catch {
          setInfo('SSH key ready — copy the public key below to the VPS authorized_keys, then retry.');
        }
      } else {
        setInfo('SSH key ready. Copy the public key to the VPS authorized_keys.');
      }
    } catch (e) {
      setErr(e.message || 'Could not generate SSH key');
    } finally {
      setSshKeyBusy(false);
    }
  }

  async function testVpsSsh() {
    setSshKeyBusy(true);
    setErr('');
    setInfo('');
    try {
      const r = await apiFetch('/api/super-admin/wireguard/vps-ssh-test', {
        method: 'POST',
        body: '{}',
      });
      setInfo(
        `VPS SSH OK (${r.endpoint} as ${r.user}). ${r.whoami ? `whoami: ${r.whoami}` : ''}`
      );
    } catch (e) {
      setErr(e.message || 'VPS SSH test failed');
      if (e.publicKey) {
        try {
          await navigator.clipboard.writeText(e.publicKey);
        } catch {
          /* ignore */
        }
      }
    } finally {
      setSshKeyBusy(false);
    }
  }

  async function copySshPublicKey() {
    const line = cfg?.vpsSsh?.authorizedKeysLine || cfg?.vpsSsh?.publicKey || '';
    if (!line) return;
    try {
      await navigator.clipboard.writeText(line);
      setInfo('Public key copied. Paste it into ~/.ssh/authorized_keys on the VPS.');
    } catch {
      setErr('Could not copy — select the key text manually.');
    }
  }

  async function downloadInstallScript() {
    setDownloading(true);
    setErr('');
    setInfo('');
    try {
      const q = new URLSearchParams();
      if (dlSiteName.trim()) q.set('siteName', dlSiteName.trim());
      if (dlLanSubnet.trim()) q.set('lanSubnet', dlLanSubnet.trim());
      const path = `/api/super-admin/wireguard/install-script${q.toString() ? `?${q}` : ''}`;
      const res = await fetch(resolveApiUrl(path), {
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      });
      if (!res.ok) {
        let msg = `Download failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wireguard-auto-register.rsc';
      a.click();
      URL.revokeObjectURL(url);
      setInfo(
        'Script downloaded. Import it on the MikroTik — site name and LAN auto-detect unless you filled the optional fields.'
      );
    } catch (e) {
      setErr(e.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  async function createPeer(e) {
    e.preventDefault();
    setCreating(true);
    setErr('');
    setInfo('');
    try {
      const body = {
        siteName: siteName.trim(),
        publicKey: publicKey.trim(),
        ...(lanSubnet.trim() ? { lanSubnet: lanSubnet.trim() } : {}),
        ...(tunnelIp.trim() ? { tunnelIp: tunnelIp.trim() } : {}),
      };
      await apiFetch('/api/super-admin/wireguard/peers', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSiteName('');
      setPublicKey('');
      setLanSubnet('');
      setTunnelIp('');
      setInfo('Peer saved and synced to the VPS.');
      await load();
    } catch (e2) {
      setErr(e2.message || 'Could not create peer');
    } finally {
      setCreating(false);
    }
  }

  async function resync(id) {
    setBusyId(id);
    setErr('');
    setInfo('');
    try {
      await apiFetch(`/api/super-admin/wireguard/peers/${id}/resync`, {
        method: 'POST',
        body: '{}',
      });
      setInfo('VPS peer resynced.');
      await load();
    } catch (e) {
      setErr(e.message || 'Resync failed');
      await load();
    } finally {
      setBusyId('');
    }
  }

  async function setStatus(id, status) {
    setBusyId(id);
    setErr('');
    try {
      await apiFetch(`/api/super-admin/wireguard/peers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Update failed');
    } finally {
      setBusyId('');
    }
  }

  async function removePeer(id, name) {
    if (!window.confirm(`Remove VPN peer “${name}” from the database? (Does not remove it on the VPS.)`)) {
      return;
    }
    setBusyId(id);
    setErr('');
    try {
      await apiFetch(`/api/super-admin/wireguard/peers/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e.message || 'Delete failed');
    } finally {
      setBusyId('');
    }
  }

  async function generatePhoneClient(e) {
    e.preventDefault();
    setPhoneBusy(true);
    setErr('');
    setInfo('');
    setPhoneBundle(null);
    try {
      const data = await apiFetch('/api/super-admin/wireguard/phone-clients', {
        method: 'POST',
        body: JSON.stringify({
          label: phoneLabel.trim() || undefined,
          includeLan: phoneIncludeLan,
        }),
      });
      setPhoneBundle(data);
      setPhoneLabel('');
      setInfo(
        `Phone client ready — ${data.peer?.tunnelIp || 'tunnel allocated'}. Scan the QR or download the config.`
      );
      await load();
    } catch (e2) {
      setErr(e2.message || 'Could not create phone client');
    } finally {
      setPhoneBusy(false);
    }
  }

  function downloadPhoneConfig() {
    if (!phoneBundle?.config) return;
    const blob = new Blob([phoneBundle.config], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = phoneBundle.filename || 'qarefi-wg-phone.conf';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyPhoneConfig() {
    if (!phoneBundle?.config) return;
    try {
      await navigator.clipboard.writeText(phoneBundle.config);
      setInfo('Config copied to clipboard.');
    } catch {
      setErr('Could not copy — download the .conf instead.');
    }
  }

  const endpoint = cfg?.endpoint || '(set WG_ENDPOINT on the API)';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {isVpn ? 'WireGuard VPN' : 'WireGuard routers'}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            {isVpn ? (
              <>
                Platform VPN hub: endpoint status, VPS SSH for peer sync, and phone / laptop clients.
                Onboard site MikroTiks under{' '}
                <Link
                  to="/super/wireguard"
                  className="text-indigo-300 underline-offset-2 hover:underline"
                >
                  WireGuard routers
                </Link>
                .
              </>
            ) : (
              <>
                Site MikroTiks join the platform VPN first. After a peer appears here, add the site under{' '}
                <Link
                  to="/devices/routers"
                  className="text-indigo-300 underline-offset-2 hover:underline"
                >
                  Routers
                </Link>{' '}
                using the tunnel IP (<span className="font-mono text-slate-300">10.10.10.x</span>).
                VPN status and phone access live under{' '}
                <Link
                  to="/devices/wireguard"
                  className="text-indigo-300 underline-offset-2 hover:underline"
                >
                  WireGuard VPN
                </Link>
                .
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/devices/wireguard"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              isVpn
                ? 'bg-amber-600/20 text-amber-100 ring-1 ring-amber-500/40'
                : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            VPN
          </Link>
          <Link
            to="/super/wireguard"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              !isVpn
                ? 'bg-amber-600/20 text-amber-100 ring-1 ring-amber-500/40'
                : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Routers
          </Link>
        </div>
      </div>

      {isVpn ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="text-sm font-medium text-white">Platform VPN status</h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Ready</dt>
              <dd className="mt-1 text-slate-200">
                {cfg?.enabled ? 'Yes' : 'No — finish env + SSH key below'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Endpoint</dt>
              <dd className="mt-1 break-all font-mono text-xs text-slate-200">{endpoint}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">IP pool</dt>
              <dd className="mt-1 font-mono text-xs text-slate-200">{cfg?.pool || '10.10.10.0/24'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Register token</dt>
              <dd className="mt-1 text-slate-200">
                {cfg?.hasRegisterToken ? 'Configured' : 'Optional / not set'}
              </dd>
            </div>
          </dl>

          <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/15 p-4">
            <h4 className="text-sm font-medium text-amber-50">VPS SSH key (for peer sync)</h4>
            <p className="mt-1 text-xs text-amber-100/80">
              Generates an <strong>Ed25519</strong> or <strong>RSA 2048</strong> key (formats your VPS
              panel accepts). Copy the public line into the panel’s SSH keys /{' '}
              <span className="font-mono">authorized_keys</span>. If you see a key-format error, click{' '}
              <strong>Rotate key</strong> and replace the old line on the VPS.
            </p>
            {cfg?.vpsSsh?.privateKeyParseOk === false ? (
              <p className="mt-2 rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-100">
                Stored private key is not usable. Click <strong>Rotate key</strong>, then replace the
                public key on the VPS before adding routers.
              </p>
            ) : null}
            {cfg?.vpsSsh?.source === 'env' ? (
              <p className="mt-2 text-xs text-amber-100/90">
                Using SSH key from environment (<span className="font-mono">WG_VPS_SSH_*</span>).
              </p>
            ) : cfg?.vpsSsh?.publicKey ? (
              <>
                <pre className="mt-3 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[11px] text-slate-200">
                  {cfg.vpsSsh.authorizedKeysLine || cfg.vpsSsh.publicKey}
                </pre>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copySshPublicKey()}
                    className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-900/30"
                  >
                    Copy public key
                  </button>
                  <button
                    type="button"
                    disabled={sshKeyBusy}
                    onClick={() => testVpsSsh()}
                    className="rounded-lg border border-emerald-600/40 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-950/40 disabled:opacity-50"
                  >
                    {sshKeyBusy ? 'Testing…' : 'Test VPS SSH'}
                  </button>
                  <button
                    type="button"
                    disabled={sshKeyBusy}
                    onClick={() => generateSshKey(true)}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {sshKeyBusy ? 'Working…' : 'Rotate key'}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                disabled={sshKeyBusy}
                onClick={() => generateSshKey(false)}
                className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {sshKeyBusy ? 'Generating…' : 'Generate SSH key'}
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-indigo-500/25 bg-indigo-950/20 p-5 text-sm text-indigo-100/90">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-indigo-50">How to onboard a site</p>
            {!cfg?.enabled ? (
              <Link
                to="/devices/wireguard"
                className="text-xs text-amber-200 underline-offset-2 hover:underline"
              >
                VPN not ready — set up VPS SSH first
              </Link>
            ) : (
              <span className="text-xs text-indigo-200/70">
                Endpoint <span className="font-mono">{endpoint}</span>
              </span>
            )}
          </div>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs text-indigo-100/85">
            <li>Download the install script below (API URL and token are filled in for you).</li>
            <li>
              On the MikroTik: set a clear <strong>System → Identity</strong> name, then{' '}
              <span className="font-mono">/import</span> the <span className="font-mono">.rsc</span>{' '}
              file. LAN is taken from DHCP/bridge automatically.
            </li>
            <li>
              Refresh this page — the peer should appear with a{' '}
              <span className="font-mono">10.10.10.x</span> tunnel IP.
            </li>
            <li>
              Open{' '}
              <Link to="/devices/routers" className="underline underline-offset-2">
                Routers
              </Link>
              , pick that VPN peer, enter SSH login/password, then Test connection.
            </li>
          </ol>
          <div className="mt-4 grid gap-3 border-t border-indigo-500/20 pt-4 sm:grid-cols-2">
            <label className="block text-xs text-indigo-100/90">
              Site name override (optional)
              <input
                value={dlSiteName}
                onChange={(e) => setDlSiteName(e.target.value)}
                placeholder="leave blank → use router Identity"
                className="mt-1 w-full rounded-lg border border-indigo-500/30 bg-slate-950/60 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block text-xs text-indigo-100/90">
              LAN subnet override (optional)
              <input
                value={dlLanSubnet}
                onChange={(e) => setDlLanSubnet(e.target.value)}
                placeholder="leave blank → auto-detect"
                className="mt-1 w-full rounded-lg border border-indigo-500/30 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={downloading}
            onClick={() => downloadInstallScript()}
            className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {downloading ? 'Preparing…' : 'Download install script (.rsc)'}
          </button>
        </section>
      )}

      {err && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {err}
        </p>
      )}
      {info && (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {info}
        </p>
      )}

      {isVpn ? (
        <section className="rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-5">
          <h3 className="font-medium text-white">Phone / laptop access</h3>
          <p className="mt-1 text-xs text-slate-400">
            Creates a WireGuard client on the platform VPN, syncs it to the VPS, and shows a QR +{' '}
            <span className="font-mono">.conf</span> once. Install the WireGuard app, scan the QR, turn
            the tunnel on, then open Winbox to the router&apos;s{' '}
            <span className="font-mono text-slate-300">10.10.10.x:8291</span> from{' '}
            <Link
              to="/devices/routers"
              className="text-emerald-300 underline-offset-2 hover:underline"
            >
              Routers
            </Link>
            .
          </p>
          <form onSubmit={generatePhoneClient} className="mt-4 flex max-w-xl flex-col gap-3">
            <label className="block text-sm text-slate-300">
              Device label
              <input
                value={phoneLabel}
                onChange={(e) => setPhoneLabel(e.target.value)}
                placeholder="e.g. Kwame iPhone"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={phoneIncludeLan}
                onChange={(e) => setPhoneIncludeLan(e.target.checked)}
              />
              Include site LAN subnets (reach 192.168.x devices when routed)
            </label>
            <button
              type="submit"
              disabled={phoneBusy || !cfg?.enabled}
              className="w-fit rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {phoneBusy ? 'Creating…' : 'Generate phone config + QR'}
            </button>
          </form>

          {phoneBundle ? (
            <div className="mt-5 grid gap-4 rounded-xl border border-emerald-500/30 bg-slate-950/50 p-4 sm:grid-cols-[auto_1fr]">
              <div className="flex flex-col items-center gap-2">
                {phoneBundle.qrDataUrl ? (
                  <img
                    src={phoneBundle.qrDataUrl}
                    alt="WireGuard QR code"
                    className="h-48 w-48 rounded-lg bg-white p-2"
                  />
                ) : null}
                <p className="text-center text-[11px] text-slate-500">Scan in WireGuard app</p>
              </div>
              <div className="min-w-0 space-y-3">
                <p className="text-sm text-emerald-100">
                  Tunnel IP{' '}
                  <span className="font-mono font-semibold">{phoneBundle.peer?.tunnelIp}</span>
                  {phoneBundle.peer?.siteName ? (
                    <span className="text-slate-400"> · {phoneBundle.peer.siteName}</span>
                  ) : null}
                </p>
                <p className="text-xs text-amber-100/90">
                  Private key is shown only here — download or scan now. Lost config? Delete the peer
                  and generate a new one.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={downloadPhoneConfig}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    Download .conf
                  </button>
                  <button
                    type="button"
                    onClick={copyPhoneConfig}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Copy config
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhoneBundle(null)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Dismiss
                  </button>
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[10px] text-slate-400">
                  {phoneBundle.config}
                </pre>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="font-medium text-white">Manual peer (known public key)</h3>
          <p className="mt-1 text-xs text-slate-500">
            Use when the site already has a WireGuard key and you need to allocate / re-sync a tunnel
            IP without re-running the RouterOS script.
          </p>
          <form onSubmit={createPeer} className="mt-4 grid max-w-2xl gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300 sm:col-span-2">
              Site name
              <input
                required
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="East Legon POP"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
            <label className="block text-sm text-slate-300 sm:col-span-2">
              Public key
              <input
                required
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                placeholder="Base64 WireGuard public key"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="block text-sm text-slate-300">
              LAN subnet (optional)
              <input
                value={lanSubnet}
                onChange={(e) => setLanSubnet(e.target.value)}
                placeholder="192.168.88.0/24"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Tunnel IP (optional)
              <input
                value={tunnelIp}
                onChange={(e) => setTunnelIp(e.target.value)}
                placeholder="auto 10.10.10.x"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {creating ? 'Saving…' : 'Add peer'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-white">
            {isVpn ? 'Phone / laptop peers' : 'Registered router peers'}
          </h3>
          <button
            type="button"
            onClick={() => load()}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : tablePeers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            {isVpn
              ? 'No phone clients yet. Generate a config above.'
              : 'No router peers yet. Run the auto-register script on a MikroTik, or add a peer manually above.'}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  {!isVpn ? <th className="px-3 py-2 font-medium">Type</th> : null}
                  <th className="px-3 py-2 font-medium">Tunnel IP</th>
                  <th className="px-3 py-2 font-medium">LAN</th>
                  <th className="px-3 py-2 font-medium">Public key</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {tablePeers.map((p) => (
                  <tr key={p.id} className="text-slate-300">
                    <td className="px-3 py-2.5 text-slate-100">{p.siteName}</td>
                    {!isVpn ? (
                      <td className="px-3 py-2.5">
                        <span className="inline-flex rounded-md bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-300 ring-1 ring-slate-500/30">
                          Router
                        </span>
                      </td>
                    ) : null}
                    <td className="px-3 py-2.5 font-mono text-xs text-emerald-200">{p.tunnelIp}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-400">
                      {p.lanSubnet || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-400" title={p.publicKey}>
                      {shortKey(p.publicKey)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${statusBadge(p.status)}`}
                      >
                        {p.status}
                      </span>
                      {p.lastSyncError ? (
                        <p
                          className="mt-1 max-w-[10rem] text-[10px] text-red-300/90"
                          title={p.lastSyncError}
                        >
                          {p.lastSyncError}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      {p.lastSeen ? new Date(p.lastSeen).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={busyId === p.id}
                          onClick={() => resync(p.id)}
                          className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                        >
                          Resync
                        </button>
                        {p.status !== 'disabled' ? (
                          <button
                            type="button"
                            disabled={busyId === p.id}
                            onClick={() => setStatus(p.id, 'disabled')}
                            className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                          >
                            Disable
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === p.id}
                            onClick={() => setStatus(p.id, 'active')}
                            className="rounded border border-emerald-700/50 px-2 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-950/40 disabled:opacity-50"
                          >
                            Enable
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === p.id}
                          onClick={() => removePeer(p.id, p.siteName)}
                          className="rounded border border-red-700/40 px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-950/40 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
