import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BarChart } from "react-native-chart-kit";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, Permission } from "@bizbil/shared";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { usePermission, useRequirePermission } from "@/hooks/usePermission";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function ReportsScreen() {
  const [period, setPeriod] = useState("today");
  const [tab, setTab] = useState("sales");
  const canFinancialReports = usePermission(Permission.REPORTS_FINANCIAL);
  const gstEnabled = useAuthStore((state) => state.tenant?.gstEnabled ?? true);
  const query = useQuery({ queryKey: ["reports", period], queryFn: () => apiClient.get<any>(`/api/reports/sales?period=${period}`) });
  const data = query.data ?? {};
  const tabs = ["sales", ...(gstEnabled ? ["gst"] : []), "stock", ...(canFinancialReports ? ["pnl"] : [])];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="Reports" subtitle="Sales, GST, stock, and profitability" />
      <View style={styles.row}>{["today", "week", "month", "custom"].map((item) => <Button key={item} label={item} variant={period === item ? "primary" : "secondary"} onPress={() => setPeriod(item)} />)}</View>
      {period === "custom" ? <View style={styles.row}><Input label="From" /><Input label="To" /></View> : null}
      <View style={styles.row}>{tabs.map((item) => <Button key={item} label={item.toUpperCase()} variant={tab === item ? "primary" : "secondary"} onPress={() => setTab(item)} />)}</View>
      {tab === "sales" ? <ReportBlock title="Sales" rows={[["Gross sales", data.grossSales], ["Net sales", data.netSales], ["Invoice count", data.invoiceCount], ["Avg bill value", data.avgBillValue]]} chart /> : null}
      {tab === "gst" ? <ReportBlock title="GST" rows={[["0/5/12/18%", data.taxBySlab], ["Total CGST", data.totalCgst], ["Total SGST", data.totalSgst], ["Total tax collected", data.taxCollected], ["ITC from purchases", data.itc], ["Net payable", data.netPayable]]} /> : null}
      {tab === "stock" ? <ReportBlock title="Stock" rows={[["Stock value total", data.stockValue], ["Low stock list", data.lowStock], ["Expiry 30/60/90", data.expiryBreakdown]]} /> : null}
      {tab === "pnl" ? <PnlBlock data={data} /> : null}
    </ScrollView>
  );
}

function PnlBlock({ data }: { data: Record<string, unknown> }) {
  useRequirePermission(Permission.REPORTS_FINANCIAL);
  return <ReportBlock title="P&L" rows={[["Revenue", data.revenue], ["COGS", data.cogs], ["Gross profit", data.grossProfit], ["Expenses", data.expenses], ["Net profit", data.netProfit], ["For detailed analysis consult your accountant", ""]]} />;
}

function ReportBlock({ title, rows, chart }: { title: string; rows: Array<[string, unknown]>; chart?: boolean }) {
  return <Card style={styles.block}><Text style={styles.title}>{title}</Text>{chart ? <BarChart data={{ labels: ["M", "T", "W", "T", "F"], datasets: [{ data: [10, 20, 12, 28, 24] }] }} width={320} height={180} yAxisLabel="₹" yAxisSuffix="" chartConfig={{ color: () => colors.teal, backgroundGradientFrom: colors.white, backgroundGradientTo: colors.white, decimalPlaces: 0 }} /> : null}{rows.map(([label, value]) => <View key={label} style={styles.reportRow}><Text style={styles.muted}>{label}</Text><Text style={styles.value}>{typeof value === "number" ? formatCurrency(value) : String(value ?? "-")}</Text></View>)}</Card>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  block: { gap: spacing.md },
  title: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  reportRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  muted: { color: colors.slateMid },
  value: { color: colors.slate, fontWeight: fontWeights.semibold },
});
