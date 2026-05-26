import { readdir, readFile, writeFile } from "node:fs/promises";

const distRoot = new URL("../dist/", import.meta.url);

async function fixDirectory(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const entryUrl = new URL(entry.name, directoryUrl);

      if (entry.isDirectory()) {
        await fixDirectory(new URL(`${entry.name}/`, directoryUrl));
        return;
      }

      if (entry.isFile() && entry.name.endsWith(".js")) {
        await fixFile(entryUrl);
      }
    }),
  );
}

async function fixFile(fileUrl) {
  const source = await readFile(fileUrl, "utf8");
  const fixed = source.replaceAll(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, (match, prefix, specifier, suffix) => {
    if (specifier.endsWith(".js") || specifier.endsWith(".json")) {
      return match;
    }

    return `${prefix}${specifier}.js${suffix}`;
  });

  if (fixed !== source) {
    await writeFile(fileUrl, fixed);
  }
}

await fixDirectory(distRoot);
