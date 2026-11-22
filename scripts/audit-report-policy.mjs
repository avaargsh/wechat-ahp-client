// All audit exits must supply a complete, internally consistent report.
// pnpm 10 can return exit=1 for Low/Moderate-only vulnerabilities even under
// --audit-level high; a nonzero exit is not, by itself, an advisory decision.
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

export function isCompleteAuditReport(report) {
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
    if (!advisory || typeof advisory !== 'object' || Array.isArray(advisory) ||
        !Object.hasOwn(observed, advisory.severity)) {
      return false;
    }
    observed[advisory.severity]++;
  }
  return SEVERITIES.every((severity) => Number.isSafeInteger(metadata[severity]) &&
    metadata[severity] >= 0 && observed[severity] === metadata[severity]);
}

export function acceptsLowSeverityAuditExit(audit, report) {
  if (!audit || audit.status !== 1 || audit.signal !== null ||
      typeof audit.stderr !== 'string' || audit.stderr.trim() !== '' ||
      !isCompleteAuditReport(report)) {
    return false;
  }
  const metadata = report.metadata.vulnerabilities;
  return metadata.high === 0 && metadata.critical === 0 &&
    metadata.info + metadata.low + metadata.moderate > 0;
}
