import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

export interface BillingProduct {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unit?: string | null;
  sellingPrice: number | string;
  gstRate?: number | string | null;
  currentStock?: number | string | null;
}

export function useBillingProducts() {
  return useQuery({
    queryKey: ["billing-products"],
    queryFn: async () => {
      const response = await apiClient.get<{ data?: BillingProduct[] } | BillingProduct[]>("/api/inventory/products?limit=500");
      return Array.isArray(response) ? response : response.data ?? [];
    },
    gcTime: 5 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });
}

export function filterProducts(search: string, products: BillingProduct[]): BillingProduct[] {
  const term = search.trim().toLowerCase();
  if (!term) return products.slice(0, 25);
  return products
    .filter((product) => [product.name, product.sku, product.barcode].some((value) => String(value ?? "").toLowerCase().includes(term)))
    .sort((left, right) => {
      const leftBarcode = String(left.barcode ?? "").toLowerCase() === term ? 0 : 1;
      const rightBarcode = String(right.barcode ?? "").toLowerCase() === term ? 0 : 1;
      if (leftBarcode !== rightBarcode) return leftBarcode - rightBarcode;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 25);
}

export function useFilteredBillingProducts(search: string, products: BillingProduct[] = []) {
  return useMemo(() => filterProducts(search, products), [products, search]);
}
