import type { VerticalConfig } from "@retailos/shared";

export interface CurrentVerticalConfigResponse {
  tenantId: string;
  tenant: {
    name: string;
    slug: string;
  };
  config: VerticalConfig;
}
