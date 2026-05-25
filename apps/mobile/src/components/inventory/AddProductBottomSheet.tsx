import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { createProductSchema } from "@retailos/shared";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface ProductFormProps {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function AddProductBottomSheet({ visible, onClose, onSaved }: ProductFormProps) {
  const gstEnabled = useAuthStore((state) => state.tenant?.gstEnabled ?? true);
  const [form, setForm] = useState<Record<string, string>>({ unit: "piece", gstRate: "0" });

  function update(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const payload = createProductSchema.parse({
      name: form.name,
      sku: form.sku,
      barcode: form.barcode,
      unit: form.unit,
      mrp: Number(form.mrp ?? 0),
      sellingPrice: Number(form.sellingPrice ?? 0),
      purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : undefined,
      gstRate: Number(form.gstRate ?? 0),
      hsnCode: form.hsnCode,
      reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : undefined,
      category: form.category,
      supplierId: form.supplierId,
      verticalData: {
        category: form.category,
        brand: form.brand,
        perishable: form.perishable === "true",
      },
    });
    await apiClient.post("/api/inventory/products", payload);
    onSaved?.();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide">
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Add product</Text>
        <Input label="Name*" value={form.name} onChangeText={(value) => update("name", value)} />
        <Input label="SKU" value={form.sku} onChangeText={(value) => update("sku", value)} />
        <Input label="Barcode" value={form.barcode} onChangeText={(value) => update("barcode", value)} />
        <Input label="Unit*" value={form.unit} onChangeText={(value) => update("unit", value)} />
        <Input label="MRP*" keyboardType="numeric" value={form.mrp} onChangeText={(value) => update("mrp", value)} />
        <Input label="Selling price*" keyboardType="numeric" value={form.sellingPrice} onChangeText={(value) => update("sellingPrice", value)} />
        <Input label="Purchase price" keyboardType="numeric" value={form.purchasePrice} onChangeText={(value) => update("purchasePrice", value)} />
        {gstEnabled ? <Input label="GST%" keyboardType="numeric" value={form.gstRate} onChangeText={(value) => update("gstRate", value)} /> : null}
        {gstEnabled ? <Input label="HSN code" value={form.hsnCode} onChangeText={(value) => update("hsnCode", value)} /> : null}
        <Input label="Reorder level" keyboardType="numeric" value={form.reorderLevel} onChangeText={(value) => update("reorderLevel", value)} />
        <Input label="Category" value={form.category} onChangeText={(value) => update("category", value)} />
        <Input label="Supplier search" value={form.supplierId} onChangeText={(value) => update("supplierId", value)} />
        <Input label="Brand" value={form.brand} onChangeText={(value) => update("brand", value)} />
        <Input label="Perishable for grocery" value={form.perishable} onChangeText={(value) => update("perishable", value)} hint="true or false" />
        <View style={styles.actions}>
          <Button label="Save" onPress={() => void save()} />
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
