import { PrismaClient } from "@prisma/client";

export async function expireOverdueQuotations(): Promise<number> {
  const prisma = new PrismaClient();

  try {
    const result = await prisma.quotation.updateMany({
      where: {
        status: { in: ["DRAFT", "SENT"] },
        validUntil: { lt: new Date() },
      },
      data: { status: "EXPIRED" },
    });

    return result.count;
  } finally {
    await prisma.$disconnect();
  }
}
