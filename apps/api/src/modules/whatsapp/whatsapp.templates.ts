import type { FastifyInstance } from "fastify";

export const WHATSAPP_TEMPLATE_DEFINITIONS = [
  {
    key: "invoiceReady",
    label: "Invoice confirmation",
    description: "Used when sharing or confirming an invoice.",
    placeholders: ["customerName", "tenantName", "invoiceNumber", "grandTotal", "paymentMode", "itemsBlock", "pdfLine"],
    defaultBody: [
      "Hi {{customerName}},",
      "Your invoice {{invoiceNumber}} from {{tenantName}} is ready.",
      "Total: ₹{{grandTotal}}.",
      "Payment: {{paymentMode}}.",
      "{{itemsBlock}}",
      "{{pdfLine}}",
    ].join("\n"),
  },
  {
    key: "paymentReminder",
    label: "Payment reminder",
    description: "Used from the Payments page for outstanding dues.",
    placeholders: ["customerName", "tenantName", "invoiceNumber", "amountDue", "grandTotal"],
    defaultBody: [
      "Hi {{customerName}},",
      "Payment reminder from {{tenantName}} for invoice {{invoiceNumber}}.",
      "Due amount: ₹{{amountDue}}.",
      "Please share the screenshot once the payment is done.  Thank you!",
    ].join("\n"),
  },
  {
    key: "deliveryOutForDelivery",
    label: "Delivery out for delivery",
    description: "Used when an order moves to out for delivery.",
    placeholders: ["customerName", "tenantName", "invoiceNumber", "grandTotal", "deliveryAddress"],
    defaultBody: [
      "Hi {{customerName}},",
      "Your order {{invoiceNumber}} from {{tenantName}} is out for delivery.",
      "Total: ₹{{grandTotal}}.",
      "Delivery address: {{deliveryAddress}}",
    ].join("\n"),
  },
  {
    key: "deliveryDelivered",
    label: "Delivery delivered",
    description: "Used when an order is marked delivered.",
    placeholders: ["customerName", "tenantName", "invoiceNumber", "grandTotal"],
    defaultBody: [
      "Hi {{customerName}},",
      "Your order {{invoiceNumber}} from {{tenantName}} has been delivered.",
      "Thank you.",
    ].join("\n"),
  },
  {
    key: "deliveryAssigned",
    label: "Delivery person assignment",
    description: "Used when a delivery person is assigned an order.",
    placeholders: ["invoiceNumber", "customerName", "grandTotal", "deliveryAddress"],
    defaultBody: "RetailOS: delivery assigned for {{invoiceNumber}}. Customer: {{customerName}}. Amount: ₹{{grandTotal}}. Address: {{deliveryAddress}}",
  },
  {
    key: "whatsappTest",
    label: "WhatsApp test",
    description: "Used by the Test message button in WhatsApp settings.",
    placeholders: ["tenantName"],
    defaultBody: "RetailOS WhatsApp test from {{tenantName}}. If you received this, WhatsApp Business is connected.",
  },
] as const;

export const WHATSAPP_TEMPLATE_KEYS = WHATSAPP_TEMPLATE_DEFINITIONS.map((definition) => definition.key) as [
  "invoiceReady",
  "paymentReminder",
  "deliveryOutForDelivery",
  "deliveryDelivered",
  "deliveryAssigned",
  "whatsappTest",
];

export type WhatsappTemplateKey = (typeof WHATSAPP_TEMPLATE_KEYS)[number];

export interface WhatsappMessageTemplateInput {
  key: WhatsappTemplateKey;
  body: string;
}

export type WhatsappTemplateContext = Record<string, string | number | null | undefined>;

export async function getWhatsappMessageTemplates(fastify: FastifyInstance, tenantId: string) {
  const records = await fastify.prisma.whatsappMessageTemplate.findMany({
    where: {
      tenantId,
    },
  });
  const bodyByKey = new Map(records.map((record) => [record.key, record.body]));

  return {
    templates: WHATSAPP_TEMPLATE_DEFINITIONS.map((definition) => {
      const body = bodyByKey.get(definition.key) ?? definition.defaultBody;
      return {
        ...definition,
        body,
      };
    }),
  };
}

export async function saveWhatsappMessageTemplates(
  fastify: FastifyInstance,
  tenantId: string,
  templates: WhatsappMessageTemplateInput[],
) {
  await fastify.prisma.$transaction(
    templates.map((template) =>
      fastify.prisma.whatsappMessageTemplate.upsert({
        where: {
          tenantId_key: {
            tenantId,
            key: template.key,
          },
        },
        create: {
          tenantId,
          key: template.key,
          body: template.body,
        },
        update: {
          body: template.body,
        },
      }),
    ),
  );

  return getWhatsappMessageTemplates(fastify, tenantId);
}

export async function renderWhatsappMessageTemplate(
  fastify: FastifyInstance,
  tenantId: string,
  key: WhatsappTemplateKey,
  context: WhatsappTemplateContext,
): Promise<string> {
  const record = await fastify.prisma.whatsappMessageTemplate.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key,
      },
    },
  });
  const definition = WHATSAPP_TEMPLATE_DEFINITIONS.find((template) => template.key === key);
  const body = record?.body ?? definition?.defaultBody ?? "";
  return renderWhatsappTemplateBody(body, context);
}

export function renderWhatsappTemplateBody(body: string, context: WhatsappTemplateContext): string {
  return body
    .replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => formatTemplateValue(context[key]))
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line, index, lines) => line.trim() || !isBlankLineAroundBlank(lines, index))
    .join("\n")
    .trim();
}

export function moneyForWhatsapp(value: string | number | { toNumber(): number } | null | undefined): string {
  const amount = typeof value === "object" && value && "toNumber" in value ? value.toNumber() : Number(value ?? 0);
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTemplateValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function isBlankLineAroundBlank(lines: string[], index: number): boolean {
  const previousBlank = index > 0 && !lines[index - 1]?.trim();
  const nextBlank = index < lines.length - 1 && !lines[index + 1]?.trim();
  return previousBlank || nextBlank;
}
