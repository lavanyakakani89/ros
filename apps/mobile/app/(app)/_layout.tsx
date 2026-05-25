import { Redirect, Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { LoadingScreen } from "@/components/common/LoadingScreen";
import { useSession } from "@/hooks/useSession";
import { colors } from "@/theme";

export default function AppLayout() {
  const { isLoading, isAuthenticated, user } = useSession();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;
  if (user?.role === "DELIVERY") return <Redirect href="/(delivery)" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.slateMid,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="view-dashboard" color={color} size={size} /> }} />
      <Tabs.Screen name="billing/index" options={{ title: "Billing", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="receipt" color={color} size={size} /> }} />
      <Tabs.Screen name="inventory/index" options={{ title: "Inventory", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="package-variant" color={color} size={size} /> }} />
      <Tabs.Screen name="customers/index" options={{ title: "Customers", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="account-group" color={color} size={size} /> }} />
      <Tabs.Screen name="more/index" options={{ title: "More", tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="dots-horizontal" color={color} size={size} /> }} />
      <Tabs.Screen name="customers/[id]" options={{ href: null }} />
      <Tabs.Screen name="more/reports" options={{ href: null }} />
      <Tabs.Screen name="more/payments" options={{ href: null }} />
      <Tabs.Screen name="more/expenses" options={{ href: null }} />
      <Tabs.Screen name="more/credit-notes" options={{ href: null }} />
      <Tabs.Screen name="more/quotations" options={{ href: null }} />
      <Tabs.Screen name="more/coupons" options={{ href: null }} />
      <Tabs.Screen name="more/suppliers" options={{ href: null }} />
      <Tabs.Screen name="more/settings" options={{ href: null }} />
      <Tabs.Screen name="more/audit-log" options={{ href: null }} />
      <Tabs.Screen name="more/users" options={{ href: null }} />
      <Tabs.Screen name="more/whatsapp-orders" options={{ href: null }} />
      <Tabs.Screen name="more/whatsapp-orders/[id]" options={{ href: null }} />
      <Tabs.Screen name="more/purchases" options={{ href: null }} />
      <Tabs.Screen name="more/purchases/create" options={{ href: null }} />
      <Tabs.Screen name="more/purchases/[id]" options={{ href: null }} />
    </Tabs>
  );
}
