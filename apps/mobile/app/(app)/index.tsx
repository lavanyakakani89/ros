import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@retailos/shared";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { useSyncQueue } from "@/hooks/useSyncQueue";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function DashboardScreen() {
  const tenant = useAuthStore((state) => state.tenant);
  const { pendingCount } = useSyncQueue();
  const dashboard = useQuery({ queryKey: ["mobile-dashboard"], queryFn: () => apiClient.get<any>("/api/reports/dashboard") });
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);
  const data = dashboard.data ?? {};
  const alerts = [
    data.expiring30 ? { color: "red" as const, text: `${data.expiring30} items expiring within 30 days`, href: "/(app)/inventory" } : null,
    data.pendingDeliveries ? { color: "amber" as const, text: `${data.pendingDeliveries} deliveries pending assignment`, href: "/(app)/more" } : null,
    data.pendingWhatsapp ? { color: "amber" as const, text: `${data.pendingWhatsapp} WhatsApp orders waiting confirmation`, href: "/(app)/more/whatsapp-orders" } : null,
  ].filter(Boolean) as Array<{ color: "red" | "amber"; text: string; href: any }>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title={`${greeting}, ${tenant?.name ?? "RetailOS"}`} subtitle={`${formatDate(new Date())} | ${tenant?.vertical ?? "Shop"}`} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statStrip}>
        <Stat label="Today's sales" value={formatCurrency(Number(data.todaySales ?? 0))} color={colors.teal} />
        <Stat label="Invoice count" value={String(data.invoiceCount ?? 0)} color={colors.blue} />
        <Stat label="Outstanding dues" value={formatCurrency(Number(data.outstandingDue ?? 0))} color={Number(data.outstandingDue ?? 0) > 0 ? colors.amber : colors.slateMid} />
        <Stat label="Low stock items" value={String(data.lowStock ?? 0)} color={Number(data.lowStock ?? 0) > 0 ? colors.red : colors.slateMid} />
        <Stat label="Pending deliveries" value={String(data.pendingDeliveries ?? 0)} color={Number(data.pendingDeliveries ?? 0) > 0 ? colors.amber : colors.slateMid} />
        <Stat label="Offline queue" value={String(pendingCount)} color={pendingCount > 0 ? colors.slateMid : colors.teal} />
      </ScrollView>
      {alerts.length > 0 ? <View style={styles.section}>{alerts.map((alert) => <Pressable key={alert.text} onPress={() => router.push(alert.href)}><Card style={styles.alert}><Badge label={alert.text} color={alert.color} /></Card></Pressable>)}</View> : null}
      <View style={styles.grid}>
        <Button label="New invoice" icon="receipt" onPress={() => router.push("/(app)/billing")} />
        <Button label="Receive stock" variant="secondary" icon="package-down" onPress={() => router.push({ pathname: "/(app)/inventory", params: { tab: "adjustments" } })} />
        <Button label="Record payment" variant="secondary" icon="cash" onPress={() => router.push("/(app)/more/payments")} />
        <Button label="View reports" variant="secondary" icon="chart-bar" onPress={() => router.push("/(app)/more/reports")} />
      </View>
      <Card style={styles.section}><Text style={styles.sectionTitle}>Recent activity</Text>{(data.activity ?? []).slice(0, 5).map((event: any, index: number) => <Text key={event.id ?? index} style={styles.muted}>{event.action} · {event.user} · {event.timeAgo}</Text>)}</Card>
      {data.whatsappOrders?.length ? <Card style={styles.section}><Text style={styles.sectionTitle}>WhatsApp orders</Text><ScrollView horizontal>{data.whatsappOrders.map((order: any) => <Card key={order.id} style={styles.order}><Text style={styles.sectionTitle}>{order.customerName}</Text><Text style={styles.muted}>{order.itemsSummary}</Text><Button label="Review" onPress={() => router.push(`/(app)/more/whatsapp-orders/${order.id}`)} /></Card>)}</ScrollView></Card> : null}
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return <Card style={styles.stat}><Text style={[styles.statValue, { color }]}>{value}</Text><Text style={styles.muted}>{label}</Text></Card>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  statStrip: { gap: spacing.sm },
  stat: { width: 150 },
  statValue: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  alert: { marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  order: { width: 220, marginRight: spacing.sm },
});
