import type { EvidenceFinding, WebsiteSnapshot } from "@/types";

export function researchFromSnapshot(
  lead: {
    website?: string | null;
    originalPost?: string | null;
  } | null
  | undefined,
  snapshot: WebsiteSnapshot | null,
) {
  const findings: EvidenceFinding[] = [];
  const limitations: string[] = [];
  const techSignals = snapshot?.techHints ?? [];
  const problems: string[] = [];
  const missingFeatures: string[] = [];
  const webDevOpportunities: string[] = [];
  const aiOpportunities: string[] = [];
  const seoOpportunities: string[] = [];
  const brandingOpportunities: string[] = [];

  if (!lead?.website) {
    limitations.push("No website URL was provided on the lead record.");
  } else if (!snapshot) {
    limitations.push("Website snapshot was not collected.");
  } else if (snapshot.error) {
    limitations.push(`Website fetch limitation: ${snapshot.error}`);
    findings.push({
      finding: "Public website could not be fully analyzed.",
      evidence: snapshot.error,
      reason: "The public GET did not return a usable HTML document.",
      sourceUrl: snapshot.finalUrl || snapshot.requestedUrl,
      category: "website_quality",
      confidence: "observed",
    });
  } else {
    const sourceUrl = snapshot.finalUrl || snapshot.requestedUrl;
    let quality = 4;
    if (snapshot.statusCode && snapshot.statusCode < 400) quality += 2;
    if (snapshot.title) quality += 1;
    else problems.push("No HTML title tag observed.");
    if (snapshot.description) quality += 1;
    else missingFeatures.push("Meta description not observed.");
    if (snapshot.hasViewport) quality += 1;
    else problems.push("No viewport meta tag observed.");
    if (techSignals.length) {
      findings.push({
        finding: `Observed technology hints: ${techSignals.join(", ")}.`,
        evidence: techSignals.join(", "),
        reason: "Matched public HTML/script markers or generator meta.",
        sourceUrl,
        category: "tech",
        confidence: "observed",
      });
    }
    if (snapshot.title) {
      findings.push({
        finding: `Public page title is “${snapshot.title}”.`,
        evidence: snapshot.title,
        reason: "Extracted from the HTML <title> tag.",
        sourceUrl,
        category: "website_quality",
        confidence: "observed",
      });
    }
    if (snapshot.linkedinUrls?.length) {
      findings.push({
        finding: `Public LinkedIn URL(s) observed on the website: ${snapshot.linkedinUrls.slice(0, 3).join(", ")}.`,
        evidence: snapshot.linkedinUrls.join(", "),
        reason: "Extracted from public HTML links. Jarvis did not log into LinkedIn.",
        sourceUrl,
        category: "contact",
        confidence: "observed",
      });
    }
    quality = Math.max(0, Math.min(10, quality));
    return {
      findings,
      websiteQuality: quality,
      websiteQualityNotes: snapshot.description
        ? `Fetched ${sourceUrl}. Description present.`
        : `Fetched ${sourceUrl}. Limited on-page metadata.`,
      techSignals,
      problems,
      missingFeatures,
      webDevOpportunities,
      aiOpportunities,
      seoOpportunities,
      brandingOpportunities,
      limitations,
      summary: `Public fetch of ${sourceUrl} completed${snapshot.error ? " with limitations" : ""}.`,
    };
  }

  return {
    findings,
    websiteQuality: lead?.website ? 2 : 0,
    websiteQualityNotes: limitations[0] ?? "Insufficient public website evidence.",
    techSignals,
    problems,
    missingFeatures,
    webDevOpportunities,
    aiOpportunities,
    seoOpportunities,
    brandingOpportunities,
    limitations,
    summary: limitations.join(" "),
  };
}
