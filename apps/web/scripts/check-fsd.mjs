import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const layers = ["app", "pages", "widgets", "features", "entities", "shared"];
const failures = [];
const sourceFiles = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.tsx?$/.test(entry.name)) sourceFiles.push(full);
  }
}
const describe = (filename) =>
  path.relative(sourceRoot, filename).split(path.sep);
async function resolveImport(filename, specifier) {
  const target = path.resolve(path.dirname(filename), specifier);
  for (const candidate of [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    path.join(target, "index.ts"),
  ]) {
    try {
      await access(candidate);
      if (/\.(ts|tsx|css)$/.test(candidate)) return candidate;
    } catch {}
  }
  return null;
}
await walk(sourceRoot);
for (const filename of sourceFiles) {
  const from = describe(filename),
    fromLayer = layers.indexOf(from[0]);
  if (fromLayer < 0) {
    failures.push(`${from.join("/")}: невідомий FSD шар`);
    continue;
  }
  const content = await readFile(filename, "utf8");
  const imports = [
    ...content.matchAll(
      /(?:import|export)\s+(?:type\s+)?(?:[^;'"`]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    ),
  ].map((match) => match[1]);
  for (const match of content.matchAll(/import\s*\(([^)]+)\)/g)) {
    const literal = match[1].trim().match(/^['"]([^'"]+)['"]$/);
    if (literal) imports.push(literal[1]);
    else
      failures.push(`${from.join("/")}: динамічний import має бути статичним`);
  }
  for (const specifier of imports) {
    if (!specifier.startsWith(".")) {
      if (!["react", "react-dom/client", "leaflet", "leaflet/dist/leaflet.css", "@electric-sql/pglite", "@electric-sql/pglite/worker"].includes(specifier))
        failures.push(
          `${from.join("/")}: невідомий зовнішній імпорт ${specifier}`,
        );
      continue;
    }
    const target = await resolveImport(filename, specifier);
    if (!target) {
      failures.push(`${from.join("/")}: не знайдено ${specifier}`);
      continue;
    }
    const to = describe(target),
      toLayer = layers.indexOf(to[0]);
    if (to[0] === ".." || toLayer < 0)
      failures.push(`${from.join("/")}: імпорт поза FSD шарами ${specifier}`);
    else if (toLayer < fromLayer)
      failures.push(`${from.join("/")}: імпорт у вищий шар ${specifier}`);
    else if (
      toLayer === fromLayer &&
      !["app", "shared"].includes(from[0]) &&
      from[1] !== to[1]
    )
      failures.push(
        `${from.join("/")}: перехресний імпорт slices ${specifier}`,
      );
    else if (
      !(from[0] === "app" && to[0] === "app") &&
      (from[0] !== to[0] || from[1] !== to[1]) &&
      path.basename(target) !== "index.ts" &&
      !target.endsWith(".css")
    )
      failures.push(
        `${from.join("/")}: обхід публічного index.ts ${specifier}`,
      );
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `FSD: ${sourceFiles.length} файлів, напрямки імпортів і публічні API перевірено`,
  );
