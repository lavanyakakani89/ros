import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const tenantA = await prisma.tenant.create({
    data: {
      name: `RLS Tenant A ${suffix}`,
      slug: `rls-a-${suffix}`,
      vertical: "PHARMACY",
      phone: "9000000000",
    },
  });
  const tenantB = await prisma.tenant.create({
    data: {
      name: `RLS Tenant B ${suffix}`,
      slug: `rls-b-${suffix}`,
      vertical: "GROCERY",
      phone: "9000000001",
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.product.create({
      data: {
        tenantId: tenantA.id,
        name: "RLS isolation product",
        unit: "piece",
        mrp: 100,
        sellingPrice: 90,
        gstRate: 12,
        currentStock: 10,
      },
    });
  });

  const verifier = await createRlsVerifierClient(suffix);

  const visibleToTenantB = await verifier.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantB.id}, TRUE)`;
    return tx.product.findMany({
      where: {
        tenantId: tenantA.id,
      },
    });
  });

  if (visibleToTenantB.length !== 0) {
    throw new Error("RLS isolation failed: tenant B can read tenant A products");
  }

  await verifier.$disconnect();
}

try {
  await main();
  console.log("RLS isolation verified");
} finally {
  await prisma.$disconnect();
}

async function createRlsVerifierClient(suffix: string): Promise<PrismaClient> {
  const roleName = `rls_verifier_${suffix.replaceAll("-", "_")}`;
  const password = randomUUID();

  await prisma.$executeRawUnsafe(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`);
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
  await prisma.$executeRawUnsafe(`GRANT SELECT ON "products" TO "${roleName}"`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for RLS verification");
  }

  const url = new URL(databaseUrl);
  url.username = roleName;
  url.password = password;

  return new PrismaClient({
    datasources: {
      db: {
        url: url.toString(),
      },
    },
  });
}
