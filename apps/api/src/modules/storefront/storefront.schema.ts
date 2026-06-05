import { z } from "zod";

export const storefrontTenantParamsSchema = z.object({
  tenantSlug: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const storefrontProductParamsSchema = storefrontTenantParamsSchema.extend({
  productId: z.string().trim().min(1),
});

export const storefrontCategoryProductsParamsSchema = storefrontTenantParamsSchema.extend({
  categoryId: z.string().trim().min(1),
});

export const storefrontFamilyParamsSchema = z.object({
  familyId: z.string().trim().min(1),
});

export const storefrontFamilyItemParamsSchema = storefrontFamilyParamsSchema.extend({
  itemId: z.string().trim().min(1),
});

export const storefrontCatalogQuerySchema = z.object({
  host: z.string().trim().min(1).max(255).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  categoryId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(1000),
});

export const storefrontProductListQuerySchema = z.object({
  host: z.string().trim().min(1).max(255).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  categoryId: z.string().trim().min(1).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  size: z.string().trim().min(1).max(80).optional(),
  color: z.string().trim().min(1).max(80).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  discountOnly: z.preprocess((value) => {
    if (value === undefined) return false;
    if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
    return value;
  }, z.boolean()).default(false),
  sort: z.enum(["FEATURED", "PRICE_ASC", "PRICE_DESC", "NEWEST", "DISCOUNT", "NAME"]).default("FEATURED"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(60).default(24),
});

export const storefrontSearchQuerySchema = z.object({
  host: z.string().trim().min(1).max(255).optional(),
  query: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().positive().max(20).default(8),
});

export const storefrontCouponSchema = z.object({
  code: z.string().trim().min(1).max(32),
  items: z.array(z.object({
    productId: z.string().trim().min(1),
    quantity: z.coerce.number().positive().max(999),
  })).min(1).max(100),
});

const customerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(10).max(16),
  email: z.string().trim().email().max(120).optional(),
  address: z.string().trim().min(5).max(500),
  city: z.string().trim().min(1).max(80).optional(),
  state: z.string().trim().min(1).max(80).optional(),
  postalCode: z.string().trim().min(1).max(16).optional(),
});

export const storefrontCheckoutSchema = z.object({
  customer: customerSchema,
  items: z.array(z.object({
    productId: z.string().trim().min(1),
    quantity: z.coerce.number().positive().max(999),
  })).min(1).max(100),
  paymentMethod: z.enum(["COD", "RAZORPAY"]).default("COD"),
  couponCode: z.string().trim().min(1).max(32).optional(),
  delivery: z.object({
    address: z.string().trim().min(5).max(500).optional(),
    notes: z.string().trim().min(1).max(500).optional(),
    scheduledAt: z.coerce.date().optional(),
  }).optional(),
});

export const storefrontRazorpayVerifySchema = z.object({
  invoiceId: z.string().trim().min(1),
  razorpayOrderId: z.string().trim().min(1),
  razorpayPaymentId: z.string().trim().min(1),
  razorpaySignature: z.string().trim().min(1),
});

export const storefrontCustomerRegisterSchema = customerSchema.extend({
  password: z.string().min(8).max(128),
});

export const storefrontCustomerLoginSchema = z.object({
  phone: z.string().trim().min(10).max(16),
  password: z.string().min(8).max(128),
});

export const storefrontSettingsRequestSchema = z.object({
  requestType: z.enum(["SETTINGS", "THEME", "PAYMENT"]).default("SETTINGS"),
  theme: z.enum(["CLASSIC_RETAIL", "PREMIUM_BRAND"]).optional(),
  displayName: z.string().trim().min(2).max(120).optional(),
  heroTitle: z.string().trim().min(2).max(120).optional(),
  heroSubtitle: z.string().trim().min(2).max(240).optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-f]{6}$/i).optional(),
  accentColor: z.string().trim().regex(/^#[0-9a-f]{6}$/i).optional(),
  allowGuestCheckout: z.coerce.boolean().optional(),
  allowCustomerLogin: z.coerce.boolean().optional(),
  allowCod: z.coerce.boolean().optional(),
  paymentProvider: z.enum(["PLATFORM_RAZORPAY", "TENANT_RAZORPAY"]).optional(),
  tenantRazorpayKeyId: z.string().trim().min(4).max(120).optional(),
  tenantRazorpayKeySecret: z.string().trim().min(8).max(240).optional(),
  deliveryCharge: z.coerce.number().nonnegative().max(100000).optional(),
  freeDeliveryAbove: z.coerce.number().nonnegative().max(10000000).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const storefrontDomainRequestSchema = z.object({
  hostname: z
    .string()
    .trim()
    .min(4)
    .max(255)
    .toLowerCase()
    .regex(/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/, "Enter a valid domain name"),
  notes: z.string().trim().max(500).optional(),
});

export const storefrontCreateProductFamilySchema = z.object({
  name: z.string().trim().min(2).max(120),
  attributeLabel: z.string().trim().min(2).max(40).default("Size"),
  source: z.enum(["MANUAL", "SUGGESTED"]).default("MANUAL"),
  items: z.array(z.object({
    productId: z.string().trim().min(1),
    variantLabel: z.string().trim().min(1).max(80).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
    isDefault: z.coerce.boolean().optional(),
  })).min(2).max(50),
});

export const storefrontUpdateProductFamilySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  attributeLabel: z.string().trim().min(2).max(40).optional(),
  items: z.array(z.object({
    id: z.string().trim().min(1),
    variantLabel: z.string().trim().min(1).max(80),
    sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
    isDefault: z.coerce.boolean().default(false),
  })).max(50).optional(),
});

export const storefrontAddFamilyItemsSchema = z.object({
  items: z.array(z.object({
    productId: z.string().trim().min(1),
    variantLabel: z.string().trim().min(1).max(80).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
    isDefault: z.coerce.boolean().optional(),
  })).min(1).max(50),
});
