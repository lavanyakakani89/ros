export function StatStrip({
  items,
}: Readonly<{
  items: Array<{ label: string; value: string; tone: "emerald" | "blue" | "amber" | "slate" }>;
}>) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    slate: "border-slate-200 bg-white text-slate-900",
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={`rounded-md border p-4 ${tones[item.tone]}`}>
          <div className="text-xs font-medium text-slate-500">{item.label}</div>
          <div className="mt-2 text-2xl font-semibold">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
