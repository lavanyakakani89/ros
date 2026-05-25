import { forwardRef } from "react";
import { StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";

import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface InputProps extends TextInputProps {
  label?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
}

export const Input = forwardRef<TextInput, InputProps>(({ label, error, hint, style, ...props }, ref) => (
  <View style={styles.wrap}>
    {label ? <Text style={styles.label}>{label}</Text> : null}
    <TextInput
      ref={ref}
      placeholderTextColor="#94A3B8"
      {...props}
      style={[styles.input, error ? styles.inputError : null, style]}
    />
    {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>
));

Input.displayName = "Input";

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { color: colors.slateMid, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    backgroundColor: colors.white,
    fontSize: fontSizes.base,
  },
  inputError: { borderColor: colors.red },
  error: { color: colors.red, fontSize: fontSizes.sm },
  hint: { color: colors.slateMid, fontSize: fontSizes.sm },
});
