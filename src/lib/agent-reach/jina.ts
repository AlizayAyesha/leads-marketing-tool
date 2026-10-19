import { extractLinkedInPublicIdentifier } from "@/lib/linkedin/url";

export const JINA_LINKEDIN_AUTH_WALL = "JINA_LINKEDIN_AUTH_WALL";

export type JinaLinkedInRead = {
  ok: boolean;
  status: number;
  url: string;
  sourceUrl: string;
  title: string | null;
  text: string;
  authWall: boolean;
  error: string | null;
};

const AUTH_WALL =
  /sign up\s*\|\s*linkedin|join linkedin|agree & join linkedin|authwall|sign in to view|member to view/i;

export function isLinkedInPublicAuthWall(text: string, title?: string | null) {
  const haystack = `${title ?? ""}\n${text}`;
  return AUTH_WALL.test(haystack);
}

export function jinaReaderUrl(profileUrl: string) {
  return `https://r.jina.ai/${profileUrl.replace(/^https?:\/\//i, "https://")}`;
}

export async function readLinkedInPublicPage(
  profileUrl: string,
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<JinaLinkedInRead> {
  const identifier = extractLinkedInPublicIdentifier(profileUrl);
  const sourceUrl = identifier ? `https://www.linkedin.com/in/${identifier}` : profileUrl;
  const url = jinaReaderUrl(sourceUrl);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "text/plain" },
    });
    const text = await response.text();
    const titleMatch = text.match(/^Title:\s*(.+)$/m);
    const title = titleMatch?.[1]?.trim() ?? null;
    const authWall = isLinkedInPublicAuthWall(text, title);
    return {
      ok: response.ok && !authWall,
      status: response.status,
      url,
      sourceUrl,
      title,
      text,
      authWall,
      error: authWall
        ? "Jina Reader returned a LinkedIn login/signup wall. That is not profile evidence."
        : response.ok
          ? null
          : `Jina Reader failed (${response.status}).`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      sourceUrl,
      title: null,
      text: "",
      authWall: false,
      error: error instanceof Error ? error.message : "Jina Reader request failed.",
    };
  } finally {
    clearTimeout(timer);
  }
}
