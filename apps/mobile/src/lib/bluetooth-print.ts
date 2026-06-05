import * as SecureStore from "expo-secure-store";
import { Platform, ToastAndroid } from "react-native";
import { formatCurrency, formatDate, numberToWords } from "@bizbil/shared";

const PRINTER_KEY = "bizbil.printer_device_id";

declare const require: (moduleName: string) => unknown;

interface BluetoothEscposPrinterModule {
  ALIGN: { LEFT: number; CENTER: number; RIGHT: number };
  printerInit: () => Promise<void>;
  printerAlign: (align: number) => Promise<void>;
  setBlob: (enabled: number) => Promise<void>;
  printText: (text: string, options: Record<string, unknown>) => Promise<void>;
  printAndFeed: (lines: number) => Promise<void>;
  cutOnePoint?: () => Promise<void>;
  cutPaper: () => Promise<void>;
  getDeviceList: () => Promise<Array<{ address?: string; id?: string; name?: string }>>;
}

function getBluetoothEscposPrinter(): BluetoothEscposPrinterModule {
  const printerPackage = require("react-native-bluetooth-escpos-printer") as {
    BluetoothEscposPrinter?: BluetoothEscposPrinterModule;
    default?: BluetoothEscposPrinterModule;
  };
  const printer = printerPackage.BluetoothEscposPrinter ?? printerPackage.default;
  if (!printer) {
    throw new Error("Printer not connected");
  }
  return printer;
}

export interface PrintableInvoice {
  invoiceNumber: string;
  invoiceDate: string | Date;
  customer?: { name?: string; phone?: string; address?: string };
  items: Array<{ name: string; quantity: number; price: number; amount: number }>;
  grandTotal: number;
  paymentMode: string;
  discountAmount?: number;
  totalCgst?: number;
  totalSgst?: number;
  totalDiscount?: number;
}

export interface PrintConfig {
  shopName: string;
  address?: string;
  phone?: string;
  fssai?: string;
  fssaiNumber?: string;
  gstEnabled?: boolean;
  gstNumber?: string;
  footerNote?: string;
  thankYouMessage?: string;
}

export async function printReceipt(invoice: PrintableInvoice, config: PrintConfig): Promise<void> {
  const deviceId = await getDefaultPrinter();
  if (!deviceId) throw new Error("Printer not connected");

  const separator = "-".repeat(48);
  const totalQty = invoice.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const discount = invoice.totalDiscount ?? invoice.discountAmount ?? 0;

  try {
    const BluetoothEscposPrinter = getBluetoothEscposPrinter();
    await BluetoothEscposPrinter.printerInit();
    await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
    await BluetoothEscposPrinter.setBlob(1);
    await BluetoothEscposPrinter.printText(`${config.shopName}\n`, {});
    await BluetoothEscposPrinter.setBlob(0);
    if (config.address) await BluetoothEscposPrinter.printText(`${config.address}\n`, {});
    if (config.phone) await BluetoothEscposPrinter.printText(`${config.phone}\n`, {});
    if (config.fssaiNumber ?? config.fssai) await BluetoothEscposPrinter.printText(`FSSAI: ${config.fssaiNumber ?? config.fssai}\n`, {});
    if (config.gstEnabled && config.gstNumber) await BluetoothEscposPrinter.printText(`GSTIN: ${config.gstNumber}\n`, {});
    await BluetoothEscposPrinter.printText(`${separator}\n`, {});

    await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.LEFT);
    await BluetoothEscposPrinter.printText(`Inv No: ${invoice.invoiceNumber}  Date: ${formatDate(invoice.invoiceDate)}\n`, {});
    if (invoice.customer?.name) await BluetoothEscposPrinter.printText(`Customer: ${invoice.customer.name}\n`, {});
    if (invoice.customer?.phone) await BluetoothEscposPrinter.printText(`Phone: ${invoice.customer.phone}\n`, {});
    if (invoice.customer?.address) await BluetoothEscposPrinter.printText(`Address: ${invoice.customer.address}\n`, {});
    await BluetoothEscposPrinter.printText(`${separator}\n`, {});
    await BluetoothEscposPrinter.printText("SR | Item | Qty | Price | Amt\n", {});

    for (const [index, item] of invoice.items.entries()) {
      await BluetoothEscposPrinter.printText(`${String(index + 1)} | ${item.name}\n`, {});
      await BluetoothEscposPrinter.printText(`   | ${String(item.quantity)} | ${formatCurrency(item.price)} | ${formatCurrency(item.amount)}\n`, {});
    }

    await BluetoothEscposPrinter.printText(`${separator}\n`, {});
    await BluetoothEscposPrinter.printText(`Items: ${String(invoice.items.length)}  QTY: ${String(totalQty)}  AMOUNT: ${formatCurrency(invoice.grandTotal)}\n`, {});
    if (discount > 0) await BluetoothEscposPrinter.printText(`DISC AMOUNT: ${formatCurrency(discount)}\n`, {});
    if (config.gstEnabled) {
      await BluetoothEscposPrinter.printText(`CGST: ${formatCurrency(invoice.totalCgst ?? 0)}\n`, {});
      await BluetoothEscposPrinter.printText(`SGST: ${formatCurrency(invoice.totalSgst ?? 0)}\n`, {});
    }
    await BluetoothEscposPrinter.printText(`${separator}\n`, {});
    await BluetoothEscposPrinter.setBlob(1);
    await BluetoothEscposPrinter.printText(`GRAND TOTAL ${formatCurrency(invoice.grandTotal)}\n`, {});
    await BluetoothEscposPrinter.setBlob(0);
    await BluetoothEscposPrinter.printText(`${separator}\n`, {});
    await BluetoothEscposPrinter.printText(`${numberToWords(invoice.grandTotal)} Only\n`, {});
    await BluetoothEscposPrinter.printText(`Payment: ${invoice.paymentMode}\n`, {});
    if (config.footerNote) await BluetoothEscposPrinter.printText(`${config.footerNote}\n`, { underline: true });
    await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
    await BluetoothEscposPrinter.printText(`${config.thankYouMessage ?? "Thank you"}\n`, {});
    await BluetoothEscposPrinter.printAndFeed(4);
    if (BluetoothEscposPrinter.cutOnePoint) {
      await BluetoothEscposPrinter.cutOnePoint();
    } else {
      await BluetoothEscposPrinter.cutPaper();
    }
  } catch (error) {
    if (Platform.OS === "android") {
      ToastAndroid.show("Printing failed. Check printer connection.", ToastAndroid.LONG);
    }
    throw error instanceof Error ? error : new Error("Printing failed");
  }
}

export async function getPairedDevices(): Promise<{ id: string; name: string }[]> {
  const BluetoothEscposPrinter = getBluetoothEscposPrinter();
  const devices = await BluetoothEscposPrinter.getDeviceList();
  return devices.map((device) => ({
    id: device.address ?? device.id ?? "",
    name: device.name ?? "Bluetooth printer",
  }));
}

export async function setDefaultPrinter(deviceId: string): Promise<void> {
  await SecureStore.setItemAsync(PRINTER_KEY, deviceId);
}

export async function getDefaultPrinter(): Promise<string | null> {
  return SecureStore.getItemAsync(PRINTER_KEY);
}
