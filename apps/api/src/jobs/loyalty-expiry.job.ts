import { LoyaltyTxType, PrismaClient } from "@prisma/client";

export async function expireLoyaltyPoints(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const expiredEarns = await prisma.loyaltyTransaction.findMany({
      where: {
        type: LoyaltyTxType.EARNED,
        expiresAt: {
          not: null,
          lt: new Date(),
        },
      },
      include: {
        account: true,
      },
      take: 500,
      orderBy: {
        expiresAt: "asc",
      },
    });

    for (const transaction of expiredEarns) {
      const alreadyExpired = await prisma.loyaltyTransaction.findFirst({
        where: {
          tenantId: transaction.tenantId,
          type: LoyaltyTxType.EXPIRED,
          referenceId: transaction.id,
        },
        select: {
          id: true,
        },
      });
      if (alreadyExpired || transaction.account.points <= 0) {
        continue;
      }

      const pointsToExpire = Math.min(transaction.points, transaction.account.points);
      await prisma.$transaction([
        prisma.loyaltyAccount.update({
          where: { id: transaction.accountId },
          data: { points: { decrement: pointsToExpire } },
        }),
        prisma.loyaltyTransaction.create({
          data: {
            tenantId: transaction.tenantId,
            accountId: transaction.accountId,
            points: -pointsToExpire,
            type: LoyaltyTxType.EXPIRED,
            referenceId: transaction.id,
            notes: "Points expired automatically.",
          },
        }),
      ]);
    }
  } catch (error) {
    if (isMissingLoyaltyExpiryColumn(error)) {
      console.warn(
        "[BizBil] Loyalty expiry job skipped because loyalty_transactions.expires_at is missing in the current database.",
      );
      return;
    }

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

function isMissingLoyaltyExpiryColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const knownError = error as {
    code?: string;
    meta?: { column?: string };
  };

  return knownError.code === "P2022" && knownError.meta?.column === "loyalty_transactions.expires_at";
}
