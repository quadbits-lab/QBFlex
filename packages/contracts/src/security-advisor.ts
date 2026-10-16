export interface SecurityFinding {
  id: string;
  code: string;
  severity: 'high' | 'medium' | 'info';
  resource: string;
  evidence: string[];
  remediation: string;
  acknowledgedUntil: number | null;
}
export interface SecurityReport {
  scannedAt: number;
  schemaVersion: number;
  findings: SecurityFinding[];
  truncated: boolean;
  limitations: string[];
}
