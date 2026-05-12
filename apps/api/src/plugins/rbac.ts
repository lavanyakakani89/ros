import { UserRole } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";

type Permission =
  | "audit:view"
  | "billing:create"
  | "billing:view"
  | "billing:cancel"
  | "billing:customer-ledger"
  | "categories:view"
  | "categories:manage"
  | "coupons:apply"
  | "coupons:manage"
  | "credit-notes:manage"
  | "customers:basic"
  | "customers:import-export"
  | "delivery:manage"
  | "delivery:mobile"
  | "expenses:add"
  | "expenses:delete"
  | "inventory:view"
  | "inventory:manage"
  | "inventory:import-export"
  | "inventory:stock-adjust"
  | "loyalty:use"
  | "payments:use"
  | "purchase-orders:manage"
  | "quotations:create"
  | "quotations:manage"
  | "reports:view"
  | "reports:pnl"
  | "restaurant:operate"
  | "settings:password"
  | "settings:view"
  | "settings:tenant"
  | "settings:users"
  | "settings:templates"
  | "settings:printer"
  | "suppliers:manage"
  | "whatsapp:orders"
  | "whatsapp:setup";

const ownerPermissions: Permission[] = [
  "audit:view",
  "billing:create",
  "billing:view",
  "billing:cancel",
  "billing:customer-ledger",
  "categories:view",
  "categories:manage",
  "coupons:apply",
  "coupons:manage",
  "credit-notes:manage",
  "customers:basic",
  "customers:import-export",
  "delivery:manage",
  "delivery:mobile",
  "expenses:add",
  "expenses:delete",
  "inventory:view",
  "inventory:manage",
  "inventory:import-export",
  "inventory:stock-adjust",
  "loyalty:use",
  "payments:use",
  "purchase-orders:manage",
  "quotations:create",
  "quotations:manage",
  "reports:view",
  "reports:pnl",
  "restaurant:operate",
  "settings:password",
  "settings:view",
  "settings:tenant",
  "settings:users",
  "settings:templates",
  "settings:printer",
  "suppliers:manage",
  "whatsapp:orders",
  "whatsapp:setup",
];

const managerPermissions: Permission[] = ownerPermissions.filter((permission) => ![
  "reports:pnl",
  "settings:tenant",
  "whatsapp:setup",
].includes(permission));

const staffPermissions: Permission[] = [
  "billing:create",
  "billing:view",
  "categories:view",
  "coupons:apply",
  "customers:basic",
  "expenses:add",
  "inventory:view",
  "inventory:stock-adjust",
  "loyalty:use",
  "payments:use",
  "quotations:create",
  "restaurant:operate",
  "settings:password",
];

const deliveryPermissions: Permission[] = [
  "delivery:mobile",
  "settings:password",
];

const permissionsByRole: Record<UserRole, Set<Permission>> = {
  [UserRole.OWNER]: new Set(ownerPermissions),
  [UserRole.MANAGER]: new Set(managerPermissions),
  [UserRole.STAFF]: new Set(staffPermissions),
  [UserRole.DELIVERY]: new Set(deliveryPermissions),
};

export function enforceRbac(request: FastifyRequest, reply: FastifyReply) {
  if (request.isImpersonated) {
    return;
  }

  const role = request.user?.role;
  if (!role) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const permission = requiredPermission(request.method, request.url);
  if (!permission) {
    return;
  }

  if (!permissionsByRole[role].has(permission)) {
    return reply.status(403).send({
      error: "Forbidden",
      code: role === UserRole.DELIVERY ? "DELIVERY_ROLE_RESTRICTED" : "INSUFFICIENT_PERMISSIONS",
      message: "Your role does not have permission to perform this action.",
      requiredPermission: permission,
    });
  }

  return undefined;
}

export function canRoleAccess(role: UserRole, method: string, url: string): boolean {
  const permission = requiredPermission(method, url);
  return permission ? permissionsByRole[role].has(permission) : true;
}

