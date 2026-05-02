"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const salesData = [
  { day: "Mon", sales: 14800, gst: 1320 },
  { day: "Tue", sales: 17600, gst: 1580 },
  { day: "Wed", sales: 15940, gst: 1410 },
  { day: "Thu", sales: 21400, gst: 1910 },
  { day: "Fri", sales: 18420, gst: 1640 },
  { day: "Sat", sales: 24200, gst: 2160 },
  { day: "Sun", sales: 12600, gst: 1120 },
];

const stockData = [
  { category: "Tablets", value: 420 },
  { category: "Syrups", value: 180 },
  { category: "OTC", value: 260 },
  { category: "Devices", value: 84 },
];

const expiryData = [
  { bucket: "30 days", batches: 8 },
  { bucket: "60 days", batches: 14 },
  { bucket: "90 days", batches: 22 },
];

export function ReportsDashboard() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-md border border-border bg-white p-4">
        <div className="mb-4 text-sm font-semibold text-slate-950">Daily sales</div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={salesData}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`} />
              <Line type="monotone" dataKey="sales" stroke="#059669" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="gst" stroke="#2563eb" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="rounded-md border border-border bg-white p-4">
        <div className="mb-4 text-sm font-semibold text-slate-950">Stock by category</div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stockData}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="category" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="rounded-md border border-border bg-white p-4 xl:col-span-2">
        <div className="mb-4 text-sm font-semibold text-slate-950">Expiry report</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={expiryData}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="batches" fill="#d97706" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
