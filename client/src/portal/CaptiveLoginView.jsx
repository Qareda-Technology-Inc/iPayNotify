import { Link } from 'react-router-dom';

function BrandMark({ logoUrl, brandName, light }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={brandName || 'Logo'}
        className="mb-4 h-12 w-auto max-w-[180px] object-contain"
      />
    );
  }
  return (
    <p className={`text-sm font-semibold tracking-wide ${light ? 'text-orange-700' : 'text-emerald-300'}`}>
      {brandName || 'Wi‑Fi'}
    </p>
  );
}

function LoginFields({
  code,
  onCode,
  onSubmit,
  preview,
  error,
  siteName,
  buyTo,
  buttonLabel,
  buyLabel,
  inputClass,
  buttonClass,
  hintClass,
  linkClass,
}) {
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className={hintClass}>Access code</span>
        <input
          value={code}
          onChange={(e) => onCode(e.target.value.replace(/\s+/g, ''))}
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          placeholder="482193"
          readOnly={preview}
          className={inputClass}
        />
      </label>
      {error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className={buttonClass}>
        {buttonLabel || 'Connect'}
      </button>
      {siteName ? <p className={hintClass}>Site: {siteName}</p> : null}
      {preview ? (
        <p className={linkClass}>{buyLabel || 'Buy a code'}</p>
      ) : (
        <Link to={buyTo} className={linkClass}>
          {buyLabel || 'Buy a code'}
        </Link>
      )}
    </form>
  );
}

/**
 * Guest hotspot login. `compact` fits the admin design picker.
 * `preview` keeps the form from posting to a router.
 */
export function CaptiveLoginView({
  designId = 'midnight',
  brandName = 'Wi‑Fi',
  logoUrl = '',
  siteName = '',
  error = '',
  compact = false,
  preview = false,
  code = '',
  onCode = () => {},
  onSubmit = (e) => e.preventDefault(),
  buyTo = '/portal/hotspot',
  headline = '',
  subtitle = '',
  buttonLabel = '',
  buyLabel = '',
}) {
  const pad = compact ? 'px-5 py-6' : 'px-5 py-10';
  const shell = compact ? 'min-h-[460px]' : 'min-h-screen';
  const fields = { buttonLabel, buyLabel };

  if (designId === 'sunrise') {
    return (
      <div className={`${shell} bg-[#fff7ed] text-stone-900 ${pad}`}>
        <div className="mx-auto max-w-sm rounded-3xl bg-white px-6 py-8 shadow-xl shadow-orange-900/10">
          <BrandMark logoUrl={logoUrl} brandName={brandName} light />
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{headline || 'Get online'}</h1>
          <p className="mt-1 text-sm text-stone-500">{subtitle || 'Enter the code on your voucher.'}</p>
          <LoginFields
            {...fields}
            code={code}
            onCode={onCode}
            onSubmit={onSubmit}
            preview={preview}
            error={error}
            siteName={siteName}
            buyTo={buyTo}
            hintClass="mb-1.5 block text-xs font-medium text-stone-500"
            inputClass="w-full rounded-xl border border-orange-200 bg-orange-50/40 px-3 py-3 font-mono text-lg tracking-[0.3em] text-stone-900 outline-none focus:border-orange-400"
            buttonClass="w-full rounded-xl bg-orange-600 py-3 text-sm font-semibold text-white hover:bg-orange-500"
            linkClass="block text-center text-sm font-medium text-orange-700"
          />
        </div>
      </div>
    );
  }

  if (designId === 'signal') {
    return (
      <div className={`${shell} bg-[#06141f] text-white ${pad}`}>
        <div className="mx-auto max-w-sm">
          <BrandMark logoUrl={logoUrl} brandName={brandName} />
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-cyan-200">
            {headline || 'Enter your code'}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {subtitle || 'The number printed on your voucher.'}
          </p>
          <LoginFields
            {...fields}
            code={code}
            onCode={onCode}
            onSubmit={onSubmit}
            preview={preview}
            error={error}
            siteName={siteName}
            buyTo={buyTo}
            hintClass="mb-1.5 block text-xs font-medium uppercase tracking-wider text-cyan-400/80"
            inputClass="w-full rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-3 py-4 font-mono text-2xl tracking-[0.35em] text-cyan-50 outline-none focus:border-cyan-300"
            buttonClass="w-full rounded-2xl bg-cyan-400 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
            linkClass="block text-center text-sm text-cyan-300"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`${shell} bg-slate-950 text-white ${pad}`}>
      <div className="mx-auto max-w-sm rounded-3xl border border-slate-800 bg-slate-900/80 px-6 py-8">
        <BrandMark logoUrl={logoUrl} brandName={brandName} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{headline || 'Connect to Wi‑Fi'}</h1>
        <p className="mt-1 text-sm text-slate-400">{subtitle || 'Type the code from your voucher.'}</p>
        <LoginFields
          {...fields}
          code={code}
          onCode={onCode}
          onSubmit={onSubmit}
          preview={preview}
          error={error}
          siteName={siteName}
          buyTo={buyTo}
          hintClass="mb-1.5 block text-xs font-medium text-slate-400"
          inputClass="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-lg tracking-[0.3em] text-white outline-none focus:border-emerald-500"
          buttonClass="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
          linkClass="block text-center text-sm text-emerald-300"
        />
      </div>
    </div>
  );
}
