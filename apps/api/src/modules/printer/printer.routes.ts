import { PaperSize, PrinterConn } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply } from "fastify";
import { z } from "zod";

import { testPrinterForTenant } from "./printer.service.js";

const printerSchema = z.object({
  connectionType: z.nativeEnum(PrinterConn),
  paperSize: z.nativeEnum(PaperSize),
  networkIp: z.string().trim().min(3).optional().nullable(),
  networkPort: z.coerce.number().int().positive().max(65535).optional().nullable(),
  printNodeApiKey: z.string().trim().optional().nullable(),
  printNodePrinterId: z.string().trim().optional().nullable(),
  bluetoothDeviceId: z.string().trim().optional().nullable(),
  bluetoothDeviceName: z.string().trim().optional().nullable(),
  localPrinterName: z.string().trim().optional().nullable(),
  localAgentUrl: z.string().trim().url().optional().nullable(),
  isActive: z.coerce.boolean().default(true),
});

const bluetoothPairSchema = z.object({
  deviceId: z.string().trim().min(1),
  deviceName: z.string().trim().min(1),
});

export const printerRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/printer", async (request) => {
    const printer = await fastify.prisma.printerConfig.findUnique({
      where: {
        tenantId: request.tenant.id,
      },
    });

    return {
      printer,
    };
  });

  fastify.put("/api/printer", async (request) => {
    const input = printerSchema.parse(request.body);
    const printerData = {
      connectionType: input.connectionType,
      paperSize: input.paperSize,
      networkIp: input.networkIp ?? null,
      networkPort: input.networkPort ?? null,
      printNodeApiKey: input.printNodeApiKey ?? null,
      printNodePrinterId: input.printNodePrinterId ?? null,
      bluetoothDeviceId: input.bluetoothDeviceId ?? null,
      bluetoothDeviceName: input.bluetoothDeviceName ?? null,
      localPrinterName: input.localPrinterName ?? null,
      localAgentUrl: input.localAgentUrl ?? "http://127.0.0.1:9211",
      isActive: input.isActive,
    };
    const printer = await fastify.prisma.printerConfig.upsert({
      where: {
        tenantId: request.tenant.id,
      },
      create: {
        tenantId: request.tenant.id,
        ...printerData,
      },
      update: printerData,
    });

    return {
      printer,
    };
  });

  fastify.post("/api/printer/test", async (request, reply) => {
    return handlePrinter(reply, () => testPrinterForTenant({ fastify, tenant: request.tenant }));
  });

  fastify.post("/api/printer/bluetooth-pair", async (request) => {
    const input = bluetoothPairSchema.parse(request.body);
    const printer = await fastify.prisma.printerConfig.upsert({
      where: {
        tenantId: request.tenant.id,
      },
      create: {
        tenantId: request.tenant.id,
        connectionType: PrinterConn.BLUETOOTH,
        paperSize: PaperSize.THERMAL_3,
        bluetoothDeviceId: input.deviceId,
        bluetoothDeviceName: input.deviceName,
      },
      update: {
        connectionType: PrinterConn.BLUETOOTH,
        bluetoothDeviceId: input.deviceId,
        bluetoothDeviceName: input.deviceName,
        isActive: true,
      },
    });

    return {
      printer,
    };
  });

  done();
};

async function handlePrinter<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    return reply.status(502).send({
      error: error instanceof Error ? error.message : "Printer operation failed",
    });
  }
}
