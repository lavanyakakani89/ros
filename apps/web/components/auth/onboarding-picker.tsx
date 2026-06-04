"use client";

import type { TenantVertical } from "@retailos/shared";
import { Hammer, Pill, Shirt, ShoppingBasket, Smartphone, Utensils, type LucideIcon } from "lucide-react";
import Link from "next/link";

const verticals: Array<{ value: TenantVertical; label: string; caption: string; icon: LucideIcon }> = [
  { value: "PHARMACY", label: "Pharmacy", caption: "Batches, expiry, prescriptions", icon: Pill },
  { value: "GROCERY", label: "Grocery", caption: "Weights, perishables, delivery", icon: ShoppingBasket },
  { value: "FASHION", label: "Fashion", caption: "Sizes, colors, seasons", icon: Shirt },
  { value: "HARDWARE", label: "Hardware", caption: "Units, conversions, site delivery", icon: Hammer },
  { value: "ELECTRONICS", label: "Electronics", caption: "Serials, IMEI, warranty", icon: Smartphone },
  { value: "RESTAURANT", label: "Restaurant", caption: "Tables, menu, takeaway", icon: Utensils },
];

export function OnboardingPicker() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {verticals.map((vertical) => {
        const Icon = vertical.icon;

        return (
          <Link key={vertical.value} href={`/register?vertical=${vertical.value}`} className="rounded-md border border-border bg-white p-4 hover:border-emerald-500">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-950">{vertical.label}</div>
                <div className="text-xs text-slate-500">{vertical.caption}</div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
