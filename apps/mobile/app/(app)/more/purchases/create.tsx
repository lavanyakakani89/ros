import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { formatCurrency } from "@bizbil/shared";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function CreatePOScreen() {
  const [supplierId, setSupplierId] = useState("");
  const [items, setItems] = useState<Array<{ productId: string; qty: string; unit: string; expectedPrice: string }>>([]);
  const total = items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.expectedPrice || 0), 0);
  async function create() {
    await apiClient.post("/api/purchase-orders", { supplierId, items: items.map((item) => ({ productId: item.productId, quantity: Number(item.qty), expectedPrice: Number(item.expectedPrice) })) });
    router.back();
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="Create PO" subtitle="Supplier, expected delivery, and items" />
      <Input label="Supplier search" value={supplierId} onChangeText={setSupplierId} />
      <Input label="Expected delivery date" />
      <Input label="Payment terms" />
      <Button label="Add item" variant="secondary" onPress={() => setItems((current) => [...current, { productId: "", qty: "1", unit: "piece", expectedPrice: "0" }])} />
      {items.map((item, index) => <Card key={index} style={styles.card}><Input label="Product" value={item.productId} onChangeText={(productId) => setItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, productId } : line))} /><Input label="Qty ordered" value={item.qty} onChangeText={(qty) => setItems((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, qty } : line))} /><Input label="Unit" value={item.unit} /><Input label="Expected price" value={item.expectedPrice} /></Card>)}
      <Text style={styles.total}>Running total {formatCurrency(total)}</Text>
      <Button label="Create PO" onPress={() => void create()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.sm },
  total: { color: colors.teal, fontSize: fontSizes.xl, fontWeight: fontWeights.bold, textAlign: "right" },
});
