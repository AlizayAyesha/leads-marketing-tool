import type { OutreachChannel, ZarService } from "@prisma/client";

import { getBusinessProfile } from "@/lib/business/profile";

export const PRODUCT_NAME = "Leads Marketing Tool";
export const PRODUCT_TAGLINE = "Open-source lead discovery, qualification & outreach";
export const PRODUCT_CREDIT = "Built by Zar Labs (zarlabs.online)";
/** Your business name, from the Business Profile (business-profile.json or defaults). */
export const COMPANY_NAME = getBusinessProfile().businessName;

export const ZAR_SERVICES: { id: ZarService; label: string; summary: string }[] =
  [
    {
      id: "WEBSITE_DEVELOPMENT",
      label: "Website Development",
      summary: "Marketing sites, rebuilds, and conversion-focused web presence.",
    },
    {
      id: "FULL_STACK_DEVELOPMENT",
      label: "Full-Stack Development",
      summary: "End-to-end product and internal platform engineering.",
    },
    {
      id: "SAAS_DEVELOPMENT",
      label: "SaaS Development",
      summary: "Multi-tenant products, billing, and web application platforms.",
    },
    {
      id: "AI_INTEGRATION",
      label: "AI Integration",
      summary: "Model-backed features and AI architecture inside existing products and workflows.",
    },
    {
      id: "AI_AUTOMATION",
      label: "AI Automation",
      summary: "Operational automation across research, CRM, and delivery.",
    },
    {
      id: "AI_CHATBOTS",
      label: "AI Chatbots",
      summary: "Qualified assistants for support, intake, and lead handling.",
    },
    {
      id: "CRM_ERP_DEVELOPMENT",
      label: "CRM/ERP Development",
      summary: "Custom systems of record for sales, ops, and inventory.",
    },
    {
      id: "SEO",
      label: "SEO",
      summary: "Technical and content search improvements with measurable structure.",
    },
    {
      id: "UI_UX",
      label: "UI/UX",
      summary: "Interface, information architecture, and conversion design.",
    },
    {
      id: "BRANDING",
      label: "Branding, graphics & UGC",
      summary: "Identity, graphics, AI ads, and UGC-style video for launches and listings.",
    },
    {
      id: "CUSTOM_SOFTWARE",
      label: "Custom Software",
      summary: "Bespoke tools when off-the-shelf software is the constraint.",
    },
  ];

export const CHANNELS: { id: OutreachChannel; label: string }[] = [
  { id: "EMAIL", label: "Email" },
  { id: "LINKEDIN", label: "LinkedIn" },
  { id: "INSTAGRAM", label: "Instagram" },
  { id: "FACEBOOK", label: "Facebook" },
  { id: "X_TWITTER", label: "X / Twitter" },
];

export const SERVICE_LABEL: Record<ZarService, string> = Object.fromEntries(
  ZAR_SERVICES.map((item) => [item.id, item.label]),
) as Record<ZarService, string>;

export const CHANNEL_LABEL: Record<OutreachChannel, string> = Object.fromEntries(
  CHANNELS.map((item) => [item.id, item.label]),
) as Record<OutreachChannel, string>;

export const PIPELINE_STEPS = [
  "intake",
  "research",
  "qualification",
  "decision_maker",
  "opportunity",
  "strategist",
  "outreach_writer",
  "human_approval",
] as const;
