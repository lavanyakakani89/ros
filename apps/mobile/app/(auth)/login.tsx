import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginPayload } from "@retailos/shared";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiClient } from "@/lib/api-client";
import { enableBiometric, isBiometricAvailable, isBiometricEnabled, storeTokens } from "@/lib/auth";
import { registerForPushNotifications } from "@/lib/notifications";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface LoginResponse {
  user: { id: string; name: string; email: string; role: "OWNER" | "MANAGER" | "STAFF" | "DELIVERY"; tenantId: string; storeId?: string | null };
  tenant?: { id: string; name: string; vertical: string; gstEnabled: boolean };
  tokens: { accessToken: string; refreshToken: string };
}

export default function LoginScreen() {
  const [secure, setSecure] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBiometricPrompt, setShowBiometricPrompt] = useState(false);
  const [biometricLoginVisible, setBiometricLoginVisible] = useState(false);
  const setUser = useAuthStore((state) => state.setUser);
  const setTenant = useAuthStore((state) => state.setTenant);
  const setLoading = useAuthStore((state) => state.setLoading);

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginPayload>({
    resolver: zodResolver(loginSchema),
    defaultValues: { tenantSlug: "", identifier: "", password: "" },
  });

  useEffect(() => {
    void isBiometricEnabled().then(setBiometricLoginVisible);
  }, []);

  async function onSubmit(payload: LoginPayload) {
    setError(null);
    try {
      const auth = await apiClient.post<LoginResponse>("/api/auth/login", payload);
      await storeTokens(auth.tokens.accessToken, auth.tokens.refreshToken);
      setUser(auth.user);
      if (auth.tenant) setTenant(auth.tenant);
      setLoading(false);

      const pushToken = await registerForPushNotifications();
      if (pushToken) {
        await apiClient.post("/api/notifications/register", { token: pushToken, platform: "android" }).catch(() => null);
      }

      if (await isBiometricAvailable() && !(await isBiometricEnabled())) {
        setShowBiometricPrompt(true);
        return;
      }

      router.replace("/(app)");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign in failed");
    }
  }

  async function acceptBiometric() {
    await enableBiometric();
    setShowBiometricPrompt(false);
    router.replace("/(app)");
  }

  return (
    <View style={styles.screen}>
      <View style={styles.logo}><Text style={styles.logoText}>R</Text></View>
      <Text style={styles.title}>RetailOS</Text>
      <Text style={styles.subtitle}>Sign in to your shop</Text>

      <View style={styles.form}>
        <Controller control={control} name="tenantSlug" render={({ field }) => (
          <Input label="Shop URL / Slug" placeholder="yourshop" autoCapitalize="none" value={field.value} onChangeText={field.onChange} error={errors.tenantSlug?.message} />
        )} />
        <Controller control={control} name="identifier" render={({ field }) => (
          <Input label="Email or phone" keyboardType="email-address" autoCapitalize="none" value={field.value} onChangeText={field.onChange} error={errors.identifier?.message} />
        )} />
        <Controller control={control} name="password" render={({ field }) => (
          <View>
            <Input label="Password" secureTextEntry={secure} value={field.value} onChangeText={field.onChange} error={errors.password?.message} />
            <Pressable style={styles.eye} onPress={() => setSecure((value) => !value)}>
              <MaterialCommunityIcons name={secure ? "eye-off" : "eye"} size={20} color={colors.slateMid} />
            </Pressable>
          </View>
        )} />
        <Button label="Sign in" fullWidth loading={isSubmitting} disabled={isSubmitting} onPress={handleSubmit(onSubmit)} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {biometricLoginVisible ? <Button label="Use fingerprint" variant="secondary" icon="fingerprint" fullWidth onPress={() => router.replace("/(app)")} /> : null}
      </View>

      <Modal visible={showBiometricPrompt} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Enable fingerprint login?</Text>
            <Text style={styles.sheetBody}>Use this device biometric unlock for quicker access next time.</Text>
            <Button label="Yes, enable" fullWidth onPress={() => void acceptBiometric()} />
            <Button label="Not now" fullWidth variant="ghost" onPress={() => { setShowBiometricPrompt(false); router.replace("/(app)"); }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.xxl, justifyContent: "center" },
  logo: { alignSelf: "center", width: 72, height: 72, borderRadius: 36, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  logoText: { color: colors.white, fontSize: 34, fontWeight: fontWeights.bold },
  title: { textAlign: "center", color: colors.teal, fontSize: 32, fontWeight: fontWeights.bold },
  subtitle: { textAlign: "center", color: colors.slateMid, fontSize: fontSizes.md, marginTop: spacing.xs, marginBottom: spacing.xxl },
  form: { gap: spacing.lg },
  eye: { position: "absolute", right: spacing.md, bottom: 13 },
  error: { color: colors.red, textAlign: "center", fontWeight: fontWeights.semibold },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15, 23, 42, 0.35)" },
  sheet: { backgroundColor: colors.white, padding: spacing.xxl, borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: spacing.md },
  sheetTitle: { color: colors.slate, fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  sheetBody: { color: colors.slateMid, fontSize: fontSizes.base },
});
