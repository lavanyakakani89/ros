import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, fontSizes, fontWeights, spacing } from "@/theme";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  fullWidth?: boolean;
}

export function Button({ label, variant = "primary", loading, disabled, icon, fullWidth, style, ...props }: ButtonProps) {
  const variantStyle = styles[variant];
  const textStyle = variant === "secondary" || variant === "ghost" ? styles.secondaryText : styles.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      {...props}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        variantStyle,
        fullWidth && styles.fullWidth,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        typeof style === "function" ? style({ pressed }) : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" || variant === "ghost" ? colors.teal : colors.white} />
      ) : (
        <>
          {icon ? <MaterialCommunityIcons name={icon} size={18} color={textStyle.color} /> : null}
          <Text style={[styles.label, textStyle]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: "transparent",
  },
  fullWidth: { width: "100%" },
  primary: { backgroundColor: colors.teal },
  secondary: { backgroundColor: colors.white, borderColor: colors.teal },
  danger: { backgroundColor: colors.red },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.86 },
  label: { fontSize: fontSizes.base, fontWeight: fontWeights.semibold },
  primaryText: { color: colors.white },
  secondaryText: { color: colors.teal },
});
