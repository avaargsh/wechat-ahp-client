// A pnpm audit exit status of 1 is ambiguous in pnpm 10: it can accompany
// a complete advisory JSON report with only Low/Moderate findings, despite
// --audit-level high. Never accept it based on the exit code alone.
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

export function acceptsLowSeverityAuditExit(audit, report) {
  if (!audit || audit.status !== 1 || audit.signal !== null ||
      typeof audit.stderr !== 'string' || audit.stderr.trim() !== '') {
    return false;
  }
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      report.error != null || !report.advisories ||
      typeof report.advisories !== 'object' || Array.isArray(report.advisories)) {
    return false;
  }
  const metadata = report.metadata?.vulnerabilities;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const observed = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const advisory of Object.values(report.advisories)) {
    if (!advisory || typeof advisory !== 'object' ||
        !Object.hasOwn(observed, advisory.severity)) {
      return false;
    }
    observed[advisory.severity]++;
  }
  for (const severity of SEVERITIES) {
    if (!Number.isSafeInteger(metadata[severity]) || metadata[severity] < 0 ||
        observed[severity] !== metadata[severity]) {
      return false;
    }
  }
  return observed.high === 0 && observed.critical === 0 &&
    observed.info + observed.low + observed.moderate > 0;
}
