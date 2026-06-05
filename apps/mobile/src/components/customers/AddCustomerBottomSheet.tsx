import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { createCustomerSchema } from "@bizbil/shared";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export function AddCustomerBottomSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved?: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  async function save() {
    const payload = createCustomerSchema.parse(form);
    await apiClient.post("/api/customers", payload);
    onSaved?.();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide">
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Add customer</Text>
        <Input label="Name*" value={form.name} onChangeText={(name) => setForm((current) => ({ ...current, name }))} />
        <Input label="Phone*" keyboardType="phone-pad" value={form.phone} onChangeText={(phone) => setForm((current) => ({ ...current, phone }))} />
        <Input label="Address" value={form.address} onChangeText={(address) => setForm((current) => ({ ...current, address }))} />
        <View style={styles.actions}><Button label="Save" onPress={() => void save()} /><Button label="Cancel" variant="ghost" onPress={onClose} /></View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.md },
  title: { color: colors.slate, fontSize: fontSizes.xxl, fontWeight: fontWeights.bold },
  actions: { gap: spacing.sm },
});
