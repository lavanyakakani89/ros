declare module "react-native-bluetooth-escpos-printer" {
  const BluetoothEscposPrinter: {
    ALIGN: { LEFT: number; CENTER: number; RIGHT: number };
    printerInit(): Promise<void>;
    printerAlign(align: number): Promise<void>;
    setBlob(weight: number): Promise<void>;
    printText(text: string, options: Record<string, unknown>): Promise<void>;
    printAndFeed(lines: number): Promise<void>;
    cutOnePoint?(): Promise<void>;
    cutPaper(): Promise<void>;
    getDeviceList(): Promise<unknown[]>;
  };
  export default BluetoothEscposPrinter;
}
