import { useState } from "react";
import { FlatList, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@retailos/shared";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function PaymentsScreen() {
  const [period, setPeriod] = useState("today");
  const [tab, setTab] = useState("collections");
  const [recordFor, setRecordFor] = useState<any | null>(null);
  const [amount, setAmount] = useState("");
  const role = useAuthStore((state) => state.user?.role);
  const query = useQuery({ queryKey: ["payments", period], queryFn: () => apiClient.get<any>(`/api/payments?period=${period}`) });
  const data = query.data ?? {};
  async function recordPayment() {
    await apiClient.post("/api/payments", { customerId: recordFor.id, amount: Number(amount), mode: "CASH", referenceNumber: "", paidAt: new Date().toISOString() });
    setRecordFor(null);
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="Payments" subtitle="Collections, outstanding, and day close" />
      <View style={styles.row}><Stat label="Cash" value={data.cash} /><Stat label="UPI" value={data.upi} /><Stat label="Card" value={data.card} /></View>
      <View style={styles.row}>{["today", "week", "month"].map((item) => <Button key={item} label={item} variant={period === item ? "primary" : "secondary"} onPress={() => setPeriod(item)} />)}</View>
      <View style={styles.row}>{["collections", "outstanding", ...(role === "OWNER" || role === "MANAGER" ? ["day close"] : [])].map((item) => <Button key={item} label={item} variant={tab === item ? "primary" : "secondary"} onPress={() => setTab(item)} />)}</View>
      {tab === "collections" ? <FlatList scrollEnabled={false} data={data.collections ?? []} keyExtractor={(item: any) => item.id} renderItem={({ item }: any) => <Card style={styles.card}><Text style={styles.title}>{item.invoiceNumber}</Text><Text>{item.customerName}</Text><Badge label={item.mode} color="blue" /><Text>{formatCurrency(Number(item.amount ?? 0))} | {item.time}</Text></Card>} /> : null}
      {tab === "outstanding" ? <Card style={styles.card}><Text style={styles.due}>{formatCurrency(Number(data.totalOutstanding ?? 0))}</Text>{(data.outstandingCustomers ?? []).map((customer: any) => <Button key={customer.id} label={`${customer.name} ${formatCurrency(Number(customer.dueAmount ?? 0))}`} variant="secondary" onPress={() => setRecordFor(customer)} />)}</Card> : null}
      {tab === "day close" ? <Card style={styles.card}><Text>Expected cash: {formatCurrency(Number(data.expectedCash ?? 0))}</Text><Input label="Actual cash" keyboardType="numeric" /><Text>Discrepancy shown after entry</Text><Button label="Close day" onPress={() => void apiClient.post("/api/payments/day-close", {})} /></Card> : null}
      <Modal visible={Boolean(recordFor)} transparent animationType="slide"><View style={styles.backdrop}><View style={styles.sheet}><Input label="Amount" keyboardType="numeric" value={amount} onChangeText={setAmount} /><Input label="Payment mode" value="CASH" /><Input label="Reference number" /><Input label="Date" value={new Date().toISOString().slice(0, 10)} /><Button label="Record payment" onPress={() => void recordPayment()} /><Button label="Cancel" variant="ghost" onPress={() => setRecordFor(null)} /></View></View></Modal>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: unknown }) { return <Card style={styles.stat}><Text style={styles.value}>{formatCurrency(Number(value ?? 0))}</Text><Text style={styles.muted}>{label}</Text></Card>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { flex: 1 },
  card: { marginBottom: spacing.sm, gap: spacing.sm },
  value: { color: colors.teal, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid },
  title: { color: colors.slate, fontWeight: fontWeights.bold },
  due: { color: colors.red, fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.35)" },
  sheet: { backgroundColor: colors.white, padding: spacing.xl, gap: spacing.md, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
});
