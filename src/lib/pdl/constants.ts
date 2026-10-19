export const PDL_ADAPTER_ID = "pdl-person";
export const PDL_ADAPTER_VERSION = "1.0.0";
export const PDL_ENRICH_URL = "https://api.peopledatalabs.com/v5/person/enrich";
export const PDL_SEARCH_URL = "https://api.peopledatalabs.com/v5/person/search";
export const PDL_MIN_LIKELIHOOD = 6;
export const HARD_PDL_LOOKUP_DAILY_CAP = 100;
export const HARD_PDL_DISCOVER_DAILY_CAP = 100;
export const PDL_REQUEST_TIMEOUT_MS = 15_000;

export const DEFAULT_DISCOVERY_TITLE_LEVELS = ["owner", "cxo", "director", "vp", "partner"] as const;
export const DEFAULT_DISCOVERY_TITLE_ROLES = ["founder", "owner", "marketing"] as const;
