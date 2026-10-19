/**
 * Optional modules. Everything here is OFF unless explicitly enabled in the environment.
 *
 * ENABLE_SOCIAL_AUTOMATION=true turns on the LinkedIn / X browser-automation module
 * (driving a signed-in browser to send connection requests, DMs, follows).
 * WARNING: LinkedIn's User Agreement and X's Terms of Service prohibit automated
 * activity on their sites. Using this module can get your accounts restricted or banned.
 * You are solely responsible for complying with each platform's terms.
 */
export const SOCIAL_AUTOMATION_DISABLED_REASON =
  "LinkedIn/X browser automation is disabled (ENABLE_SOCIAL_AUTOMATION is not 'true'). Drafts are still created for manual sending. See README → Compliance.";

export function socialAutomationEnabled(env: Record<string, string | undefined> = process.env) {
  return (env.ENABLE_SOCIAL_AUTOMATION ?? "").trim().toLowerCase() === "true";
}
