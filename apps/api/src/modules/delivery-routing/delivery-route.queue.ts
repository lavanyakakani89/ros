import { Queue } from "bullmq";

import { createQueueConnection } from "../../jobs/connection.js";

export interface DeliveryRouteJob {
  routePlanId: string;
  pollCount?: number | undefined;
}

export const deliveryRouteQueue = new Queue<DeliveryRouteJob>("delivery-route", {
  connection: createQueueConnection(),
});
