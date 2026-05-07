import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";

import { createQueueConnection } from "./connection.js";

type WhatsAppSocket = ReturnType<typeof makeWASocket>;

export interface WhatsAppNotifyJob {
  tenantId?: string;
  whatsappMessageId?: string;
  phone: string;
  message: string;
}

let socket: WhatsAppSocket | null = null;
let socketPromise: Promise<WhatsAppSocket> | null = null;

export const whatsappNotifyQueue = new Queue<WhatsAppNotifyJob>("whatsapp-notify", {
  connection: createQueueConnection(),
});

export function createWhatsappNotifyWorker() {
  const prisma = new PrismaClient();

  return new Worker<WhatsAppNotifyJob>(
    "whatsapp-notify",
    async (job) => {
      try {
        await sendWhatsAppMessage(job.data.phone, job.data.message);
        if (job.data.whatsappMessageId) {
          await prisma.whatsappMessage.update({
            where: {
              id: job.data.whatsappMessageId,
            },
            data: {
              status: "SENT",
              sentAt: new Date(),
            },
          });
        }
      } catch (error) {
        if (job.data.whatsappMessageId) {
          await prisma.whatsappMessage.update({
            where: {
              id: job.data.whatsappMessageId,
            },
            data: {
              status: "FAILED",
              error: error instanceof Error ? error.message : "WhatsApp send failed",
            },
          }).catch(() => undefined);
        }

        throw error;
      }
    },
    {
      connection: createQueueConnection(),
    },
  );
}

export async function sendWhatsAppMessage(phone: string, message: string): Promise<void> {
  if (process.env.WHATSAPP_CLOUD_ACCESS_TOKEN && process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID) {
    await sendCloudApiWhatsAppMessage(phone, message);
    return;
  }

  const activeSocket = await getWhatsAppSocket();
  await activeSocket.sendMessage(`${phone.replace(/\D/g, "")}@s.whatsapp.net`, { text: message });
}

async function sendCloudApiWhatsAppMessage(phone: string, message: string): Promise<void> {
  const apiVersion = process.env.WHATSAPP_CLOUD_API_VERSION ?? "v23.0";
  const phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error("WhatsApp Cloud API credentials are not configured");
  }

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: formatCloudApiPhone(phone),
      type: "text",
      text: {
        preview_url: true,
        body: message,
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`WhatsApp Cloud API rejected message (${String(response.status)}): ${details.slice(0, 200)}`);
  }
}

function formatCloudApiPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }

  return digits;
}

async function getWhatsAppSocket(): Promise<WhatsAppSocket> {
  if (socket) {
    return socket;
  }

  socketPromise ??= createWhatsAppSocket();
  socket = await socketPromise;
  return socket;
}

async function createWhatsAppSocket(): Promise<WhatsAppSocket> {
  const sessionPath = process.env.WHATSAPP_SESSION_PATH ?? "./whatsapp-session";
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const nextSocket = makeWASocket({
    auth: state,
    printQRInTerminal: process.env.WHATSAPP_PRINT_QR === "true",
  });

  nextSocket.ev.on("creds.update", saveCreds);
  nextSocket.ev.on("connection.update", (update) => {
    if (update.connection === "close") {
      socket = null;
      socketPromise = null;
    }
  });

  return nextSocket;
}
