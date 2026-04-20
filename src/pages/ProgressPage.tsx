import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type LooseProfile = {
  id?: string;
  email?: string;
  role?: string;
  center_id?: string | null;
  centerName?: string;
  center_name?: string;
  centers?: {
    name?: string;
  } | null;
};

type WorkBatchRow = {
  id: string;
  center_id?: string | null;
  process_id?: string | null;
  batch_no?: string | null;
  batch_type?: string | null;
  target_date?: string | null;
  planned_qty?: number | null;
  actual_qty?: number | null;
  status?: string | null;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ProcessRow = {
  id: string;
  name?: string | null;
  process_name?: string | null;
  process_code?: string | null;
};

type ProgressLogRow = {
  id?: string;
  batch_id?: string | null;
  process_id?: string | null;
  target_date?: string | null;
  logged_at?: string | null;
  completed_qty?: number | null;
  backlog_qty?: number | null;
  working_staff_count?: number | null;
  memo?: string | null;
  progress_percent?: number | null;
  created_at?: string | null;
};

type AlertRow = {
  id?: string;
  center_id?: string | null;
  batch_id?: string | null;
  process_id?: string | null;
  alert_type?: string | null;
  type?: string | null;
  category?: string | null;
  severity?: string | null;
  priority?: string | null;
  level?: string | null;
  status?: string | null;
  title?: string | null;
  message?: string | null;
  target_date?: string | null;
  work_date?: string | null;
  source?: string | null;
  rule_key?: string | null;
  created_by?: string | null;
  assigned_to?: string | null;
  created_at?: string | null;
};

type ProgressViewRow = {
  id: string;
  batchId: string;
  batchNo: string;
  batchType: string;
  processId: string | null;
  processName: string;
  targetDate: string;
  plannedQty: number;
  actualQty: number;
  completedQty: number;
  backlogQty: number;
  workingStaffCount: number;
  progressPercent: number;
  status: string;
  memo: string;
  loggedAt: string;
};

type UpdateFormState = {
  completedQty: string;
  workingStaffCount: string;
  memo: string;
};

type AutoAlertRule = {
  kind: 'delay' | 'understaff' | 'sla_risk';
  severity: 'high' | 'medium';
  title: string;
  message: string;
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function normalizeStatusLabel(status?: string | null) {
  switch (status) {
    case 'planned':
      return '未着手';
    case 'in_progress':
      return '進行中';
    case 'completed':
      return '完了';
    case 'delayed':
      return '遅延';
    default:
      return status || '-';
  }
}

function getStatusBadgeClass(status?: string | null) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-700';
    case 'in_progress':
      return 'bg-blue-100 text-blue-700';
    case 'delayed':
      return 'bg-rose-100 text-rose-700';
    case 'planned':
      return 'bg-slate-100 text-slate-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function toNumber(value: string) {
  if (!value.trim()) return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function compactPayload(candidate: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined),
  );
}

function getMissingColumnName(error: any): string | null {
  const message = String(error?.message ?? '');
  const matched = message.match(/Could not find the '([^']+)' column/i);
  return matched?.[1] ?? null;
}

function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isPastDate(targetDate?: string | null) {
  if (!targetDate) return false;
  const target = new Date(targetDate);
  if (Number.isNaN(target.getTime())) return false;

  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetOnly = new Date(target.getFullYear(), target.getMonth(), target.getDate());

  return targetOnly < todayOnly;
}

function deriveAutoAlert(params: {
  batchNo: string;
  processName: string;
  targetDate: string;
  plannedQty: number;
  completedQty: number;
  backlogQty: number;
  progressPercent: number;
  workingStaffCount: number;
}): AutoAlertRule | null {
  const {
    batchNo,
    processName,
    targetDate,
    plannedQty,
    completedQty,
    backlogQty,
    progressPercent,
    workingStaffCount,
  } = params;

  if (targetDate && isPastDate(targetDate) && progressPercent < 100) {
    return {
      kind: 'delay',
      severity: 'high',
      title: `工程遅延アラート: ${batchNo}`,
      message: `${processName} が対象日 ${targetDate} を過ぎても未完了です。進捗 ${progressPercent}% / 完了 ${completedQty} / 計画 ${plannedQty} / 残数 ${backlogQty}`,
    };
  }

  if (progressPercent < 100 && workingStaffCount === 0) {
    return {
      kind: 'understaff',
      severity: 'high',
      title: `人員不足アラート: ${batchNo}`,
      message: `${processName} が未完了のまま作業人数 0 名です。進捗 ${progressPercent}% / 残数 ${backlogQty}`,
    };
  }

  const backlogThreshold = Math.max(50, Math.ceil(plannedQty * 0.2));
  if (progressPercent < 100 && backlogQty >= backlogThreshold) {
    return {
      kind: 'sla_risk',
      severity: 'medium',
      title: `SLAリスクアラート: ${batchNo}`,
      message: `${processName} の残数が多く、遅延リスクがあります。残数 ${backlogQty} / 計画 ${plannedQty} / 進捗 ${progressPercent}%`,
    };
  }

  return null;
}

