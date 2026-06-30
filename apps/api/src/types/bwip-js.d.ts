declare module "bwip-js" {
  interface BWIPJSOptions {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    textxalign?: string;
    backgroundcolor?: string;
  }

  export function toBuffer(options: BWIPJSOptions): Promise<Buffer>;

  const bwipjs: {
    toBuffer: typeof toBuffer;
  };

  export default bwipjs;
}
