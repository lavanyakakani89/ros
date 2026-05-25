import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate, formatPhone, type CustomerResult } from "@retailos/shared";

import { AddCustomerBottomSheet } from "@/components/customers/AddCustomerBottomSheet";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function CustomersScreen() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const query = useQuery({ queryKey: ["customers", search], queryFn: () => apiClient.get<{ data: CustomerResult[] }>(`/api/customers?search=${encodeURIComponent(search)}`) });
  const customers = query.data?.data ?? [];
  const outstanding = customers.reduce((sum, item) => sum + Number(item.outstandingDue ?? 0), 0);
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Customers" subtitle="Profiles, dues, loyalty, and ledger" />
      <View style={styles.stats}><Card style={styles.stat}><Text style={styles.value}>{customers.length}</Text><Text style={styles.muted}>Total customers</Text></Card><Card style={styles.stat}><Text style={[styles.value, outstanding > 0 && { color: colors.amber }]}>{formatCurrency(outstanding)}</Text><Text style={styles.muted}>Outstanding dues</Text></Card></View>
      <Input placeholder="Search name or phone" value={search} onChangeText={setSearch} />
      <FlatList
        data={customers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/(app)/customers/${item.id}`)}>
            <Card style={styles.customer}>
              <View style={styles.rowBetween}><Text style={styles.name}>{item.name}</Text>{Number(item.outstandingDue ?? 0) > 0 ? <Badge label={formatCurrency(Number(item.outstandingDue))} color="red" /> : null}</View>
              <Text style={styles.muted}>{formatPhone(item.phone)}</Text>
              <Text style={styles.muted}>Last visit {item.lastVisitAt ? formatDate(item.lastVisitAt) : "No invoices yet"}</Text>
            </Card>
          </Pressable>
        )}
      />
      <Pressable style={styles.fab} onPress={() => setAddOpen(true)}><Text style={styles.fabText}>+</Text></Pressable>
      <AddCustomerBottomSheet visible={addOpen} onClose={() => setAddOpen(false)} onSaved={() => void query.refetch()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1 },
  value: { color: colors.teal, fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
  customer: { marginBottom: spacing.sm, gap: spacing.xs },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  name: { color: colors.slate, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
  fab: { position: "absolute", right: spacing.xl, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  fabText: { color: colors.white, fontSize: 30, fontWeight: fontWeights.bold },
});
