import QRCode from "qrcode";

export async function generateQrDataUrl(payload: string) {
  return await QRCode.toDataURL(payload, {
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
