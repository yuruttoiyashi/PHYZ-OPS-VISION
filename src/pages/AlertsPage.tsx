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

type AlertRow = {
  id: string;
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
  assigned_to?: string | null;
  assignee_id?: string | null;
  resolved_at?: string | null;
  response_note?: string | null;
  resolution_note?: string | null;
  memo?: string | null;
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

type WorkBatchRow = {
  id: string;
  batch_no?: string | null;
  batch_type?: string | null;
};

type ProfileRow = {
  id: string;
  email?: string | null;
  center_id?: string | null;
};

type AlertViewRow = {
  id: string;
  occurredAt: string;
  title: string;
  message: string;
  alertType: string;
  severity: string;
  status: string;
  processName: string;
  batchNo: string;
  assigneeLabel: string;
  assigneeValue: string;
  resolvedAt: string;
  raw: AlertRow;
};

type ResolveModalState = {
  alertId: string;
};

function formatDateTime(value?: string | null): string {
  if (!value) return '未設定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function normalizeAlertType(type?: string | null) {
  switch (type) {
    case 'delay':
      return '遅延';
    case 'understaff':
      return '人員不足';
    case 'sla_risk':
      return 'SLA逼迫';
    case 'quality':
      return '品質';
    case 'no_update':
      return '更新なし';
    default:
      return type || '-';
  }
}

function normalizeSeverityLabel(severity?: string | null) {
  switch (severity) {
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

function getSeverityBadgeClass(severity?: string | null) {
  switch (severity) {
    case 'high':
      return 'bg-rose-100 text-rose-700';
    case 'medium':
      return 'bg-amber-100 text-amber-700';
    case 'low':
      return 'bg-sky-100 text-sky-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function normalizeStatusLabel(status?: string | null) {
  switch (status) {
    case 'open':
      return '未対応';
    case 'in_progress':
      return '対応中';
    case 'resolved':
      return '解決済み';
    case 'closed':
      return '解決済み';
    default:
      return status || '-';
  }
}

function getStatusBadgeClass(status?: string | null) {
  switch (status) {
    case 'open':
      return 'bg-rose-100 text-rose-700';
    case 'in_progress':
      return 'bg-sky-100 text-sky-700';
    case 'resolved':
    case 'closed':
      return 'bg-emerald-100 text-emerald-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
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

async function selectFirstSuccess(
  builders: Array<() => PromiseLike<{ data: any; error: any }>>,
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

function getProcessDisplayName(process?: ProcessRow | null) {
  if (!process) return '-';
  return process.name ?? process.process_name ?? process.process_code ?? '-';
}

export default function AlertsPage() {
  const auth = useAuth() as any;
  const authProfile = (auth?.profile ?? null) as LooseProfile | null;
  const user = auth?.user ?? null;

  const [fallbackProfile, setFallbackProfile] = useState<LooseProfile | null>(null);
  const [isResolvingProfile, setIsResolvingProfile] = useState(false);

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [batches, setBatches] = useState<WorkBatchRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [keyword, setKeyword] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  const [modalState, setModalState] = useState<ResolveModalState | null>(null);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [resolutionMemo, setResolutionMemo] = useState('');
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
      const [alertsRes, processRes, batchRes, profileRes] = await Promise.all([
        supabase
          .from('alerts')
          .select('*')
          .eq('center_id', resolvedCenterId)
          .order('created_at', { ascending: false }),
        supabase.from('processes').select('*').eq('center_id', resolvedCenterId),
        supabase.from('work_batches').select('*').eq('center_id', resolvedCenterId),
        selectFirstSuccess([
          () =>
            supabase
              .from('profiles')
              .select('id, email, center_id')
              .eq('center_id', resolvedCenterId),
          () => supabase.from('profiles').select('id, email, center_id'),
        ]),
      ]);

      if (alertsRes.error) {
        throw new Error(`alerts の取得に失敗しました: ${alertsRes.error.message}`);
      }

      if (processRes.error) {
        throw new Error(`processes の取得に失敗しました: ${processRes.error.message}`);
      }

      if (batchRes.error) {
        throw new Error(`work_batches の取得に失敗しました: ${batchRes.error.message}`);
      }

      if (profileRes.error) {
        throw new Error(`profiles の取得に失敗しました: ${profileRes.error.message}`);
      }

      setAlerts((alertsRes.data ?? []) as AlertRow[]);
      setProcesses((processRes.data ?? []) as ProcessRow[]);
      setBatches((batchRes.data ?? []) as WorkBatchRow[]);
      setProfiles((profileRes.data ?? []) as ProfileRow[]);
    } catch (error: any) {
      console.error(error);
      setPageError(error?.message ?? 'アラート一覧の取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }

  const processMap = useMemo(() => {
    const map = new Map<string, ProcessRow>();
    processes.forEach((item) => map.set(item.id, item));
    return map;
  }, [processes]);

  const batchMap = useMemo(() => {
    const map = new Map<string, WorkBatchRow>();
    batches.forEach((item) => map.set(item.id, item));
    return map;
  }, [batches]);

  const profileMap = useMemo(() => {
    const map = new Map<string, ProfileRow>();
    profiles.forEach((item) => map.set(item.id, item));
    return map;
  }, [profiles]);

  const rows = useMemo<AlertViewRow[]>(() => {
    return alerts.map((alert) => {
      const alertType = alert.alert_type ?? alert.type ?? alert.category ?? '-';
      const severity = alert.severity ?? alert.priority ?? alert.level ?? '-';

      const processName = alert.process_id
        ? getProcessDisplayName(processMap.get(alert.process_id))
        : '-';

      const batchNo = alert.batch_id ? batchMap.get(alert.batch_id)?.batch_no ?? '-' : '-';

      const assigneeRaw = alert.assigned_to ?? alert.assignee_id ?? '';
      const assigneeProfile = assigneeRaw ? profileMap.get(assigneeRaw) : null;
      const assigneeLabel = assigneeProfile?.email ?? assigneeRaw ?? '未設定';

      return {
        id: alert.id,
        occurredAt: alert.created_at ?? '',
        title: alert.title ?? '件名なし',
        message:
          alert.message ??
          alert.response_note ??
          alert.resolution_note ??
          alert.memo ??
          alert.note ??
          '詳細なし',
        alertType,
        severity,
        status: alert.status ?? 'open',
        processName,
        batchNo,
        assigneeLabel,
        assigneeValue: assigneeRaw,
        resolvedAt: alert.resolved_at ?? '',
        raw: alert,
      };
    });
  }, [alerts, processMap, batchMap, profileMap]);

  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase();

    return rows.filter((row) => {
      const statusOk = statusFilter === 'all' || row.status === statusFilter;
      const severityOk = severityFilter === 'all' || row.severity === severityFilter;

      const text =
        `${row.title} ${row.message} ${row.alertType} ${row.processName} ${row.batchNo} ${row.assigneeLabel}`.toLowerCase();
      const keywordOk = !q || text.includes(q);

      return statusOk && severityOk && keywordOk;
    });
  }, [rows, statusFilter, severityFilter, keyword]);

  const summary = useMemo(() => {
    return {
      total: filteredRows.length,
      open: filteredRows.filter((row) => row.status === 'open').length,
      inProgress: filteredRows.filter((row) => row.status === 'in_progress').length,
      resolved: filteredRows.filter((row) => ['resolved', 'closed'].includes(row.status)).length,
    };
  }, [filteredRows]);

  const modalAlert = useMemo(() => {
    if (!modalState) return null;
    return rows.find((row) => row.id === modalState.alertId) ?? null;
  }, [modalState, rows]);

  function openResolveModal(alertId: string) {
    if (!canEdit) return;

    const target = rows.find((row) => row.id === alertId);
    if (!target) return;

    setModalState({ alertId });
    setSelectedAssignee(target.assigneeValue || user?.id || '');
    setResolutionMemo('');
    setSaveError('');
  }

  function closeResolveModal() {
    if (isSaving) return;
    setModalState(null);
    setSelectedAssignee('');
    setResolutionMemo('');
    setSaveError('');
  }

  async function handleStartResponse(row: AlertViewRow) {
    if (!canEdit) {
      setPageError('viewer権限ではアラート更新できません。');
      return;
    }

    setPageError('');

    try {
      const candidates: Array<Record<string, unknown>> = [
        {
          status: 'in_progress',
          assigned_to: user?.id ?? row.assigneeValue ?? null,
          updated_at: new Date().toISOString(),
        },
        {
          status: 'in_progress',
          assigned_to: user?.id ?? row.assigneeValue ?? null,
        },
        {
          status: 'in_progress',
        },
      ];

      const result = await updateFirstSuccess('alerts', row.id, candidates);

      if (result.error) {
        throw new Error(`対応開始に失敗しました: ${result.error.message}`);
      }

      await loadPage();
    } catch (error: any) {
      console.error(error);
      setPageError(error?.message ?? '対応開始に失敗しました。');
    }
  }

  async function handleResolveAlert() {
    if (!modalAlert) return;

    if (!canEdit) {
      setSaveError('viewer権限ではアラート更新できません。');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    try {
      const resolvedAt = new Date().toISOString();
      const memoValue = resolutionMemo.trim();

      const candidates: Array<Record<string, unknown>> = [
        {
          status: 'closed',
          assigned_to: selectedAssignee || null,
          resolved_at: resolvedAt,
          response_note: memoValue,
          resolution_note: memoValue,
          memo: memoValue,
          note: memoValue,
          updated_at: resolvedAt,
        },
        {
          status: 'closed',
          assigned_to: selectedAssignee || null,
          resolved_at: resolvedAt,
          response_note: memoValue,
          resolution_note: memoValue,
          memo: memoValue,
          note: memoValue,
        },
        {
          status: 'closed',
          assigned_to: selectedAssignee || null,
          resolved_at: resolvedAt,
          memo: memoValue,
          note: memoValue,
        },
        {
          status: 'closed',
          assigned_to: selectedAssignee || null,
          resolved_at: resolvedAt,
        },
        {
          status: 'closed',
          resolved_at: resolvedAt,
        },
        {
          status: 'resolved',
          assigned_to: selectedAssignee || null,
          resolved_at: resolvedAt,
          response_note: memoValue,
          resolution_note: memoValue,
          memo: memoValue,
          note: memoValue,
          updated_at: resolvedAt,
        },
        {
          status: 'resolved',
          assigned_to: selectedAssignee || null,
          resolved_at: resolvedAt,
        },
      ];

      const result = await updateFirstSuccess('alerts', modalAlert.id, candidates);

      if (result.error) {
        throw new Error(`対応完了に失敗しました: ${result.error.message}`);
      }

      await loadPage();
      closeResolveModal();
    } catch (error: any) {
      console.error(error);
      setSaveError(error?.message ?? '対応完了に失敗しました。');
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
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">アラート一覧</h1>
            <p className="mt-1 text-sm text-slate-600">
              アラートの対応開始・担当設定・対応完了が行えます。
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
          </div>
        </div>

        {isResolvingProfile && !resolvedCenterId && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            profiles から center_id を確認中です...
          </div>
        )}

        {isViewer && (
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            viewer 権限のため、この画面は閲覧専用です。対応開始・対応完了・メモ保存はできません。
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
          <div className="text-sm text-slate-500">全件数</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{summary.total}</div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">未対応</div>
          <div className="mt-2 text-3xl font-bold text-rose-600">{summary.open}</div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">対応中</div>
          <div className="mt-2 text-3xl font-bold text-sky-600">{summary.inProgress}</div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">解決済み</div>
          <div className="mt-2 text-3xl font-bold text-emerald-600">{summary.resolved}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">絞り込み</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">状態</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
            >
              <option value="all">すべて</option>
              <option value="open">未対応</option>
              <option value="in_progress">対応中</option>
              <option value="resolved">解決済み</option>
              <option value="closed">解決済み(closed)</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">重要度</label>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
            >
              <option value="all">すべて</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">キーワード</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="件名 / 種別 / 工程 / バッチ"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
            />
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-bold text-slate-900">アラート一覧</h2>
        </div>

        {filteredRows.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">該当アラートがありません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1480px] w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-[120px] whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    発生時刻
                  </th>
                  <th className="min-w-[360px] w-[360px] px-6 py-4 text-left font-semibold text-slate-700">
                    件名
                  </th>
                  <th className="w-[110px] whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    種別
                  </th>
                  <th className="w-[90px] whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    重要度
                  </th>
                  <th className="w-[110px] whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    状態
                  </th>
                  <th className="w-[120px] whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    工程
                  </th>
                  <th className="w-[140px] whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    対象バッチ
                  </th>
                  <th className="w-[220px] whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    担当者
                  </th>
                  <th className="w-[120px] whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    解消時刻
                  </th>
                  {canEdit && (
                    <th className="w-[170px] whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                      操作
                    </th>
                  )}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-6 py-4 align-top text-slate-700">
                      {formatDateTime(row.occurredAt)}
                    </td>

                    <td className="min-w-[360px] w-[360px] px-6 py-4 align-top text-slate-900">
                      <div className="font-semibold leading-6 break-words">{row.title}</div>
                      <div className="mt-1 text-sm leading-6 text-slate-500 break-words">
                        {row.message || '詳細なし'}
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-6 py-4 align-top text-slate-700">
                      {normalizeAlertType(row.alertType)}
                    </td>

                    <td className="whitespace-nowrap px-6 py-4 align-top">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${getSeverityBadgeClass(
                          row.severity,
                        )}`}
                      >
                        {normalizeSeverityLabel(row.severity)}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-6 py-4 align-top">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(
                          row.status,
                        )}`}
                      >
                        {normalizeStatusLabel(row.status)}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-6 py-4 align-top text-slate-700">
                      {row.processName}
                    </td>

                    <td className="whitespace-nowrap px-6 py-4 align-top text-slate-700">
                      {row.batchNo}
                    </td>

                    <td className="whitespace-nowrap px-6 py-4 align-top text-slate-700">
                      {row.assigneeLabel}
                    </td>

                    <td className="whitespace-nowrap px-6 py-4 align-top text-slate-700">
                      {formatDateTime(row.resolvedAt)}
                    </td>

                    {canEdit && (
                      <td className="whitespace-nowrap px-6 py-4 align-top">
                        <div className="flex flex-col gap-2">
                          {row.status === 'open' && (
                            <button
                              type="button"
                              onClick={() => handleStartResponse(row)}
                              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                            >
                              対応開始
                            </button>
                          )}

                          {!['resolved', 'closed'].includes(row.status) && (
                            <button
                              type="button"
                              onClick={() => openResolveModal(row.id)}
                              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              対応完了
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && modalState && modalAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-bold text-slate-900">アラート対応完了</h2>
              <p className="mt-1 text-sm text-slate-500">{modalAlert.title}</p>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  <div>
                    <span className="font-semibold">種別:</span>{' '}
                    {normalizeAlertType(modalAlert.alertType)}
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold">工程:</span> {modalAlert.processName}
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold">対象バッチ:</span> {modalAlert.batchNo}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  <div>
                    <span className="font-semibold">現在状態:</span>{' '}
                    {normalizeStatusLabel(modalAlert.status)}
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold">現在担当:</span> {modalAlert.assigneeLabel}
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">担当者</label>
                <select
                  value={selectedAssignee}
                  onChange={(e) => setSelectedAssignee(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
                >
                  <option value="">未設定</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.email ?? profile.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">対応メモ</label>
                <textarea
                  rows={5}
                  value={resolutionMemo}
                  onChange={(e) => setResolutionMemo(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
                  placeholder="対応内容、原因、再発防止など"
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
                onClick={closeResolveModal}
                disabled={isSaving}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                キャンセル
              </button>

              <button
                type="button"
                onClick={handleResolveAlert}
                disabled={isSaving}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isSaving ? '保存中...' : '対応完了にする'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}