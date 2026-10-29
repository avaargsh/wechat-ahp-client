import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const exceptionFile = new URL('../security/dependency-audit-exceptions.json', import.meta.url);
const { exceptions } = JSON.parse(readFileSync(exceptionFile, 'utf8'));
const exceptionByAdvisory = new Map(exceptions.map((exception) => [exception.advisory, exception]));
const today = new Date().toISOString().slice(0, 10);
const audit = spawnSync('pnpm', ['audit', '--audit-level', 'high', '--json'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

if (audit.error) {
  console.error(`Unable to run pnpm audit: ${audit.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error('pnpm audit did not return valid JSON. Failing closed.');
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

if (!report.advisories || typeof report.advisories !== 'object') {
  console.error('pnpm audit JSON did not include an advisory map. Failing closed.');
  console.error(JSON.stringify(report.error ?? report.metadata ?? report));
  process.exit(1);
}

const highAdvisories = Object.values(report.advisories).filter((advisory) =>
  ['high', 'critical'].includes(advisory.severity),
);
const failures = [];

for (const advisory of highAdvisories) {
  const id = advisory.github_advisory_id;
  const exception = exceptionByAdvisory.get(id);
  if (!exception) {
    failures.push(`${id ?? `npm:${advisory.id}`} ${advisory.module_name}: no active exception`);
    continue;
  }

  if (today >= exception.expiresOn) {
    failures.push(`${id} ${exception.package}: exception expired on ${exception.expiresOn}`);
    continue;
  }

  if (advisory.module_name !== exception.package) {
    failures.push(`${id}: expected package ${exception.package}, found ${advisory.module_name}`);
    continue;
  }

  const findings = (advisory.findings ?? []).flatMap((finding) =>
    (finding.paths ?? []).map((path) => ({ version: finding.version, path })),
  );
  const expected = exception.versions.flatMap((version) =>
    exception.paths.map((path) => ({ version, path })),
  );
  const sortFindings = (items) =>
    items.map(({ version, path }) => `${version}\t${path}`).sort().join('\n');

  if (sortFindings(findings) !== sortFindings(expected)) {
    failures.push(`${id} ${exception.package}: affected version or dependency path changed`);
    continue;
  }

  console.warn(
    `TIME-BOXED EXCEPTION ${id} ${exception.package}; expires ${exception.expiresOn}. ${exception.isolation}`,
  );
}

if (failures.length > 0) {
  console.error('Dependency audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

if (audit.status !== 0 && highAdvisories.length === 0) {
  console.error(`pnpm audit failed with exit code ${audit.status ?? 'unknown'}.`);
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

console.log(`Dependency audit passed with ${highAdvisories.length} exact, unexpired high-severity exception(s).`);
