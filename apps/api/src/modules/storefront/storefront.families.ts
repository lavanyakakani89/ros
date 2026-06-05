import { Prisma, type EcommerceProductFamilySource } from "@prisma/client";
import type { FastifyInstance } from "fastify";

type ProductForFamily = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  imageUrl: string | null;
  isActive: boolean;
  ecommerceDisabled: boolean;
  verticalData: unknown;
  currentStock: { toNumber(): number };
  mrp: { toNumber(): number };
  sellingPrice: { toNumber(): number };
  category: { id: string; name: string; parentId: string | null } | null;
};

export const ecommerceProductFamilyInclude = Prisma.validator<Prisma.EcommerceProductFamilyInclude>()({
  items: {
    orderBy: [
      { sortOrder: "asc" },
      { createdAt: "asc" },
    ],
    include: {
      product: {
        include: {
          category: {
            select: {
              id: true,
              name: true,
              parentId: true,
            },
          },
          variants: {
            where: {
              isActive: true,
              currentStock: {
                gt: 0,
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      },
    },
  },
});

export async function listTenantProductFamilies(fastify: FastifyInstance, tenantId: string) {
  return fastify.prisma.ecommerceProductFamily.findMany({
    where: {
      tenantId,
      isActive: true,
    },
    include: ecommerceProductFamilyInclude,
    orderBy: [
      { name: "asc" },
      { createdAt: "asc" },
    ],
  });
}

export async function listEligibleFamilyProducts(fastify: FastifyInstance, tenantId: string) {
  return fastify.prisma.product.findMany({
    where: {
      tenantId,
      isActive: true,
      ecommerceDisabled: false,
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          parentId: true,
        },
      },
    },
    orderBy: [
      { name: "asc" },
      { createdAt: "asc" },
    ],
  });
}

export function buildFamilyProductMap(
  families: Awaited<ReturnType<typeof listTenantProductFamilies>>,
) {
  const byProductId = new Map<string, {
    familyId: string;
    familyName: string;
    attributeLabel: string;
    source: EcommerceProductFamilySource;
    items: typeof families[number]["items"];
    item: typeof families[number]["items"][number];
  }>();

  for (const family of families) {
    for (const item of family.items) {
      byProductId.set(item.productId, {
        familyId: family.id,
        familyName: family.name,
        attributeLabel: family.attributeLabel,
        source: family.source,
        items: family.items,
        item,
      });
    }
  }

  return byProductId;
}

export function buildProductFamilySuggestions(
  products: ProductForFamily[],
  groupedProductIds: Set<string>,
) {
  const grouped = new Map<string, {
    key: string;
    name: string;
    attributeLabel: "Size";
    items: Array<{
      productId: string;
      productName: string;
      variantLabel: string;
      sortOrder: number;
      sku: string | null;
      barcode: string | null;
      currentStock: number;
      categoryName: string;
      brand: string | null;
      imageUrl: string | null;
    }>;
  }>();

  for (const product of products) {
    if (groupedProductIds.has(product.id)) {
      continue;
    }

    const candidate = extractVariantCandidate(product);
    if (!candidate || !candidate.variantLabel || !candidate.baseName) {
      continue;
    }

    const brand = readText(product.verticalData, "brand");
    const key = normalizeFamilyKey(candidate.baseName, brand, product.category?.id ?? null);
    const current = grouped.get(key) ?? {
      key,
      name: candidate.baseName,
      attributeLabel: "Size" as const,
      items: [],
    };

    current.items.push({
      productId: product.id,
      productName: product.name,
      variantLabel: candidate.variantLabel,
      sortOrder: sortVariantLabel(candidate.variantLabel),
      sku: product.sku,
      barcode: product.barcode,
      currentStock: product.currentStock.toNumber(),
      categoryName: product.category?.name ?? "Featured",
      brand,
      imageUrl: product.imageUrl,
    });

    grouped.set(key, current);
  }

  return [...grouped.values()]
    .filter((group) => group.items.length > 1)
    .map((group) => ({
      ...group,
      items: group.items.sort((left, right) =>
        left.sortOrder - right.sortOrder ||
        left.variantLabel.localeCompare(right.variantLabel)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function extractVariantCandidate(product: Pick<ProductForFamily, "name" | "verticalData">) {
  const matches = [...product.name.matchAll(/(\d+(?:\.\d+)?)\s?(ml|l|ltr|litre|litres|g|gm|kg|kgs)\b/gi)];
  const lastMatch = matches.at(-1);
  if (!lastMatch) {
    return null;
  }

  const amount = lastMatch[1] ?? "";
  const unit = lastMatch[2] ?? "";
  const variantLabel = `${amount}${unit.toUpperCase() === "LITRE" || unit.toUpperCase() === "LITRES" ? "L" : unit.toUpperCase()}`.replace("LTR", "L");
  const baseName = product.name
    .slice(0, lastMatch.index)
    .replace(/[-(),]+$/g, "")
    .trim();

  if (!baseName) {
    return null;
  }

  return {
    baseName,
    variantLabel,
    brand: readText(product.verticalData, "brand"),
  };
}

export function chooseDefaultFamilyProduct<Item extends {
  isDefault: boolean;
  sortOrder: number;
  product: { currentStock: { toNumber(): number } };
}>(items: Item[]): Item {
  if (items.length === 0) {
    throw new Error("Cannot choose a default product from an empty family");
  }

  const explicit = items.find((item) => item.isDefault && item.product.currentStock.toNumber() > 0)
    ?? items.find((item) => item.isDefault);
  if (explicit) {
    return explicit;
  }

  const [firstSortedItem] = [...items].sort((left, right) =>
    (right.product.currentStock.toNumber() > 0 ? 1 : 0) - (left.product.currentStock.toNumber() > 0 ? 1 : 0) ||
    left.sortOrder - right.sortOrder);

  if (firstSortedItem) {
    return firstSortedItem;
  }

  const [firstItem] = items;
  if (firstItem) {
    return firstItem;
  }

  throw new Error("Cannot choose a default product from an empty family");
}

export function sortVariantLabel(value: string): number {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(ml|l|g|gm|kg)$/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount)) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (unit === "ml") return amount;
  if (unit === "l") return amount * 1000;
  if (unit === "g" || unit === "gm") return amount;
  if (unit === "kg") return amount * 1000;
  return Number.MAX_SAFE_INTEGER;
}

export function readText(value: unknown, key: string): string | null {
  const record = asRecord(value);
  const entry = record[key];
  return typeof entry === "string" && entry.trim() ? entry.trim() : null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

export function slugifyFamilyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeFamilyKey(baseName: string, brand: string | null, categoryId: string | null): string {
  return [brand?.trim().toLowerCase() ?? "", categoryId ?? "", baseName.trim().toLowerCase()]
    .filter(Boolean)
    .join("::");
}
