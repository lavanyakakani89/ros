import type { Tenant } from "@prisma/client";

import { VerticalConfigRepository } from "./vertical-config.repository.js";
import type { CurrentVerticalConfigResponse } from "./vertical-config.types.js";

export class VerticalConfigService {
  private readonly repository = new VerticalConfigRepository();

  getCurrentTenantConfig(tenant: Tenant): CurrentVerticalConfigResponse {
    return {
      tenantId: tenant.id,
      config: this.repository.getByVertical(tenant.vertical),
    };
  }
}
