const path = require("path");
const { resolveWorkspacePackage } = require("./resolve-workspace-package");
const sharp = require(resolveWorkspacePackage("sharp"));

const assetsDir = path.join(__dirname, "../assets");
const webPublicDir = path.join(__dirname, "../../web/public");
const iconSvg = path.join(webPublicDir, "icons", "icon.svg");
const wordmarkPng = path.join(webPublicDir, "bizbil-landing", "icons", "bizbil-wordmark.png");

async function createIcon() {
  await sharp(iconSvg)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, "icon.png"));
  console.log("Created icon.png");
}

async function createAdaptiveIcon() {
  const foreground = await sharp(iconSvg)
    .resize(860, 860)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: foreground, gravity: "center" }])
    .png()
    .toFile(path.join(assetsDir, "adaptive-icon.png"));
  console.log("Created adaptive-icon.png");
}

async function createSplash() {
  const wordmark = await sharp(wordmarkPng)
    .resize({ width: 720 })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 1284,
      height: 2778,
      channels: 4,
      background: "#0F6E56",
    },
  })
    .composite([{ input: wordmark, gravity: "center" }])
    .png()
    .toFile(path.join(assetsDir, "splash.png"));
  console.log("Created splash.png");
}

async function createNotificationIcon() {
  const svg = `
    <svg width="96" height="96" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
      <path fill="#ffffff" d="M21 24h54v12H21zM21 43h54v11H21zM21 61h24v14H21zM58 61h17v14H58z"/>
    </svg>`;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(assetsDir, "notification-icon.png"));
  console.log("Created notification-icon.png");
}

async function main() {
  await createIcon();
  await createAdaptiveIcon();
  await createSplash();
  await createNotificationIcon();
  console.log("Generated BizBil mobile assets from checked-in brand sources.");
}

main().catch(console.error);
