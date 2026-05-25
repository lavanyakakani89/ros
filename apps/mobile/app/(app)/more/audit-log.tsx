import { FlatList, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatDate, Permission } from "@retailos/shared";

import { QueryWrapper } from "@/components/common/QueryWrapper";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useRequirePermission } from "@/hooks/usePermission";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface AuditLogEntry {
  id: string;
  createdAt: string;
  userName?: string;
  action: string;
  details?: string;
}

export default function AuditLogScreen() {
  useRequirePermission(Permission.AUDIT_VIEW);
  const query = useQuery<AuditLogEntry[], Error>({ queryKey: ["audit-log"], queryFn: () => apiClient.get<AuditLogEntry[]>("/api/audit") });
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Audit Log" subtitle="Chronological activity trail" />
      <View style={styles.filters}>
        <Button label="Today" variant="secondary" />
        <Button label="This week" variant="secondary" />
        <Button label="All actions" variant="secondary" />
      </View>
      <QueryWrapper query={query}>
        <FlatList
          data={query.data ?? []}
          keyExtractor={(item) => item.id}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={<EmptyState icon="history" title="No audit entries found" />}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.row}><Text style={styles.title}>{item.action}</Text><Badge label={item.userName ?? "System"} color="gray" /></View>
              <Text style={styles.muted}>{formatDate(item.createdAt)}</Text>
              <Text style={styles.muted}>{item.details ?? "-"}</Text>
            </Card>
          )}
        />
      </QueryWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  card: { marginBottom: spacing.sm, gap: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  title: { color: colors.slate, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
});
