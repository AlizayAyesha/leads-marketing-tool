import { COMPANY_NAME, ZAR_SERVICES } from "@/lib/config";
import { OFFER_LABEL, OFFER_FAMILIES } from "@/lib/intelligence/offers";
import { buyerIcpNotes } from "@/lib/outreach/buyer-icp";
import { getBusinessProfile } from "@/lib/business/profile";
import { DEFAULT_MIN_COMMERCIAL_SCORE } from "@/lib/outreach/quality";
import { JARVIS_INTERPRET_IS_ADAPTER, JARVIS_LLM_INVARIANT } from "@/lib/jarvis/invariant";
import { buildJarvisConstitution } from "@/lib/jarvis/constitution";

export function buildJarvisDoctrine() {
  const services = ZAR_SERVICES.map((item) => `${item.label}: ${item.summary}`).join(" ");
  const offers = OFFER_FAMILIES.map((id) => OFFER_LABEL[id]).join(", ");
  return [
    buildJarvisConstitution(),
    `${COMPANY_NAME}: ${getBusinessProfile().description}`,
    `Services: ${services}`,
    `Offer families (pick one primary): ${offers}.`,
    `ICP (Business Profile):\n${buyerIcpNotes()}`,
    `Commercial send requires BUY_NOW ≥${DEFAULT_MIN_COMMERCIAL_SCORE} AND a PRIORITY gate (named ICP, FACT Why Now with URL+snippet, evidenced problem, a matching offer, decision-maker). Ability-to-pay does not compensate. Luxury is not an ICP.`,
    "Evidence must be observed (FACT). Do not invent buying need, decision makers, or scores.",
    "Outreach is BD intelligence, not a daily quota. Daily caps are ceilings. Kill switch and draft-only still block Gmail.",
    "Pricing philosophy: sell outcomes to non-tech operators who can pay; do not discount into peer-builder work.",
    "Voice and chat may request send. Only the existing sendApprovedDraft path may send, after Decision Maker PASS, commercial ≥80, evidence, offer match, kill switch off, and channel gates.",
    JARVIS_LLM_INVARIANT,
    JARVIS_INTERPRET_IS_ADAPTER,
    "This doctrine is static. If live Postgres facts disagree, Postgres wins.",
  ].join(" ");
}
