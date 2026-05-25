import { useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate, stockAdjustmentSchema } from "@retailos/shared";

import { AddProductBottomSheet } from "@/components/inventory/AddProductBottomSheet";
import { EditProductBottomSheet } from "@/components/inventory/EditProductBottomSheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

type Tab = "products" | "expiry" | "adjustments";

export default function InventoryScreen() {
  const [tab, setTab] = useState<Tab>("products");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [adjustment, setAdjustment] = useState<Record<string, string>>({ direction: "ADD", reason: "Goods received" });
  const productsQuery = useQuery({ queryKey: ["inventory-products"], queryFn: () => apiClient.get<{ data: any[] }>("/api/inventory/products?limit=200") });
  const expiryQuery = useQuery({ queryKey: ["inventory-expiring"], queryFn: () => apiClient.get<any[]>("/api/inventory/products/expiring?days=90") });
  const products = productsQuery.data?.data ?? [];
  const filtered = products.filter((product) => product.name?.toLowerCase().includes(search.toLowerCase()) || product.sku?.toLowerCase().includes(search.toLowerCase()));
  const lowStock = products.filter((product) => Number(product.currentStock ?? 0) <= Number(product.reorderLevel ?? 0));
  const outStock = products.filter((product) => Number(product.currentStock ?? 0) <= 0);

  async function submitAdjustment() {
    const payload = stockAdjustmentSchema.parse({
      productId: adjustment.productId,
      direction: adjustment.direction,
      quantity: Number(adjustment.quantity ?? 0),
      reason: adjustment.reason,
      notes: adjustment.reason === "Other" ? adjustment.notes : undefined,
    });
    await apiClient.post("/api/inventory/stock-adjustments", payload);
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Inventory" subtitle="Products, expiry, and stock adjustments" />
      <View style={styles.stats}>
        <Stat label="Active products" value={String(products.length)} onPress={() => setTab("products")} />
        <Stat label="Low stock" value={String(lowStock.length)} color="amber" onPress={() => setTab("products")} />
        <Stat label="Expiring soon" value={String(expiryQuery.data?.length ?? 0)} color="red" onPress={() => setTab("expiry")} />
      </View>
      <Input placeholder="Search products" value={search} onChangeText={setSearch} />
      <View style={styles.tabs}>{(["products", "expiry", "adjustments"] as const).map((item) => <TabButton key={item} label={item} active={tab === item} onPress={() => setTab(item)} />)}</View>
      {tab === "products" ? (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<EmptyState icon="package-variant" title="No products found" />}
          renderItem={({ item }) => (
            <Pressable onLongPress={() => setEditing(item)}>
              <Card style={styles.card}>
                <View style={styles.rowBetween}><Text style={styles.itemTitle}>{item.name}</Text><StockBadge stock={Number(item.currentStock ?? 0)} low={Number(item.reorderLevel ?? 0)} /></View>
                <Text style={styles.muted}>{item.sku ?? "No SKU"} | {item.unit ?? "piece"}</Text>
                <Text style={styles.price}>{formatCurrency(Number(item.sellingPrice ?? 0))} | Stock {String(item.currentStock ?? 0)}</Text>
              </Card>
            </Pressable>
          )}
        />
      ) : null}
      {tab === "expiry" ? (
        <ScrollView>
          {expiryQuery.data?.length ? expiryQuery.data.map((item: any) => (
            <Card key={item.id ?? `${item.productId}-${item.batchNumber}`} style={styles.card}>
              <Text style={styles.itemTitle}>{item.product?.name ?? item.productName}</Text>
              <Text style={styles.muted}>Batch {item.batchNumber} | Expiry {formatDate(item.expiryDate)} | Qty {String(item.quantity)}</Text>
            </Card>
          )) : <EmptyState icon="calendar-check" title="No products expiring in the next 90 days" />}
        </ScrollView>
      ) : null}
      {tab === "adjustments" ? (
        <ScrollView contentContainerStyle={styles.form}>
          <Input label="Product ID" value={adjustment.productId} onChangeText={(value) => setAdjustment((current) => ({ ...current, productId: value }))} />
          <View style={styles.direction}><Button label="+ Add" variant={adjustment.direction === "ADD" ? "primary" : "secondary"} onPress={() => setAdjustment((current) => ({ ...current, direction: "ADD" }))} /><Button label="- Remove" variant={adjustment.direction === "REMOVE" ? "danger" : "secondary"} onPress={() => setAdjustment((current) => ({ ...current, direction: "REMOVE" }))} /></View>
          <Input label="Quantity" keyboardType="numeric" value={adjustment.quantity} onChangeText={(value) => setAdjustment((current) => ({ ...current, quantity: value }))} />
          <Input label="Reason" value={adjustment.reason} onChangeText={(value) => setAdjustment((current) => ({ ...current, reason: value }))} hint="Opening stock / Goods received / Damage / Theft / Expiry write-off / Manual correction / Stock count / Other" />
          {adjustment.reason === "Other" ? <Input label="Notes" value={adjustment.notes} onChangeText={(value) => setAdjustment((current) => ({ ...current, notes: value }))} /> : null}
          <Button label="Submit adjustment" onPress={() => void submitAdjustment()} />
          <Text style={styles.sectionTitle}>Recent adjustments</Text>
          <EmptyState icon="history" title="Recent stock adjustments will appear here" />
        </ScrollView>
      ) : null}
      <Pressable style={styles.fab} onPress={() => setAddOpen(true)}><Text style={styles.fabText}>+</Text></Pressable>
      <AddProductBottomSheet visible={addOpen} onClose={() => setAddOpen(false)} onSaved={() => void productsQuery.refetch()} />
      <EditProductBottomSheet visible={Boolean(editing)} product={editing} onClose={() => setEditing(null)} onSaved={() => void productsQuery.refetch()} />
    </View>
  );
}

function Stat({ label, value, color = "green", onPress }: { label: string; value: string; color?: "green" | "amber" | "red"; onPress: () => void }) {
  return <Pressable style={styles.stat} onPress={onPress}><Text style={[styles.statValue, color === "amber" && { color: colors.amber }, color === "red" && { color: colors.red }]}>{value}</Text><Text style={styles.muted}>{label}</Text></Pressable>;
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable style={[styles.tab, active && styles.activeTab]} onPress={onPress}><Text style={[styles.tabText, active && styles.activeTabText]}>{label.charAt(0).toUpperCase() + label.slice(1)}</Text></Pressable>;
}

function StockBadge({ stock, low }: { stock: number; low: number }) {
  if (stock <= 0) return <Badge label="Out of stock" color="red" />;
  if (stock <= low) return <Badge label="Low stock" color="amber" />;
  return <Badge label="In stock" color="green" />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background, gap: spacing.md },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.white, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  statValue: { color: colors.teal, fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: { flex: 1, alignItems: "center", padding: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  activeTab: { backgroundColor: colors.teal, borderColor: colors.teal },
  tabText: { color: colors.slateMid, fontWeight: fontWeights.semibold },
  activeTabText: { color: colors.white },
  card: { marginBottom: spacing.sm, gap: spacing.xs },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  itemTitle: { color: colors.slate, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
  price: { color: colors.slate, fontWeight: fontWeights.semibold },
  form: { gap: spacing.md },
  direction: { flexDirection: "row", gap: spacing.sm },
  sectionTitle: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  fab: { position: "absolute", right: spacing.xl, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  fabText: { color: colors.white, fontSize: 30, fontWeight: fontWeights.bold },
});
