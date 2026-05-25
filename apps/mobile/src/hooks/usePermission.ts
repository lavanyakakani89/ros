import { useEffect } from "react";
import { useRouter } from "expo-router";
import { hasPermission, type Permission, type UserRole } from "@retailos/shared";

import { useAuthStore } from "../stores/auth-store";

export function usePermission(permission: Permission): boolean {
  const role = useAuthStore((state) => state.user?.role) as UserRole | undefined;
  if (!role) return false;
  return hasPermission(role, permission);
}

export function useRequirePermission(permission: Permission): void {
  const allowed = usePermission(permission);
  const router = useRouter();

  useEffect(() => {
    if (!allowed) router.replace("/(app)");
  }, [allowed, router]);
}
