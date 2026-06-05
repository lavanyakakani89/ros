import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { UseQueryResult } from "@tanstack/react-query";
import { AuthError } from "@bizbil/shared";
import { router } from "expo-router";

import { Button } from "@/components/ui/Button";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export function QueryWrapper({
  query,
  children,
  emptyState,
}: {
  query: UseQueryResult<unknown, Error>;
  children: ReactNode;
  emptyState?: ReactNode;
}) {
  if (query.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  if (query.error) {
    if (query.error instanceof AuthError) {
      router.replace("/(auth)/login");
    }
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{query.error.message || "Something went wrong. Please try again."}</Text>
        <Button label="Retry" onPress={() => void query.refetch()} />
      </View>
    );
  }

  return <>{emptyState ?? children}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xxl },
  title: { color: colors.slate, fontSize: fontSizes.base, fontWeight: fontWeights.semibold, textAlign: "center" },
});
