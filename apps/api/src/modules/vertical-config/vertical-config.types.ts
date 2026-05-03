import type { VerticalConfig } from "@retailos/shared";

export interface CurrentVerticalConfigResponse {
  tenantId: string;
  tenant: {
    name: string;
    slug: string;
    status: string;
  };
  config: VerticalConfig;
}
