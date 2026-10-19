const UI_NOISE_RE =
  /\b(Message|Send|Write a message|Pending|Connect|More|Follow|Online|Active now|View profile|See translation)\b/gi;

export function extractNewInbound(threadText: string, knownTexts: string[]): string | null {
  const cleaned = threadText.replace(/\s+/g, " ").trim();
  if (cleaned.length < 8) return null;
  let remainder = cleaned;
  for (const item of knownTexts.map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => value.length >= 8)) {
    if (remainder.includes(item)) remainder = remainder.replace(item, " ");
  }
  remainder = remainder.replace(UI_NOISE_RE, " ").replace(/\s+/g, " ").trim();
  if (remainder.length < 8) return null;
  if (/^(message|send|write a message|pending|connect|more|follow)+$/i.test(remainder)) return null;
  if (knownTexts.some((item) => item.replace(/\s+/g, " ").includes(remainder) || remainder.includes(item.replace(/\s+/g, " ").trim()))) {
    return null;
  }
  return remainder.slice(0, 2000);
}
