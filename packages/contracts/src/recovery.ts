export const recoveryIntervals = [1, 6, 12, 24, 168] as const;
export type RecoveryIntervalHours = (typeof recoveryIntervals)[number];

export const replicaStates = [
  'staging',
  'encrypted',
  'uploading',
  'verified',
  'failed',
] as const;
export type ReplicaState = (typeof replicaStates)[number];

export const drillStates = [
  'queued',
  'restoring',
  'validating',
  'complete',
  'partial',
  'failed',
  'cancelled',
] as const;
export type DrillState = (typeof drillStates)[number];

export const recoveryFindingCodes = [
  'BACKUP_STALE',
  'DESTINATION_UNAVAILABLE',
  'BACKUP_CORRUPT',
  'OBJECT_BACKUP_MISSING',
  'KEY_UNAVAILABLE',
  'DISK_PRESSURE',
] as const;
export type RecoveryFindingCode = (typeof recoveryFindingCodes)[number];

export type DrillDimensionResult = 'passed' | 'failed' | 'skipped';

export interface RecoverySettings {
  enabled: boolean;
  intervalHours: RecoveryIntervalHours;
  retentionDays: number;
  retentionWeeks: number;
  drillIntervalHours: number;
  version: number;
  updatedAt: string;
}

export interface RecoveryDestinationSummary {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  state: 'active' | 'disabled';
  credentialsConfigured: true;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryDestinationInput {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface BackupReplicaSummary {
  id: string;
  backupId: string;
  destinationId: string;
  objectKey: string | null;
  state: ReplicaState;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryInventoryItem {
  id: string;
  branchId: string;
  checksum: string;
  schemaVersion: number;
  createdAt: string;
  ageMs: number;
  stale: boolean;
  replicas: BackupReplicaSummary[];
}

export interface RecoveryFinding {
  id: string;
  code: RecoveryFindingCode;
  resource: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface RecoveryInventory {
  settings: RecoverySettings;
  items: RecoveryInventoryItem[];
  findings: RecoveryFinding[];
  newestBackupAt: string | null;
}

export interface RecoveryDrillReport {
  database: DrillDimensionResult;
  objects: DrillDimensionResult;
  key: DrillDimensionResult;
  notes: string[];
}

export interface RecoveryDrillSummary {
  id: string;
  backupId: string;
  branchId: string;
  state: DrillState;
  databaseResult: DrillDimensionResult | null;
  objectsResult: DrillDimensionResult | null;
  keyResult: DrillDimensionResult | null;
  report: RecoveryDrillReport | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}
