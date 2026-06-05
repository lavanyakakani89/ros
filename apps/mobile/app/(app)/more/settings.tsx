import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import * as Application from "expo-application";
import * as ImagePicker from "expo-image-picker";
import { Permission } from "@bizbil/shared";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { clearTokens, enableBiometric } from "@/lib/auth";
import { getDefaultPrinter, getPairedDevices, printReceipt, setDefaultPrinter } from "@/lib/bluetooth-print";
import { useRequirePermission } from "@/hooks/usePermission";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export default function SettingsScreen() {
  useRequirePermission(Permission.SETTINGS_VIEW);
  const role = useAuthStore((state) => state.user?.role);
  const tenant = useAuthStore((state) => state.tenant);
  const clear = useAuthStore((state) => state.clear);
  const [printers, setPrinters] = useState<Array<{ id: string; name: string }>>([]);
  const [toggles, setToggles] = useState({ whatsapp: true, lowStock: true, expiry: true, delivery: true });
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader title="Settings" subtitle="Shop, users, printer, notifications, account" />
      {role === "OWNER" ? <Card style={styles.section}><Text style={styles.title}>Shop</Text><Input label="Shop name" value={tenant?.name} /><Input label="Address" /><Input label="Phone" /><Input label="GSTIN" /><View style={styles.row}><Text>GST toggle</Text><Switch value={tenant?.gstEnabled ?? true} /></View><Button label="Upload logo" variant="secondary" onPress={() => void ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images })} /></Card> : null}
      {(role === "OWNER" || role === "MANAGER") ? <Card style={styles.section}><Text style={styles.title}>Users</Text><Text>Shop users with roles</Text><Badge label="OWNER" color="blue" /><Button label="Add user" variant="secondary" /></Card> : null}
      <Card style={styles.section}><Text style={styles.title}>Printer</Text><Button label="Scan for printers" onPress={() => void getPairedDevices().then(setPrinters)} />{printers.map((printer) => <Button key={printer.id} label={printer.name} variant="secondary" onPress={() => void setDefaultPrinter(printer.id)} />)}<Button label="Test print" variant="secondary" onPress={() => void printReceipt({ invoiceNumber: "TEST", invoiceDate: new Date(), items: [], grandTotal: 0, paymentMode: "CASH" }, { shopName: tenant?.name ?? "BizBil" })} /></Card>
      <Card style={styles.section}><Text style={styles.title}>Notifications</Text>{Object.entries(toggles).map(([key, value]) => <View key={key} style={styles.row}><Text>{key}</Text><Switch value={value} onValueChange={(next) => setToggles((current) => ({ ...current, [key]: next }))} /></View>)}</Card>
      <Card style={styles.section}><Text style={styles.title}>Account</Text><Button label="Change password" variant="secondary" /><Button label="Enable biometric login" variant="secondary" onPress={() => void enableBiometric()} /><Button label="Sign out" variant="danger" onPress={() => void clearTokens().then(clear)} /></Card>
      <Text style={styles.version}>BizBil v{Application.nativeApplicationVersion ?? "1.0.0"}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  title: { color: colors.slate, fontSize: fontSizes.lg, fontWeight: fontWeights.bold },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  version: { color: colors.slateMid, textAlign: "center", fontSize: fontSizes.sm },
});
