import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Row = Record<string, any>;

type DashboardData = {
  processes: Row[];
  batches: Row[];
  progressLogs: Row[];
  targets: Row[];
  assignments: Row[];
  alerts: Row[];
  staff: Row[];
};

type HistoryItem = {
  id: string;
  time: number;
  timeLabel: string;
  category: 'progress' | 'assignment' | 'alert';
  title: string;
  subtitle: string;
  detail: string;
  route: string;
};

const ROUTES = {
  dashboard: '/dashboard',
  progress: '/progress',
  assignments: '/assignments',
  alerts: '/alerts',
  imports: '/imports',
};

const ACTIVE_ALERT_STATUSES = new Set(['open', 'in_progress']);
const CLOSED_ALERT_STATUSES = new Set(['closed']);

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function buildRoute(
  basePath: string,
  params?: Record<string, string | number | null | undefined>,
) {
  if (!params) return basePath;

  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value) !== '') {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function getValue<T = any>(row: Row | null | undefined, keys: string[], fallback?: T): T | undefined {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') {
      return value as T;
    }
  }
  return fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function sameId(a: unknown, b: unknown): boolean {
  return String(a ?? '') === String(b ?? '');
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateKeyFromValue(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return formatDateKey(date);
}

function timeFromValue(value: unknown): number {
  if (!value) return 0;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return 0;
  return date.getTime();
}

function formatDateTime(value: unknown): string {
  const ts = timeFromValue(value);
  if (!ts) return '-';
  const date = new Date(ts);
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

function formatTimeOnly(value: unknown): string {
  const ts = timeFromValue(value);
  if (!ts) return '-';
  const date = new Date(ts);
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mm}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function statusLabel(status: string): string {
  switch (normalizeLower(status)) {
    case 'open':
      return '未対応';
    case 'in_progress':
      return '対応中';
    case 'closed':
      return '完了';
    default:
      return status || '-';
  }
}

function severityLabel(severity: string): string {
  switch (normalizeLower(severity)) {
    case 'critical':
      return '重大';
    case 'high':
      return '高';
    case 'medium':
      return '中';
    case 'low':
      return '低';
    default:
      return severity || '-';
  }
}

function alertTypeLabel(alertType: string): string {
  switch (normalizeLower(alertType)) {
    case 'delay':
      return '遅延';
    case 'no_update':
      return '更新なし';
    case 'quality':
      return '品質';
    case 'sla_risk':
      return 'SLAリスク';
    case 'understaff':
      return '人員不足';
    default:
      return alertType || '-';
  }
}

function scopeProcessesByCenter(processes: Row[], centerId: unknown): Row[] {
  if (!centerId) return processes;
  const filtered = processes.filter((row) => {
    const rowCenterId = getValue(row, ['center_id', 'centerId'], null);
    if (rowCenterId == null) return true;
    return sameId(rowCenterId, centerId);
  });
  return filtered.length > 0 ? filtered : processes;
}

function scopeRowsByCenter(rows: Row[], centerId: unknown, processIds: Set<string>): Row[] {
  if (!centerId && processIds.size === 0) return rows;

  const byCenter = rows.filter((row) => {
    const rowCenterId = getValue(row, ['center_id', 'centerId'], null);
    if (centerId && rowCenterId != null) {
      return sameId(rowCenterId, centerId);
    }

    const processId = getValue(row, ['process_id', 'processId'], null);
    if (processId != null && processIds.size > 0) {
      return processIds.has(String(processId));
    }

    return true;
  });

  return byCenter.length > 0 ? byCenter : rows;
}

function getProcessName(row: Row, processMap: Map<string, Row>): string {
  const processId = getValue(row, ['process_id', 'processId'], null);
  if (processId != null && processMap.has(String(processId))) {
    const process = processMap.get(String(processId))!;
    return (
      getValue<string>(process, ['name', 'process_name', 'processName', 'code'], undefined) ||
      `工程 ${processId}`
    );
  }

  return (
    getValue<string>(row, ['process_name', 'processName', 'process_code', 'processCode'], undefined) ||
    '工程未設定'
  );
}

function getStaffName(row: Row, staffMap: Map<string, Row>): string {
  const staffId = getValue(row, ['staff_id', 'staffId'], null);
  if (staffId != null && staffMap.has(String(staffId))) {
    const staff = staffMap.get(String(staffId))!;
    return (
      getValue<string>(staff, ['name', 'full_name', 'display_name', 'staff_name'], undefined) ||
      `スタッフ ${staffId}`
    );
  }

  return (
    getValue<string>(row, ['staff_name', 'staffName', 'name'], undefined) ||
    'スタッフ未設定'
  );
}

function getBatchNo(row: Row): string {
  return (
    getValue<string>(row, ['batch_no', 'batchNo', 'batch_code', 'batchCode'], undefined) || '-'
  );
}

function getTargetDate(row: Row): string {
  return (
    getValue<string>(
      row,
      ['target_date', 'assignment_date', 'work_date', 'scheduled_date', 'planned_date', 'date'],
      '',
    ) || ''
  );
}

function getTimestamp(row: Row): unknown {
  return (
    getValue(
      row,
      ['updated_at', 'resolved_at', 'created_at', 'logged_at', 'event_at', 'timestamp'],
      '',
    ) || ''
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const hasLoadedRef = useRef(false);

  const centerId = getValue(profile as Row, ['centerId', 'center_id'], null);
  const centerName =
    getValue<string>(profile as Row, ['centerName', 'center_name'], undefined) || '未設定センター';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [data, setData] = useState<DashboardData>({
    processes: [],
    batches: [],
    progressLogs: [],
    targets: [],
    assignments: [],
    alerts: [],
    staff: [],
  });

  const fetchDashboardData = useCallback(async () => {
    setError('');

    if (!hasLoadedRef.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [
        processesRes,
        batchesRes,
        progressLogsRes,
        targetsRes,
        assignmentsRes,
        alertsRes,
        staffRes,
      ] = await Promise.all([
        supabase.from('processes').select('*'),
        supabase.from('work_batches').select('*'),
        supabase.from('progress_logs').select('*'),
        supabase.from('daily_process_targets').select('*'),
        supabase.from('work_assignments').select('*'),
        supabase.from('alerts').select('*'),
        supabase.from('staff').select('*'),
      ]);

      const firstError =
        processesRes.error ||
        batchesRes.error ||
        progressLogsRes.error ||
        targetsRes.error ||
        assignmentsRes.error ||
        alertsRes.error ||
        staffRes.error;

      if (firstError) {
        throw firstError;
      }

      const rawProcesses = processesRes.data ?? [];
      const scopedProcesses = scopeProcessesByCenter(rawProcesses, centerId);
      const processIds = new Set(
        scopedProcesses
          .map((row) => getValue(row, ['id'], null))
          .filter((id) => id != null)
          .map((id) => String(id)),
      );

      const nextData: DashboardData = {
        processes: scopedProcesses,
        batches: scopeRowsByCenter(batchesRes.data ?? [], centerId, processIds),
        progressLogs: scopeRowsByCenter(progressLogsRes.data ?? [], centerId, processIds),
        targets: scopeRowsByCenter(targetsRes.data ?? [], centerId, processIds),
        assignments: scopeRowsByCenter(assignmentsRes.data ?? [], centerId, processIds),
        alerts: scopeRowsByCenter(alertsRes.data ?? [], centerId, processIds),
        staff: scopeRowsByCenter(staffRes.data ?? [], centerId, processIds),
      };

      setData(nextData);
      setLastUpdatedAt(Date.now());
      hasLoadedRef.current = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ダッシュボードの取得に失敗しました。';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [centerId]);

  useEffect(() => {
    void fetchDashboardData();
  }, [fetchDashboardData]);

  const dashboard = useMemo(() => {
    const todayKey = formatDateKey(new Date());

    const processMap = new Map<string, Row>(
      data.processes
        .map((row) => [String(getValue(row, ['id'], '')), row] as const)
        .filter(([id]) => id !== ''),
    );

    const staffMap = new Map<string, Row>(
      data.staff
        .map((row) => [String(getValue(row, ['id'], '')), row] as const)
        .filter(([id]) => id !== ''),
    );

    const batchMap = new Map<string, Row>(
      data.batches
        .map((row) => [String(getValue(row, ['id'], '')), row] as const)
        .filter(([id]) => id !== ''),
    );

    const todayBatches = data.batches.filter((row) => dateKeyFromValue(getTargetDate(row)) === todayKey);
    const targetBatches =
      todayBatches.length > 0
        ? todayBatches
        : data.batches.filter(
            (row) => !['completed', 'done', 'closed'].includes(normalizeLower(getValue(row, ['status'], ''))),
          );

    const todayTargets = data.targets.filter((row) => dateKeyFromValue(getTargetDate(row)) === todayKey);
    const targetRows = todayTargets.length > 0 ? todayTargets : data.targets;

    const todayAssignments = data.assignments.filter((row) => dateKeyFromValue(getTargetDate(row)) === todayKey);
    const assignmentRows =
      todayAssignments.length > 0
        ? todayAssignments
        : data.assignments.filter(
            (row) => !['removed', 'cancelled', 'closed'].includes(normalizeLower(getValue(row, ['status'], ''))),
          );

    const activeAlerts = data.alerts.filter((row) =>
      ACTIVE_ALERT_STATUSES.has(normalizeLower(getValue(row, ['status'], 'open'))),
    );

    const alertRateScopeBase = data.alerts.filter((row) => {
      const created = dateKeyFromValue(getValue(row, ['created_at', 'createdAt'], ''));
      const resolved = dateKeyFromValue(
        getValue(row, ['resolved_at', 'resolvedAt', 'updated_at', 'updatedAt'], ''),
      );
      return created === todayKey || resolved === todayKey;
    });

    const alertRateScope = alertRateScopeBase.length > 0 ? alertRateScopeBase : data.alerts;

    const totalPlannedQty = targetBatches.reduce((sum, row) => {
      return sum + toNumber(getValue(row, ['planned_qty', 'plannedQty', 'target_qty', 'targetQty'], 0));
    }, 0);

    const totalActualQty = targetBatches.reduce((sum, row) => {
      return sum + toNumber(getValue(row, ['actual_qty', 'actualQty', 'completed_qty', 'completedQty'], 0));
    }, 0);

    const totalProgressRate =
      totalPlannedQty > 0 ? clampPercent((totalActualQty / totalPlannedQty) * 100) : 0;

    const delayedBatchCount = targetBatches.filter((row) => {
      const status = normalizeLower(getValue(row, ['status'], ''));
      const planned = toNumber(getValue(row, ['planned_qty', 'plannedQty', 'target_qty', 'targetQty'], 0));
      const actual = toNumber(getValue(row, ['actual_qty', 'actualQty', 'completed_qty', 'completedQty'], 0));
      return (
        ['delayed', 'delay', 'late', 'overdue'].includes(status) ||
        (planned > 0 && actual < planned && status !== 'closed' && status !== 'completed')
      );
    }).length;

    const assignedPeopleCount = (() => {
      const processStaffMap = new Map<string, Set<string>>();
      for (const row of assignmentRows) {
        const status = normalizeLower(getValue(row, ['status'], 'active'));
        if (['removed', 'cancelled', 'closed', 'inactive'].includes(status)) continue;

        const processId = getValue(row, ['process_id', 'processId'], null);
        const staffId = getValue(row, ['staff_id', 'staffId'], null);
        if (processId == null || staffId == null) continue;

        const key = String(processId);
        if (!processStaffMap.has(key)) {
          processStaffMap.set(key, new Set<string>());
        }
        processStaffMap.get(key)!.add(String(staffId));
      }

      const allStaff = new Set<string>();
      for (const set of processStaffMap.values()) {
        for (const id of set.values()) {
          allStaff.add(id);
        }
      }
      return allStaff.size;
    })();

    const processTargetMap = new Map<string, number>();
    for (const row of targetRows) {
      const processId = getValue(row, ['process_id', 'processId'], null);
      if (processId == null) continue;

      const targetCount = toNumber(
        getValue(
          row,
          [
            'target_staff_count',
            'required_staff_count',
            'required_count',
            'target_count',
            'planned_staff_count',
            'staff_target',
          ],
          0,
        ),
      );

      processTargetMap.set(String(processId), (processTargetMap.get(String(processId)) ?? 0) + targetCount);
    }

    const processAssignedMap = new Map<string, Set<string>>();
    for (const row of assignmentRows) {
      const status = normalizeLower(getValue(row, ['status'], 'active'));
      if (['removed', 'cancelled', 'closed', 'inactive'].includes(status)) continue;

      const processId = getValue(row, ['process_id', 'processId'], null);
      const staffId = getValue(row, ['staff_id', 'staffId'], null);
      if (processId == null || staffId == null) continue;

      const key = String(processId);
      if (!processAssignedMap.has(key)) {
        processAssignedMap.set(key, new Set<string>());
      }
      processAssignedMap.get(key)!.add(String(staffId));
    }

    const shortageRows = Array.from(new Set([...processTargetMap.keys(), ...processAssignedMap.keys()])).map(
      (processId) => {
        const target = processTargetMap.get(processId) ?? 0;
        const assigned = processAssignedMap.get(processId)?.size ?? 0;
        const shortage = Math.max(target - assigned, 0);

        return {
          processId,
          processName:
            getValue<string>(processMap.get(processId), ['name', 'process_name', 'processName', 'code'], undefined) ||
            `工程 ${processId}`,
          target,
          assigned,
          shortage,
          route: buildRoute(ROUTES.assignments, {
            from: 'dashboard',
            processId,
            mode: 'shortage',
          }),
        };
      },
    );

    const totalShortage = shortageRows.reduce((sum, row) => sum + row.shortage, 0);

    const delayProcessMap = new Map<
      string,
      {
        processId: string;
        processName: string;
        plannedQty: number;
        actualQty: number;
        batchCount: number;
        activeDelayAlerts: number;
        route: string;
      }
    >();

    for (const row of targetBatches) {
      const processId = String(getValue(row, ['process_id', 'processId'], 'unknown'));
      if (!delayProcessMap.has(processId)) {
        delayProcessMap.set(processId, {
          processId,
          processName: getProcessName(row, processMap),
          plannedQty: 0,
          actualQty: 0,
          batchCount: 0,
          activeDelayAlerts: 0,
          route: buildRoute(ROUTES.progress, {
            from: 'dashboard',
            processId,
            mode: 'delay',
          }),
        });
      }

      const item = delayProcessMap.get(processId)!;
      item.plannedQty += toNumber(getValue(row, ['planned_qty', 'plannedQty', 'target_qty', 'targetQty'], 0));
      item.actualQty += toNumber(getValue(row, ['actual_qty', 'actualQty', 'completed_qty', 'completedQty'], 0));
      item.batchCount += 1;
    }

    for (const row of activeAlerts) {
      const type = normalizeLower(getValue(row, ['alert_type', 'alertType'], ''));
      if (type !== 'delay') continue;

      const processIdFromAlert = getValue(row, ['process_id', 'processId'], null);
      const batchId = getValue(row, ['batch_id', 'batchId'], null);

      let processId: string | null = processIdFromAlert != null ? String(processIdFromAlert) : null;

      if (!processId && batchId != null && batchMap.has(String(batchId))) {
        processId = String(getValue(batchMap.get(String(batchId))!, ['process_id', 'processId'], ''));
      }

      if (!processId) continue;

      if (!delayProcessMap.has(processId)) {
        delayProcessMap.set(processId, {
          processId,
          processName:
            getValue<string>(processMap.get(processId), ['name', 'process_name', 'processName', 'code'], undefined) ||
            `工程 ${processId}`,
          plannedQty: 0,
          actualQty: 0,
          batchCount: 0,
          activeDelayAlerts: 0,
          route: buildRoute(ROUTES.progress, {
            from: 'dashboard',
            processId,
            mode: 'delay',
          }),
        });
      }

      delayProcessMap.get(processId)!.activeDelayAlerts += 1;
    }

    const delayTop3 = Array.from(delayProcessMap.values())
      .map((row) => {
        const delayQty = Math.max(row.plannedQty - row.actualQty, 0);
        const progressRate =
          row.plannedQty > 0 ? clampPercent((row.actualQty / row.plannedQty) * 100) : 0;

        return {
          ...row,
          delayQty,
          progressRate,
        };
      })
      .filter((row) => row.delayQty > 0 || row.activeDelayAlerts > 0)
      .sort((a, b) => {
        if (b.activeDelayAlerts !== a.activeDelayAlerts) {
          return b.activeDelayAlerts - a.activeDelayAlerts;
        }
        if (b.delayQty !== a.delayQty) {
          return b.delayQty - a.delayQty;
        }
        return a.progressRate - b.progressRate;
      })
      .slice(0, 3);

    const priorityAlerts = [...activeAlerts]
      .map((alert) => {
        const batchId = getValue(alert, ['batch_id', 'batchId'], null);
        const batchNo =
          batchId != null && batchMap.has(String(batchId))
            ? getBatchNo(batchMap.get(String(batchId))!)
            : '-';

        return {
          ...alert,
          route: buildRoute(ROUTES.alerts, {
            from: 'dashboard',
            alertId: getValue(alert, ['id'], ''),
            processId: getValue(alert, ['process_id', 'processId'], ''),
            batchId: batchId ?? '',
            batchNo,
          }),
        };
      })
      .sort((a, b) => {
        const severityA = SEVERITY_ORDER[normalizeLower(getValue(a, ['severity'], 'low'))] ?? 0;
        const severityB = SEVERITY_ORDER[normalizeLower(getValue(b, ['severity'], 'low'))] ?? 0;
        if (severityB !== severityA) return severityB - severityA;
        return timeFromValue(getTimestamp(b)) - timeFromValue(getTimestamp(a));
      })
      .slice(0, 6);

    const alertCompletionRate =
      alertRateScope.length > 0
        ? clampPercent(
            (alertRateScope.filter((row) =>
              CLOSED_ALERT_STATUSES.has(normalizeLower(getValue(row, ['status'], ''))),
            ).length /
              alertRateScope.length) *
              100,
          )
        : 0;

    const progressHistory = data.progressLogs
      .filter((row) => {
        const dateKey = dateKeyFromValue(getValue(row, ['created_at', 'logged_at', 'updated_at'], ''));
        return dateKey === todayKey;
      })
      .map((row, index) => {
        const batchId = getValue(row, ['batch_id', 'batchId'], null);
        const batch = batchId != null ? batchMap.get(String(batchId)) : undefined;
        const qty = toNumber(
          getValue(row, ['actual_qty', 'actualQty', 'completed_qty', 'completedQty', 'qty', 'quantity'], 0),
        );
        const memo = getValue<string>(row, ['memo', 'comment', 'message'], '') || '';

        return {
          id: `progress-${getValue(row, ['id'], index)}`,
          time: timeFromValue(getValue(row, ['created_at', 'logged_at', 'updated_at'], '')),
          timeLabel: formatTimeOnly(getValue(row, ['created_at', 'logged_at', 'updated_at'], '')),
          category: 'progress' as const,
          title: '進捗更新',
          subtitle: `${getProcessName(row, processMap)} / ${batch ? getBatchNo(batch) : getBatchNo(row)}`,
          detail: memo || (qty > 0 ? `実績 ${qty}` : '進捗が更新されました'),
          route: buildRoute(ROUTES.progress, {
            from: 'dashboard',
            batchId: batchId ?? '',
            processId: getValue(row, ['process_id', 'processId'], ''),
          }),
        };
      });

    const assignmentHistory = data.assignments
      .filter((row) => {
        const dateKey = dateKeyFromValue(getValue(row, ['updated_at', 'created_at'], ''));
        return dateKey === todayKey;
      })
      .map((row, index) => {
        const status = normalizeLower(getValue(row, ['status'], 'active'));
        const actionLabel =
          status === 'removed' || status === 'cancelled'
            ? '配置解除'
            : timeFromValue(getValue(row, ['updated_at'], 0)) > timeFromValue(getValue(row, ['created_at'], 0))
              ? '配置変更'
              : '新規配置';

        return {
          id: `assignment-${getValue(row, ['id'], index)}`,
          time: timeFromValue(getValue(row, ['updated_at', 'created_at'], '')),
          timeLabel: formatTimeOnly(getValue(row, ['updated_at', 'created_at'], '')),
          category: 'assignment' as const,
          title: actionLabel,
          subtitle: `${getProcessName(row, processMap)} / ${getStaffName(row, staffMap)}`,
          detail: getValue<string>(row, ['memo', 'note', 'comment'], '') || '人員配置が更新されました',
          route: buildRoute(ROUTES.assignments, {
            from: 'dashboard',
            staffId: getValue(row, ['staff_id', 'staffId'], ''),
            processId: getValue(row, ['process_id', 'processId'], ''),
          }),
        };
      });

    const alertHistory = data.alerts
      .filter((row) => {
        const created = dateKeyFromValue(getValue(row, ['created_at'], ''));
        const updated = dateKeyFromValue(getValue(row, ['updated_at', 'resolved_at'], ''));
        return created === todayKey || updated === todayKey;
      })
      .map((row, index) => {
        const status = normalizeLower(getValue(row, ['status'], 'open'));
        const title = status === 'closed' ? 'アラート完了' : 'アラート更新';
        const batchId = getValue(row, ['batch_id', 'batchId'], null);
        const batch = batchId != null ? batchMap.get(String(batchId)) : undefined;

        return {
          id: `alert-${getValue(row, ['id'], index)}`,
          time: timeFromValue(getValue(row, ['updated_at', 'resolved_at', 'created_at'], '')),
          timeLabel: formatTimeOnly(getValue(row, ['updated_at', 'resolved_at', 'created_at'], '')),
          category: 'alert' as const,
          title,
          subtitle: `${alertTypeLabel(String(getValue(row, ['alert_type', 'alertType'], '') ?? ''))} / ${getProcessName(
            row,
            processMap,
          )}${batch ? ` / ${getBatchNo(batch)}` : ''}`,
          detail:
            getValue<string>(row, ['message', 'title', 'subject', 'memo', 'response_memo'], '') ||
            'アラート内容が更新されました',
          route: buildRoute(ROUTES.alerts, {
            from: 'dashboard',
            alertId: getValue(row, ['id'], ''),
            processId: getValue(row, ['process_id', 'processId'], ''),
            batchId: batchId ?? '',
          }),
        };
      });

    const historyItems: HistoryItem[] = [...progressHistory, ...assignmentHistory, ...alertHistory]
      .sort((a, b) => b.time - a.time)
      .slice(0, 12);

    const shortageTop = [...shortageRows]
      .filter((row) => row.shortage > 0 || row.target > 0)
      .sort((a, b) => {
        if (b.shortage !== a.shortage) return b.shortage - a.shortage;
        return b.target - a.target;
      })
      .slice(0, 5);

    const processOverviewMap = new Map<
      string,
      {
        processId: string;
        processName: string;
        plannedQty: number;
        actualQty: number;
        progressRate: number;
        shortage: number;
        activeAlerts: number;
        route: string;
      }
    >();

    for (const row of targetBatches) {
      const processId = String(getValue(row, ['process_id', 'processId'], 'unknown'));
      if (!processOverviewMap.has(processId)) {
        processOverviewMap.set(processId, {
          processId,
          processName: getProcessName(row, processMap),
          plannedQty: 0,
          actualQty: 0,
          progressRate: 0,
          shortage: 0,
          activeAlerts: 0,
          route: buildRoute(ROUTES.progress, {
            from: 'dashboard',
            processId,
          }),
        });
      }
      const item = processOverviewMap.get(processId)!;
      item.plannedQty += toNumber(getValue(row, ['planned_qty', 'plannedQty', 'target_qty', 'targetQty'], 0));
      item.actualQty += toNumber(getValue(row, ['actual_qty', 'actualQty', 'completed_qty', 'completedQty'], 0));
    }

    for (const row of shortageRows) {
      const processId = String(row.processId);
      if (!processOverviewMap.has(processId)) {
        processOverviewMap.set(processId, {
          processId,
          processName: row.processName,
          plannedQty: 0,
          actualQty: 0,
          progressRate: 0,
          shortage: 0,
          activeAlerts: 0,
          route: row.route,
        });
      }
      const current = processOverviewMap.get(processId)!;
      current.shortage = row.shortage;
      if (row.shortage > 0) {
        current.route = row.route;
      }
    }

    for (const row of activeAlerts) {
      const processId = getValue(row, ['process_id', 'processId'], null);
      if (processId == null) continue;
      const key = String(processId);
      if (!processOverviewMap.has(key)) {
        processOverviewMap.set(key, {
          processId: key,
          processName:
            getValue<string>(processMap.get(key), ['name', 'process_name', 'processName', 'code'], undefined) ||
            `工程 ${key}`,
          plannedQty: 0,
          actualQty: 0,
          progressRate: 0,
          shortage: 0,
          activeAlerts: 0,
          route: buildRoute(ROUTES.alerts, {
            from: 'dashboard',
            processId: key,
          }),
        });
      }
      const current = processOverviewMap.get(key)!;
      current.activeAlerts += 1;
      if (current.activeAlerts > 0) {
        current.route = buildRoute(ROUTES.alerts, {
          from: 'dashboard',
          processId: key,
        });
      }
    }

    const processOverview = Array.from(processOverviewMap.values())
      .map((row) => {
        const progressRate =
          row.plannedQty > 0 ? clampPercent((row.actualQty / row.plannedQty) * 100) : 0;

        let route = row.route;
        if (row.activeAlerts > 0) {
          route = buildRoute(ROUTES.alerts, {
            from: 'dashboard',
            processId: row.processId,
          });
        } else if (row.shortage > 0) {
          route = buildRoute(ROUTES.assignments, {
            from: 'dashboard',
            processId: row.processId,
            mode: 'shortage',
          });
        } else {
          route = buildRoute(ROUTES.progress, {
            from: 'dashboard',
            processId: row.processId,
          });
        }

        return { ...row, progressRate, route };
      })
      .sort((a, b) => {
        if (b.activeAlerts !== a.activeAlerts) return b.activeAlerts - a.activeAlerts;
        if (b.shortage !== a.shortage) return b.shortage - a.shortage;
        return a.progressRate - b.progressRate;
      })
      .slice(0, 8);

    const insightMessages: string[] = [];

    if (priorityAlerts.length > 0) {
      const alert = priorityAlerts[0];
      insightMessages.push(
        `最優先は「${getProcessName(alert, processMap)}」の${alertTypeLabel(
          String(getValue(alert, ['alert_type', 'alertType'], '') ?? ''),
        )}アラートです。`,
      );
    }

    if (delayTop3.length > 0) {
      const top = delayTop3[0];
      insightMessages.push(
        `遅延影響が最も大きいのは「${top.processName}」で、進捗率 ${top.progressRate.toFixed(
          1,
        )}% / 遅延量 ${top.delayQty} です。`,
      );
    }

    if (shortageTop.length > 0 && shortageTop[0].shortage > 0) {
      insightMessages.push(
        `人員不足が大きいのは「${shortageTop[0].processName}」で、${shortageTop[0].shortage}名不足しています。`,
      );
    }

    if (insightMessages.length === 0) {
      insightMessages.push('本日の主要指標に大きな異常は見当たりません。');
    }

    return {
      totalProgressRate,
      delayedBatchCount,
      openAlertsCount: activeAlerts.length,
      assignedPeopleCount,
      totalShortage,
      alertCompletionRate,
      priorityAlerts,
      delayTop3,
      shortageTop,
      historyItems,
      processOverview,
      insightMessages,
      todayBatchCount: targetBatches.length,
      todayAlertCount: alertRateScope.length,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ダッシュボード</h1>
          <p className="mt-1 text-sm text-slate-600">
            センター: <span className="font-semibold text-slate-900">{centerName}</span>
            {centerId ? (
              <span className="ml-2 text-slate-500">(center_id: {String(centerId)})</span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            進捗・人員配置・アラートを横断して、優先度の高い工程を見つけるための画面です。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(ROUTES.progress)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            進捗一覧へ
          </button>
          <button
            type="button"
            onClick={() => navigate(ROUTES.assignments)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            人員配置へ
          </button>
          <button
            type="button"
            onClick={() => navigate(ROUTES.alerts)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            アラート一覧へ
          </button>
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            最終更新: {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : '-'}
          </div>
          <button
            type="button"
            onClick={() => void fetchDashboardData()}
            disabled={refreshing}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {refreshing ? '更新中...' : '再読み込み'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold">ダッシュボードの取得に失敗しました</div>
          <div className="mt-1 break-all">{error}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
          読み込み中です...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <SummaryCard
              title="総進捗率"
              value={`${dashboard.totalProgressRate.toFixed(1)}%`}
              subValue={`対象バッチ ${dashboard.todayBatchCount}件`}
              tone="blue"
              onClick={() => navigate(buildRoute(ROUTES.progress, { from: 'dashboard' }))}
              actionText="進捗一覧へ"
            />
            <SummaryCard
              title="遅延バッチ数"
              value={`${dashboard.delayedBatchCount}件`}
              subValue="未完了・遅延傾向を含む"
              tone="amber"
              onClick={() => navigate(buildRoute(ROUTES.progress, { from: 'dashboard', mode: 'delay' }))}
              actionText="遅延工程を見る"
            />
            <SummaryCard
              title="未対応アラート"
              value={`${dashboard.openAlertsCount}件`}
              subValue="open / in_progress"
              tone="red"
              onClick={() => navigate(buildRoute(ROUTES.alerts, { from: 'dashboard', status: 'active' }))}
              actionText="アラート一覧へ"
            />
            <SummaryCard
              title="配置済み人数"
              value={`${dashboard.assignedPeopleCount}名`}
              subValue="本日ベース"
              tone="green"
              onClick={() => navigate(buildRoute(ROUTES.assignments, { from: 'dashboard' }))}
              actionText="人員配置へ"
            />
            <SummaryCard
              title="不足人数合計"
              value={`${dashboard.totalShortage}名`}
              subValue="工程別の不足合計"
              tone="orange"
              onClick={() => navigate(buildRoute(ROUTES.assignments, { from: 'dashboard', mode: 'shortage' }))}
              actionText="不足工程を見る"
            />
            <SummaryCard
              title="対応完了率"
              value={`${dashboard.alertCompletionRate.toFixed(1)}%`}
              subValue={`対象アラート ${dashboard.todayAlertCount}件`}
              tone="violet"
              onClick={() => navigate(buildRoute(ROUTES.alerts, { from: 'dashboard', mode: 'completion' }))}
              actionText="完了状況を見る"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.2fr_1fr_1fr]">
            <Panel
              title="未対応アラート上位"
              description="重大度と新しさを優先して表示"
              action={
                <button
                  type="button"
                  onClick={() => navigate(buildRoute(ROUTES.alerts, { from: 'dashboard', status: 'active' }))}
                  className="text-sm font-semibold text-slate-700 transition hover:text-slate-900"
                >
                  一覧へ
                </button>
              }
            >
              <div className="space-y-3">
                {dashboard.priorityAlerts.length === 0 ? (
                  <EmptyState message="未対応アラートはありません。" />
                ) : (
                  dashboard.priorityAlerts.map((alert, index) => {
                    const severity = normalizeLower(getValue(alert, ['severity'], 'low'));
                    const status = normalizeLower(getValue(alert, ['status'], 'open'));

                    return (
                      <button
                        key={String(getValue(alert, ['id'], `alert-${index}`))}
                        type="button"
                        onClick={() => navigate(alert.route)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-white"
                      >
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
                                {alertTypeLabel(String(getValue(alert, ['alert_type', 'alertType'], '') ?? ''))}
                              </span>
                              <SeverityBadge severity={severity} />
                              <StatusBadge status={status} />
                            </div>
                            <div className="mt-2 text-sm font-semibold text-slate-900">
                              {getValue<string>(alert, ['title', 'subject', 'message'], undefined) || 'アラート'}
                            </div>
                            <div className="mt-1 text-sm text-slate-600">
                              {getProcessName(
                                alert,
                                new Map(
                                  data.processes
                                    .map((row) => [String(getValue(row, ['id'], '')), row] as const)
                                    .filter(([id]) => id !== ''),
                                ),
                              )}
                            </div>
                          </div>

                          <div className="shrink-0 text-xs text-slate-500">
                            {formatDateTime(getTimestamp(alert))}
                          </div>
                        </div>

                        {getValue<string>(alert, ['response_memo', 'memo', 'note'], '') ? (
                          <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-slate-600">
                            メモ: {getValue<string>(alert, ['response_memo', 'memo', 'note'], '')}
                          </div>
                        ) : null}

                        <div className="mt-3 text-xs font-semibold text-slate-500">クリックでアラート画面へ</div>
                      </button>
                    );
                  })
                )}
              </div>
            </Panel>

            <Panel
              title="遅延工程 TOP3"
              description="遅延量・遅延アラートを元に順位付け"
              action={
                <button
                  type="button"
                  onClick={() => navigate(buildRoute(ROUTES.progress, { from: 'dashboard', mode: 'delay' }))}
                  className="text-sm font-semibold text-slate-700 transition hover:text-slate-900"
                >
                  進捗一覧へ
                </button>
              }
            >
              <div className="space-y-4">
                {dashboard.delayTop3.length === 0 ? (
                  <EmptyState message="大きな遅延工程はありません。" />
                ) : (
                  dashboard.delayTop3.map((row, index) => (
                    <button
                      key={row.processId}
                      type="button"
                      onClick={() => navigate(row.route)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-white"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-slate-500">#{index + 1}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{row.processName}</div>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          <div>遅延アラート {row.activeDelayAlerts}件</div>
                          <div>対象バッチ {row.batchCount}件</div>
                        </div>
                      </div>

                      <div className="mt-3">
                        <ProgressBar value={row.progressRate} />
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <MetricMini label="進捗率" value={`${row.progressRate.toFixed(1)}%`} />
                        <MetricMini label="遅延量" value={`${row.delayQty}`} />
                        <MetricMini label="実績/計画" value={`${row.actualQty}/${row.plannedQty}`} />
                      </div>

                      <div className="mt-3 text-xs font-semibold text-slate-500">クリックで進捗画面へ</div>
                    </button>
                  ))
                )}
              </div>
            </Panel>

            <Panel
              title="人員不足工程"
              description="今日の目標人数と配置人数の差分"
              action={
                <button
                  type="button"
                  onClick={() => navigate(buildRoute(ROUTES.assignments, { from: 'dashboard', mode: 'shortage' }))}
                  className="text-sm font-semibold text-slate-700 transition hover:text-slate-900"
                >
                  人員配置へ
                </button>
              }
            >
              <div className="space-y-4">
                {dashboard.shortageTop.length === 0 ? (
                  <EmptyState message="人員不足工程はありません。" />
                ) : (
                  dashboard.shortageTop.map((row) => (
                    <button
                      key={row.processId}
                      type="button"
                      onClick={() => navigate(row.route)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-white"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{row.processName}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            目標 {row.target}名 / 配置 {row.assigned}名
                          </div>
                        </div>
                        <div
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            row.shortage > 0
                              ? 'bg-red-100 text-red-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {row.shortage > 0 ? `${row.shortage}名不足` : '充足'}
                        </div>
                      </div>

                      <div className="mt-3 text-xs font-semibold text-slate-500">クリックで人員配置画面へ</div>
                    </button>
                  ))
                )}
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.2fr_0.8fr]">
            <Panel
              title="工程横断サマリー"
              description="進捗・人員・アラートをまとめて確認"
              action={
                <span className="text-xs text-slate-500">行クリックで関連画面へ遷移</span>
              }
            >
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-3">工程</th>
                      <th className="px-3 py-3">進捗率</th>
                      <th className="px-3 py-3">実績 / 計画</th>
                      <th className="px-3 py-3">不足人数</th>
                      <th className="px-3 py-3">未対応アラート</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.processOverview.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                          表示できる工程データがありません。
                        </td>
                      </tr>
                    ) : (
                      dashboard.processOverview.map((row) => (
                        <tr
                          key={row.processId}
                          onClick={() => navigate(row.route)}
                          className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50 last:border-b-0"
                        >
                          <td className="px-3 py-3 font-medium text-slate-900">{row.processName}</td>
                          <td className="px-3 py-3">
                            <div className="min-w-[180px]">
                              <ProgressBar value={row.progressRate} />
                            </div>
                          </td>
                          <td className="px-3 py-3 text-slate-700">
                            {row.actualQty} / {row.plannedQty}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                row.shortage > 0
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {row.shortage}名
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                row.activeAlerts > 0
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {row.activeAlerts}件
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>

            <div className="space-y-6">
              <Panel title="今日の注目ポイント" description="優先的に見るべき観点を自動抽出">
                <div className="space-y-3">
                  {dashboard.insightMessages.map((message, index) => (
                    <div
                      key={`${index}-${message}`}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
                    >
                      {message}
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel
                title="今日の更新履歴"
                description="進捗更新・配置変更・アラート更新"
                action={
                  <span className="text-xs text-slate-500">クリックで関連画面へ</span>
                }
              >
                <div className="space-y-3">
                  {dashboard.historyItems.length === 0 ? (
                    <EmptyState message="本日の更新履歴はありません。" />
                  ) : (
                    dashboard.historyItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(item.route)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-white"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <HistoryCategoryBadge category={item.category} />
                              <span className="text-sm font-semibold text-slate-900">{item.title}</span>
                            </div>
                            <div className="mt-1 text-sm text-slate-700">{item.subtitle}</div>
                            <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
                          </div>
                          <div className="shrink-0 text-xs text-slate-500">{item.timeLabel}</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function SummaryCard({
  title,
  value,
  subValue,
  tone,
  onClick,
  actionText,
}: {
  title: string;
  value: string;
  subValue?: string;
  tone: 'blue' | 'amber' | 'red' | 'green' | 'orange' | 'violet';
  onClick?: () => void;
  actionText?: string;
}) {
  const toneClassMap: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50',
    amber: 'border-amber-200 bg-amber-50',
    red: 'border-red-200 bg-red-50',
    green: 'border-emerald-200 bg-emerald-50',
    orange: 'border-orange-200 bg-orange-50',
    violet: 'border-violet-200 bg-violet-50',
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`rounded-2xl border p-4 text-left shadow-sm transition hover:shadow-md ${toneClassMap[tone]}`}
      >
        <div className="text-sm font-medium text-slate-600">{title}</div>
        <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
        {subValue ? <div className="mt-2 text-xs text-slate-500">{subValue}</div> : null}
        {actionText ? <div className="mt-3 text-xs font-semibold text-slate-600">{actionText}</div> : null}
      </button>
    );
  }

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClassMap[tone]}`}>
      <div className="text-sm font-medium text-slate-600">{title}</div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
      {subValue ? <div className="mt-2 text-xs text-slate-500">{subValue}</div> : null}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const safe = clampPercent(value);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>進捗</span>
        <span>{safe.toFixed(1)}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${
            safe >= 90
              ? 'bg-emerald-500'
              : safe >= 70
                ? 'bg-blue-500'
                : safe >= 40
                  ? 'bg-amber-500'
                  : 'bg-red-500'
          }`}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const normalized = normalizeLower(severity);
  const className =
    normalized === 'critical'
      ? 'bg-red-200 text-red-800'
      : normalized === 'high'
        ? 'bg-red-100 text-red-700'
        : normalized === 'medium'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-slate-100 text-slate-600';

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {severityLabel(normalized)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = normalizeLower(status);
  const className =
    normalized === 'open'
      ? 'bg-red-100 text-red-700'
      : normalized === 'in_progress'
        ? 'bg-amber-100 text-amber-700'
        : normalized === 'closed'
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-slate-100 text-slate-600';

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {statusLabel(normalized)}
    </span>
  );
}

function HistoryCategoryBadge({
  category,
}: {
  category: 'progress' | 'assignment' | 'alert';
}) {
  const map: Record<string, { label: string; className: string }> = {
    progress: {
      label: '進捗',
      className: 'bg-blue-100 text-blue-700',
    },
    assignment: {
      label: '配置',
      className: 'bg-emerald-100 text-emerald-700',
    },
    alert: {
      label: 'アラート',
      className: 'bg-amber-100 text-amber-700',
    },
  };

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${map[category].className}`}>
      {map[category].label}
    </span>
  );
}