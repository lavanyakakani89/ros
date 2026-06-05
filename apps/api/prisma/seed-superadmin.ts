import "dotenv/config";

import { hash } from "@node-rs/argon2";
import { PrismaClient, SuperAdminRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const name = process.env.SUPERADMIN_NAME ?? "BizBil Owner";
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD before seeding the first super-admin.");
  }

  const existing = await prisma.superAdmin.findUnique({
    where: {
      email,
    },
  });

  if (existing) {
    console.log(`Super-admin already exists: ${email}`);
    return;
  }

  await prisma.superAdmin.create({
    data: {
      name,
      email,
      passwordHash: await hash(password),
      role: SuperAdminRole.OWNER,
    },
  });

  console.log(`Created OWNER super-admin: ${email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
