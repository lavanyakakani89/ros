declare module "@node-escpos/core" {
  export class Printer {
    constructor(device: unknown);
    image(buffer: Buffer, density?: string): Promise<void>;
    feed(lines: number): Promise<void>;
    cut(): Promise<void>;
    close(): Promise<void>;
  }
}

declare module "@node-escpos/usb-adapter" {
  export default class USB {
    open(): Promise<void>;
    close(): Promise<void>;
  }
}
