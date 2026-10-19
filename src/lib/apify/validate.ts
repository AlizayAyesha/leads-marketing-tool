import { JARVIS_LEAD_FIELDS, type OutputMapping } from "@/lib/actors/mapping";

export type ActorConfigInput = {
  actorId?: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  sourceType?: string | null;
  enabled?: boolean;
  input?: Record<string, unknown> | null;
  outputMapping?: OutputMapping | Record<string, unknown> | null;
};

export type ActorConfigIssue = { field: string; message: string };

export function validateActorConfig(input: ActorConfigInput) {
  const issues: ActorConfigIssue[] = [];
  const actorId = input.actorId?.trim() ?? "";
  const name = input.name?.trim() ?? "";
  if (!actorId) issues.push({ field: "actorId", message: "Actor ID is required." });
  else if (!/^[a-zA-Z0-9_./~-]+$/.test(actorId)) {
    issues.push({ field: "actorId", message: "Actor ID contains invalid characters." });
  }
  if (!name) issues.push({ field: "name", message: "Display name is required." });
  if (input.input != null && (typeof input.input !== "object" || Array.isArray(input.input))) {
    issues.push({ field: "input", message: "Actor input must be a JSON object." });
  }
  const mappingIssues = validateOutputMapping(input.outputMapping ?? {});
  issues.push(...mappingIssues);
  return { ok: issues.length === 0, issues };
}

export function validateOutputMapping(mapping: OutputMapping | Record<string, unknown> | null | undefined) {
  const issues: ActorConfigIssue[] = [];
  if (mapping == null) return issues;
  if (typeof mapping !== "object" || Array.isArray(mapping)) {
    return [{ field: "outputMapping", message: "Output mapping must be an object." }];
  }
  const allowed = new Set<string>(JARVIS_LEAD_FIELDS);
  for (const [field, path] of Object.entries(mapping)) {
    if (!allowed.has(field)) {
      issues.push({ field: "outputMapping", message: `Unknown Jarvis field "${field}".` });
      continue;
    }
    if (path != null && typeof path !== "string") {
      issues.push({ field: "outputMapping", message: `Mapping for ${field} must be a string path.` });
    }
  }
  return issues;
}
