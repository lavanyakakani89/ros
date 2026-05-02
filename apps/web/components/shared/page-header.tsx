export function PageHeader({
  title,
  eyebrow,
  actions,
}: Readonly<{
  title: string;
  eyebrow: string;
  actions?: React.ReactNode;
}>) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-xs font-medium uppercase text-slate-500">{eyebrow}</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
