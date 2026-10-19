/**
 * Side-effect import guard for one-off send-loop scripts.
 * Must be imported immediately after `./load-local-env` and before any app imports
 * so process.exit runs during module evaluation (ESM hoists imports).
 *
 * Daily operator send is Home. Set JARVIS_ALLOW_SCRIPT_SEND=1 to bypass.
 */
const scriptPath = process.argv[1] || "";
const scriptName =
  scriptPath
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.(ts|js|mjs|cjs)$/, "") || "script";

if (process.env.JARVIS_ALLOW_SCRIPT_SEND !== "1") {
  console.error(
    [
      `[${scriptName}] Blocked: daily send is Home (http://localhost:3000), not this script.`,
      "Set JARVIS_ALLOW_SCRIPT_SEND=1 only if you intentionally need this diagnostic path.",
      "See scripts/README.md.",
    ].join("\n"),
  );
  process.exit(1);
}
