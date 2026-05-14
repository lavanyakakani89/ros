import { WhatsappOrdersClient } from "@/components/whatsapp/whatsapp-orders-client";
import { PageHeader } from "@/components/shared/page-header";

export const metadata = { title: "WhatsApp Orders — RetailOS" };

export default function WhatsappOrdersPage() {
  return (
    <>
      <PageHeader eyebrow="WhatsApp" title="Inbound order review" />
      <WhatsappOrdersClient />
    </>
  );
}
