export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
}: Readonly<{
  title: string;
  eyebrow: string;
  subtitle?: string | undefined;
  actions?: React.ReactNode;
}>) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-xs font-medium uppercase text-slate-500">{eyebrow}</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
