export type BrowserIntent = {
  intent: "BROWSER_NAVIGATE" | "EXPORT_SHEET" | "SHOW_QUEUE";
  url?: "sheet" | "lead-website";
  summary: string;
};

export function browserIntentFromCommand(command: string): BrowserIntent | null {
  const text = command.toLowerCase();
  if (/open (the )?drafts|show me what you found/.test(text)) {
    return { intent: "SHOW_QUEUE", summary: "Show the approval queue / drafts." };
  }
  if (/open (my )?(google )?sheet|open the (configured )?spreadsheet/.test(text)) {
    return {
      intent: "BROWSER_NAVIGATE",
      url: "sheet",
      summary: "Open the configured Google Sheet in Jarvis Chrome.",
    };
  }
  if (/open (this |the )?compan(y|ies)? website|open this website/.test(text)) {
    return {
      intent: "BROWSER_NAVIGATE",
      url: "lead-website",
      summary: "Open the company website in Jarvis Chrome.",
    };
  }
  if (/update (the )?research columns/.test(text)) {
    return {
      intent: "EXPORT_SHEET",
      summary: "Write Jarvis enrichment columns to the export worksheet. Original lead fields stay intact.",
    };
  }
  return null;
}
