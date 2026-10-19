import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname ?? ".", "..");

for (const file of [".env.local", ".env"]) {
  try {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 1) continue;
      const key = trimmed.slice(0, index);
      const value = trimmed.slice(index + 1).replace(/^"|"$/g, "").replace(/^'|'$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // File may not exist.
  }
}
