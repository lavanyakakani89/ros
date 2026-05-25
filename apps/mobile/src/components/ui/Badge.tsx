import { StyleSheet, Text } from "react-native";

import { colors, fontSizes, fontWeights, spacing } from "@/theme";

type BadgeColor = "green" | "amber" | "red" | "blue" | "gray";

const palette: Record<BadgeColor, { bg: string; fg: string }> = {
  green: { bg: colors.tealLight, fg: colors.teal },
  amber: { bg: colors.amberLight, fg: colors.amber },
  red: { bg: colors.redLight, fg: colors.red },
  blue: { bg: colors.blueLight, fg: colors.blue },
  gray: { bg: colors.slateLight, fg: colors.slateMid },
};

export function Badge({ label, color = "gray" }: { label: string; color?: BadgeColor }) {
  return <Text style={[styles.badge, { backgroundColor: palette[color].bg, color: palette[color].fg }]}>{label}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
  },
});
