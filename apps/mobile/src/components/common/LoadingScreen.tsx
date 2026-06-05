import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export function LoadingScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.logo}><Text style={styles.logoText}>R</Text></View>
      <ActivityIndicator color={colors.teal} />
      <Text style={styles.text}>Loading BizBil</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, backgroundColor: colors.background },
  logo: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  logoText: { color: colors.white, fontSize: fontSizes.xxl, fontWeight: fontWeights.bold },
  text: { color: colors.slateMid, fontSize: fontSizes.base, fontWeight: fontWeights.medium },
});
