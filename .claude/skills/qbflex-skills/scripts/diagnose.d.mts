export interface DoctorFinding {
  code: string;
  severity: 'info' | 'warning' | 'error';
  status: 'pass' | 'fail' | 'unknown' | 'unconfigured';
  message: string;
  remediation: string;
}
export function diagnose(
  directory: string,
  options?: { env?: Record<string, string | undefined>; probeURL?: string },
): Promise<Record<string, unknown>>;
export function doctor(
  directory: string,
  options?: { env?: Record<string, string | undefined>; probeURL?: string },
): Promise<{
  specificationVersion: '1.1';
  readOnly: true;
  exitStatus: 0 | 1;
  findings: DoctorFinding[];
  inventory: Record<string, unknown>;
}>;