async function tryInsertAdaptive(
  table: string,
  candidate: Record<string, unknown>,
): Promise<{ error: Error | null }> {
  let payload = compactPayload(candidate);
  let lastError: any = null;

  for (let i = 0; i < 12; i += 1) {
    const { error } = await supabase.from(table).insert(payload);

    if (!error) {
      return { error: null };
    }

    lastError = error;

    const missingColumn = getMissingColumnName(error);
    if (!missingColumn) {
      return { error: lastError as Error | null };
    }

    if (!(missingColumn in payload)) {
      return { error: lastError as Error | null };
    }

    const nextPayload = { ...payload };
    delete nextPayload[missingColumn];
    payload = nextPayload;
  }

  return { error: lastError as Error | null };
}

async function tryUpdateAdaptive(
  table: string,
  id: string,
  candidate: Record<string, unknown>,
): Promise<{ error: Error | null }> {
  let payload = compactPayload(candidate);
  let lastError: any = null;

  for (let i = 0; i < 12; i += 1) {
    const { error } = await supabase.from(table).update(payload).eq('id', id);

    if (!error) {
      return { error: null };
    }

    lastError = error;

    const missingColumn = getMissingColumnName(error);
    if (!missingColumn) {
      return { error: lastError as Error | null };
    }

    if (!(missingColumn in payload)) {
      return { error: lastError as Error | null };
    }

    const nextPayload = { ...payload };
    delete nextPayload[missingColumn];
    payload = nextPayload;
  }

  return { error: lastError as Error | null };
}

async function selectFirstSuccess(
  builders: Array<() => Promise<{ data: any; error: any }>>,
): Promise<{ data: any; error: any }> {
  let lastError: any = null;

  for (const builder of builders) {
    const result = await builder();
    if (!result.error) {
      return result;
    }
    lastError = result.error;
  }

  return { data: null, error: lastError };
}

async function insertFirstSuccess(
  table: string,
  candidates: Array<Record<string, unknown>>,
): Promise<{ error: Error | null }> {
  let lastError: any = null;

  for (const candidate of candidates) {
    const result = await tryInsertAdaptive(table, candidate);
    if (!result.error) {
      return result;
    }
    lastError = result.error;
  }

  return { error: lastError as Error | null };
}

async function updateFirstSuccess(
  table: string,
  id: string,
  candidates: Array<Record<string, unknown>>,
): Promise<{ error: Error | null }> {
  let lastError: any = null;

  for (const candidate of candidates) {
    const result = await tryUpdateAdaptive(table, id, candidate);
    if (!result.error) {
      return result;
    }
    lastError = result.error;
  }

  return { error: lastError as Error | null };
}

