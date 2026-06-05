import { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import MapView, { Marker } from "react-native-maps";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@bizbil/shared";

import { DeliveryProofSheet } from "@/components/delivery/DeliveryProofSheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [proofOpen, setProofOpen] = useState(false);
  const [failedReason, setFailedReason] = useState("Customer not home");
  const query = useQuery({ queryKey: ["delivery", id], queryFn: () => apiClient.get<any>(`/api/delivery/${id}`) });
  const delivery = query.data;
  if (!delivery) return null;
  const lat = Number(delivery.latitude ?? 13.0827);
  const lng = Number(delivery.longitude ?? 80.2707);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title={delivery.customer?.name ?? "Delivery"} subtitle={delivery.invoice?.invoiceNumber} rightAction={<Badge label={delivery.status} color="amber" />} />
      <Card style={styles.section}>
        <Text style={styles.title}>{delivery.customer?.name}</Text>
        <Text style={styles.link} onPress={() => void Linking.openURL(`tel:${delivery.customer?.phone}`)}>{delivery.customer?.phone}</Text>
        <Text>{delivery.deliveryAddress}</Text>
        {delivery.paymentMode !== "CREDIT" ? <Text style={styles.collect}>Collect {formatCurrency(Number(delivery.amountDue ?? delivery.invoice?.grandTotal ?? 0))} cash</Text> : null}
        <Text>{delivery.notes ?? "No delivery notes"}</Text>
        <Text>{delivery.scheduledAt ? `Scheduled ${delivery.scheduledAt}` : "No scheduled time"}</Text>
      </Card>
      <MapView style={styles.map} initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }}><Marker coordinate={{ latitude: lat, longitude: lng }} /></MapView>
      <Card style={styles.section}>
        {delivery.status === "OUT_FOR_DELIVERY" ? <Button label="Mark as delivered" onPress={() => setProofOpen(true)} /> : null}
        <Input label="Failed reason" value={failedReason} onChangeText={setFailedReason} hint="Customer not home / Wrong address / Customer refused / Payment not ready / Other" />
        <Button label="Mark as failed" variant="danger" onPress={() => void apiClient.put(`/api/delivery/${id}/status`, { status: "FAILED", notes: failedReason }).then(() => query.refetch())} />
      </Card>
      <DeliveryProofSheet visible={proofOpen} delivery={delivery} onClose={() => setProofOpen(false)} onDelivered={() => void query.refetch()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  title: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  link: { color: colors.blue, fontWeight: fontWeights.semibold },
  collect: { color: colors.red, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  map: { height: 220, borderRadius: 8 },
});
