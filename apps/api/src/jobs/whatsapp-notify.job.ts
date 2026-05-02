import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import { Queue, Worker } from "bullmq";

import { createQueueConnection } from "./connection.js";

export interface WhatsAppNotifyJob {
  phone: string;
  message: string;
}

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
  const sessionPath = process.env.WHATSAPP_SESSION_PATH ?? "./whatsapp-session";
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  socket.ev.on("creds.update", saveCreds);
  await socket.sendMessage(`${phone.replace(/\D/g, "")}@s.whatsapp.net`, { text: message });
}