async function maybeCreateAutoAlert(params: {
  centerId: string | null;
  userId?: string | null;
  batchId: string;
  batchNo: string;
  processId: string | null;
  processName: string;
  targetDate: string;
  plannedQty: number;
  completedQty: number;
  backlogQty: number;
  progressPercent: number;
  workingStaffCount: number;
}): Promise<{ created: boolean; error: Error | null }> {
  if (!params.centerId) {
    return {
      created: false,
      error: new Error('alerts 作成に必要な center_id を取得できませんでした。'),
    };
  }

  const rule = deriveAutoAlert(params);
  if (!rule) {
    return { created: false, error: null };
  }

  const existingAlertRes = await selectFirstSuccess([
    async () =>
      await supabase
        .from('alerts')
        .select('*')
        .eq('center_id', params.centerId)
        .eq('batch_id', params.batchId),
    async () =>
      await supabase
        .from('alerts')
        .select('*')
        .eq('batch_id', params.batchId),
    async () =>
      await supabase
        .from('alerts')
        .select('*'),
  ]);

  if (existingAlertRes.error) {
    return { created: false, error: existingAlertRes.error as Error };
  }

  const alerts = (existingAlertRes.data ?? []) as AlertRow[];

  const hasSameOpenAlert = alerts.some((alert) => {
    const sameCenter = alert.center_id === params.centerId;
    const sameBatch = alert.batch_id === params.batchId;
    const sameProcess =
      !params.processId || !alert.process_id ? true : alert.process_id === params.processId;

    const currentType = String(
      alert.alert_type ?? alert.type ?? alert.category ?? '',
    ).toLowerCase();
    const sameType = currentType === rule.kind;

    const status = String(alert.status ?? '').toLowerCase();
    const unresolved = !['resolved', 'closed', 'done', 'completed'].includes(status);

    return sameCenter && sameBatch && sameProcess && sameType && unresolved;
  });

  if (hasSameOpenAlert) {
    return { created: false, error: null };
  }

  const common = {
    center_id: params.centerId,
    batch_id: params.batchId,
    process_id: params.processId,
    alert_type: rule.kind,
    severity: rule.severity,
    status: 'open',
    title: rule.title,
    message: rule.message,
  };

  const candidates: Array<Record<string, unknown>> = [
    {
      ...common,
      type: rule.kind,
      category: rule.kind,
      priority: rule.severity,
      level: rule.severity,
      target_date: params.targetDate || null,
      work_date: params.targetDate || null,
      source: 'progress_update',
      rule_key: `${rule.kind}:${params.batchId}`,
      created_by: params.userId ?? null,
    },
    {
      ...common,
      target_date: params.targetDate || null,
      created_by: params.userId ?? null,
    },
    {
      ...common,
      target_date: params.targetDate || null,
    },
    {
      ...common,
      priority: rule.severity,
    },
    {
      ...common,
      level: rule.severity,
    },
    {
      ...common,
    },
  ];

  const result = await insertFirstSuccess('alerts', candidates);

  return {
    created: !result.error,
    error: result.error,
  };
}

