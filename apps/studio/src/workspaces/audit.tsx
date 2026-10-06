import { useQuery } from '@tanstack/react-query';
import { management } from '../api';
import { ActivityDashboard } from './activity-dashboard';
import { type AuditEvent, projectAuditEvents } from './activity-metrics';

export function AuditLog({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const logs = useQuery({
    queryKey: ['audit'],
    queryFn: () => management.request<AuditEvent[]>('/audit'),
    refetchInterval: 15000,
  });
  const events = projectAuditEvents(logs.data?.data ?? [], projectId);
  return (
    <ActivityDashboard
      compact={compact}
      error={logs.error}
      events={events}
      pending={logs.isPending}
    />
  );
}
