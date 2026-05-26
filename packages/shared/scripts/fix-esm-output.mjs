import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = fileURLToPath(new URL("../dist/", import.meta.url));

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectJavaScriptFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && extname(entry.name) === ".js") {
      files.push(entryPath);
    }
  }

  return files;
}

const files = await collectJavaScriptFiles(distRoot);
const fileSet = new Set(files.map((filePath) => normalize(filePath)));

await Promise.all(
  files.map(async (filePath) => {
    const source = await readFile(filePath, "utf8");
    const fixed = source.replaceAll(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (match, prefix, specifier, suffix) => {
      if (specifier.endsWith(".mjs") || specifier.endsWith(".json")) {
        return match;
      }

      const resolvedSpecifier = resolve(dirname(filePath), specifier);
      const directFile = normalize(`${resolvedSpecifier}.js`);
      const indexFile = normalize(join(resolvedSpecifier, "index.js"));

      if (fileSet.has(directFile)) {
        return `${prefix}${specifier}.mjs${suffix}`;
      }

      if (fileSet.has(indexFile)) {
        return `${prefix}${specifier}/index.mjs${suffix}`;
      }

      return match;
    });

    if (fixed !== source) {
      await writeFile(filePath, fixed);
    }
  }),
);

await Promise.all(files.map((filePath) => rename(filePath, filePath.replace(/\.js$/, ".mjs"))));
