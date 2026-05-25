declare module "expo-server-sdk" {
  export interface ExpoPushMessage {
    to: string | string[];
    sound?: "default" | null;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  }

  export class Expo {
    static isExpoPushToken(token: string): boolean;
    sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<unknown>;
  }
}
