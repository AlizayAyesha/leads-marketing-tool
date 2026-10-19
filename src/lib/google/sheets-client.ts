/**
 * Fail-fast Google Sheets transport helpers.
 * An unavailable/timeout/malformed response is never treated as an empty tab.
 */

export const SHEETS_TIMEOUT_MS = 15_000;
export const SHEETS_MAX_RETRIES = 1;
export const SHEETS_RETRY_BASE_MS = 400;

export type GoogleSheetsErrorCode =
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "MISSING_TAB"
  | "MALFORMED"
  | "UNAVAILABLE";

export class GoogleSheetsError extends Error {
  readonly code: GoogleSheetsErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly worksheet?: string;
  readonly spreadsheetId?: string;

  constructor(
    code: GoogleSheetsErrorCode,
    message: string,
    options?: {
      retryable?: boolean;
      status?: number;
      worksheet?: string;
      spreadsheetId?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "GoogleSheetsError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status;
    this.worksheet = options?.worksheet;
    this.spreadsheetId = options?.spreadsheetId;
  }
}

export type SheetReadSuccess = {
  ok: true;
  rows: string[][];
  dataRowCount: number;
  empty: boolean;
  message: string;
};

export type SheetReadFailure = {
  ok: false;
  code: GoogleSheetsErrorCode;
  message: string;
  dataRowCount: null;
  empty: false;
};

export type SheetAvailability = SheetReadSuccess | SheetReadFailure;

export function emptyLeadsTabMessage(worksheet = "Leads") {
  return `${worksheet} tab exists and contains 0 rows.`;
}

export function timeoutLeadsTabMessage(worksheet = "Leads") {
  return `Google Sheets request timed out while reading the ${worksheet} tab.`;
}

export function sheetsUnavailableMessage() {
  return "Google Sheets unavailable/error/timeout.";
}

/** Only a successful Sheet read may proceed. Timeout/error is not an empty tab and not pipeline permission. */
export function sheetReadAllowsPipeline(availability: SheetAvailability): boolean {
  return availability.ok === true;
}

export function sheetFailureToAvailability(error: unknown): SheetReadFailure {
  const sheetsError =
    error instanceof GoogleSheetsError ? error : classifyGoogleSheetsError(error, { worksheet: "Leads" });
  return {
    ok: false,
    code: sheetsError.code,
    message: sheetsError.message,
    dataRowCount: null,
    empty: false,
  };
}

export function connectionHasSheetsScope(scopes: string[] | null | undefined) {
  if (!scopes?.length) return true;
  return scopes.some(
    (scope) =>
      scope.includes("spreadsheets") ||
      scope.includes("drive.readonly") ||
      scope.includes("drive") ||
      scope.endsWith("/drive"),
  );
}

export function redactGoogleErrorText(text: string) {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/refresh_token=[^&\s]+/gi, "refresh_token=[redacted]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/1\/\/[A-Za-z0-9_-]+/g, "[redacted-refresh]");
}

const SECRET_CONTEXT_KEY = /token|secret|authorization|password|apikey|api[_-]?key|credential/i;

export function logGoogleSheetsError(
  error: GoogleSheetsError,
  context: Record<string, unknown> = {},
) {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SECRET_CONTEXT_KEY.test(key)) continue;
    if (typeof value === "string") safe[key] = redactGoogleErrorText(value);
    else safe[key] = value;
  }
  console.error("[google-sheets]", {
    code: error.code,
    status: error.status ?? null,
    retryable: error.retryable,
    worksheet: error.worksheet ?? null,
    spreadsheetId: error.spreadsheetId ?? null,
    message: redactGoogleErrorText(error.message),
    ...safe,
  });
}

function googleErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown; data?: { error?: { code?: unknown } } };
  };
  const candidates = [record.response?.status, record.status, record.response?.data?.error?.code, record.code];
  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isFinite(status) && status >= 100) return status;
  }
  return undefined;
}

function googleErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const record = error as {
    message?: unknown;
    response?: {
      data?:
        | {
            error?: { message?: unknown; status?: unknown } | string;
            error_description?: unknown;
          }
        | string;
    };
  };
  const apiMessage = record.response?.data;
  if (typeof apiMessage === "string" && apiMessage.trim()) return apiMessage;
  if (typeof apiMessage === "object" && apiMessage) {
    const nested = apiMessage.error;
    if (typeof nested === "string" && nested.trim()) {
      const description = typeof apiMessage.error_description === "string" ? apiMessage.error_description : "";
      return description ? `${nested}: ${description}` : nested;
    }
    if (nested && typeof nested === "object" && nested.message) {
      return String(nested.message);
    }
    if (typeof apiMessage.error_description === "string" && apiMessage.error_description.trim()) {
      return apiMessage.error_description;
    }
  }
  if (typeof record.message === "string") return record.message;
  return String(error);
}

export function classifyGoogleSheetsError(
  error: unknown,
  context: { worksheet?: string; spreadsheetId?: string; operation?: string } = {},
): GoogleSheetsError {
  if (error instanceof GoogleSheetsError) return error;
  const worksheet = context.worksheet;
  const spreadsheetId = context.spreadsheetId;
  const status = googleErrorStatus(error);
  const text = googleErrorText(error);
  const lower = text.toLowerCase();
  const name = error instanceof Error ? error.name : "";

  const timedOut =
    name === "AbortError" ||
    /aborted|abort|timed?\s*out|etimedout|econnaborted|timeout/i.test(`${name} ${text}`) ||
    (typeof error === "object" && error !== null && "code" in error && String((error as { code?: string }).code).toUpperCase() === "ETIMEDOUT");

  if (timedOut) {
    return new GoogleSheetsError(
      "TIMEOUT",
      worksheet ? timeoutLeadsTabMessage(worksheet) : "Google Sheets request timed out.",
      { retryable: false, status, worksheet, spreadsheetId, cause: error },
    );
  }

  if (status === 401 || status === 403 || /invalid credentials|unauthenticated|unauthorized|insufficient permission|insufficient authentication|missing sheets scope|invalid_grant|invalid refresh|token has been expired or revoked/i.test(lower)) {
    const scopeMissing = /insufficient permission|access not configured|insufficient authentication scopes|missing sheets scope/i.test(lower);
    return new GoogleSheetsError(
      "UNAUTHORIZED",
      scopeMissing
        ? "Google connection is missing Sheets scope. Reconnect Google in Settings."
        : "Google Sheets credentials are invalid or expired. Reconnect Google in Settings.",
      { retryable: false, status, worksheet, spreadsheetId, cause: error },
    );
  }

  if (/unable to parse range|unable to parse the range|not found.*sheet|no sheet with/i.test(lower)) {
    return new GoogleSheetsError(
      "MISSING_TAB",
      `Google Sheets tab "${worksheet ?? "Leads"}" was not found.`,
      { retryable: false, status: status ?? 400, worksheet, spreadsheetId, cause: error },
    );
  }

  if (status === 404 || /requested entity was not found|spreadsheet not found|file not found/i.test(lower)) {
    return new GoogleSheetsError("NOT_FOUND", "Google spreadsheet was not found.", {
      retryable: false,
      status: status ?? 404,
      worksheet,
      spreadsheetId,
      cause: error,
    });
  }

  const retryableStatus = status === 429 || (status !== undefined && status >= 500);
  const network =
    /fetch failed|econnreset|enotfound|eai_again|socket|network|request to .+ failed, reason:\s*$/i.test(lower) ||
    /failed, reason:\s*$/i.test(text);

  if (retryableStatus || network) {
    return new GoogleSheetsError("UNAVAILABLE", sheetsUnavailableMessage(), {
      retryable: true,
      status,
      worksheet,
      spreadsheetId,
      cause: error,
    });
  }

  return new GoogleSheetsError(
    "UNAVAILABLE",
    redactGoogleErrorText(text).trim() || sheetsUnavailableMessage(),
    {
      retryable: false,
      status,
      worksheet,
      spreadsheetId,
      cause: error,
    },
  );
}

