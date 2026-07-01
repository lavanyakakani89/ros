import QRCode from "qrcode";

export async function generateQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    width: 400,
    margin: 1,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
}
