import { hash } from "@node-rs/argon2";
import { PrismaClient, UserRole, VerticalType } from "@prisma/client";

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

  const passwordHash = await hash("RetailOS@123", {
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
      phone: "+919999999998",
      passwordHash,
      role: UserRole.OWNER,
    },
  });
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
