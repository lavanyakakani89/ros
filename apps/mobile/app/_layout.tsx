import "react-native-gesture-handler";

import { useEffect, useMemo } from "react";
import { Slot, useRouter } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MD3LightTheme, PaperProvider } from "react-native-paper";

import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { useNotificationHandler } from "@/lib/notifications";
import { colors } from "@/theme";

export default function RootLayout() {
  const router = useRouter();
  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  }), []);

  useNotificationHandler(router);

  const theme = {
    ...MD3LightTheme,
    colors: {
      ...MD3LightTheme.colors,
      primary: colors.teal,
      secondary: colors.tealMid,
      background: colors.background,
    },
  };

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={theme}>
          <Slot />
        </PaperProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
