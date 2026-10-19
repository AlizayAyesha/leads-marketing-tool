import type { ZarService } from "@prisma/client";

import { SERVICE_LABEL } from "@/lib/config";
import type { ConversationMatch } from "@/lib/conversation/types";

type PainPattern = {
  id: string;
  pain: string;
  re: RegExp;
  specific: boolean;
  service: ZarService;
  capability: string;
  outcome: string;
};

const PAIN_PATTERNS: PainPattern[] = [
  {
    id: "lead_handling",
    pain: "lead-management pain",
    re: /\b(lead handling|lead management|incoming leads|too many leads|leads to handle|losing .{0,40}leads|manage( all)? (our |the )?leads|nobody follows up|lead (intake|routing|management|follow[- ]?up)|qualify(ing)? leads)\b/i,
    specific: true,
    service: "AI_AUTOMATION",
    capability: "AI automation for lead handling and follow-up",
    outcome: "qualification and follow-up actually happen, so opportunities don't fall through the cracks",
  },
  {
    id: "chatbot",
    pain: "explicit chatbot demand",
    re: /\b((ai )?chatbots?|need a chatbot)\b/i,
    specific: true,
    service: "AI_CHATBOTS",
    capability: "AI chatbots for intake and lead handling",
    outcome: "inbound conversations get qualified instead of going quiet",
  },
  {
    id: "website_rebuild",
    pain: "website rebuild demand",
    re: /\b((rebuild|redesign) (the |our )?(website|site|it)?|ideas for (my |our |the )?(website|site)|handle (our |the )?(website|site)|someone to (handle|run|manage) (our |the )?(website|site))\b/i,
    specific: true,
    service: "WEBSITE_DEVELOPMENT",
    capability: "custom high-performance websites and web platforms",
    outcome: "the site is actually ready for the work you need it to do",
  },
  {
    id: "website_not_ready",
    pain: "website not ready",
    re: /\b(website|site) (isn'?t|is not|not) (ready|great|finished|done)\b/i,
    specific: true,
    service: "WEBSITE_DEVELOPMENT",
    capability: "custom high-performance websites and web platforms",
    outcome: "the site can support the launch instead of blocking it",
  },
  {
    id: "website_slow",
    pain: "website performance complaint",
    re: /\b(website|site)('s| is| feels| loads) (a bit |pretty |really |so )?(slow|sluggish|outdated)\b/i,
    specific: true,
    service: "WEBSITE_DEVELOPMENT",
    capability: "custom high-performance websites and web platforms",
    outcome: "pages load fast enough that people actually stay",
  },
  {
    id: "conversion",
    pain: "conversion problem",
    re: /\b(doesn'?t convert|not convert(ing)?|low conversion|website is(n'?t| not) converting)\b/i,
    specific: true,
    service: "WEBSITE_DEVELOPMENT",
    capability: "conversion-focused websites and rebuilds",
    outcome: "the site turns visits into inquiries instead of bouncing",
  },
  {
    id: "seo",
    pain: "acquisition problem",
    re: /\b(seo isn'?t|seo is not|not bringing (in )?clients|organic (traffic|search) (isn'?t|is not)|need (better |more )?seo|improv(e|ing) .{0,24}seo|how .{0,20}seo)\b/i,
    specific: true,
    service: "SEO",
    capability: "SEO and growth systems",
    outcome: "search actually brings in clients",
  },
  {
    id: "custom_platform",
    pain: "software need",
    re: /\b(custom platform|need a (custom )?(platform|system|app)|full[- ]stack|custom (software|app))\b/i,
    specific: true,
    service: "FULL_STACK_DEVELOPMENT",
    capability: "custom platforms and full-stack systems",
    outcome: "you get software that fits the workflow instead of another off-the-shelf mismatch",
  },
  {
    id: "crm",
    pain: "CRM / process pain",
    re: /\b(crm|follow[- ]?up is (a )?mess|pipeline is (a )?mess)\b/i,
    specific: true,
    service: "CRM_ERP_DEVELOPMENT",
    capability: "CRM and workflow systems",
    outcome: "follow-up stops falling through",
  },
  {
    id: "manual_ops",
    pain: "automation opportunity",
    re: /\b(everything manually|doing (it|everything) (manually|by hand)|too manual|still manual)\b/i,
    specific: true,
    service: "AI_AUTOMATION",
    capability: "AI automation around manual workflows",
    outcome: "the repetitive work stops living in someone's inbox",
  },
  {
    id: "automation",
    pain: "automation opportunity",
    re: /\b(automat(e|ing|ion)|workflow(s)? (are |is )?(a )?(mess|nightmare)?)\b/i,
    specific: true,
    service: "AI_AUTOMATION",
    capability: "custom AI and automation systems",
    outcome: "those bottlenecks stop being the thing the team is fighting every week",
  },
  {
    id: "saas",
    pain: "SaaS / product need",
    re: /\b(saas (app|platform|product)|need (a |an )?saas|build this saas|this saas)\b/i,
    specific: true,
    service: "SAAS_DEVELOPMENT",
    capability: "SaaS products and subscription platforms",
    outcome: "the product actually fits how the business sells and delivers",
  },
  {
    id: "custom_software",
    pain: "custom software need",
    re: /\bcustom software\b/i,
    specific: true,
    service: "CUSTOM_SOFTWARE",
    capability: "custom software for the business",
    outcome: "the system fits the workflow instead of forcing another workaround",
  },
  {
    id: "uiux",
    pain: "UI/UX problem",
    re: /\b(ui\/ux|user experience is|ux is (bad|poor|dated|outdated))\b/i,
    specific: true,
    service: "UI_UX",
    capability: "UI/UX for business products and sites",
    outcome: "people can actually use the thing without getting lost",
  },
  {
    id: "branding",
    pain: "branding need",
    re: /\b(rebrand|need (a )?new brand|branding (is |isn))\b/i,
    specific: true,
    service: "BRANDING",
    capability: "branding for the business",
    outcome: "the brand matches the company you're trying to be",
  },
  {
    id: "ai_tool",
    pain: "AI implementation need",
    re: /\b(what ai should i use|which ai (tool|model)|what (ai )?tool should i|implement(ing)? ai)\b/i,
    specific: true,
    service: "AI_INTEGRATION",
    capability: "AI systems implemented around the actual business process",
    outcome: "the AI is built for the workflow instead of being another generic tool",
  },
];

