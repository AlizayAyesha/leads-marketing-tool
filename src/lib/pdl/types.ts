export type PdlExperience = {
  title?: { name?: string | null } | string | null;
  company?: { name?: string | null } | string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type PdlPerson = {
  id?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  job_title?: string | null;
  job_title_role?: string | null;
  job_title_levels?: string[] | null;
  job_company_name?: string | null;
  job_company_website?: string | null;
  job_company_industry?: string | null;
  industry?: string | null;
  location_name?: string | null;
  linkedin_url?: string | null;
  linkedin_username?: string | null;
  linkedin_connections?: number | null;
  inferred_years_experience?: number | null;
  summary?: string | null;
  headline?: string | null;
  experience?: PdlExperience[] | null;
  work_email?: string | null;
};

export type PdlEnrichParams = {
  profile?: string;
  email?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  location?: string;
  phone?: string;
  min_likelihood?: number;
  required?: string;
};

export type PdlEnrichResponse = {
  status: number;
  likelihood?: number;
  data?: PdlPerson | null;
  error?: { type?: string; message?: string };
};

export type PdlSearchResponse = {
  status: number;
  data?: PdlPerson[] | null;
  total?: number;
  error?: { type?: string; message?: string };
};

export type PdlHttpResult<T> = {
  httpStatus: number;
  body: T | null;
  retryAfterMs?: number;
};
