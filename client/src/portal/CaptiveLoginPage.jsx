import { useMemo, useState } from 'react';
import { CaptiveLoginView } from './CaptiveLoginView.jsx';
import { PORTAL_DESIGNS, portalCopy } from './designs.js';
import { getPortalSlugFromLocation, usePortalContext } from './usePortalContext.js';

function routerLoginUrl() {
  const q = new URLSearchParams(window.location.search);
  return (q.get('link-login') || q.get('link-login-only') || '').trim();
}

function postCodeToRouter(link, code) {
  const q = new URLSearchParams(window.location.search);
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = link;
  const add = (name, value) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  };
  add('username', code);
  add('password', '');
  const dst = q.get('dst') || q.get('link-orig') || '';
  if (dst) add('dst', dst);
  document.body.appendChild(form);
  form.submit();
}

export function CaptiveLoginPage() {
  const { ctx } = usePortalContext();
  const slug = getPortalSlugFromLocation();
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState('');

  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const requested = query.get('design') || '';
  const designId = PORTAL_DESIGNS.some((d) => d.id === requested)
    ? requested
    : ctx?.branding?.portalDesign || 'midnight';

  const brandName = String(ctx?.branding?.displayName || '').trim() || 'Wi‑Fi';
  const logoUrl = String(ctx?.branding?.logoUrl || '').trim();
  const siteName = String(ctx?.router?.name || '').trim();
  const routerError = String(query.get('error') || '').trim();
  const buyTo = slug ? `/portal/hotspot?r=${encodeURIComponent(slug)}` : '/portal/hotspot';
  const copy = portalCopy(designId, {
    headline: ctx?.branding?.portalHeadline,
    subtitle: ctx?.branding?.portalSubtitle,
    buttonLabel: ctx?.branding?.portalButtonLabel,
    buyLabel: ctx?.branding?.portalBuyLabel,
  });

  function onSubmit(e) {
    e.preventDefault();
    setLocalError('');
    const next = code.trim();
    if (!next) {
      setLocalError('Enter the code on your voucher.');
      return;
    }
    const link = routerLoginUrl();
    let allowed = false;
    try {
      const url = new URL(link);
      allowed = url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      allowed = false;
    }
    if (!allowed) {
      setLocalError('Open this page from the venue Wi‑Fi login so the router can accept the code.');
      return;
    }
    postCodeToRouter(link, next);
  }

  return (
    <CaptiveLoginView
      designId={designId}
      brandName={brandName}
      logoUrl={logoUrl}
      siteName={siteName}
      error={localError || routerError}
      code={code}
      onCode={setCode}
      onSubmit={onSubmit}
      buyTo={buyTo}
      headline={copy.headline}
      subtitle={copy.subtitle}
      buttonLabel={copy.buttonLabel}
      buyLabel={copy.buyLabel}
    />
  );
}
