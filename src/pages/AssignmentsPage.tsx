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

type StaffRow = {
  id: string;
  center_id?: string | null;
  employee_code?: string | null;
  name?: string | null;
  employment_type?: string | null;
  status?: string | null;
  note?: string | null;
};

type ShiftRow = {
  id?: string;
  staff_id?: string | null;
  work_date?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  attendance_status?: string | null;
  note?: string | null;
};

type ProcessRow = {
  id: string;
  center_id?: string | null;
  name?: string | null;
  process_name?: string | null;
  process_code?: string | null;
};

type StaffSkillRow = {
  id?: string;
  staff_id?: string | null;
  process_id?: string | null;
  skill_level?: number | null;
  level?: number | null;
};

type WorkAssignmentRow = {
  id?: string;
  center_id?: string | null;
  staff_id?: string | null;
  process_id?: string | null;
  target_date?: string | null;
  work_date?: string | null;
  assignment_date?: string | null;
  note?: string | null;
  memo?: string | null;
  assigned_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  status?: string | null;
};

type DailyProcessTargetRow = {
  id?: string;
  center_id?: string | null;
  process_id?: string | null;
  target_date?: string | null;
  work_date?: string | null;
  date?: string | null;
  target_staff_count?: number | null;
  required_staff_count?: number | null;
  target_count?: number | null;
  planned_staff_count?: number | null;
};

type StaffViewRow = {
  id: string;
  employeeCode: string;
  name: string;
  employmentType: string;
  staffStatus: string;
  attendanceStatus: string;
  shiftTime: string;
  skillProcessIds: string[];
  skillNames: string[];
  currentAssignmentId: string | null;
  currentProcessId: string | null;
  currentProcessName: string;
  note: string;
};

type ProcessSummaryRow = {
  processId: string;
  processName: string;
  processCode: string;
  targetCount: number;
  assignedCount: number;
  shortageCount: number;
  assignedStaff: StaffViewRow[];
  supportCandidates: StaffViewRow[];
};

type AssignmentModalState = {
  staffId: string;
  preferredProcessId: string;
};

type QueryResponse<T> = {
  data: T[];
  error: Error | null;
};

function todayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

function formatTimeRange(start?: string | null, end?: string | null) {
  const s = start ? String(start).slice(0, 5) : '--:--';
  const e = end ? String(end).slice(0, 5) : '--:--';
  if (!start && !end) return '-';
  return `${s} - ${e}`;
}

function normalizeAttendanceLabel(status?: string | null) {
  switch (status) {
    case 'present':
      return '出勤';
    case 'planned':
      return '予定';
    case 'absent':
      return '欠勤';
    case 'off':
      return '休み';
    case 'leave':
      return '休暇';
    default:
      return status || '未設定';
  }
}

