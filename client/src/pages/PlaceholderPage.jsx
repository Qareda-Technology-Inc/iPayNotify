export function PlaceholderPage({ title, body }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-3 text-sm text-slate-400">{body}</p>
    </div>
  );
}