export function requiredPermission(method: string, url: string): Permission | undefined {
  const verb = method.toUpperCase();
  const path = url.split("?")[0] ?? url;

  if (path === "/api/vertical-config/current") return undefined;
  if (path === "/api/settings/password") return "settings:password";

  if (path.startsWith("/api/audit-logs")) return "audit:view";

  if (path.startsWith("/api/billing/customer-ledger")) return "billing:customer-ledger";
  if (path.startsWith("/api/billing/invoices")) {
    if (path.endsWith("/cancel")) return "billing:cancel";
    if (verb === "POST" && path === "/api/billing/invoices") return "billing:create";
    if (verb === "PUT") return "billing:create";
    return "billing:view";
  }

  if (path.startsWith("/api/categories")) {
    return verb === "GET" ? "categories:view" : "categories:manage";
  }

  if (path.startsWith("/api/coupons/validate")) return "coupons:apply";
  if (path.startsWith("/api/coupons")) {
    return verb === "GET" ? "coupons:apply" : "coupons:manage";
  }

  if (path.startsWith("/api/credit-notes")) return "credit-notes:manage";

  if (path.startsWith("/api/customers/template") || path.startsWith("/api/customers/export") || path.startsWith("/api/customers/import")) {
    return "customers:import-export";
  }
  if (path.startsWith("/api/customers")) return "customers:basic";

  if (path === "/api/delivery/me" || path === "/api/delivery/mobile/sync" || path === "/api/delivery/me/notifications") {
    return "delivery:mobile";
  }
  if (path.startsWith("/api/delivery/notifications/") && path.endsWith("/read")) return "delivery:mobile";
  if (path === "/api/delivery/location-pings") return "delivery:mobile";
  if (path.startsWith("/api/delivery/") && (
    path.endsWith("/status") ||
    path.endsWith("/location") ||
    path.includes("/proofs")
  )) {
    return "delivery:mobile";
  }
  if (verb === "GET" && isDeliveryDetailRoute(path)) return "delivery:mobile";
  if (path.startsWith("/api/delivery")) return "delivery:manage";

  if (path.startsWith("/api/expenses")) {
    return verb === "DELETE" ? "expenses:delete" : "expenses:add";
  }

  if (path.startsWith("/api/inventory/products/template") || path.startsWith("/api/inventory/products/export") || path.startsWith("/api/inventory/products/import")) {
    return "inventory:import-export";
  }
  if (path === "/api/inventory/stock-adjustment" || (path.startsWith("/api/inventory/products/") && path.endsWith("/batches") && verb === "POST")) {
    return "inventory:stock-adjust";
  }
  if (path.startsWith("/api/inventory/products")) {
    return verb === "GET" ? "inventory:view" : "inventory:manage";
  }

  if (path.startsWith("/api/loyalty")) return "loyalty:use";
  if (path.startsWith("/api/payments")) return "payments:use";
  if (path.startsWith("/api/purchase-orders") || path.startsWith("/api/purchase-returns")) return "purchase-orders:manage";

  if (path.startsWith("/api/quotations")) {
    if (verb === "POST" && path === "/api/quotations") return "quotations:create";
    if (verb === "GET") return "quotations:create";
    return "quotations:manage";
  }

  if (path.startsWith("/api/reports/pnl") || path.startsWith("/api/reports/pl")) return "reports:pnl";
  if (path.startsWith("/api/reports")) return "reports:view";

  if (path.startsWith("/api/restaurant")) return "restaurant:operate";

  if (path === "/api/settings/current") return "settings:view";
  if (path === "/api/settings/tenant") return "settings:tenant";
  if (path.startsWith("/api/settings/users")) return "settings:users";
  if (path.startsWith("/api/templates")) return "settings:templates";
  if (path.startsWith("/api/printer")) return "settings:printer";

  if (path.startsWith("/api/suppliers")) return "suppliers:manage";

  if (path === "/api/whatsapp/orders" || path === "/api/whatsapp/orders/paste") return "whatsapp:orders";
  if (path.startsWith("/api/whatsapp")) return "whatsapp:setup";

  if (path.startsWith("/api/import-export")) return "inventory:import-export";

  return "settings:tenant";
}

function isDeliveryDetailRoute(path: string): boolean {
  if (path === "/api/delivery") {
    return false;
  }

  if (path.startsWith("/api/delivery/agent/") || path.startsWith("/api/delivery/routes/")) {
    return false;
  }

  const segments = path.split("/").filter(Boolean);
  return segments.length === 3 && segments[0] === "api" && segments[1] === "delivery";
}
