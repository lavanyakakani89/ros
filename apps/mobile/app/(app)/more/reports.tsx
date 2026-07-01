import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BarChart } from "react-native-chart-kit";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, Permission } from "@bizbil/shared";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { usePermission, useRequirePermission } from "@/hooks/usePermission";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

type MobileTab = "sales" | "stock" | "dues" | "profit";

interface OverviewResponse {
  metrics: {
    netSales: number;
    invoiceCount: number;
    collections: number;
    receivables: number;
    lowStockCount: number;
  };
  topProducts: Array<{ productName: string; quantitySold: number; totalSales: number }>;
  trends: {
    revenue: Array<{ date: string; value: number }>;
  };
}

interface InventoryResponse {
  stockValue: number;
  lowStockCount: number;
  stockByCategory: Array<{ category: string; stock: number }>;
}

interface PnlResponse {
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMarginPct: number;
}

export default function ReportsScreen() {
  useRequirePermission(Permission.REPORTS_VIEW);
  const canFinancialReports = usePermission(Permission.REPORTS_FINANCIAL);
  const [period, setPeriod] = useState<"7d" | "30d">("7d");
  const [tab, setTab] = useState<MobileTab>("sales");
  const dateRange = useMemo(() => {
    const to = new Date().toISOString().slice(0, 10);
    const days = period === "30d" ? 29 : 6;
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return { from, to };
  }, [period]);

  const overviewQuery = useQuery({
    queryKey: ["mobile-reports-overview", period, dateRange.from, dateRange.to],
    queryFn: () => apiClient.get<OverviewResponse>(`/api/reports/overview?from=${dateRange.from}&to=${dateRange.to}`),
  });
  const inventoryQuery = useQuery({
    queryKey: ["mobile-reports-inventory"],
    queryFn: () => apiClient.get<InventoryResponse>("/api/reports/inventory"),
  });
  const pnlQuery = useQuery({
    queryKey: ["mobile-reports-pnl", period, dateRange.from, dateRange.to],
    queryFn: () => apiClient.get<PnlResponse>(`/api/reports/pnl?from=${dateRange.from}&to=${dateRange.to}`),
    enabled: canFinancialReports,
  });

  const overview = overviewQuery.data;
  const inventory = inventoryQuery.data;
  const pnl = pnlQuery.data;
  const tabs: MobileTab[] = ["sales", "stock", "dues", ...(canFinancialReports ? ["profit" as const] : [])];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="Reports" subtitle="Mobile analytics summary" />
      <View style={styles.row}>
        {(["7d", "30d"] as const).map((item) => (
          <Button key={item} label={item === "7d" ? "Last 7d" : "Last 30d"} variant={period === item ? "primary" : "secondary"} onPress={() => setPeriod(item)} />
        ))}
      </View>
      <View style={styles.row}>
        {tabs.map((item) => (
          <Button key={item} label={item.toUpperCase()} variant={tab === item ? "primary" : "secondary"} onPress={() => setTab(item)} />
        ))}
      </View>

      {tab === "sales" ? (
        <ReportBlock
          title="Sales summary"
          rows={[
            ["Net sales", overview?.metrics.netSales],
            ["Invoices", overview?.metrics.invoiceCount],
            ["Collections", overview?.metrics.collections],
            ["Top product", overview?.topProducts[0]?.productName ?? "-"],
          ]}
          chartData={overview?.trends.revenue.map((item) => item.value) ?? []}
        />
      ) : null}

      {tab === "stock" ? (
        <ReportBlock
          title="Stock summary"
          rows={[
            ["Stock value", inventory?.stockValue],
            ["Low stock items", inventory?.lowStockCount],
            ["Top category", inventory?.stockByCategory[0]?.category ?? "-"],
            ["Category stock", inventory?.stockByCategory[0]?.stock],
          ]}
        />
      ) : null}

      {tab === "dues" ? (
        <ReportBlock
          title="Dues summary"
          rows={[
            ["Receivables", overview?.metrics.receivables],
            ["Collections", overview?.metrics.collections],
            ["Invoices", overview?.metrics.invoiceCount],
            ["Low stock items", overview?.metrics.lowStockCount],
          ]}
        />
      ) : null}

      {tab === "profit" ? (
        <ReportBlock
          title="Profitability"
          rows={[
            ["Revenue", pnl?.revenue],
            ["Cost", pnl?.cost],
            ["Gross profit", pnl?.grossProfit],
            ["Margin", pnl ? `${pnl.grossMarginPct.toFixed(1)}%` : "-"],
          ]}
        />
      ) : null}
    </ScrollView>
  );
}

function ReportBlock({
  title,
  rows,
  chartData,
}: {
  title: string;
  rows: Array<[string, unknown]>;
  chartData?: number[];
}) {
  return (
    <Card style={styles.block}>
      <Text style={styles.title}>{title}</Text>
      {chartData && chartData.length > 1 ? (
        <BarChart
          data={{
            labels: chartData.map((_value, index) => `${index + 1}`),
            datasets: [{ data: chartData.length > 0 ? chartData : [0] }],
          }}
          width={320}
          height={180}
          yAxisLabel="Rs "
          yAxisSuffix=""
          chartConfig={{
            color: () => colors.teal,
            backgroundGradientFrom: colors.white,
            backgroundGradientTo: colors.white,
            decimalPlaces: 0,
          }}
          style={styles.chart}
        />
      ) : null}
      {rows.map(([label, value]) => (
        <View key={label} style={styles.reportRow}>
          <Text style={styles.muted}>{label}</Text>
          <Text style={styles.value}>{typeof value === "number" ? formatCurrency(value) : String(value ?? "-")}</Text>
        </View>
      ))}
    </Card>
  );
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
  chart: { marginVertical: spacing.sm, borderRadius: 12 },
});
