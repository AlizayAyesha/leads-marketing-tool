export function fallbackSpokenReply(summary: string) {
  return summary.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().slice(0, 800);
}
