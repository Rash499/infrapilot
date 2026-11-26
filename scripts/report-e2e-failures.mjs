/**
 * Converts the Playwright JSON report into GitHub annotations.
 *
 * The workflow log endpoint is not always reachable from automation, so failures are published as
 * annotations (title = test name, message = first error) instead of being buried in the step log.
 *
 * Usage: node scripts/report-e2e-failures.mjs /tmp/pw.json
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/report-e2e-failures.mjs <playwright-json-report>");
  process.exit(0);
}

let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`Could not read the Playwright report at ${file}: ${error instanceof Error ? error.message : error}`);
  process.exit(0);
}

const clean = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").replace(/%/g, "%25").slice(0, 900);

let failures = 0;
function walk(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const messages = (test.results ?? []).flatMap((result) => (result.errors ?? []).map((error) => error.message ?? ""));
      const failed = test.status !== "expected" && messages.length > 0;
      if (!failed) continue;
      failures += 1;
      console.log(`::error title=${clean(spec.title)}::${clean(messages.join(" | "))}`);
    }
  }
  for (const child of suite.suites ?? []) walk(child);
}

for (const suite of report.suites ?? []) walk(suite);

// Report-level errors cover failures that happen before or around the tests (web servers, reporters).
for (const error of report.errors ?? []) {
  const message = clean(error.message ?? error);
  if (message) {
    failures += 1;
    console.log(`::error title=Playwright run error::${message}`);
  }
}

const stats = report.stats ?? {};
console.log(
  `::notice title=Playwright summary::${JSON.stringify({
    expected: stats.expected ?? 0,
    unexpected: stats.unexpected ?? 0,
    flaky: stats.flaky ?? 0,
    skipped: stats.skipped ?? 0,
    durationMs: stats.duration ?? 0,
  })}`,
);
console.log(`Reported ${failures} failing test(s) from ${file}.`);
