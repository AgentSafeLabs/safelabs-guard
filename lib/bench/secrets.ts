// Secret scan for benchmark recordings. A recording may hold only
// {model, recordedAt, response}; anything that looks like a key, an
// Authorization header or a credential URL fails the scan. Findings name the
// rule, never the matched text, so a scan never prints a secret.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RULES: readonly { label: string; pattern: RegExp }[] = [
  { label: "Authorization header", pattern: /authorization["'\s]*[:=]/i },
  { label: "bearer token", pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i },
  { label: "api key field", pattern: /\b(?:x-)?api[_-]?key\b/i },
  { label: "key env var name", pattern: /\bMETA_[A-Z_]*API_KEY\b/ },
  { label: "credential in URL", pattern: /[?&](?:key|api_?key|token|access_token|sig|signature|secret)=/i },
  { label: "secret-style key", pattern: /\b(?:sk|pk|rk|key)[-_][A-Za-z0-9_-]{16,}/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "long token-like string", pattern: /[A-Za-z0-9_-]{40,}/ },
  { label: "raw headers", pattern: /"(?:headers|set-cookie|cookie)"\s*:/i },
];

const ALLOWED_FIELDS = ["model", "recordedAt", "response"];

/** Problems found in one recording's text. `secrets` are literal values (e.g. env keys) that must not appear. */
export function scanRecordingText(text: string, secrets: readonly string[] = []): string[] {
  const problems: string[] = [];
  for (const { label, pattern } of RULES) if (pattern.test(text)) problems.push(label);
  for (const secret of secrets) if (secret && secret.length >= 6 && text.includes(secret)) problems.push("configured key value");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) problems.push("not a recording object");
    else {
      const extra = Object.keys(parsed).filter((k) => !ALLOWED_FIELDS.includes(k));
      if (extra.length) problems.push(`unexpected fields (${extra.length})`);
    }
  } catch {
    problems.push("not valid JSON");
  }
  return problems;
}

export interface ScanFinding {
  file: string;
  problems: string[];
}

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Scans every file under `dir`. Files that are not .json are findings too. */
export function scanRecordingsDir(dir: string, secrets: readonly string[] = []): { files: number; findings: ScanFinding[] } {
  const files = walk(dir).filter((f) => !f.endsWith(".gitkeep"));
  const findings: ScanFinding[] = [];
  for (const file of files) {
    const rel = relative(dir, file);
    if (!file.endsWith(".json")) {
      findings.push({ file: rel, problems: ["not a .json recording"] });
      continue;
    }
    const problems = scanRecordingText(readFileSync(file, "utf8"), secrets);
    if (problems.length) findings.push({ file: rel, problems });
  }
  return { files: files.length, findings };
}
