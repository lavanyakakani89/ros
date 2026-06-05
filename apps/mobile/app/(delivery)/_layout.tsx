import { Stack, Redirect, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { LoadingScreen } from "@/components/common/LoadingScreen";
import { clearTokens } from "@/lib/auth";
import { useAuthStore } from "@/stores/auth-store";
import { useSession } from "@/hooks/useSession";
import { colors } from "@/theme";

export default function DeliveryLayout() {
  const router = useRouter();
  const { isLoading, isAuthenticated, user } = useSession();
  const clear = useAuthStore((state) => state.clear);

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;
  if (user?.role !== "DELIVERY") return <Redirect href="/(app)" />;

  return (
    <Stack
      screenOptions={{
        headerTitle: () => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.white, fontWeight: "700" }}>R</Text>
            </View>
            <Text style={{ color: colors.slate, fontWeight: "700" }}>BizBil Delivery</Text>
          </View>
        ),
        headerRight: () => (
          <Pressable onPress={() => void clearTokens().then(() => { clear(); router.replace("/(auth)/login"); })}>
            <Text style={{ color: colors.red, fontWeight: "700" }}>Exit</Text>
          </Pressable>
        ),
      }}
    />
  );
}
