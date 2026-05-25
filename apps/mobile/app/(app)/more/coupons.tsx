import { FlatList, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { QueryWrapper } from "@/components/common/QueryWrapper";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface Coupon {
  id: string;
  code: string;
  description?: string;
  status: string;
  discountType?: string;
  discountValue?: number;
}

export default function CouponsScreen() {
  const query = useQuery<Coupon[], Error>({ queryKey: ["coupons"], queryFn: () => apiClient.get<Coupon[]>("/api/coupons") });
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Coupons" subtitle="Available discounts and offers" />
      <QueryWrapper query={query}>
        <FlatList
          data={query.data ?? []}
          keyExtractor={(item) => item.id}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={<EmptyState icon="tag" title="No coupons found" />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.row}><Text style={styles.title}>{item.code}</Text><Badge label={item.status} color="blue" /></View>
              <Text style={styles.muted}>{item.description ?? "No description"}</Text>
              <Text style={styles.muted}>{item.discountType ?? "Discount"} {String(item.discountValue ?? "")}</Text>
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
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
});
