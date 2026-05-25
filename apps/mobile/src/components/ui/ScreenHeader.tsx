import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export function ScreenHeader({ title, subtitle, rightAction }: { title: string; subtitle?: string; rightAction?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {rightAction}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  copy: { flex: 1 },
  title: { color: colors.slate, fontSize: fontSizes.xxl, fontWeight: fontWeights.bold },
  subtitle: { color: colors.slateMid, fontSize: fontSizes.base, marginTop: spacing.xs },
});
