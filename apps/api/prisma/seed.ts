import { hash } from "@node-rs/argon2";
import { PrismaClient, StorefrontStatus, StorefrontTheme, UserRole, VerticalType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-pharmacy" },
    update: {},
    create: {
      name: "Demo Pharmacy",
      slug: "demo-pharmacy",
      vertical: VerticalType.PHARMACY,
      gstNumber: "29ABCDE1234F1Z5",
      phone: "+919999999999",
      address: "MG Road, Bengaluru, Karnataka",
    },
  });

  const passwordHash = await hash("BizBil@123", {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: "owner@demo-pharmacy.test",
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Demo Owner",
      email: "owner@demo-pharmacy.test",
      username: "owner@demo-pharmacy.test",
      phone: "+919999999998",
      passwordHash,
      role: UserRole.OWNER,
    },
  });

  await prisma.storefrontSettings.upsert({
    where: {
      tenantId: tenant.id,
    },
    update: {
      status: StorefrontStatus.ACTIVE,
      theme: StorefrontTheme.PREMIUM_BRAND,
      subdomain: "demo-pharmacy",
      displayName: "Demo Pharmacy Online",
      heroTitle: "Wellness essentials delivered with local-store trust",
      heroSubtitle: "Fast-moving care, personal picks, and storefront-ready catalog data for BizBil ecommerce QA.",
      primaryColor: "#115e59",
      accentColor: "#f59e0b",
      allowGuestCheckout: true,
      allowCustomerLogin: true,
      allowCod: true,
      deliveryCharge: 40,
      freeDeliveryAbove: 499,
    },
    create: {
      tenantId: tenant.id,
      status: StorefrontStatus.ACTIVE,
      theme: StorefrontTheme.PREMIUM_BRAND,
      subdomain: "demo-pharmacy",
      displayName: "Demo Pharmacy Online",
      heroTitle: "Wellness essentials delivered with local-store trust",
      heroSubtitle: "Fast-moving care, personal picks, and storefront-ready catalog data for BizBil ecommerce QA.",
      primaryColor: "#115e59",
      accentColor: "#f59e0b",
      allowGuestCheckout: true,
      allowCustomerLogin: true,
      allowCod: true,
      deliveryCharge: 40,
      freeDeliveryAbove: 499,
    },
  });

  const categories = await Promise.all([
    prisma.category.upsert({
      where: {
        tenantId_name: {
          tenantId: tenant.id,
          name: "Daily Essentials",
        },
      },
      update: {
        code: "DAILY",
      },
      create: {
        tenantId: tenant.id,
        name: "Daily Essentials",
        code: "DAILY",
      },
    }),
    prisma.category.upsert({
      where: {
        tenantId_name: {
          tenantId: tenant.id,
          name: "Immunity & Wellness",
        },
      },
      update: {
        code: "IMMUNE",
      },
      create: {
        tenantId: tenant.id,
        name: "Immunity & Wellness",
        code: "IMMUNE",
      },
    }),
    prisma.category.upsert({
      where: {
        tenantId_name: {
          tenantId: tenant.id,
          name: "Personal Care",
        },
      },
      update: {
        code: "CARE",
      },
      create: {
        tenantId: tenant.id,
        name: "Personal Care",
        code: "CARE",
      },
    }),
  ]);

  const categoryByName = new Map(categories.map((category) => [category.name, category.id]));
  const products = [
    {
      name: "Paracetamol 650 Tablets",
      sku: "MED-001",
      categoryName: "Daily Essentials",
      mrp: 35,
      sellingPrice: 32,
      currentStock: 120,
      gstRate: 12,
      description: "Reliable fever and pain relief for everyday household needs.",
    },
    {
      name: "Vitamin C Effervescent Tablets",
      sku: "MED-002",
      categoryName: "Immunity & Wellness",
      mrp: 299,
      sellingPrice: 269,
      currentStock: 48,
      gstRate: 12,
      description: "Daily immunity support with a citrus-flavored dissolve.",
    },
    {
      name: "Digital Thermometer",
      sku: "MED-003",
      categoryName: "Daily Essentials",
      mrp: 199,
      sellingPrice: 179,
      currentStock: 24,
      gstRate: 18,
      description: "Fast-read thermometer suited for family use.",
    },
    {
      name: "Hand Sanitizer 500ml",
      sku: "MED-004",
      categoryName: "Personal Care",
      mrp: 149,
      sellingPrice: 129,
      currentStock: 64,
      gstRate: 18,
      description: "Quick-dry sanitizer with a non-sticky finish.",
    },
    {
      name: "Protein Nutrition Powder",
      sku: "MED-005",
      categoryName: "Immunity & Wellness",
      mrp: 699,
      sellingPrice: 629,
      currentStock: 18,
      gstRate: 18,
      description: "Balanced daily nutrition blend for energy and recovery.",
    },
    {
      name: "Baby Care Gentle Lotion",
      sku: "MED-006",
      categoryName: "Personal Care",
      mrp: 245,
      sellingPrice: 219,
      currentStock: 35,
      gstRate: 18,
      description: "Lightweight lotion formulated for sensitive skin.",
    },
    {
      name: "Blood Pressure Monitor",
      sku: "MED-007",
      categoryName: "Daily Essentials",
      mrp: 1699,
      sellingPrice: 1549,
      currentStock: 9,
      gstRate: 18,
      description: "Compact automatic monitor for home wellness tracking.",
    },
    {
      name: "Herbal Cough Syrup",
      sku: "MED-008",
      categoryName: "Immunity & Wellness",
      mrp: 110,
      sellingPrice: 98,
      currentStock: 52,
      gstRate: 12,
      description: "Soothing syrup for seasonal cough and throat irritation.",
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: {
        tenantId_sku: {
          tenantId: tenant.id,
          sku: product.sku,
        },
      },
      update: {
        name: product.name,
        description: product.description,
        categoryId: categoryByName.get(product.categoryName) ?? null,
        mrp: product.mrp,
        sellingPrice: product.sellingPrice,
        currentStock: product.currentStock,
        gstRate: product.gstRate,
        unit: "piece",
        isActive: true,
        ecommerceDisabled: false,
      },
      create: {
        tenantId: tenant.id,
        name: product.name,
        sku: product.sku,
        description: product.description,
        categoryId: categoryByName.get(product.categoryName) ?? null,
        unit: "piece",
        mrp: product.mrp,
        sellingPrice: product.sellingPrice,
        currentStock: product.currentStock,
        gstRate: product.gstRate,
        isActive: true,
        ecommerceDisabled: false,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
