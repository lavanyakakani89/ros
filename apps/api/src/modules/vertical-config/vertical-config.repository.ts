import type { TenantVertical, VerticalConfig } from "@bizbil/shared";
import { getVerticalConfig } from "@bizbil/vertical-configs";

export class VerticalConfigRepository {
  getByVertical(vertical: TenantVertical): VerticalConfig {
    return getVerticalConfig(vertical);
  }
}
