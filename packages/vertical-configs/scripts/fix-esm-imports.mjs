import { readFile, writeFile } from "node:fs/promises";

const indexPath = new URL("../dist/packages/vertical-configs/src/index.js", import.meta.url);
const source = await readFile(indexPath, "utf8");
const fixed = source.replaceAll(/from "(\.\/[^"]+\.config)"/g, 'from "$1.js"');

await writeFile(indexPath, fixed);
