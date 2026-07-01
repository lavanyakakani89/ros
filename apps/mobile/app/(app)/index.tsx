import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate, Permission } from "@bizbil/shared";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { usePermission } from "@/hooks/usePermission";
import { apiClient } from "@/lib/api-client";
import { useSyncQueue } from "@/hooks/useSyncQueue";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface OverviewResponse {
  metrics: {
    netSales: number;
    invoiceCount: number;
    receivables: number;
    lowStockCount: number;
    collections: number;
  };
}

interface DeliveryRecord {
  id: string;
  status: "PENDING" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED";
}

interface AuditLogRecord {
  id: string;
  action: string;
  entity: string;
  createdAt: string;
  user?: {
    name?: string;
  } | null;
}

export default function DashboardScreen() {
  const tenant = useAuthStore((state) => state.tenant);
  const role = useAuthStore((state) => state.user?.role ?? "STAFF");
  const canViewReports = usePermission(Permission.REPORTS_VIEW);
  const canViewAudit = usePermission(Permission.AUDIT_VIEW);
  const { pendingCount } = useSyncQueue();
  const today = new Date().toISOString().slice(0, 10);

  const overviewQuery = useQuery({
    queryKey: ["mobile-dashboard-overview", today],
    queryFn: () => apiClient.get<OverviewResponse>(`/api/reports/overview?from=${today}&to=${today}`),
    enabled: canViewReports,
  });
  const deliveriesQuery = useQuery({
    queryKey: ["mobile-dashboard-deliveries"],
    queryFn: () => apiClient.get<DeliveryRecord[]>("/api/delivery?scope=active"),
    enabled: canViewReports,
  });
  const auditQuery = useQuery({
    queryKey: ["mobile-dashboard-audit"],
    queryFn: () => apiClient.get<{ data: AuditLogRecord[] }>("/api/audit-logs?limit=5"),
    enabled: canViewAudit,
  });

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const overview = overviewQuery.data?.metrics;
  const deliveries = deliveriesQuery.data ?? [];
  const pendingDeliveries = deliveries.filter((delivery) => ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(delivery.status)).length;
  const recentActivity = auditQuery.data?.data ?? [];
  const alerts = [
    canViewReports && (overview?.lowStockCount ?? 0) > 0
      ? { color: "red" as const, text: `${overview?.lowStockCount ?? 0} low stock items`, href: "/(app)/inventory" }
      : null,
    canViewReports && pendingDeliveries > 0
      ? { color: "amber" as const, text: `${pendingDeliveries} deliveries need action`, href: "/(app)/more" }
      : null,
  ].filter(Boolean) as Array<{ color: "red" | "amber"; text: string; href: "/(app)/inventory" | "/(app)/more" }>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title={`${greeting}, ${tenant?.name ?? "BizBil"}`} subtitle={`${formatDate(new Date())} | ${tenant?.vertical ?? "Shop"} · ${role}`} />
      {canViewReports ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statStrip}>
          <Stat label="Today's sales" value={formatCurrency(Number(overview?.netSales ?? 0))} color={colors.teal} />
          <Stat label="Invoice count" value={String(overview?.invoiceCount ?? 0)} color={colors.blue} />
          <Stat label="Collections" value={formatCurrency(Number(overview?.collections ?? 0))} color={colors.teal} />
          <Stat label="Outstanding dues" value={formatCurrency(Number(overview?.receivables ?? 0))} color={Number(overview?.receivables ?? 0) > 0 ? colors.amber : colors.slateMid} />
          <Stat label="Low stock items" value={String(overview?.lowStockCount ?? 0)} color={Number(overview?.lowStockCount ?? 0) > 0 ? colors.red : colors.slateMid} />
          <Stat label="Pending deliveries" value={String(pendingDeliveries)} color={pendingDeliveries > 0 ? colors.amber : colors.slateMid} />
          <Stat label="Offline queue" value={String(pendingCount)} color={pendingCount > 0 ? colors.slateMid : colors.teal} />
        </ScrollView>
      ) : (
        <Card>
          <Text style={styles.sectionTitle}>Quick status</Text>
          <Text style={styles.muted}>Detailed analytics are available to owners and managers. You can still continue with billing, payments, and inventory workflows.</Text>
        </Card>
      )}
      {alerts.length > 0 ? <View style={styles.section}>{alerts.map((alert) => <Pressable key={alert.text} onPress={() => router.push(alert.href)}><Card style={styles.alert}><Badge label={alert.text} color={alert.color} /></Card></Pressable>)}</View> : null}
      <View style={styles.grid}>
        <Button label="New invoice" icon="receipt" onPress={() => router.push("/(app)/billing")} />
        <Button label="Receive stock" variant="secondary" icon="package-down" onPress={() => router.push({ pathname: "/(app)/inventory", params: { tab: "adjustments" } })} />
        <Button label="Record payment" variant="secondary" icon="cash" onPress={() => router.push("/(app)/more/payments")} />
        {canViewReports ? <Button label="View reports" variant="secondary" icon="chart-bar" onPress={() => router.push("/(app)/more/reports")} /> : null}
      </View>
      {canViewAudit ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Recent activity</Text>
          {recentActivity.length > 0 ? recentActivity.map((event) => (
            <Text key={event.id} style={styles.muted}>
              {readableAction(event.action)} {event.entity.toLowerCase()} · {event.user?.name ?? "System"}
            </Text>
          )) : <Text style={styles.muted}>No recent audit activity.</Text>}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return <Card style={styles.stat}><Text style={[styles.statValue, { color }]}>{value}</Text><Text style={styles.muted}>{label}</Text></Card>;
}

function readableAction(action: string) {
  return action.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  statStrip: { gap: spacing.sm },
  stat: { width: 160 },
  statValue: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  alert: { marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
