import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@bizbil/shared";

import { QueryWrapper } from "@/components/common/QueryWrapper";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface Quotation {
  id: string;
  quotationNumber: string;
  customerName?: string;
  validUntil?: string;
  totalAmount: number;
  status: string;
}

export default function QuotationsScreen() {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ customerSearch: "", productSearch: "", validUntil: "", terms: "" });
  const query = useQuery<Quotation[], Error>({ queryKey: ["quotations"], queryFn: () => apiClient.get<Quotation[]>("/api/quotations") });

  async function createQuotation() {
    await apiClient.post("/api/quotations", form);
    setCreateOpen(false);
    await query.refetch();
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Quotations" subtitle="Quotes, validity, and WhatsApp sharing" />
      <QueryWrapper query={query}>
        <FlatList
          data={query.data ?? []}
          keyExtractor={(item) => item.id}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={<EmptyState icon="file-document-edit" title="No quotations found" />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.row}><Text style={styles.title}>{item.quotationNumber}</Text><Badge label={item.status} color="blue" /></View>
              <Text style={styles.muted}>{item.customerName ?? "Walk-in"} | Valid {item.validUntil ? formatDate(item.validUntil) : "-"}</Text>
              <Text style={styles.amount}>{formatCurrency(Number(item.totalAmount))}</Text>
            </Card>
          )}
        />
      </QueryWrapper>
      <Pressable style={styles.fab} onPress={() => setCreateOpen(true)}><Text style={styles.fabText}>+</Text></Pressable>
      <Modal visible={createOpen} animationType="slide">
        <View style={styles.modal}>
          <ScreenHeader title="Create quotation" rightAction={<Button label="Close" variant="ghost" onPress={() => setCreateOpen(false)} />} />
          <Input label="Customer search" value={form.customerSearch} onChangeText={(customerSearch) => setForm((current) => ({ ...current, customerSearch }))} />
          <Input label="Product search" value={form.productSearch} onChangeText={(productSearch) => setForm((current) => ({ ...current, productSearch }))} />
          <Input label="Validity date" value={form.validUntil} onChangeText={(validUntil) => setForm((current) => ({ ...current, validUntil }))} />
          <Input label="Terms" value={form.terms} onChangeText={(terms) => setForm((current) => ({ ...current, terms }))} />
          <Button label="Create quotation" onPress={() => void createQuotation()} />
          <Button label="Send on WhatsApp" variant="secondary" />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background },
  card: { marginBottom: spacing.sm, gap: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  title: { color: colors.slate, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
  amount: { color: colors.teal, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
  fab: { position: "absolute", right: spacing.xl, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  fabText: { color: colors.white, fontSize: 30, fontWeight: fontWeights.bold },
  modal: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
});
