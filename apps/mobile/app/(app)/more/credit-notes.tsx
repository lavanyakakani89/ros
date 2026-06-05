import { FlatList, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@bizbil/shared";

import { QueryWrapper } from "@/components/common/QueryWrapper";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface CreditNote {
  id: string;
  creditNoteNumber: string;
  invoiceNumber?: string;
  customerName?: string;
  totalAmount: number;
  status: string;
  createdAt: string;
}

export default function CreditNotesScreen() {
  const query = useQuery<CreditNote[], Error>({ queryKey: ["credit-notes"], queryFn: () => apiClient.get<CreditNote[]>("/api/credit-notes") });
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Credit Notes" subtitle="Returns and GST reversals" />
      <QueryWrapper query={query}>
        <FlatList
          data={query.data ?? []}
          keyExtractor={(item) => item.id}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={<EmptyState icon="file-undo" title="No credit notes found" />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.row}><Text style={styles.title}>{item.creditNoteNumber}</Text><Badge label={item.status} color="blue" /></View>
              <Text style={styles.muted}>Invoice {item.invoiceNumber ?? "-"} | {item.customerName ?? "Walk-in"}</Text>
              <Text style={styles.amount}>{formatCurrency(Number(item.totalAmount))}</Text>
              <Text style={styles.muted}>{formatDate(item.createdAt)}</Text>
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
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  title: { color: colors.slate, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
  amount: { color: colors.teal, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
});
