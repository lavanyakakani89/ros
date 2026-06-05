import { FlatList, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@bizbil/shared";

import { QueryWrapper } from "@/components/common/QueryWrapper";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface Supplier {
  id: string;
  name: string;
  phone?: string;
  outstandingPayable?: number;
  recentPurchaseOrders?: Array<{ id: string; poNumber: string; status: string }>;
}

export default function SuppliersScreen() {
  const query = useQuery<Supplier[], Error>({ queryKey: ["suppliers"], queryFn: () => apiClient.get<Supplier[]>("/api/suppliers") });
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Suppliers" subtitle="Contacts, payables, and recent POs" />
      <QueryWrapper query={query}>
        <FlatList
          data={query.data ?? []}
          keyExtractor={(item) => item.id}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={<EmptyState icon="truck-delivery" title="No suppliers found" />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <Text style={styles.title}>{item.name}</Text>
              <Text style={styles.muted}>{item.phone ?? "No phone"}</Text>
              {Number(item.outstandingPayable ?? 0) > 0 ? <Text style={styles.amount}>Payable {formatCurrency(Number(item.outstandingPayable))}</Text> : null}
              <Text style={styles.muted}>Recent POs: {(item.recentPurchaseOrders ?? []).map((po) => po.poNumber).join(", ") || "-"}</Text>
              <Button label="Record payment" variant="secondary" />
            </Card>
          )}
        />
      </QueryWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background },
  card: { marginBottom: spacing.sm, gap: spacing.xs },
  title: { color: colors.slate, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
  amount: { color: colors.amber, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
});
