import { useCallback, useEffect, useState } from 'react';
import { apiDownload, apiFetch } from '../api.js';

/**
 * ZenFi-style add router:
 * 1) Download .rsc (router phones home — cloud never needs LAN)
 * 2) Import on MikroTik via Winbox
 * 3) Peer appears → enter SSH/API login → claim into org DB
 *
 * Advanced: provision by reachable IP (public WAN or existing tunnel IP).
 */
export function AddRouterWizard({ onCreated, onCancel }) {
  const [mode, setMode] = useState('script'); // script | attach | advanced
  const [siteName, setSiteName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [transport, setTransport] = useState('ssh');
  const [host, setHost] = useState('');
  const [allowRemoteAccess, setAllowRemoteAccess] = useState(true);
  const [allowLanAccess, setAllowLanAccess] = useState(true);
  const [peers, setPeers] = useState([]);
  const [selectedPeerId, setSelectedPeerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [fetchCmds, setFetchCmds] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadPeers = useCallback(async () => {
    try {
      const data = await apiFetch('/api/routers/wireguard-peers?pending=1');
      const items = Array.isArray(data?.items) ? data.items : [];
      setPeers(items);
      if (items.length && !selectedPeerId) {
        setSelectedPeerId(items[0].id);
      }
      if (items.length && mode === 'script') {
        setMode('attach');
        setInfo(`Tunnel online: ${items[0].siteName} (${items[0].tunnelIp}). Enter the MikroTik login to finish.`);
      }
    } catch {
      /* keep previous list */
    }
  }, [mode, selectedPeerId]);

  useEffect(() => {
    loadPeers();
    const t = setInterval(loadPeers, 5000);
    return () => clearInterval(t);
  }, [loadPeers]);

  async function downloadScript() {
    setError('');
    setInfo('');
    if (siteName.trim() && siteName.trim().length < 2) {
      setError('Site name must be at least 2 characters (or leave blank to use router Identity).');
      return;
    }
    setDownloading(true);
    try {
      const q = new URLSearchParams();
      if (siteName.trim()) q.set('siteName', siteName.trim());
      const blob = await apiDownload(`/api/routers/install-script${q.toString() ? `?${q}` : ''}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = siteName.trim()
        ? `qarefi-${siteName.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40)}.rsc`
        : 'wireguard-auto-register.rsc';
      a.click();
      URL.revokeObjectURL(url);
      setInfo(
        'Script downloaded. Prefer /tool fetch below if the router has internet — or Winbox → Files → Upload → /import.'
      );
    } catch (err) {
      setError(err.message || 'Could not download script');
    } finally {
      setDownloading(false);
    }
  }

  async function loadFetchCommands() {
    setError('');
    setInfo('');
    try {
      const q = new URLSearchParams();
      if (siteName.trim()) q.set('siteName', siteName.trim());
      const data = await apiFetch(
        `/api/routers/install-script/commands${q.toString() ? `?${q}` : ''}`
      );
      setFetchCmds(data);
      setInfo('Copy the Terminal command and paste it on the MikroTik — it fetches and imports the script.');
    } catch (err) {
      setError(err.message || 'Could not build fetch URL');
      setFetchCmds(null);
    }
  }

  async function copyOneShot() {
    if (!fetchCmds?.oneShot) return;
    try {
      await navigator.clipboard.writeText(fetchCmds.oneShot);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the command and copy manually.');
    }
  }

  async function attachPeer(e) {
    e.preventDefault();
    setError('');
    if (!selectedPeerId) {
      setError('Wait for the peer to appear after importing the .rsc, or pick one below.');
      return;
    }
    if (!username.trim() || !password) {
      setError('MikroTik username and password are required.');
      return;
    }
    setBusy(true);
    try {
      const peer = peers.find((p) => p.id === selectedPeerId);
      const data = await apiFetch('/api/routers/from-peer', {
        method: 'POST',
        body: JSON.stringify({
          peerId: selectedPeerId,
          siteName: siteName.trim() || peer?.siteName,
          username: username.trim(),
          password,
          transport,
          allowRemoteAccess,
        }),
      });
      if (onCreated) onCreated(data);
    } catch (err) {
      setError(err.message || 'Could not attach router');
    } finally {
      setBusy(false);
    }
  }

  async function provisionAdvanced(e) {
    e.preventDefault();
    setError('');
    if (!siteName.trim() || siteName.trim().length < 2) {
      setError('Site name is required.');
      return;
    }
    if (!host.trim() || !username.trim() || !password) {
      setError('IP, username, and password are required.');
      return;
    }
    setBusy(true);
    try {
      const data = await apiFetch('/api/routers/provision', {
        method: 'POST',
        body: JSON.stringify({
          siteName: siteName.trim(),
          host: host.trim(),
          username: username.trim(),
          password,
          transport: transport === 'ssh' || transport === 'api' ? transport : 'auto',
          allowRemoteAccess,
          allowLanAccess,
        }),
      });
      if (onCreated) onCreated(data);
    } catch (err) {
      setError(err.message || 'Could not add router');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'mt-1.5 w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onCancel} />
      <div className="relative z-10 flex max-h-[min(92dvh,92vh)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-700/80 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-base font-semibold text-white">Add router</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Like ZenFi: import a script on site — the router joins the VPN by itself.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-2.5 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-slate-800 px-3 py-2">
          {[
            { id: 'script', label: '1. Script' },
            { id: 'attach', label: '2. Finish' },
            { id: 'advanced', label: 'Advanced' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMode(t.id)}
              className={`min-h-9 flex-1 rounded-lg text-xs font-semibold transition ${
                mode === t.id ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5">
          {mode === 'script' ? (
            <>
              <p className="text-xs leading-relaxed text-slate-400">
                You do <span className="text-slate-200">not</span> need to run QareFi on localhost. Download
                the script here, upload it on the MikroTik while you are on site Wi‑Fi, import it — the router
                calls the cloud and creates the tunnel.
              </p>
              <label className="block text-xs font-medium text-slate-400">
                Site name (optional)
                <input
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="East Legon — or leave blank for Identity"
                  className={inputClass}
                />
              </label>
              <ol className="list-decimal space-y-1.5 pl-4 text-xs text-slate-400">
                <li>Open your API health URL in a browser first (wakes Render if asleep)</li>
                <li>On MikroTik: paste the wake test, wait until status finished</li>
                <li>Paste the install command (short URL + check-certificate=no)</li>
                <li>Open “2. Finish” when the peer appears</li>
              </ol>
              <button
                type="button"
                onClick={loadFetchCommands}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Get /tool fetch command
              </button>
              {fetchCmds?.wakeCmd ? (
                <div className="space-y-2 rounded-xl border border-slate-700/80 bg-slate-950/60 p-3">
                  <p className="text-[11px] text-amber-200/90">
                    Run these as <span className="font-semibold">3 separate</span> Terminal commands. After
                    import you must see lines starting with <span className="font-mono">QAREFI:</span>
                  </p>
                  {(fetchCmds.steps || [fetchCmds.wakeCmd, fetchCmds.fetchCmd, fetchCmds.importCmd]).map(
                    (cmd, i) => (
                      <div key={i} className="space-y-1">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          Step {i + 1}
                        </p>
                        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-emerald-200/90">
                          {cmd}
                        </pre>
                      </div>
                    )
                  )}
                  <button
                    type="button"
                    onClick={copyOneShot}
                    className="w-full rounded-lg border border-slate-600 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    {copied ? 'Copied all steps' : 'Copy all steps'}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                disabled={downloading}
                onClick={downloadScript}
                className="flex h-10 w-full items-center justify-center rounded-xl border border-slate-600 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                {downloading ? 'Preparing…' : 'Or download .rsc (after redeploy)'}
              </button>
              {peers.length ? (
                <button
                  type="button"
                  onClick={() => setMode('attach')}
                  className="w-full text-center text-xs font-medium text-emerald-400 hover:text-emerald-300"
                >
                  {peers.length} pending tunnel{peers.length === 1 ? '' : 's'} ready → Finish
                </button>
              ) : null}
            </>
          ) : null}

          {mode === 'attach' ? (
            <form onSubmit={attachPeer} className="space-y-4">
              <p className="text-xs leading-relaxed text-slate-400">
                Tunnel peers waiting to be linked. Pick one and enter the MikroTik admin login — we connect over
                the VPN from the cloud.
              </p>
              {peers.length === 0 ? (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100">
                  No pending peers yet. Import the .rsc on the router, wait ~10s, then refresh.
                </p>
              ) : (
                <label className="block text-xs font-medium text-slate-400">
                  Tunnel peer
                  <select
                    value={selectedPeerId}
                    onChange={(e) => setSelectedPeerId(e.target.value)}
                    className={inputClass}
                  >
                    {peers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.siteName} — {p.tunnelIp}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-xs font-medium text-slate-400">
                Display name (optional)
                <input
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="Overrides peer site name"
                  className={inputClass}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                <label className="block text-xs font-medium text-slate-400">
                  Username
                  <input
                    required
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-xs font-medium text-slate-400">
                  Password
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-400">Connect with</p>
                <div className="flex gap-1 rounded-xl bg-slate-950 p-1">
                  {[
                    { id: 'ssh', label: 'SSH' },
                    { id: 'api', label: 'API' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTransport(t.id)}
                      className={`min-h-9 flex-1 rounded-lg text-xs font-semibold transition ${
                        transport === t.id
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={loadPeers}
                className="text-xs font-medium text-slate-400 hover:text-white"
              >
                Refresh peers
              </button>
              <button
                type="submit"
                disabled={busy || !peers.length}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? 'Linking…' : 'Link router to account'}
              </button>
            </form>
          ) : null}

          {mode === 'advanced' ? (
            <form onSubmit={provisionAdvanced} className="space-y-4">
              <p className="text-xs leading-relaxed text-slate-400">
                Only if the cloud can already reach the router (public IP with SSH/API open, or an existing
                tunnel IP like 10.66.54.x). Site LAN IPs (192.168.x / 10.1.x) will not work from production.
              </p>
              <label className="block text-xs font-medium text-slate-400">
                Site name
                <input
                  required
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="East Legon"
                  className={inputClass}
                />
              </label>
              <label className="block text-xs font-medium text-slate-400">
                Reachable IP
                <input
                  required
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="Public WAN or 10.66.54.x"
                  className={`${inputClass} font-mono`}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                <label className="block text-xs font-medium text-slate-400">
                  Username
                  <input
                    required
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-xs font-medium text-slate-400">
                  Password
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
              <div className="flex flex-col gap-2.5 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-sm text-slate-300">
                <label className="inline-flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={allowRemoteAccess}
                    onChange={(e) => setAllowRemoteAccess(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  Allow remote access over VPN
                </label>
                <label className="inline-flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={allowLanAccess}
                    onChange={(e) => setAllowLanAccess(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  Allow access to site LAN
                </label>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? 'Connecting…' : 'Provision by IP'}
              </button>
            </form>
          ) : null}

          {info ? (
            <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-100">
              {info}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
