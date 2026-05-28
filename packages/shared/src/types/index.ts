export type TenantVertical =
  | "PHARMACY"
  | "GROCERY"
  | "FASHION"
  | "HARDWARE"
  | "ELECTRONICS"
  | "RESTAURANT";

export type UserRole = "OWNER" | "MANAGER" | "STAFF" | "DELIVERY";

export type InvoiceStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "PAID"
  | "PARTIAL"
  | "CANCELLED"
  | "PENDING_WHATSAPP";

export type PaymentMode = "CASH" | "UPI" | "CARD" | "CREDIT" | "NETBANKING";

export type InvoiceSource = "POS" | "WHATSAPP" | "MOBILE" | "WEB";

export type DeliveryStatus =
  | "PENDING"
  | "ASSIGNED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED";

export type VerticalFieldType =
  | "text"
  | "decimal"
  | "number"
  | "date"
  | "select"
  | "boolean";

export interface VerticalField {
  key: string;
  label: string;
  type: VerticalFieldType;
  required: boolean;
  options?: readonly string[];
  vertical?: boolean;
}

export interface VerticalModuleFlags {
  billing: boolean;
  inventory: boolean;
  delivery: boolean;
  payments: boolean;
  purchaseOrders: boolean;
  suppliers: boolean;
  reports: boolean;
  customers: boolean;
}

export interface VerticalNavigationItem {
  label: string;
  icon: string;
  href: string;
}

export interface VerticalConfig {
  vertical: TenantVertical;
  displayName: string;
  icon: string;
  modules: VerticalModuleFlags;
  productFields: readonly VerticalField[];
  batchFields?: readonly VerticalField[];
  billingFields: readonly VerticalField[];
  expiryAlerts?: {
    enabled: boolean;
    thresholds: readonly number[];
  };
  billTemplate: string;
  reportTemplates: readonly string[];
  navigation: readonly VerticalNavigationItem[];
}

export interface StoredUser {
  id?: string;
  tenantId?: string;
  name?: string;
  email?: string;
  role?: UserRole;
  storeId?: string | null;
}

export interface StoredAuthSession {
  user?: StoredUser;
}

export interface StoredTenant {
  id?: string;
  name: string;
  slug?: string;
  vertical?: TenantVertical | string;
  status?: string;
  gstEnabled?: boolean;
  gstNumber?: string | null;
}

export interface PosLine {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
  discount: number;
  gstRate: number;
  unit?: string;
  sku?: string;
  barcode?: string;
  stock?: number;
}

export interface CustomerResult {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  outstandingDue?: number;
  totalSpent?: number;
  lastVisitAt?: string | Date | null;
  [key: string]: unknown;
}
