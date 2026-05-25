import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import type { Router } from "expo-router";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const permissions = await Notifications.requestPermissionsAsync();
    if (!permissions.granted) {
      return null;
    }
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    return null;
  }
}

export function useNotificationHandler(navigation: Router): void {
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string; deliveryId?: string };
      if (data.type === "WHATSAPP_ORDER") navigation.push("/(app)/more/whatsapp-orders");
      if (data.type === "LOW_STOCK") navigation.push("/(app)/inventory");
      if (data.type === "EXPIRY_ALERT") navigation.push({ pathname: "/(app)/inventory", params: { tab: "expiry" } });
      if (data.type === "DELIVERY_ASSIGNED" && data.deliveryId) navigation.push(`/(delivery)/${data.deliveryId}`);
    });

    return () => subscription.remove();
  }, [navigation]);
}
