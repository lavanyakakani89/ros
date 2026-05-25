import { useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function WhatsappOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [paymentMode, setPaymentMode] = useState("CASH");
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const query = useQuery({ queryKey: ["whatsapp-order", id], queryFn: () => apiClient.get<any>(`/api/whatsapp/orders/${id}`) });
  const order = query.data;
  if (!order) return null;
  async function confirm() {
    await apiClient.post(`/api/whatsapp/orders/${id}/confirm`, { paymentMode, deliveryEnabled });
    router.back();
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="Review WhatsApp order" subtitle={order.phone} />
      <Card style={styles.section}><Input label="Customer name" value={order.customer?.name ?? order.detectedName ?? ""} /><Input label="Phone" value={order.phone} editable={false} /></Card>
      <Card style={styles.quote}><Text>{order.rawMessage ?? order.message}</Text></Card>
      <FlatList scrollEnabled={false} data={order.parsedItems ?? []} keyExtractor={(_, index) => String(index)} renderItem={({ item }) => <Card style={[styles.line, item.confidence < 0.7 && styles.low, !item.productId && styles.bad]}><Input label="Product" value={item.name} /><Input label="Qty" value={String(item.quantity)} /><Input label="Price" value={String(item.price ?? "")} /></Card>} />
      <Input label="Payment mode" value={paymentMode} onChangeText={setPaymentMode} />
      <Button label={deliveryEnabled ? "Delivery enabled" : "Enable delivery"} variant={deliveryEnabled ? "primary" : "secondary"} onPress={() => setDeliveryEnabled((value) => !value)} />
      {deliveryEnabled ? <Input label="Delivery address" value={order.customer?.address ?? ""} /> : null}
      <Input label="Notes" />
      <Button label="Confirm order" onPress={() => void confirm()} />
      <Button label="Reject order" variant="danger" onPress={() => void apiClient.post(`/api/whatsapp/orders/${id}/dismiss`, { reason: "Rejected from mobile" }).then(() => router.back())} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  quote: { backgroundColor: colors.slateLight },
  line: { marginBottom: spacing.sm, gap: spacing.sm },
  low: { backgroundColor: colors.amberLight },
  bad: { backgroundColor: colors.redLight },
});