const VAGUE_OPS_RE =
  /\b(operations? (are |is )?(becoming )?(difficult|hard|messy|painful)|growing (pretty |really )?(quickly|fast)|ops (pain|strain)|things are (hectic|busy)|keep(ing)? up|overwhelmed|hectic|bottleneck|bandwidth)\b/i;

const BUYING_SIGNAL_RE =
  /\b(looking for (someone|an agency|help|a (developer|dev|vendor|freelancer))|need someone|we need (a|an|to|someone)|hire (an? |a )?(agency|developer|someone)|(rebuild|redesign)|outsource|struggling (to|with)|losing .{0,40}(leads|customers|deals|opportunities|revenue)|fall(ing)? through|nobody follows up|follow[- ]?ups? .{0,24}(slow|quickly|fast enough)|costing us|can'?t keep up|looking to (automat|rebuild|hire|fix)|too many leads|not bringing (in )?clients)\b/i;

const NONE: ConversationMatch = {
  pain: null,
  matched: false,
  specific: false,
  strength: "none",
  buyingSignal: false,
  buyingSignalReason: null,
  service: null,
  serviceLabel: null,
  capability: null,
  outcome: null,
  valueProp: null,
};

export function detectBuyingSignal(text: string): { buyingSignal: boolean; reason: string | null } {
  if (!text.trim()) return { buyingSignal: false, reason: null };
  if (!BUYING_SIGNAL_RE.test(text)) return { buyingSignal: false, reason: null };
  if (/\blooking for (someone|an agency|help)\b/i.test(text)) {
    return { buyingSignal: true, reason: "They are looking for someone to do the work." };
  }
  if (/\b(rebuild|redesign)\b/i.test(text)) {
    return { buyingSignal: true, reason: "They asked to rebuild or redesign." };
  }
  if (/\blosing .{0,40}leads|nobody follows up|too many leads\b/i.test(text)) {
    return { buyingSignal: true, reason: "Leads are being lost or not followed up." };
  }
  if (/\bstruggling (to|with)\b/i.test(text)) {
    return { buyingSignal: true, reason: "They are struggling to get a solvable job done." };
  }
  if (/\bwe need (a|an|to|someone)\b/i.test(text)) {
    return { buyingSignal: true, reason: "They stated an active need." };
  }
  return { buyingSignal: true, reason: "They signaled they want this solved, not just mentioned it." };
}

export function shouldPitchConversation(match: ConversationMatch) {
  return Boolean(match.matched);
}

export function matchConversationPain(text: string): ConversationMatch {
  const body = text.trim();
  const intent = detectBuyingSignal(body);
  if (!body) return NONE;

  for (const pattern of PAIN_PATTERNS) {
    if (!pattern.re.test(body)) continue;
    return {
      pain: pattern.pain,
      matched: true,
      specific: pattern.specific,
      strength: "strong",
      buyingSignal: intent.buyingSignal,
      buyingSignalReason: intent.reason,
      service: pattern.service,
      serviceLabel: SERVICE_LABEL[pattern.service],
      capability: pattern.capability,
      outcome: pattern.outcome,
      valueProp: `${pattern.capability} so ${pattern.outcome}`,
    };
  }

  if (VAGUE_OPS_RE.test(body)) {
    return {
      pain: "operational strain",
      matched: false,
      specific: false,
      strength: "weak",
      buyingSignal: intent.buyingSignal,
      buyingSignalReason: intent.reason,
      service: null,
      serviceLabel: null,
      capability: null,
      outcome: null,
      valueProp: null,
    };
  }

  if (intent.buyingSignal) {
    return {
      ...NONE,
      buyingSignal: true,
      buyingSignalReason: intent.reason,
      strength: "none",
    };
  }

  return NONE;
}
