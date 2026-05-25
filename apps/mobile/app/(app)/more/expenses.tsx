import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@retailos/shared";

import { QueryWrapper } from "@/components/common/QueryWrapper";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface Expense {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMode: string;
}

export default function ExpensesScreen() {
  const [period, setPeriod] = useState("week");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ date: formatDate(new Date()), category: "General", description: "", amount: "", paymentMode: "CASH", notes: "" });
  const query = useQuery<Expense[], Error>({ queryKey: ["expenses", period], queryFn: () => apiClient.get<Expense[]>(`/api/expenses?period=${period}`) });
  const expenses = query.data ?? [];

  async function saveExpense() {
    await apiClient.post("/api/expenses", { ...form, amount: Number(form.amount || 0) });
    setAddOpen(false);
    await query.refetch();
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Expenses" subtitle="Track shop spending" />
      <View style={styles.filters}>
        {["week", "month"].map((item) => <Button key={item} label={item === "week" ? "This week" : "This month"} variant={period === item ? "primary" : "secondary"} onPress={() => setPeriod(item)} />)}
      </View>
      <QueryWrapper query={query}>
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={<EmptyState icon="receipt" title="No expenses found" subtitle="Add expenses as they happen." />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.row}><Text style={styles.title}>{item.category}</Text><Text style={styles.amount}>{formatCurrency(Number(item.amount))}</Text></View>
              <Text style={styles.muted}>{formatDate(item.date)} | {item.description}</Text>
              <Badge label={item.paymentMode} color="blue" />
            </Card>
          )}
        />
      </QueryWrapper>
      <Pressable style={styles.fab} onPress={() => setAddOpen(true)}><Text style={styles.fabText}>+</Text></Pressable>
      <Modal visible={addOpen} animationType="slide">
        <View style={styles.modal}>
          <ScreenHeader title="Add expense" rightAction={<Button label="Close" variant="ghost" onPress={() => setAddOpen(false)} />} />
          <Input label="Date" value={form.date} onChangeText={(date) => setForm((current) => ({ ...current, date }))} />
          <Input label="Category" value={form.category} onChangeText={(category) => setForm((current) => ({ ...current, category }))} />
          <Input label="Description" value={form.description} onChangeText={(description) => setForm((current) => ({ ...current, description }))} />
          <Input label="Amount" keyboardType="numeric" value={form.amount} onChangeText={(amount) => setForm((current) => ({ ...current, amount }))} />
          <Input label="Payment mode" value={form.paymentMode} onChangeText={(paymentMode) => setForm((current) => ({ ...current, paymentMode }))} />
          <Input label="Notes" value={form.notes} onChangeText={(notes) => setForm((current) => ({ ...current, notes }))} />
          <Button label="Save expense" onPress={() => void saveExpense()} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background },
  filters: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  card: { marginBottom: spacing.sm, gap: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  title: { color: colors.slate, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
  amount: { color: colors.red, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
  fab: { position: "absolute", right: spacing.xl, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  fabText: { color: colors.white, fontSize: 30, fontWeight: fontWeights.bold },
  modal: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
});
