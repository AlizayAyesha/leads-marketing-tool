import "server-only";

import { getSetting } from "@/lib/db/settings";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { authorizeTwitterDailyOutreach } from "@/lib/twitter/daily/authorize";
import { TWITTER_DAILY_SNAPSHOT_KEY } from "@/lib/twitter/daily/events";
import { countTwitterConfirmedDms, loadTwitterDailyCandidates } from "@/lib/twitter/daily/queue";
import { resolveTwitterSendProvider } from "@/lib/twitter/send/registry";
import { isChromeTwitterSessionReady } from "@/lib/twitter/session/host";
import { HARD_TWITTER_DM_DAILY_CAP } from "@/lib/outreach/policy";

export async function getTwitterDailyDashboard(now = new Date()) {
  const policy = await getOutreachEnginePolicy();
  const sendProvider = await resolveTwitterSendProvider();
  const auth = authorizeTwitterDailyOutreach({
    policy,
    sendProviderConfigured: sendProvider.configured,
  });
  const confirmed = await countTwitterConfirmedDms(now);
  const candidates = await loadTwitterDailyCandidates(now, 10);
  const snapshot = (await getSetting(TWITTER_DAILY_SNAPSHOT_KEY, null).catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const cap = Math.min(HARD_TWITTER_DM_DAILY_CAP, policy.twitterDmDailyCap);

  return {
    policy,
    auth,
    confirmed: {
      dmsToday: confirmed.dmsToday,
      dmsRemaining: Math.max(0, cap - confirmed.dmsToday),
      cap,
    },
    sendAvailable: sendProvider.configured && isChromeTwitterSessionReady(),
    unavailableReason: sendProvider.configured
      ? null
      : "Connect Jarvis Chrome and sign into x.com in that window.",
    candidates,
    snapshot,
  };
}
