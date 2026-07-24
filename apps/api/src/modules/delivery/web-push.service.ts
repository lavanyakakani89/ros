import webPush from "web-push";

export interface WebPushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  url?: string | undefined;
  tag?: string | undefined;
}

export function getWebPushPublicKey(): string | null {
  return process.env.WEB_PUSH_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? null;
}

export function isWebPushConfigured(): boolean {
  return Boolean(getWebPushPublicKey() && process.env.WEB_PUSH_PRIVATE_KEY);
}

export async function sendWebPushNotification(subscription: WebPushSubscriptionRecord, payload: WebPushPayload): Promise<void> {
  const publicKey = getWebPushPublicKey();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return;
  }

  webPush.setVapidDetails(
    process.env.WEB_PUSH_SUBJECT ?? "mailto:support@bizbil.com",
    publicKey,
    privateKey,
  );

  await webPush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    },
    JSON.stringify(payload),
    {
      TTL: 60 * 60,
      urgency: "high",
    },
  );
}
