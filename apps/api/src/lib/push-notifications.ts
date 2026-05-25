import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import type { PrismaClient, UserRole } from "@prisma/client";

const expo = new Expo();

type NotificationPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export async function sendPushToUser(
  prisma: PrismaClient,
  userId: string,
  notification: NotificationPayload,
): Promise<void> {
  try {
    const expoPushToken = (prisma as any).expoPushToken;
    const tokens = await expoPushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    await sendMessages(tokens.map((record: { token: string }) => record.token), notification);
  } catch (error) {
    console.error("Failed to send Expo push notification to user", { error, userId });
  }
}

export async function sendPushToTenant(
  prisma: PrismaClient,
  tenantId: string,
  roles: UserRole[],
  notification: NotificationPayload,
): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: {
        tenantId,
        role: { in: roles },
        isActive: true,
      },
      select: { id: true },
    });
    const expoPushToken = (prisma as any).expoPushToken;
    const tokens = await expoPushToken.findMany({
      where: {
        userId: { in: users.map((user) => user.id) },
      },
      select: { token: true },
    });
    await sendMessages(tokens.map((record: { token: string }) => record.token), notification);
  } catch (error) {
    console.error("Failed to send Expo push notification to tenant", { error, tenantId });
  }
}

async function sendMessages(tokens: string[], notification: NotificationPayload): Promise<void> {
  const messages: ExpoPushMessage[] = tokens
    .filter((token) => Expo.isExpoPushToken(token))
    .map((to) => ({
      to,
      sound: "default",
      title: notification.title,
      body: notification.body,
      ...(notification.data ? { data: notification.data } : {}),
    }));

  if (messages.length === 0) {
    return;
  }

  try {
    await expo.sendPushNotificationsAsync(messages);
  } catch (error) {
    console.error("Expo push send failed", { error });
  }
}
