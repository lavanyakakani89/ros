import type { TenantVertical, VerticalConfig } from "@retailos/shared";

import { electronicsConfig } from "./electronics.config";
import { fashionConfig } from "./fashion.config";
import { groceryConfig } from "./grocery.config";
import { hardwareConfig } from "./hardware.config";
import { pharmacyConfig } from "./pharmacy.config";
import { restaurantConfig } from "./restaurant.config";

export { electronicsConfig, fashionConfig, groceryConfig, hardwareConfig, pharmacyConfig, restaurantConfig };

export const verticalConfigs = {
  PHARMACY: pharmacyConfig,
  GROCERY: groceryConfig,
  FASHION: fashionConfig,
  HARDWARE: hardwareConfig,
  ELECTRONICS: electronicsConfig,
  RESTAURANT: restaurantConfig,
} satisfies Record<TenantVertical, VerticalConfig>;

export function getVerticalConfig(vertical: TenantVertical): VerticalConfig {
  return verticalConfigs[vertical];
}
