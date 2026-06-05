import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Permission } from "@bizbil/shared";

import { QueryWrapper } from "@/components/common/QueryWrapper";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useRequirePermission } from "@/hooks/usePermission";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface ShopUser {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "MANAGER" | "STAFF" | "DELIVERY";
  active?: boolean;
}

export default function UsersScreen() {
  useRequirePermission(Permission.SETTINGS_MANAGE_USERS);
  const currentRole = useAuthStore((state) => state.user?.role);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: "", email: "", role: "STAFF" });
  const query = useQuery<ShopUser[], Error>({ queryKey: ["settings-users"], queryFn: () => apiClient.get<ShopUser[]>("/api/settings/users") });
  const roleOptions = currentRole === "MANAGER" ? ["STAFF", "DELIVERY"] : ["MANAGER", "STAFF", "DELIVERY"];

  async function sendInvite() {
    await apiClient.post("/api/settings/users", invite);
    setInviteOpen(false);
    await query.refetch();
  }

  async function deactivate(user: ShopUser) {
    await apiClient.patch(`/api/settings/users/${user.id}`, { active: false });
    await query.refetch();
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Users" subtitle="Team access and roles" />
      <QueryWrapper query={query}>
        <FlatList
          data={query.data ?? []}
          keyExtractor={(item) => item.id}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          ListEmptyComponent={<EmptyState icon="account-group" title="No users found" />}
          renderItem={({ item }) => (
            <Pressable onLongPress={() => void deactivate(item)}>
              <Card style={styles.card}>
                <View style={styles.row}><Text style={styles.title}>{item.name}</Text><Badge label={item.role} color={item.active === false ? "gray" : "blue"} /></View>
                <Text style={styles.muted}>{item.email}</Text>
                <Text style={styles.muted}>{item.active === false ? "Inactive" : "Active"} | long press to deactivate</Text>
              </Card>
            </Pressable>
          )}
        />
      </QueryWrapper>
      <Pressable style={styles.fab} onPress={() => setInviteOpen(true)}><Text style={styles.fabText}>+</Text></Pressable>
      <Modal visible={inviteOpen} animationType="slide">
        <View style={styles.modal}>
          <ScreenHeader title="Invite user" rightAction={<Button label="Close" variant="ghost" onPress={() => setInviteOpen(false)} />} />
          <Input label="Name" value={invite.name} onChangeText={(name) => setInvite((current) => ({ ...current, name }))} />
          <Input label="Email" keyboardType="email-address" autoCapitalize="none" value={invite.email} onChangeText={(email) => setInvite((current) => ({ ...current, email }))} />
          <View style={styles.roles}>{roleOptions.map((role) => <Button key={role} label={role} variant={invite.role === role ? "primary" : "secondary"} onPress={() => setInvite((current) => ({ ...current, role }))} />)}</View>
          <Button label="Send invite" onPress={() => void sendInvite()} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, backgroundColor: colors.background },
  card: { marginBottom: spacing.sm, gap: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  title: { color: colors.slate, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
  muted: { color: colors.slateMid, fontSize: fontSizes.sm },
  roles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fab: { position: "absolute", right: spacing.xl, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  fabText: { color: colors.white, fontSize: 30, fontWeight: fontWeights.bold },
  modal: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
});
