import { useState } from "react";
import { Linking, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate, formatPhone } from "@retailos/shared";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useAuthStore((state) => state.user?.role);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const query = useQuery({ queryKey: ["customer", id], queryFn: () => apiClient.get<any>(`/api/customers/${id}`) });
  const ledger = useQuery({ queryKey: ["customer-ledger", id], queryFn: () => apiClient.get<any[]>(`/api/customers/${id}/ledger`), enabled: role === "OWNER" || role === "MANAGER" });
  const customer = query.data;
  if (!customer) return null;
  const outstanding = Number(customer.outstandingDue ?? 0);

  async function recordPayment() {
    await apiClient.post("/api/payments", { customerId: id, amount: Number(paymentAmount), mode: "CASH", paidAt: new Date().toISOString() });
    setPaymentOpen(false);
    await query.refetch();
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title={customer.name} subtitle={formatPhone(customer.phone)} />
      <Card style={styles.section}><Text style={styles.sectionTitle}>Profile</Text><Text>{customer.email ?? "No email"}</Text><Text>{customer.address ?? "No address"}</Text><Text>{customer.gstin ?? "No GSTIN"}</Text></Card>
      {outstanding > 0 ? (
        <Card style={styles.warning}>
          <Text style={styles.warningText}>Outstanding: {formatCurrency(outstanding)}</Text>
          <Button label="Send reminder" variant="secondary" onPress={() => void Linking.openURL(`whatsapp://send?phone=${customer.phone}&text=${encodeURIComponent(`Reminder: outstanding ${formatCurrency(outstanding)}`)}`)} />
          <Button label="Record payment" onPress={() => setPaymentOpen(true)} />
        </Card>
      ) : null}
      <Card style={styles.section}><Text style={styles.sectionTitle}>Loyalty</Text><Badge label={customer.loyaltyTier ?? "Base"} color="blue" /><Text>Points {String(customer.pointsBalance ?? 0)} | Value {formatCurrency(Number(customer.pointsValue ?? 0))}</Text><View style={styles.progress}><View style={[styles.progressFill, { width: "42%" }]} /></View></Card>
      <Card style={styles.section}><Text style={styles.sectionTitle}>Recent invoices</Text>{customer.invoices?.slice(0, 5).map((invoice: any) => <Text key={invoice.id}>{invoice.invoiceNumber} | {formatDate(invoice.invoiceDate)} | {formatCurrency(Number(invoice.grandTotal ?? 0))}</Text>)}</Card>
      {(role === "OWNER" || role === "MANAGER") ? <Card style={styles.section}><Text style={styles.sectionTitle}>Ledger</Text>{ledger.data?.map((entry: any, index) => <Text key={entry.id ?? index}>{entry.date ? formatDate(entry.date) : ""} {entry.description ?? "Transaction"} {formatCurrency(Number(entry.balance ?? 0))}</Text>)}</Card> : null}
      <Modal visible={paymentOpen} transparent animationType="slide"><View style={styles.modalBackdrop}><View style={styles.sheet}><Input label="Amount" keyboardType="numeric" value={paymentAmount} onChangeText={setPaymentAmount} /><Button label="Save payment" onPress={() => void recordPayment()} /><Button label="Cancel" variant="ghost" onPress={() => setPaymentOpen(false)} /></View></View></Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  warning: { gap: spacing.sm, backgroundColor: colors.amberLight },
  warningText: { color: colors.amber, fontWeight: fontWeights.bold },
  progress: { height: 8, backgroundColor: colors.slateLight, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: colors.teal },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.35)" },
  sheet: { backgroundColor: colors.white, padding: spacing.xl, borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: spacing.md },
});
