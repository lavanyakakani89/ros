import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as Application from "expo-application";
import { Permission } from "@bizbil/shared";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { clearTokens, enableBiometric } from "@/lib/auth";
import { getDefaultPrinter, getPairedDevices, printReceipt, setDefaultPrinter } from "@/lib/bluetooth-print";
import { useRequirePermission } from "@/hooks/usePermission";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function SettingsScreen() {
  useRequirePermission(Permission.SETTINGS_VIEW);
  const user = useAuthStore((state) => state.user);
  const tenant = useAuthStore((state) => state.tenant);
  const clear = useAuthStore((state) => state.clear);
  const [printers, setPrinters] = useState<Array<{ id: string; name: string }>>([]);
  const [defaultPrinterId, setDefaultPrinterId] = useState<string | null>(null);

  useEffect(() => {
    void getDefaultPrinter().then(setDefaultPrinterId);
  }, []);

  async function handleSetDefaultPrinter(deviceId: string) {
    await setDefaultPrinter(deviceId);
    setDefaultPrinterId(deviceId);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="Settings" subtitle="Operational setup for this device" />
      <Card style={styles.section}>
        <Text style={styles.title}>Shop</Text>
        <View style={styles.detailRow}><Text style={styles.label}>Store</Text><Text style={styles.value}>{tenant?.name ?? "BizBil"}</Text></View>
        <View style={styles.detailRow}><Text style={styles.label}>Vertical</Text><Text style={styles.value}>{tenant?.vertical ?? "-"}</Text></View>
        <View style={styles.detailRow}><Text style={styles.label}>GST</Text><Text style={styles.value}>{tenant?.gstEnabled ? "Enabled" : "Disabled"}</Text></View>
        <View style={styles.detailRow}><Text style={styles.label}>Signed in as</Text><Text style={styles.value}>{user?.name ?? "-"}</Text></View>
      </Card>
      <Card style={styles.section}>
        <Text style={styles.title}>Printer</Text>
        <View style={styles.detailRow}><Text style={styles.label}>Default printer</Text><Text style={styles.value}>{defaultPrinterId ?? "Not configured"}</Text></View>
        <Button label="Scan paired printers" onPress={() => void getPairedDevices().then(setPrinters)} />
        {printers.map((printer) => (
          <Button
            key={printer.id}
            label={defaultPrinterId === printer.id ? `${printer.name} (Default)` : printer.name}
            variant="secondary"
            onPress={() => void handleSetDefaultPrinter(printer.id)}
          />
        ))}
        <Button label="Test print" variant="secondary" onPress={() => void printReceipt({ invoiceNumber: "TEST", invoiceDate: new Date(), items: [], grandTotal: 0, paymentMode: "CASH" }, { shopName: tenant?.name ?? "BizBil" })} />
      </Card>
      <Card style={styles.section}>
        <Text style={styles.title}>Security</Text>
        <Button label="Enable biometric login" variant="secondary" onPress={() => void enableBiometric()} />
        <Button label="Sign out" variant="danger" onPress={() => void clearTokens().then(clear)} />
      </Card>
      <Card style={styles.section}>
        <Text style={styles.title}>App</Text>
        <View style={styles.detailRow}><Text style={styles.label}>Version</Text><Text style={styles.value}>{Application.nativeApplicationVersion ?? "1.0.0"}</Text></View>
        <View style={styles.detailRow}><Text style={styles.label}>Build</Text><Text style={styles.value}>{Application.nativeBuildVersion ?? "-"}</Text></View>
        <View style={styles.detailRow}><Text style={styles.label}>Android package</Text><Text style={styles.value}>{Application.applicationId ?? "in.bizbil.app"}</Text></View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  title: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  label: { color: colors.slateMid, fontSize: fontSizes.sm },
  value: { color: colors.slate, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, flex: 1, textAlign: "right" },
});
