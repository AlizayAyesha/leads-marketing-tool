export function executeIntentCommand(raw: string) {
  const text = raw.trim();
  if (!text) return "Do not send.";
  return /do not send|don't send|draft only/i.test(text) ? text : `${text} Do not send.`;
}