export function parseValuesGetResponse(data: unknown, worksheet = "Leads"): SheetReadSuccess {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new GoogleSheetsError(
      "MALFORMED",
      `Google Sheets returned a malformed response while reading the ${worksheet} tab.`,
      { worksheet },
    );
  }
  const record = data as Record<string, unknown>;
  const hasEnvelope = typeof record.range === "string" || typeof record.majorDimension === "string";
  if (!hasEnvelope) {
    throw new GoogleSheetsError(
      "MALFORMED",
      `Google Sheets returned a malformed response while reading the ${worksheet} tab.`,
      { worksheet },
    );
  }
  if (record.values !== undefined && !Array.isArray(record.values)) {
    throw new GoogleSheetsError(
      "MALFORMED",
      `Google Sheets returned a malformed response while reading the ${worksheet} tab.`,
      { worksheet },
    );
  }
  const rows = asStringMatrix(record.values, worksheet);
  const dataRowCount = rows.length === 0 ? 0 : Math.max(0, rows.length - 1);
  const empty = dataRowCount === 0;
  return {
    ok: true,
    rows,
    dataRowCount,
    empty,
    message: empty
      ? emptyLeadsTabMessage(worksheet)
      : `${worksheet} tab exists and contains ${dataRowCount} rows.`,
  };
}

function asStringMatrix(values: unknown, worksheet: string): string[][] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new GoogleSheetsError(
      "MALFORMED",
      `Google Sheets returned a malformed response while reading the ${worksheet} tab.`,
      { worksheet },
    );
  }
  return values.map((row) => {
    if (!Array.isArray(row)) {
      throw new GoogleSheetsError(
        "MALFORMED",
        `Google Sheets returned a malformed response while reading the ${worksheet} tab.`,
        { worksheet },
      );
    }
    return row.map((cell) => (cell == null ? "" : String(cell)));
  });
}

export async function coalesceInflight<T>(
  key: string,
  start: () => Promise<T>,
  store: Map<string, Promise<T>>,
): Promise<T> {
  const existing = store.get(key);
  if (existing) return existing;
  const promise = start().finally(() => {
    if (store.get(key) === promise) store.delete(key);
  });
  store.set(key, promise);
  return promise;
}

export type GoogleApiCallOptions = {
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
  worksheet?: string;
  spreadsheetId?: string;
  operation?: string;
};

export async function callGoogleApi<T>(
  operation: string,
  fn: (signal: AbortSignal) => Promise<T>,
  options: GoogleApiCallOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? SHEETS_TIMEOUT_MS;
  const retries = options.retries ?? SHEETS_MAX_RETRIES;
  const retryBaseMs = options.retryBaseMs ?? SHEETS_RETRY_BASE_MS;
  const context = {
    worksheet: options.worksheet,
    spreadsheetId: options.spreadsheetId,
    operation,
  };

  let lastError: GoogleSheetsError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withDeadline(timeoutMs, fn, () =>
        new GoogleSheetsError(
          "TIMEOUT",
          options.worksheet ? timeoutLeadsTabMessage(options.worksheet) : "Google Sheets request timed out.",
          { retryable: false, worksheet: options.worksheet, spreadsheetId: options.spreadsheetId },
        ),
      );
    } catch (error) {
      const classified = classifyGoogleSheetsError(error, context);
      lastError = classified;
      logGoogleSheetsError(classified, { operation, attempt: attempt + 1 });
      const canRetry = classified.retryable && classified.code !== "TIMEOUT" && attempt < retries;
      if (!canRetry) throw classified;
      await sleep(retryBaseMs * 2 ** attempt);
    }
  }
  throw lastError ?? new GoogleSheetsError("UNAVAILABLE", sheetsUnavailableMessage(), context);
}

async function withDeadline<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
  onTimeout: () => GoogleSheetsError,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = fn(controller.signal);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(onTimeout());
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    void work.catch(() => undefined);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
