import { Component, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <View style={styles.screen}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>RetailOS hit an unexpected screen error. Try again to reload this section.</Text>
          <Button label="Retry" onPress={() => this.setState({ hasError: false })} />
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md, backgroundColor: colors.background },
  title: { color: colors.slate, fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  body: { color: colors.slateMid, fontSize: fontSizes.base, textAlign: "center" },
});
