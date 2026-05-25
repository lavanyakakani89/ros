import { useState } from "react";
import { FlatList, Linking, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@retailos/shared";

import { DeliveryProofSheet } from "@/components/delivery/DeliveryProofSheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function MyDeliveriesScreen() {
  const user = useAuthStore((state) => state.user);
  const [proofDelivery, setProofDelivery] = useState<any | null>(null);
  const query = useQuery({ queryKey: ["my-deliveries"], queryFn: () => apiClient.get<any[]>("/api/delivery/me") });
  const deliveries = (query.data ?? []).filter((delivery) => !delivery.assignedTo || delivery.assignedTo === user?.id);
  const pending = deliveries.filter((delivery) => delivery.status === "PENDING");
  const active = deliveries.filter((delivery) => delivery.status === "ASSIGNED" || delivery.status === "OUT_FOR_DELIVERY");
  const delivered = deliveries.filter((delivery) => delivery.status === "DELIVERED");
  const sections = [
    { title: "PENDING", data: pending },
    { title: "ASSIGNED / OUT FOR DELIVERY", data: active },
    { title: "DELIVERED TODAY", data: delivered },
  ].filter((section) => section.data.length > 0);

  async function updateStatus(delivery: any) {
    if (delivery.status === "PENDING") {
      await apiClient.put(`/api/delivery/${delivery.id}/status`, { status: "OUT_FOR_DELIVERY" });
      await query.refetch();
      return;
    }
    if (delivery.status === "OUT_FOR_DELIVERY") setProofDelivery(delivery);
    if (delivery.status === "FAILED") {
      await apiClient.put(`/api/delivery/${delivery.id}/status`, { status: "PENDING" });
      await query.refetch();
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="My Deliveries - Today" subtitle={formatDate(new Date())} rightAction={<Badge label={`${pending.length} pending`} color={pending.length ? "amber" : "green"} />} />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/(delivery)/${item.id}`)}>
            <Card style={styles.card}>
              <View style={styles.rowBetween}><Text style={styles.customer}>{item.customer?.name ?? item.customerName}</Text><Badge label={item.status} color={item.status === "DELIVERED" ? "green" : "amber"} /></View>
              <Text style={styles.address} numberOfLines={2}>{item.deliveryAddress}</Text>
              {item.paymentMode !== "CREDIT" ? <Badge label={`Collect ${formatCurrency(Number(item.amountDue ?? item.grandTotal ?? 0))}`} color="red" /> : null}
              <View style={styles.actions}>
                <Button label="Call" variant="secondary" icon="phone" onPress={() => void Linking.openURL(`tel:${item.customer?.phone ?? item.phone}`)} />
                <Button label="Navigate" variant="secondary" icon="map-marker" onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.deliveryAddress)}`)} />
                <Button label={item.status === "PENDING" ? "Start delivery" : item.status === "OUT_FOR_DELIVERY" ? "Mark delivered" : "Retry"} onPress={() => void updateStatus(item)} />
              </View>
            </Card>
          </Pressable>
        )}
      />
      <DeliveryProofSheet visible={Boolean(proofDelivery)} delivery={proofDelivery} onClose={() => setProofDelivery(null)} onDelivered={() => void query.refetch()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background },
  sectionTitle: { color: colors.slateMid, fontSize: fontSizes.sm, fontWeight: fontWeights.bold, marginVertical: spacing.sm },
  card: { marginBottom: spacing.sm, gap: spacing.sm },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  customer: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  address: { color: colors.slateMid, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
