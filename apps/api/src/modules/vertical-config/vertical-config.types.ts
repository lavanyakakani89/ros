import type { UserRole, VerticalConfig } from "@retailos/shared";

export interface CurrentVerticalConfigResponse {
  tenantId: string;
  tenant: {
    name: string;
    slug: string;
    status: string;
    gstEnabled: boolean;
    gstNumber?: string | null;
    logoUrl?: string | null;
  };
  config: VerticalConfig;
  user?: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    role: UserRole;
    storeId?: string | null;
  } | null;
}
