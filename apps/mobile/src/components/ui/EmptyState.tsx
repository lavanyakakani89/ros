import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon} size={32} color={colors.teal} />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xxxl },
  title: { color: colors.slate, fontSize: fontSizes.md, fontWeight: fontWeights.bold, textAlign: "center" },
  subtitle: { color: colors.slateMid, fontSize: fontSizes.base, textAlign: "center" },
});
