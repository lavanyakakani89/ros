import type { UserRole } from "@prisma/client";

export const Permission = {
  AUDIT_VIEW: "audit:view",
  BILLING_CREATE: "billing:create",
  BILLING_VIEW: "billing:view",
  BILLING_CANCEL: "billing:cancel",
  BILLING_CUSTOMER_LEDGER: "billing:customer-ledger",
  CATEGORIES_VIEW: "categories:view",
  CATEGORIES_MANAGE: "categories:manage",
  COUPONS_APPLY: "coupons:apply",
  COUPONS_MANAGE: "coupons:manage",
  CREDIT_NOTES_MANAGE: "credit-notes:manage",
  CUSTOMERS_BASIC: "customers:basic",
  CUSTOMERS_IMPORT_EXPORT: "customers:import-export",
  DELIVERY_MANAGE: "delivery:manage",
  DELIVERY_MOBILE: "delivery:mobile",
  EXPENSES_ADD: "expenses:add",
  EXPENSES_DELETE: "expenses:delete",
  PRODUCT_CREATE: "inventory:manage",
  PRODUCT_EDIT: "inventory:manage",
  PRODUCT_DELETE: "inventory:manage",
  INVENTORY_VIEW: "inventory:view",
  INVENTORY_MANAGE: "inventory:manage",
  INVENTORY_IMPORT_EXPORT: "inventory:import-export",
  INVENTORY_STOCK_ADJUST: "inventory:stock-adjust",
  LOYALTY_USE: "loyalty:use",
  PAYMENTS_USE: "payments:use",
  PURCHASE_ORDERS_MANAGE: "purchase-orders:manage",
  QUOTATIONS_CREATE: "quotations:create",
  QUOTATIONS_MANAGE: "quotations:manage",
  REPORTS_VIEW: "reports:view",
  REPORTS_FINANCIAL: "reports:pnl",
  RESTAURANT_OPERATE: "restaurant:operate",
  SETTINGS_EDIT_PROFILE: "settings:tenant",
  SETTINGS_PASSWORD: "settings:password",
  SETTINGS_VIEW: "settings:view",
  SETTINGS_USERS: "settings:users",
  SETTINGS_MANAGE_USERS: "settings:users",
  SETTINGS_TEMPLATES: "settings:templates",
  SETTINGS_PRINTER: "settings:printer",
  SUPPLIERS_MANAGE: "suppliers:manage",
  WHATSAPP_ORDERS: "whatsapp:orders",
  WHATSAPP_SETUP: "whatsapp:setup",
} as const;

export type Permission = typeof Permission[keyof typeof Permission];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  OWNER: Object.values(Permission),
  MANAGER: Object.values(Permission).filter((permission) => !(new Set<Permission>([
    Permission.REPORTS_FINANCIAL,
    Permission.SETTINGS_EDIT_PROFILE,
    Permission.WHATSAPP_SETUP,
  ])).has(permission)),
  STAFF: [
    Permission.BILLING_CREATE,
    Permission.BILLING_VIEW,
    Permission.CATEGORIES_VIEW,
    Permission.COUPONS_APPLY,
    Permission.CUSTOMERS_BASIC,
    Permission.EXPENSES_ADD,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_STOCK_ADJUST,
    Permission.LOYALTY_USE,
    Permission.PAYMENTS_USE,
    Permission.QUOTATIONS_CREATE,
    Permission.RESTAURANT_OPERATE,
    Permission.SETTINGS_PASSWORD,
  ],
  DELIVERY: [
    Permission.DELIVERY_MOBILE,
    Permission.SETTINGS_PASSWORD,
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
