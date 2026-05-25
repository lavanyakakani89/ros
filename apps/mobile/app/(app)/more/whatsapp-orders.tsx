import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function WhatsappOrdersScreen() {
  const query = useQuery({ queryKey: ["whatsapp-orders"], queryFn: () => apiClient.get<{ data?: any[] } | any[]>("/api/whatsapp/orders?status=PENDING_WHATSAPP") });
  const orders = Array.isArray(query.data) ? query.data : query.data?.data ?? [];
  return (
    <View style={styles.screen}>
      <ScreenHeader title="WhatsApp Orders" subtitle="Pending | Confirmed | Rejected" />
      <FlatList data={orders} keyExtractor={(item) => item.id} renderItem={({ item }) => (
        <Card style={styles.card}>
          <Text style={styles.title}>{item.customer?.name ?? `Unknown: ${item.phone}`}</Text>
          <Text style={styles.muted}>{item.receivedAgo ?? "12 min ago"}</Text>
          <Text numberOfLines={2} style={styles.message}>{item.rawMessage ?? item.message ?? "Order message"}</Text>
          {(item.parsedItems ?? []).map((line: any, index: number) => <Text key={index}>{line.confidence >= 0.7 ? "OK" : line.productId ? "!" : "X"} {line.name} x {line.quantity}</Text>)}
          {Number(item.outstandingDue ?? 0) > 0 ? <Badge label="Outstanding due" color="amber" /> : null}
          <View style={styles.row}><Button label="Review & Confirm" onPress={() => router.push(`/(app)/more/whatsapp-orders/${item.id}`)} /><Button label="Reject" variant="danger" onPress={() => void apiClient.post(`/api/whatsapp/orders/${item.id}/dismiss`, { reason: "Rejected from mobile" }).then(() => query.refetch())} /></View>
        </Card>
      )} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background },
  card: { marginBottom: spacing.sm, gap: spacing.sm },
  title: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid },
  message: { color: colors.slateMid },
  row: { flexDirection: "row", gap: spacing.sm },
});
