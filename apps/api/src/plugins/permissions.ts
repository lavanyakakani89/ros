import { hasPermission, Permission as SharedPermissionValue, ROLE_PERMISSIONS, type Permission as SharedPermission } from "@retailos/shared";
import { UserRole } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";

export const Permission = SharedPermissionValue;
export { ROLE_PERMISSIONS, hasPermission };
export type Permission = SharedPermission;

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return hasPermission(role, permission);
}

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.isImpersonated) {
      return;
    }

    if (!roleHasPermission(request.user.role, permission)) {
      return reply.status(403).send({
        error: "Forbidden",
        code: request.user.role === UserRole.DELIVERY ? "DELIVERY_ROLE_RESTRICTED" : "INSUFFICIENT_PERMISSIONS",
        message: "Your role does not have permission to perform this action.",
        requiredPermission: permission,
      });
    }
  };
}
