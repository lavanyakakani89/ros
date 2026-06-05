import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { updateProductSchema } from "@bizbil/shared";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export function EditProductBottomSheet({ visible, product, onClose, onSaved }: { visible: boolean; product: any | null; onClose: () => void; onSaved?: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name ?? "",
        sku: product.sku ?? "",
        barcode: product.barcode ?? "",
        unit: product.unit ?? "piece",
        mrp: String(product.mrp ?? ""),
        sellingPrice: String(product.sellingPrice ?? ""),
      });
    }
  }, [product]);

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!product) return;
    const payload = updateProductSchema.parse({
      name: form.name,
      sku: form.sku,
      barcode: form.barcode,
      unit: form.unit,
      mrp: Number(form.mrp ?? 0),
      sellingPrice: Number(form.sellingPrice ?? 0),
    });
    await apiClient.put(`/api/inventory/products/${product.id}`, payload);
    onSaved?.();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide">
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Edit product</Text>
        <Input label="Name*" value={form.name} onChangeText={(value) => update("name", value)} />
        <Input label="SKU" value={form.sku} onChangeText={(value) => update("sku", value)} />
        <Input label="Barcode" value={form.barcode} onChangeText={(value) => update("barcode", value)} />
        <Input label="Unit*" value={form.unit} onChangeText={(value) => update("unit", value)} />
        <Input label="MRP*" keyboardType="numeric" value={form.mrp} onChangeText={(value) => update("mrp", value)} />
        <Input label="Selling price*" keyboardType="numeric" value={form.sellingPrice} onChangeText={(value) => update("sellingPrice", value)} />
        <View style={styles.actions}>
          <Button label="Save changes" onPress={() => void save()} />
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.md },
  title: { color: colors.slate, fontSize: fontSizes.xxl, fontWeight: fontWeights.bold },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
