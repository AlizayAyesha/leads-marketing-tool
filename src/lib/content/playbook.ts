import { readFileSync } from "node:fs";
import { join } from "node:path";

import { platformById, type ContentPlatformId } from "@/lib/content/platforms";

export function skillsDirectory(root = process.cwd()) {
  return join(root, "skills");
}

/** Load the platform playbook. The file is system guidance, not a tool script. */
export function loadPlaybook(platform: ContentPlatformId, root = process.cwd()) {
  const row = platformById(platform);
  const path = join(skillsDirectory(root), row.folder, "SKILL.md");
  const text = readFileSync(path, "utf8");
  if (!text.includes("Adapted from")) {
    throw new Error(`Playbook ${row.skillId} is missing its attribution line.`);
  }
  return text;
}
