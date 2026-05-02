import { PageHeader } from "@/components/shared/page-header";
import { DeliveryBoard } from "@/components/delivery/delivery-board";

export default function DeliveryPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Delivery" title="Delivery board" />
      <DeliveryBoard />
    </div>
  );
}
