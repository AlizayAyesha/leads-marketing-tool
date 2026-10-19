import { getBusinessProfile } from "@/lib/business/profile";
export function composeTwitterDm(input: {
  name?: string | null;
  originalPost?: string | null;
  company?: string | null;
}) {
  const first = (input.name ?? "").trim().split(/\s+/)[0] || "there";
  const post = (input.originalPost ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const observation = post
    ? `Saw your note about “${post}${post.length >= 60 ? "…" : ""}”.`
    : "Saw you’re looking for help building software / automation.";
  return `Hi ${first} — ${observation} ${getBusinessProfile().businessName} builds custom software and AI automation. Open to a quick 15-min chat?`;
}
