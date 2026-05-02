import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import { Queue, Worker } from "bullmq";

import { createQueueConnection } from "./connection.js";

type WhatsAppSocket = ReturnType<typeof makeWASocket>;

export interface WhatsAppNotifyJob {
  phone: string;
  message: string;
}

let socket: WhatsAppSocket | null = null;
let socketPromise: Promise<WhatsAppSocket> | null = null;

export const whatsappNotifyQueue = new Queue<WhatsAppNotifyJob>("whatsapp-notify", {
  connection: createQueueConnection(),
});

export function createWhatsappNotifyWorker() {
  return new Worker<WhatsAppNotifyJob>(
    "whatsapp-notify",
    async (job) => {
      await sendWhatsAppMessage(job.data.phone, job.data.message);
    },
    {
      connection: createQueueConnection(),
    },
  );
}

export async function sendWhatsAppMessage(phone: string, message: string): Promise<void> {
  const activeSocket = await getWhatsAppSocket();
  await activeSocket.sendMessage(`${phone.replace(/\D/g, "")}@s.whatsapp.net`, { text: message });
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
