import type { VerticalNavigationItem } from "@retailos/shared";

export interface NavigationGroup {
  label: string;
  items: VerticalNavigationItem[];
}

const groupOrder = ["Sales", "Stock", "People", "Finance", "Insights", "Operations"] as const;
const accountNavigationHrefs = new Set(["/settings", "/audit"]);

const groupByHref: Record<string, (typeof groupOrder)[number]> = {
  "/billing": "Sales",
  "/quotations": "Sales",
  "/coupons": "Sales",
  "/loyalty": "Sales",
  "/credit-notes": "Sales",
  "/inventory": "Stock",
  "/inventory/expiry": "Stock",
  "/inventory/warranty": "Stock",
  "/categories": "Stock",
  "/purchases": "Stock",
  "/purchase-returns": "Stock",
  "/delivery": "Stock",
  "/customers": "People",
  "/customers/campaigns": "People",
  "/suppliers": "People",
  "/payments": "Finance",
  "/settings/payment-methods": "Finance",
  "/expenses": "Finance",
  "/reports": "Insights",
  "/whatsapp": "Operations",
  "/restaurant": "Operations",
  "/restaurant/kds": "Operations",
};

export function dashboardItem(items: readonly VerticalNavigationItem[]): VerticalNavigationItem | undefined {
  return items.find((item) => item.href === "/dashboard");
}

export function groupedNavigation(items: readonly VerticalNavigationItem[]): NavigationGroup[] {
  return groupOrder.flatMap((label) => {
    const groupItems = items.filter((item) => item.href !== "/dashboard" && !accountNavigationHrefs.has(item.href) && categoryForItem(item) === label);
    return groupItems.length > 0 ? [{ label, items: groupItems }] : [];
  });
}

export function dashboardModuleGroups(items: readonly VerticalNavigationItem[]): NavigationGroup[] {
  const groups = groupedNavigation(items);
  const financeAndPeopleItems = groups
    .filter((group) => group.label === "Finance" || group.label === "People")
    .flatMap((group) => group.items);

  return [
    ...groups.filter((group) => group.label === "Sales" || group.label === "Operations" || group.label === "Stock"),
    ...(financeAndPeopleItems.length > 0 ? [{ label: "Finance & people", items: financeAndPeopleItems }] : []),
  ];
}

function categoryForItem(item: VerticalNavigationItem): (typeof groupOrder)[number] {
  return groupByHref[item.href] ?? "Operations";
}
