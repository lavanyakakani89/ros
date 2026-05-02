export type TenantVertical =
  | "PHARMACY"
  | "GROCERY"
  | "FASHION"
  | "HARDWARE"
  | "ELECTRONICS"
  | "RESTAURANT";

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
