import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@bizbil/shared";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";
import { apiClient } from "@/lib/api-client";

export default function PurchasesScreen() {
  const query = useQuery({ queryKey: ["purchase-orders"], queryFn: () => apiClient.get<{ data?: any[] } | any[]>("/api/purchase-orders") });
  const orders = Array.isArray(query.data) ? query.data : query.data?.data ?? [];
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Purchase Orders" subtitle="All | Draft | Sent | Partial | Received" />
      <FlatList data={orders} keyExtractor={(item) => item.id} renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/(app)/more/purchases/${item.id}`)}>
          <Card style={styles.card}>
            <View style={styles.rowBetween}><Text style={styles.title}>{item.poNumber}</Text><Badge label={item.status ?? item.approvalStatus ?? "DRAFT"} color="blue" /></View>
            <Text style={styles.muted}>{item.supplier?.name ?? item.supplierName} | {item.createdAt ? formatDate(item.createdAt) : ""}</Text>
            <Text>{String(item.items?.length ?? item.itemCount ?? 0)} items | {formatCurrency(Number(item.totalAmount ?? 0))}</Text>
          </Card>
        </Pressable>
      )} />
      <Pressable style={styles.fab} onPress={() => router.push("/(app)/more/purchases/create")}><Text style={styles.fabText}>+</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background },
  card: { marginBottom: spacing.sm, gap: spacing.xs },
  rowBetween: { flexDirection: "row", justifyContent: "space-between" },
  title: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid },
  fab: { position: "absolute", right: spacing.xl, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  fabText: { color: colors.white, fontSize: 30, fontWeight: fontWeights.bold },
});
