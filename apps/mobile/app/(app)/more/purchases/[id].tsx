import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@retailos/shared";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function PODetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const query = useQuery({ queryKey: ["purchase-order", id], queryFn: () => apiClient.get<any>(`/api/purchase-orders/${id}`) });
  const po = query.data;
  if (!po) return null;
  const canReceive = ["SENT", "PARTIAL"].includes(po.status ?? po.approvalStatus);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title={po.poNumber} subtitle={po.supplier?.name} rightAction={<Badge label={po.status ?? po.approvalStatus} color="blue" />} />
      <Card style={styles.section}>{po.items?.map((item: any) => <Text key={item.id}>{item.product?.name} x {String(item.quantity)} | {formatCurrency(Number(item.expectedPrice ?? 0))}</Text>)}</Card>
      <Card style={styles.section}><Text style={styles.title}>Status timeline</Text><Text>Draft - Sent - Partial - Received</Text></Card>
      {canReceive ? <Button label="Receive goods" onPress={() => setReceiveOpen(true)} /> : null}
      <Modal visible={receiveOpen} transparent animationType="slide"><View style={styles.backdrop}><View style={styles.sheet}><Text style={styles.title}>Receive goods</Text>{po.items?.map((item: any) => <Card key={item.id} style={styles.receiveLine}><Text>{item.product?.name}</Text><Input label="Qty received" /><Input label="Batch number" /><Input label="Expiry date" /></Card>)}<Button label="Confirm receiving" onPress={() => void apiClient.post(`/api/purchase-orders/${id}/receive`, {}).then(() => { setReceiveOpen(false); void query.refetch(); })} /><Button label="Cancel" variant="ghost" onPress={() => setReceiveOpen(false)} /></View></View></Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  title: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.35)" },
  sheet: { maxHeight: "86%", backgroundColor: colors.white, padding: spacing.xl, gap: spacing.md, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  receiveLine: { gap: spacing.sm },
});
