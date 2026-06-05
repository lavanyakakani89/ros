import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Permission } from "@bizbil/shared";

import { Card } from "@/components/ui/Card";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { usePermission } from "@/hooks/usePermission";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

const groups = [
  { title: "FINANCE", items: [["Payments & Collections", "/(app)/more/payments"], ["Expenses", "/(app)/more/expenses"], ["Purchase Orders", "/(app)/more/purchases"], ["Suppliers", "/(app)/more/suppliers"]] },
  { title: "SALES", items: [["Quotations", "/(app)/more/quotations"], ["Credit Notes", "/(app)/more/credit-notes"], ["Coupons", "/(app)/more/coupons"], ["WhatsApp Orders", "/(app)/more/whatsapp-orders"]] },
  { title: "INSIGHTS", items: [["Reports", "/(app)/more/reports", Permission.REPORTS_VIEW], ["P&L Reports", "/(app)/more/reports", Permission.REPORTS_FINANCIAL]] },
  { title: "ADMIN", items: [["Settings", "/(app)/more/settings", Permission.SETTINGS_VIEW], ["Audit Log", "/(app)/more/audit-log", Permission.AUDIT_VIEW], ["Users", "/(app)/more/users", Permission.SETTINGS_MANAGE_USERS]] },
];

export default function MoreScreen() {
  const canFinancialReports = usePermission(Permission.REPORTS_FINANCIAL);
  const canSettings = usePermission(Permission.SETTINGS_VIEW);
  const canUsers = usePermission(Permission.SETTINGS_MANAGE_USERS);
  const canAudit = usePermission(Permission.AUDIT_VIEW);
  const visible = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(([, , permission]) => {
        if (permission === Permission.REPORTS_FINANCIAL) return canFinancialReports;
        if (permission === Permission.SETTINGS_VIEW) return canSettings;
        if (permission === Permission.SETTINGS_MANAGE_USERS) return canUsers;
        if (permission === Permission.AUDIT_VIEW) return canAudit;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
  return (
    <View style={styles.screen}>
      <ScreenHeader title="More" subtitle="Finance, sales, insights, and admin" />
      <FlatList
        data={visible}
        keyExtractor={(item) => item.title}
        renderItem={({ item }) => (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>{item.title}</Text>
            <Card style={styles.card}>
              {item.items.map(([label, href]) => (
                <Pressable key={href} style={styles.row} onPress={() => router.push(href as any)}>
                  <Text style={styles.label}>{label}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.slateMid} />
                </Pressable>
              ))}
            </Card>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background },
  group: { marginBottom: spacing.lg },
  groupTitle: { color: colors.slateMid, fontSize: fontSizes.xs, fontWeight: fontWeights.bold, marginBottom: spacing.sm },
  card: { paddingVertical: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { color: colors.slate, fontSize: fontSizes.base, fontWeight: fontWeights.semibold },
});
