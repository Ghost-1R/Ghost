import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const files = ["site/index.html", "site/styles.css", "site/app.js"];
const hashes = files.map((rel) => {
  const abs = path.join(root, rel);
  return `${rel}:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`;
});
const digest = createHash("sha256").update(hashes.join("|")).digest("hex");
writeFileSync(path.join(root, "dist-manifest.txt"), `${digest}\n${hashes.join("\n")}\n`);
console.log("BUILD_OK", digest.slice(0, 12));
