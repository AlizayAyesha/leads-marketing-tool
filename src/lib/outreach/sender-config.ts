const PLACEHOLDER_ADDRESSES = new Set(["123 example street, city, country"]);

export type SenderConfiguration = {
  readyForProductionSend: boolean;
  address: string;
  fromEmail: string;
  fromName: string;
  httpsAppUrl: boolean;
  unsubscribeConfigured: boolean;
  problems: string[];
  blockCode: "SENDER_ADDRESS_REQUIRED" | "UNSUBSCRIBE_NOT_CONFIGURED" | "APP_URL_MUST_BE_HTTPS" | null;
};

export function evaluateSenderConfiguration(env: NodeJS.ProcessEnv = process.env): SenderConfiguration {
  const address = (env.OUTREACH_SENDER_ADDRESS ?? "").trim();
  const fromEmail = (env.OUTREACH_FROM_EMAIL ?? "").trim();
  const fromName = (env.OUTREACH_FROM_NAME ?? "").trim();
  const appUrl = (env.APP_URL ?? "").trim();
  const httpsAppUrl = appUrl.startsWith("https://");
  const unsubscribeConfigured = (env.UNSUBSCRIBE_TOKEN_SECRET ?? "").trim().length >= 16;
  const problems: string[] = [];
  if (!address) {
    problems.push("OUTREACH_SENDER_ADDRESS is empty. Jarvis will not invent a postal address.");
  } else if (PLACEHOLDER_ADDRESSES.has(address.toLowerCase())) {
    problems.push("OUTREACH_SENDER_ADDRESS is still the example placeholder.");
  }
  if (fromEmail && /@example\.(com|org|net)$/i.test(fromEmail)) {
    problems.push("OUTREACH_FROM_EMAIL is an example domain. Use the connected Gmail mailbox or a real From address.");
  }
  if (fromName === "Your Business") {
    problems.push('OUTREACH_FROM_NAME is still "Your Business". Set the real sender name or remove the placeholder.');
  }
  if (!unsubscribeConfigured) {
    problems.push("UNSUBSCRIBE_TOKEN_SECRET is missing, so one-click unsubscribe links cannot be signed.");
  }
  if (!httpsAppUrl) {
    problems.push("APP_URL is not https, so RFC 8058 one-click List-Unsubscribe-Post is not advertised. Mailto is still added when a real From address exists.");
  }
  let blockCode: SenderConfiguration["blockCode"] = null;
  const addressBad = !address || PLACEHOLDER_ADDRESSES.has(address.toLowerCase());
  if (addressBad) blockCode = "SENDER_ADDRESS_REQUIRED";
  else if (!unsubscribeConfigured) blockCode = "UNSUBSCRIBE_NOT_CONFIGURED";
  else if (env.NODE_ENV === "production" && !httpsAppUrl) blockCode = "APP_URL_MUST_BE_HTTPS";
  return {
    readyForProductionSend: blockCode === null && httpsAppUrl,
    address,
    fromEmail,
    fromName,
    httpsAppUrl,
    unsubscribeConfigured,
    problems,
    blockCode,
  };
}

export type DnsObservation = "present" | "missing" | "unknown";

export type DomainAuthReport = {
  lookedUp: boolean;
  fromDomain: string | null;
  mailboxDomain: string | null;
  spf: DnsObservation;
  dkim: DnsObservation;
  dmarc: DnsObservation;
  /** Never "configured". Records may be present; this app does not publish them. */
  summary: "not_checked" | "records_present" | "incomplete" | "mismatch";
  notes: string[];
};

function domainOf(email: string | null | undefined) {
  const value = (email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return null;
  return value.slice(at + 1);
}

export function evaluateDomainAuthentication(input: {
  fromEmail?: string | null;
  mailboxEmail?: string | null;
  spfRecords?: string[] | null;
  dkimRecords?: string[] | null;
  dmarcRecords?: string[] | null;
  lookedUp: boolean;
}): DomainAuthReport {
  const fromDomain = domainOf(input.fromEmail);
  const mailboxDomain = domainOf(input.mailboxEmail);
  const notes = [
    "Jarvis does not create or edit DNS records. Publish SPF, DKIM, and DMARC at your DNS host.",
    "Gmail OAuth authenticates the connected Google mailbox. It does not authenticate a different From domain.",
  ];
  if (!input.lookedUp) {
    return {
      lookedUp: false,
      fromDomain,
      mailboxDomain,
      spf: "unknown",
      dkim: "unknown",
      dmarc: "unknown",
      summary: "not_checked",
      notes,
    };
  }
  const spf: DnsObservation = (input.spfRecords ?? []).some((row) => row.toLowerCase().includes("v=spf1")) ? "present" : "missing";
  const dkim: DnsObservation = (input.dkimRecords ?? []).some((row) => /v=dkim1/i.test(row) || row.includes("k=rsa")) ? "present" : "missing";
  const dmarc: DnsObservation = (input.dmarcRecords ?? []).some((row) => row.toLowerCase().includes("v=dmarc1")) ? "present" : "missing";
  if (fromDomain && mailboxDomain && fromDomain !== mailboxDomain) {
    notes.push(
      `From domain ${fromDomain} is not the connected mailbox domain ${mailboxDomain}. DNS on the From domain does not make this Gmail connection send as that domain.`,
    );
  }
  const mismatch = Boolean(fromDomain && mailboxDomain && fromDomain !== mailboxDomain);
  const summary = mismatch ? "mismatch" : spf === "present" && dkim === "present" && dmarc === "present" ? "records_present" : "incomplete";
  if (summary === "records_present") {
    notes.push("TXT records were observed. That is not a claim that Jarvis configured DNS or that every mailbox is aligned.");
  }
  return { lookedUp: true, fromDomain, mailboxDomain, spf, dkim, dmarc, summary, notes };
}
