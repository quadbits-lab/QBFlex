export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertKind =
  | 'error_rate'
  | 'error_count'
  | 'p95_latency'
  | 'dead_letter_depth'
  | 'quota_usage'
  | 'backup_failure'
  | 'snapshot_age';

export interface AlertChannel {
  type: 'email';
  to: string;
}

export interface AlertRuleInput {
  name: string;
  kind: AlertKind;
  config: AlertConfig;
  severity: AlertSeverity;
  channels: AlertChannel[];
  enabled?: boolean;
  projectId?: string | null;
}

export interface AlertConfig {
  threshold: number;
  windowMinutes?: number;
  route?: string;
  projectId?: string;
}

export interface AlertRuleSummary {
  id: string;
  orgId: string;
  projectId?: string | null;
  name: string;
  kind: AlertKind;
  severity: AlertSeverity;
  channels: AlertChannel[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRule extends AlertRuleSummary {
  config: AlertConfig;
  createdBy: string;
}

export interface NotificationSummary {
  id: string;
  orgId: string;
  projectId?: string | null;
  severity: AlertSeverity;
  title: string;
  body?: string;
  readAt?: string | null;
  createdAt: string;
}

export interface AlertDelivery {
  id: string;
  ruleId: string;
  channel: string;
  result: 'sent' | 'failed' | 'silenced';
  createdAt: string;
}

export function isValidAlertKind(kind: string): kind is AlertKind {
  return [
    'error_rate',
    'error_count',
    'p95_latency',
    'dead_letter_depth',
    'quota_usage',
    'backup_failure',
    'snapshot_age',
  ].includes(kind as AlertKind);
}

export function isValidAlertSeverity(severity: string): severity is AlertSeverity {
  return ['info', 'warning', 'critical'].includes(severity as AlertSeverity);
}
