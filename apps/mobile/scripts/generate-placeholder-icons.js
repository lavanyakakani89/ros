const sharp = require("sharp");
const path = require("path");

async function createIcon(filename, width, height, bg, text) {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${bg}"/>
      <text x="50%" y="50%" font-family="Arial" font-size="${Math.floor(width / 6)}"
        font-weight="bold" fill="white" text-anchor="middle"
        dominant-baseline="middle">${text}</text>
    </svg>`;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(__dirname, "../assets", filename));
  console.log("Created", filename);
}

async function main() {
  await createIcon("icon.png", 1024, 1024, "#0F6E56", "ROS");
  await createIcon("adaptive-icon.png", 1024, 1024, "#0F6E56", "R");
  await createIcon("splash.png", 1284, 2778, "#0F6E56", "BizBil");
  await createIcon("notification-icon.png", 96, 96, "#0F6E56", "R");
  console.log("All placeholder icons created. Replace with real assets before Play Store.");
}

main().catch(console.error);