function getAttendanceBadgeClass(status?: string | null) {
  switch (status) {
    case 'present':
      return 'bg-emerald-100 text-emerald-700';
    case 'planned':
      return 'bg-blue-100 text-blue-700';
    case 'absent':
      return 'bg-rose-100 text-rose-700';
    case 'off':
    case 'leave':
      return 'bg-slate-100 text-slate-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function isAvailableAttendance(status?: string | null) {
  return !['absent', 'off', 'leave', 'holiday', 'cancelled'].includes(
    String(status ?? '').toLowerCase(),
  );
}

function getTargetDateValue(row: DailyProcessTargetRow) {
  return row.target_date ?? row.work_date ?? row.date ?? null;
}

function getTargetCount(row: DailyProcessTargetRow) {
  return Number(
    row.target_staff_count ??
      row.required_staff_count ??
      row.target_count ??
      row.planned_staff_count ??
      0,
  );
}

function getAssignmentDateValue(row: WorkAssignmentRow) {
  return row.target_date ?? row.work_date ?? row.assignment_date ?? null;
}

function getProcessDisplayName(process?: ProcessRow | null) {
  if (!process) return '-';
  return process.name ?? process.process_name ?? process.process_code ?? '-';
}

function getProcessDisplayCode(process?: ProcessRow | null) {
  if (!process) return '-';
  return process.process_code ?? process.name ?? process.process_name ?? '-';
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

async function tryInsertAdaptive(
  table: string,
  candidate: Record<string, unknown>,
): Promise<{ error: Error | null }> {
  let payload = compactPayload(candidate);
  let lastError: any = null;

  for (let i = 0; i < 10; i += 1) {
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

  for (let i = 0; i < 10; i += 1) {
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

async function runFallbackQueries<T>(
  builders: Array<
    () => Promise<{ data: T[] | null; error: { message?: string } | null }>
  >,
): Promise<QueryResponse<T>> {
  let lastError: Error | null = null;

  for (const builder of builders) {
    try {
      const result = await builder();

      if (!result.error) {
        return {
          data: (result.data ?? []) as T[],
          error: null,
        };
      }

      lastError = new Error(result.error.message ?? 'データ取得に失敗しました。');
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error('データ取得に失敗しました。');
    }
  }

  return {
    data: [],
    error: lastError ?? new Error('データ取得に失敗しました。'),
  };
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

export default function AssignmentsPage() {
  const auth = useAuth() as any;
  const authProfile = (auth?.profile ?? null) as LooseProfile | null;
  const user = auth?.user ?? null;

  const [fallbackProfile, setFallbackProfile] = useState<LooseProfile | null>(null);
  const [isResolvingProfile, setIsResolvingProfile] = useState(false);

  const [selectedDate, setSelectedDate] = useState(todayString());
  const [keyword, setKeyword] = useState('');

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [skills, setSkills] = useState<StaffSkillRow[]>([]);
  const [assignments, setAssignments] = useState<WorkAssignmentRow[]>([]);
  const [targets, setTargets] = useState<DailyProcessTargetRow[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  const [modalState, setModalState] = useState<AssignmentModalState | null>(null);
  const [selectedProcessId, setSelectedProcessId] = useState('');
  const [assignmentMemo, setAssignmentMemo] = useState('');
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
  }, [resolvedCenterId, selectedDate]);

  async function loadPage() {
    if (!resolvedCenterId) return;

    setIsLoading(true);
    setPageError('');

    try {
      const [staffRes, processRes, shiftRes, skillsRes, assignmentsRes, targetsRes] =
        await Promise.all([
          runFallbackQueries<StaffRow>([
            async () =>
              await supabase.from('staff').select('*').eq('center_id', resolvedCenterId),
            async () => await supabase.from('staff').select('*'),
          ]),
          runFallbackQueries<ProcessRow>([
            async () =>
              await supabase.from('processes').select('*').eq('center_id', resolvedCenterId),
            async () => await supabase.from('processes').select('*'),
          ]),
          runFallbackQueries<ShiftRow>([
            async () => await supabase.from('shifts').select('*'),
          ]),
          runFallbackQueries<StaffSkillRow>([
            async () => await supabase.from('staff_skills').select('*'),
          ]),
          runFallbackQueries<WorkAssignmentRow>([
            async () =>
              await supabase
                .from('work_assignments')
                .select('*')
                .eq('center_id', resolvedCenterId),
            async () => await supabase.from('work_assignments').select('*'),
          ]),
          runFallbackQueries<DailyProcessTargetRow>([
            async () =>
              await supabase
                .from('daily_process_targets')
                .select('*')
                .eq('center_id', resolvedCenterId),
            async () => await supabase.from('daily_process_targets').select('*'),
          ]),
        ]);

      if (staffRes.error) {
        throw new Error(`staff の取得に失敗しました: ${staffRes.error.message}`);
      }

      if (processRes.error) {
        throw new Error(`processes の取得に失敗しました: ${processRes.error.message}`);
      }

      if (shiftRes.error) {
        throw new Error(`shifts の取得に失敗しました: ${shiftRes.error.message}`);
      }

      if (skillsRes.error) {
        throw new Error(`staff_skills の取得に失敗しました: ${skillsRes.error.message}`);
      }

      if (assignmentsRes.error) {
        throw new Error(
          `work_assignments の取得に失敗しました: ${assignmentsRes.error.message}`,
        );
      }

      if (targetsRes.error) {
        throw new Error(
          `daily_process_targets の取得に失敗しました: ${targetsRes.error.message}`,
        );
      }

      const staffRows = staffRes.data ?? [];
      const processRows = processRes.data ?? [];
      const shiftRows = shiftRes.data ?? [];
      const skillRows = skillsRes.data ?? [];

      const assignmentRows = (assignmentsRes.data ?? []).filter((row) => {
        const rowDate = getAssignmentDateValue(row);
        const staffIds = new Set(staffRows.map((item) => item.id));
        return rowDate === selectedDate && !!row.staff_id && staffIds.has(row.staff_id);
      });

      const targetRows = (targetsRes.data ?? []).filter((row) => {
        const rowDate = getTargetDateValue(row);
        return rowDate === selectedDate;
      });

      const staffIdSet = new Set(staffRows.map((item) => item.id));
      const processIdSet = new Set(processRows.map((item) => item.id));

      setStaff(staffRows);
      setProcesses(processRows);
      setShifts(shiftRows.filter((item) => item.staff_id && staffIdSet.has(item.staff_id)));
      setSkills(
        skillRows.filter(
          (item) =>
            !!item.staff_id &&
            !!item.process_id &&
            staffIdSet.has(item.staff_id) &&
            processIdSet.has(item.process_id),
        ),
      );
      setAssignments(assignmentRows);
      setTargets(targetRows.filter((item) => item.process_id && processIdSet.has(item.process_id)));
    } catch (error: any) {
      console.error(error);
      setPageError(error?.message ?? '人員配置ページの取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  }

  const processMap = useMemo(() => {
    const map = new Map<string, ProcessRow>();
    processes.forEach((item) => {
      map.set(item.id, item);
    });
    return map;
  }, [processes]);

  const shiftMap = useMemo(() => {
    const map = new Map<string, ShiftRow>();
    shifts.forEach((item) => {
      if (item.staff_id && !map.has(item.staff_id)) {
        map.set(item.staff_id, item);
      }
    });
    return map;
  }, [shifts]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, WorkAssignmentRow>();
    assignments.forEach((item) => {
      if (item.staff_id && !map.has(item.staff_id)) {
        map.set(item.staff_id, item);
      }
    });
    return map;
  }, [assignments]);

  const skillMap = useMemo(() => {
    const map = new Map<string, StaffSkillRow[]>();

    skills.forEach((item) => {
      if (!item.staff_id) return;
      const current = map.get(item.staff_id) ?? [];
      current.push(item);
      map.set(item.staff_id, current);
    });

    return map;
  }, [skills]);

  const targetMap = useMemo(() => {
    const map = new Map<string, DailyProcessTargetRow>();
    targets.forEach((item) => {
      if (item.process_id && !map.has(item.process_id)) {
        map.set(item.process_id, item);
      }
    });
    return map;
  }, [targets]);

  const staffRows = useMemo<StaffViewRow[]>(() => {
    return staff.map((member) => {
      const shift = shiftMap.get(member.id);
      const assignment = assignmentMap.get(member.id);
      const memberSkills = skillMap.get(member.id) ?? [];
      const processIds = memberSkills
        .map((item) => item.process_id)
        .filter((value): value is string => Boolean(value));

      const skillNames = processIds.map((processId) =>
        getProcessDisplayName(processMap.get(processId)),
      );

      return {
        id: member.id,
        employeeCode: member.employee_code ?? '-',
        name: member.name ?? '-',
        employmentType: member.employment_type ?? '-',
        staffStatus: member.status ?? '-',
        attendanceStatus: shift?.attendance_status ?? 'off',
        shiftTime: formatTimeRange(shift?.planned_start, shift?.planned_end),
        skillProcessIds: processIds,
        skillNames,
        currentAssignmentId: assignment?.id ?? null,
        currentProcessId: assignment?.process_id ?? null,
        currentProcessName: assignment?.process_id
          ? getProcessDisplayName(processMap.get(assignment.process_id))
          : '未配置',
        note: assignment?.note ?? assignment?.memo ?? member.note ?? '',
      };
    });
  }, [staff, shiftMap, assignmentMap, skillMap, processMap]);

  const filteredStaffRows = useMemo(() => {
    const q = keyword.trim().toLowerCase();

    return staffRows.filter((row) => {
      if (!q) return true;

      const text =
        `${row.employeeCode} ${row.name} ${row.currentProcessName} ${row.skillNames.join(' ')}`.toLowerCase();
      return text.includes(q);
    });
  }, [staffRows, keyword]);

  const processSummaryRows = useMemo<ProcessSummaryRow[]>(() => {
    return processes.map((process) => {
      const assignedStaff = filteredStaffRows.filter(
        (staffRow) => staffRow.currentProcessId === process.id,
      );
      const targetCount = getTargetCount(targetMap.get(process.id) ?? {});
      const availableCandidates = filteredStaffRows.filter((staffRow) => {
        const skilled = staffRow.skillProcessIds.includes(process.id);
        const available = isAvailableAttendance(staffRow.attendanceStatus);
        const unassigned = !staffRow.currentProcessId;
        return skilled && available && unassigned;
      });

      return {
        processId: process.id,
        processName: getProcessDisplayName(process),
        processCode: getProcessDisplayCode(process),
        targetCount,
        assignedCount: assignedStaff.length,
        shortageCount: Math.max(targetCount - assignedStaff.length, 0),
        assignedStaff,
        supportCandidates: availableCandidates,
      };
    });
  }, [processes, filteredStaffRows, targetMap]);

  const summary = useMemo(() => {
    const totalAssigned = filteredStaffRows.filter((row) => !!row.currentProcessId).length;
    const unassigned = filteredStaffRows.filter(
      (row) => !row.currentProcessId && isAvailableAttendance(row.attendanceStatus),
    ).length;
    const shortageTotal = processSummaryRows.reduce((sum, row) => sum + row.shortageCount, 0);

    return {
      totalAssigned,
      unassigned,
      shortageTotal,
    };
  }, [filteredStaffRows, processSummaryRows]);

  const modalStaff = useMemo(() => {
    if (!modalState) return null;
    return staffRows.find((row) => row.id === modalState.staffId) ?? null;
  }, [modalState, staffRows]);

  function openAssignmentModal(staffId: string, preferredProcessId?: string | null) {
    if (!canEdit) return;

    const targetStaff = staffRows.find((row) => row.id === staffId);
    if (!targetStaff) return;

    setModalState({
      staffId,
      preferredProcessId: preferredProcessId ?? targetStaff.currentProcessId ?? '',
    });
    setSelectedProcessId(preferredProcessId ?? targetStaff.currentProcessId ?? '');
    setAssignmentMemo(targetStaff.note ?? '');
    setSaveError('');
  }

  function closeAssignmentModal() {
    if (isSaving) return;
    setModalState(null);
    setSelectedProcessId('');
    setAssignmentMemo('');
    setSaveError('');
  }

  async function handleSaveAssignment() {
    if (!modalStaff) return;

    if (!canEdit) {
      setSaveError('viewer権限では配置変更できません。');
      return;
    }

    if (!selectedProcessId) {
      setSaveError('配置先の工程を選択してください。');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    try {
      const existing = assignmentMap.get(modalStaff.id);
      const memoValue = assignmentMemo.trim();

      const candidates: Array<Record<string, unknown>> = [
        {
          center_id: resolvedCenterId,
          staff_id: modalStaff.id,
          process_id: selectedProcessId,
          target_date: selectedDate,
          note: memoValue,
          memo: memoValue,
          assigned_by: user?.id ?? null,
        },
        {
          center_id: resolvedCenterId,
          staff_id: modalStaff.id,
          process_id: selectedProcessId,
          work_date: selectedDate,
          note: memoValue,
          memo: memoValue,
          assigned_by: user?.id ?? null,
        },
        {
          center_id: resolvedCenterId,
          staff_id: modalStaff.id,
          process_id: selectedProcessId,
          target_date: selectedDate,
        },
        {
          center_id: resolvedCenterId,
          staff_id: modalStaff.id,
          process_id: selectedProcessId,
          work_date: selectedDate,
        },
        {
          staff_id: modalStaff.id,
          process_id: selectedProcessId,
          target_date: selectedDate,
          note: memoValue,
          memo: memoValue,
        },
        {
          staff_id: modalStaff.id,
          process_id: selectedProcessId,
          work_date: selectedDate,
          note: memoValue,
          memo: memoValue,
        },
        {
          staff_id: modalStaff.id,
          process_id: selectedProcessId,
          target_date: selectedDate,
        },
        {
          staff_id: modalStaff.id,
          process_id: selectedProcessId,
          work_date: selectedDate,
        },
      ];

      const result = existing?.id
        ? await updateFirstSuccess('work_assignments', existing.id, candidates)
        : await insertFirstSuccess('work_assignments', candidates);

      if (result.error) {
        throw new Error(`work_assignments 保存に失敗しました: ${result.error.message}`);
      }

      await loadPage();
      closeAssignmentModal();
    } catch (error: any) {
      console.error(error);
      setSaveError(error?.message ?? '配置変更に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnassign(staffRow: StaffViewRow) {
    if (!staffRow.currentAssignmentId) return;

    if (!canEdit) {
      setPageError('viewer権限では配置解除できません。');
      return;
    }

    const confirmed = window.confirm(`${staffRow.name} の配置を解除しますか？`);
    if (!confirmed) return;

    setPageError('');

    try {
      const { error } = await supabase
        .from('work_assignments')
        .delete()
        .eq('id', staffRow.currentAssignmentId);

      if (error) {
        throw new Error(`配置解除に失敗しました: ${error.message}`);
      }

      await loadPage();
    } catch (error: any) {
      console.error(error);
      setPageError(error?.message ?? '配置解除に失敗しました。');
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
            <h1 className="text-2xl font-bold text-slate-900">人員配置ボード</h1>
            <p className="mt-1 text-sm text-slate-600">
              スタッフの配置変更・再配置・解除を行えます。
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
            viewer 権限のため、この画面は閲覧専用です。配置変更・配置解除はできません。
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
          <div className="text-sm text-slate-500">配置済み人数</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{summary.totalAssigned}</div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">未配置人数</div>
          <div className="mt-2 text-3xl font-bold text-amber-600">{summary.unassigned}</div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">不足人数合計</div>
          <div className="mt-2 text-3xl font-bold text-rose-600">{summary.shortageTotal}</div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">対象日</div>
          <div className="mt-2 text-xl font-bold text-slate-900">
            {formatDate(selectedDate)}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">絞り込み</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">対象日</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">キーワード</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="社員コード / 氏名 / 工程名"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
            />
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">工程別配置サマリー</h2>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {processSummaryRows.map((row) => (
            <div key={row.processId} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-bold text-slate-900">{row.processName}</div>
                  <div className="mt-1 text-sm text-slate-500">{row.processCode}</div>
                </div>

                <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                  <div>
                    目標: <span className="font-semibold">{row.targetCount}</span>名
                  </div>
                  <div className="mt-1">
                    配置: <span className="font-semibold">{row.assignedCount}</span>名
                  </div>
                  <div className="mt-1">
                    不足:{' '}
                    <span className="font-semibold text-rose-600">{row.shortageCount}</span>名
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 text-sm font-semibold text-slate-700">現在の配置</div>
                {row.assignedStaff.length === 0 ? (
                  <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-500">
                    まだ配置がありません。
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {row.assignedStaff.map((staffRow) => (
                      <span
                        key={`${row.processId}-${staffRow.id}`}
                        className="rounded-full bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
                      >
                        {staffRow.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4">
                <div className="mb-2 text-sm font-semibold text-slate-700">応援候補</div>
                {row.supportCandidates.length === 0 ? (
                  <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-500">
                    候補はいません。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {row.supportCandidates.slice(0, 3).map((staffRow) => (
                      <div
                        key={`${row.processId}-candidate-${staffRow.id}`}
                        className="flex items-center justify-between rounded-xl bg-white px-4 py-3"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{staffRow.name}</div>
                          <div className="text-xs text-slate-500">{staffRow.employeeCode}</div>
                        </div>

                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openAssignmentModal(staffRow.id, row.processId)}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                          >
                            この工程に配置
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-bold text-slate-900">スタッフ一覧</h2>
        </div>

        {filteredStaffRows.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">該当スタッフがいません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    社員コード
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    氏名
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    出勤状態
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    シフト
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    対応可能工程
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                    現在の配置
                  </th>
                  {canEdit && (
                    <th className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700">
                      操作
                    </th>
                  )}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredStaffRows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-900">
                      {row.employeeCode}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-700">{row.name}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${getAttendanceBadgeClass(
                          row.attendanceStatus,
                        )}`}
                      >
                        {normalizeAttendanceLabel(row.attendanceStatus)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-700">{row.shiftTime}</td>
                    <td className="px-6 py-4 text-slate-700">
                      {row.skillNames.length === 0 ? '-' : row.skillNames.join(' / ')}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                      {row.currentProcessName}
                    </td>
                    {canEdit && (
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openAssignmentModal(row.id, row.currentProcessId)}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                          >
                            {row.currentProcessId ? '配置変更' : '配置する'}
                          </button>

                          {row.currentAssignmentId && (
                            <button
                              type="button"
                              onClick={() => handleUnassign(row)}
                              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              配置解除
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

      {canEdit && modalState && modalStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-bold text-slate-900">配置変更</h2>
              <p className="mt-1 text-sm text-slate-500">
                {modalStaff.employeeCode} / {modalStaff.name}
              </p>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  <div>
                    <span className="font-semibold">対象日:</span> {formatDate(selectedDate)}
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold">出勤状態:</span>{' '}
                    {normalizeAttendanceLabel(modalStaff.attendanceStatus)}
                  </div>
                  <div className="mt-2">
                    <span className="font-semibold">現在の配置:</span>{' '}
                    {modalStaff.currentProcessName}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  <div>
                    <span className="font-semibold">対応可能工程:</span>
                  </div>
                  <div className="mt-2">
                    {modalStaff.skillNames.length === 0 ? '-' : modalStaff.skillNames.join(' / ')}
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">配置先工程</label>
                <select
                  value={selectedProcessId}
                  onChange={(e) => setSelectedProcessId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
                >
                  <option value="">選択してください</option>
                  {processes.map((process) => {
                    const skilled = modalStaff.skillProcessIds.includes(process.id);
                    const label = `${getProcessDisplayName(process)}${skilled ? '（適性あり）' : ''}`;

                    return (
                      <option key={process.id} value={process.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">メモ</label>
                <textarea
                  rows={4}
                  value={assignmentMemo}
                  onChange={(e) => setAssignmentMemo(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-500"
                  placeholder="配置理由、応援、注意点など"
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
                onClick={closeAssignmentModal}
                disabled={isSaving}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                キャンセル
              </button>

              <button
                type="button"
                onClick={handleSaveAssignment}
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