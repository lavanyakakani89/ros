import type { TenantVertical, VerticalConfig } from "@bizbil/shared";

import { electronicsConfig } from "./electronics.config.js";
import { fashionConfig } from "./fashion.config.js";
import { groceryConfig } from "./grocery.config.js";
import { hardwareConfig } from "./hardware.config.js";
import { pharmacyConfig } from "./pharmacy.config.js";
import { restaurantConfig } from "./restaurant.config.js";

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
