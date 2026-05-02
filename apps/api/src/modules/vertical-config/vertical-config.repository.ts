import type { TenantVertical, VerticalConfig } from "@retailos/shared";
import { getVerticalConfig } from "@retailos/vertical-configs";

export class VerticalConfigRepository {
  getByVertical(vertical: TenantVertical): VerticalConfig {
    return getVerticalConfig(vertical);
  }
}
