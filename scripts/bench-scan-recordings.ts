// Fails (exit 1) if any file under bench/recordings looks like it holds a
// key, an Authorization header, a credential URL or raw headers. Prints the
// file and rule only, never the matched text. If META_*_API_KEY values are
// set in the environment, their literal values are searched for too.

import { join } from "node:path";
import { scanRecordingsDir } from "../lib/bench/secrets";

const dir = process.argv[2] ?? join(process.cwd(), "bench", "recordings");
const secrets = [process.env.META_SAM_API_KEY, process.env.META_SPARK_API_KEY, process.env.META_VOICE_API_KEY].filter(
  (v): v is string => Boolean(v),
);

const { files, findings } = scanRecordingsDir(dir, secrets);
if (findings.length) {
  for (const f of findings) console.error(`FAIL ${f.file}: ${f.problems.join(", ")}`);
  console.error(`bench-scan-recordings: ${findings.length} of ${files} files failed.`);
  process.exit(1);
}
console.log(`bench-scan-recordings: ${files} files clean.`);