export default function ProgressPage() {
  const auth = useAuth() as any;
  const authProfile = (auth?.profile ?? null) as LooseProfile | null;
  const user = auth?.user ?? null;

  const [fallbackProfile, setFallbackProfile] = useState<LooseProfile | null>(null);
  const [isResolvingProfile, setIsResolvingProfile] = useState(false);

  const [batches, setBatches] = useState<WorkBatchRow[]>([]);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [logs, setLogs] = useState<ProgressLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [keyword, setKeyword] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<ProgressViewRow | null>(null);
  const [form, setForm] = useState<UpdateFormState>({
    completedQty: '',
    workingStaffCount: '',
    memo: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const resolvedCenterId = authProfile?.center_id ?? fallbackProfile?.center_id ?? null;
  const resolvedCenterName =
    authProfile?.centerName ??
    authProfile?.center_name ??
    authProfile?.centers?.name ??
    fallbackProfile?.centerName ??
    fallbackProfile?.center_name ??
    fallbackProfile?.centers?.name ??
    'センター未設定';
  const resolvedRole = authProfile?.role ?? fallbackProfile?.role ?? null;
  const isViewer = String(resolvedRole ?? '').toLowerCase() === 'viewer';
  const canEdit = !isViewer;

  useEffect(() => {
    async function resolveOwnProfile() {
      if (!user?.id) return;
      if (authProfile?.center_id || fallbackProfile?.center_id) return;

      setIsResolvingProfile(true);

      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, role, center_id, centers(name)')
        .eq('id', user.id)
        .maybeSingle();

      if (!error && data) {
        setFallbackProfile(data as LooseProfile);
      }

      setIsResolvingProfile(false);
    }

    void resolveOwnProfile();
  }, [user?.id, authProfile?.center_id, fallbackProfile?.center_id]);

  useEffect(() => {
    if (!resolvedCenterId) return;
    void loadPage();
  }, [resolvedCenterId]);

  async function loadPage() {
    if (!resolvedCenterId) return;

    setIsLoading(true);
    setPageError('');

    try {
      const [batchesRes, processesRes, logsRes] = await Promise.all([
        supabase
          .from('work_batches')
          .select('*')
          .eq('center_id', resolvedCenterId)
          .order('target_date', { ascending: true }),
        supabase
          .from('processes')
          .select('*')
          .eq('center_id', resolvedCenterId),
        supabase
          .from('progress_logs')
          .select('*')
          .order('logged_at', { ascending: false }),
      ]);

      if (batchesRes.error) {
        throw new Error(`work_batches の取得に失敗しました: ${batchesRes.error.message}`);
      }

      if (processesRes.error) {
        throw new Error(`processes の取得に失敗しました: ${processesRes.error.message}`);
      }

      if (logsRes.error) {
        throw new Error(`progress_logs の取得に失敗しました: ${logsRes.error.message}`);
      }

      const batchRows = (batchesRes.data ?? []) as WorkBatchRow[];
      const processRows = (processesRes.data ?? []) as ProcessRow[];
      const logRows = (logsRes.data ?? []) as ProgressLogRow[];

      const batchIdSet = new Set(batchRows.map((item) => item.id));
      const filteredLogs = logRows.filter((log) => log.batch_id && batchIdSet.has(log.batch_id));

      setBatches(batchRows);
      setProcesses(processRows);
      setLogs(filteredLogs);
    } catch (error: any) {
      console.error(error);
      setPageError(error?.message ?? '進捗一覧の取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }

  const processMap = useMemo(() => {
    const map = new Map<string, ProcessRow>();
    processes.forEach((process) => {
      map.set(process.id, process);
    });
    return map;
  }, [processes]);

  const latestLogMap = useMemo(() => {
    const map = new Map<string, ProgressLogRow>();

    const sorted = [...logs].sort((a, b) => {
      const aTime = new Date(a.logged_at ?? a.created_at ?? 0).getTime();
      const bTime = new Date(b.logged_at ?? b.created_at ?? 0).getTime();
      return bTime - aTime;
    });

    sorted.forEach((log) => {
      if (!log.batch_id) return;
      if (!map.has(log.batch_id)) {
        map.set(log.batch_id, log);
      }
    });

    return map;
  }, [logs]);

  const rows = useMemo<ProgressViewRow[]>(() => {
    return batches.map((batch) => {
      const latestLog = latestLogMap.get(batch.id);
      const resolvedProcessId = batch.process_id ?? latestLog?.process_id ?? null;
      const process = resolvedProcessId ? processMap.get(resolvedProcessId) : undefined;

      const plannedQty = Number(batch.planned_qty ?? 0);
      const actualQty = Number(batch.actual_qty ?? 0);
      const completedQty = Number(latestLog?.completed_qty ?? actualQty ?? 0);
      const backlogQty =
        latestLog?.backlog_qty !== null && latestLog?.backlog_qty !== undefined
          ? Number(latestLog.backlog_qty)
          : Math.max(plannedQty - completedQty, 0);

      const progressPercent =
        latestLog?.progress_percent !== null && latestLog?.progress_percent !== undefined
          ? Number(latestLog.progress_percent)
          : plannedQty > 0
            ? Math.min(100, Math.max(0, Math.round((completedQty / plannedQty) * 100)))
            : 0;

      return {
        id: batch.id,
        batchId: batch.id,
        batchNo: batch.batch_no ?? '-',
        batchType: batch.batch_type ?? '-',
        processId: resolvedProcessId,
        processName: process?.name ?? process?.process_name ?? process?.process_code ?? '-',
        targetDate: batch.target_date ?? '',
        plannedQty,
        actualQty,
        completedQty,
        backlogQty,
        workingStaffCount: Number(latestLog?.working_staff_count ?? 0),
        progressPercent,
        status: batch.status ?? 'planned',
        memo: latestLog?.memo ?? batch.note ?? '',
        loggedAt: latestLog?.logged_at ?? latestLog?.created_at ?? '',
      };
    });
  }, [batches, latestLogMap, processMap]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesDate = !dateFilter || row.targetDate === dateFilter;
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;

      const text = `${row.batchNo} ${row.processName} ${row.batchType} ${row.memo}`.toLowerCase();
      const matchesKeyword = !keyword.trim() || text.includes(keyword.trim().toLowerCase());

      return matchesDate && matchesStatus && matchesKeyword;
    });
  }, [rows, dateFilter, statusFilter, keyword]);

  const summary = useMemo(() => {
    const total = filteredRows.length;
    const completed = filteredRows.filter((row) => row.progressPercent >= 100).length;
    const delayed = filteredRows.filter((row) => {
      if (!row.targetDate) return false;
      return isPastDate(row.targetDate) && row.progressPercent < 100;
    }).length;

    const avgProgress =
      total > 0
        ? Math.round(filteredRows.reduce((sum, row) => sum + row.progressPercent, 0) / total)
        : 0;

    return {
      total,
      completed,
      delayed,
      avgProgress,
    };
  }, [filteredRows]);

  function openUpdateModal(row: ProgressViewRow) {
    if (!canEdit) return;

    setSelectedRow(row);
    setForm({
      completedQty: String(row.completedQty ?? 0),
      workingStaffCount: String(row.workingStaffCount ?? 0),
      memo: row.memo ?? '',
    });
    setSaveError('');
    setIsModalOpen(true);
  }

  function closeUpdateModal() {
    if (isSaving) return;
    setIsModalOpen(false);
    setSelectedRow(null);
    setSaveError('');
  }

  async function handleSaveProgress() {
    if (!selectedRow) return;

    if (!canEdit) {
      setSaveError('viewer権限では進捗更新できません。');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    try {
      const completedQty = toNumber(form.completedQty);
      const workingStaffCount = toNumber(form.workingStaffCount);
      const memo = form.memo.trim();

      const processId = selectedRow.processId;
      if (!processId) {
        throw new Error(
          'process_id を特定できません。batch CSV を再取込するか、work_batches.process_id を確認してください。',
        );
      }

      const plannedQty = Number(selectedRow.plannedQty ?? 0);
      const backlogQty = Math.max(plannedQty - completedQty, 0);
      const progressPercent =
        plannedQty > 0
          ? Math.min(100, Math.max(0, Math.round((completedQty / plannedQty) * 100)))
          : 0;

      const nextStatus =
        progressPercent >= 100
          ? 'completed'
          : completedQty > 0
            ? 'in_progress'
            : selectedRow.status || 'planned';

      const loggedAt = new Date().toISOString();

      const logCandidates: Array<Record<string, unknown>> = [
        {
          batch_id: selectedRow.batchId,
          process_id: processId,
          target_date: selectedRow.targetDate || null,
          logged_at: loggedAt,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
          progress_percent: progressPercent,
        },
        {
          batch_id: selectedRow.batchId,
          process_id: processId,
          logged_at: loggedAt,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
          progress_percent: progressPercent,
        },
        {
          batch_id: selectedRow.batchId,
          process_id: processId,
          target_date: selectedRow.targetDate || null,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
          progress_percent: progressPercent,
        },
        {
          batch_id: selectedRow.batchId,
          process_id: processId,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
        },
        {
          batch_id: selectedRow.batchId,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
        },
        {
          batch_id: selectedRow.batchId,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
        },
      ];

      const logInsert = await insertFirstSuccess('progress_logs', logCandidates);

      if (logInsert.error) {
        throw new Error(`progress_logs 保存に失敗しました: ${logInsert.error.message}`);
      }

      const batchUpdate = await updateFirstSuccess('work_batches', selectedRow.batchId, [
        {
          actual_qty: completedQty,
          status: nextStatus,
        },
        {
          actual_qty: completedQty,
        },
      ]);

      if (batchUpdate.error) {
        throw new Error(`work_batches 更新に失敗しました: ${batchUpdate.error.message}`);
      }

      const alertResult = await maybeCreateAutoAlert({
        centerId: resolvedCenterId,
        userId: user?.id ?? null,
        batchId: selectedRow.batchId,
        batchNo: selectedRow.batchNo,
        processId,
        processName: selectedRow.processName,
        targetDate: selectedRow.targetDate,
        plannedQty,
        completedQty,
        backlogQty,
        progressPercent,
        workingStaffCount,
      });

      await loadPage();
      closeUpdateModal();

      if (alertResult.error) {
        setPageError(
          `進捗は保存しましたが、alerts の自動作成に失敗しました: ${alertResult.error.message}`,
        );
      } else {
        setPageError('');
      }
    } catch (error: any) {
      console.error(error);
      setSaveError(error?.message ?? '進捗更新に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          読み込み中です...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">工程進捗一覧</h1>
            <p className="mt-1 text-sm text-slate-600">
              工程ごとの進捗状況を確認し、その場で進捗更新できます。
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <div>
              <span className="font-semibold">センター:</span> {resolvedCenterName}
            </div>
            <div>
              <span className="font-semibold">center_id:</span> {resolvedCenterId ?? '未取得'}
            </div>
            <div>
              <span className="font-semibold">権限:</span> {resolvedRole ?? '-'}
            </div>
            <div>
              <span className="font-semibold">今日:</span> {getTodayDateString()}
            </div>
          </div>
        </div>

        {isResolvingProfile && !resolvedCenterId && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            profiles から center_id を確認中です...
          </div>
        )}

        {isViewer && (
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            viewer 権限のため、この画面は閲覧専用です。進捗更新はできません。
          </div>
        )}

        {pageError && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {pageError}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">対象バッチ数</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{summary.total}</div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">平均進捗率</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{summary.avgProgress}%</div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">完了件数</div>
          <div className="mt-2 text-3xl font-bold text-emerald-600">{summary.completed}</div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">遅延件数</div>
          <div className="mt-2 text-3xl font-bold text-rose-600">{summary.delayed}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">絞り込み</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">日付</label>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">ステータス</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
            >
              <option value="all">すべて</option>
              <option value="planned">未着手</option>
              <option value="in_progress">進行中</option>
              <option value="completed">完了</option>
              <option value="delayed">遅延</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">キーワード</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="batch_no / 工程名 / メモ"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
            />
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-bold text-slate-900">進捗一覧</h2>
        </div>

        {filteredRows.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">該当データがありません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    バッチNo
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    工程
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    対象日
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    数量
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    進捗
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    配置人数
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    ステータス
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    最終更新
                  </th>
                  {canEdit && (
                    <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                      操作
                    </th>
                  )}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-900">{row.batchNo}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                      {row.processName}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                      {formatDate(row.targetDate)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                      計画 {row.plannedQty} / 実績 {row.completedQty}
                    </td>
                    <td className="px-6 py-4 text-slate-700">
                      <div className="min-w-[180px]">
                        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                          <span>{row.progressPercent}%</span>
                          <span>残 {row.backlogQty}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-slate-900 transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(0, row.progressPercent))}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                      {row.workingStaffCount}名
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(
                          row.status,
                        )}`}
                      >
                        {normalizeStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                      {formatDateTime(row.loggedAt)}
                    </td>
                    {canEdit && (
                      <td className="whitespace-nowrap px-6 py-4">
                        <button
                          type="button"
                          onClick={() => openUpdateModal(row)}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                        >
                          進捗更新
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && isModalOpen && selectedRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-bold text-slate-900">進捗更新</h2>
              <p className="mt-1 text-sm text-slate-500">
                {selectedRow.batchNo} / {selectedRow.processName}
              </p>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  <div>
                    <span className="font-semibold">対象日:</span> {formatDate(selectedRow.targetDate)}
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold">計画数:</span> {selectedRow.plannedQty}
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold">現在実績:</span> {selectedRow.completedQty}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  <div>
                    <span className="font-semibold">現在進捗:</span> {selectedRow.progressPercent}%
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold">残数:</span> {selectedRow.backlogQty}
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold">現在人数:</span> {selectedRow.workingStaffCount}名
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">完了数</label>
                  <input
                    type="number"
                    min="0"
                    value={form.completedQty}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, completedQty: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">作業人数</label>
                  <input
                    type="number"
                    min="0"
                    value={form.workingStaffCount}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, workingStaffCount: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">メモ</label>
                <textarea
                  rows={4}
                  value={form.memo}
                  onChange={(e) => setForm((prev) => ({ ...prev, memo: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
                  placeholder="進捗状況や特記事項を入力"
                />
              </div>

              {saveError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {saveError}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 px-6 py-5">
              <button
                type="button"
                onClick={closeUpdateModal}
                disabled={isSaving}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                キャンセル
              </button>

              <button
                type="button"
                onClick={handleSaveProgress}
                disabled={isSaving}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isSaving ? '保存中...' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}