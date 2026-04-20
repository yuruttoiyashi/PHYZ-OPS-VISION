import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type ImportType = 'staff' | 'shift' | 'batch' | 'progress';
type CsvRow = Record<string, string>;

type ImportResult = {
  successCount: number;
  errorCount: number;
  errors: string[];
};

type ImportJobRecord = {
  id?: string;
  import_type?: string;
  file_name?: string;
  total_rows?: number;
  total_count?: number;
  success_count?: number;
  error_count?: number;
  status?: string;
  error_details?: string | string[] | null;
  created_at?: string;
};

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

const IMPORT_OPTIONS: Array<{
  value: ImportType;
  label: string;
  description: string;
}> = [
  {
    value: 'staff',
    label: 'staff CSV',
    description: 'スタッフマスタを登録・更新します',
  },
  {
    value: 'shift',
    label: 'shift CSV',
    description: 'シフト情報を登録・更新します',
  },
  {
    value: 'batch',
    label: 'batch CSV',
    description: '作業バッチを登録・更新します',
  },
  {
    value: 'progress',
    label: 'progress CSV',
    description: '進捗ログを登録します',
  },
];

const REQUIRED_COLUMNS: Record<ImportType, string[]> = {
  staff: ['employee_code', 'name'],
  shift: ['employee_code', 'work_date'],
  batch: ['batch_no', 'process_code または process_name'],
  progress: ['batch_no'],
};

function normalizeHeader(header: string): string {
  return header
    .replace(/^\ufeff/, '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '_')
    .replace(/\//g, '_')
    .replace(/-+/g, '_');
}

function normalizeLookup(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeRow(raw: Record<string, unknown>): CsvRow {
  const row: CsvRow = {};

  Object.entries(raw).forEach(([key, value]) => {
    const normalizedKey = normalizeHeader(key);
    row[normalizedKey] = normalizeValue(value);
  });

  return row;
}

function getValue(row: CsvRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function compactRecord<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string' && value.trim() === '') return false;
      return true;
    }),
  ) as Partial<T>;
}

function toNumberOrNull(value: string): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, '').trim();
  if (normalized === '') return null;
  const num = Number(normalized);
  return Number.isNaN(num) ? null : num;
}

function normalizeDate(value: string): string {
  if (!value) return '';

  if (value.includes('T')) {
    return value;
  }

  const normalized = value.replace(/\./g, '/').replace(/-/g, '/');
  const parts = normalized.split('/').map((part) => part.trim());

  if (parts.length === 3) {
    const [y, m, d] = parts;
    if (y && m && d) {
      return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }

  return value;
}

function normalizeTime(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();

  if (/^\d{1,2}:\d{1,2}$/.test(trimmed)) {
    const [h, m] = trimmed.split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`;
  }

  if (/^\d{1,2}:\d{1,2}:\d{1,2}$/.test(trimmed)) {
    const [h, m, s] = trimmed.split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
  }

  return trimmed;
}

function normalizeDateTime(value: string): string {
  if (!value) return '';

  const trimmed = value.trim();

  if (trimmed.includes('T')) {
    return trimmed;
  }

  const normalized = trimmed.replace(/\//g, '-');
  if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(normalized)) {
    return normalized.replace(' ', 'T');
  }

  return trimmed;
}

function formatDateTime(value?: string | null): string {
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

function getRequiredText(importType: ImportType): string {
  return REQUIRED_COLUMNS[importType].join(' / ');
}

function validateRow(importType: ImportType, row: CsvRow, rowIndex: number): string[] {
  const rowNo = rowIndex + 2;
  const errors: string[] = [];

  if (importType === 'staff') {
    const employeeCode = getValue(row, ['employee_code', 'code', 'staff_code']);
    const name = getValue(row, ['name', 'staff_name', 'employee_name']);

    if (!employeeCode || !name) {
      errors.push(`${rowNo}行目: employee_code と name は必須です。`);
    }
  }

  if (importType === 'shift') {
    const employeeCode = getValue(row, ['employee_code', 'code', 'staff_code']);
    const workDate = getValue(row, ['work_date', 'date', 'shift_date']);

    if (!employeeCode || !workDate) {
      errors.push(`${rowNo}行目: employee_code と work_date は必須です。`);
    }
  }

  if (importType === 'batch') {
    const batchNo = getValue(row, ['batch_no', 'lot_no']);
    const processKey = getValue(row, ['process_code', 'process_name', 'process']);

    if (!batchNo || !processKey) {
      errors.push(`${rowNo}行目: batch_no と process_code（または process_name）は必須です。`);
    }
  }

  if (importType === 'progress') {
    const batchNo = getValue(row, ['batch_no', 'lot_no']);

    if (!batchNo) {
      errors.push(`${rowNo}行目: batch_no は必須です。`);
    }
  }

  return errors;
}

async function insertFirstSuccess(
  table: string,
  candidates: Array<Record<string, unknown>>,
): Promise<{ error: Error | null }> {
  let lastError: any = null;

  for (const candidate of candidates) {
    const payload = compactRecord(candidate);
    const { error } = await supabase.from(table).insert(payload);

    if (!error) {
      return { error: null };
    }

    lastError = error;
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
    const payload = compactRecord(candidate);
    const { error } = await supabase.from(table).update(payload).eq('id', id);

    if (!error) {
      return { error: null };
    }

    lastError = error;
  }

  return { error: lastError as Error | null };
}

async function saveImportJob(params: {
  centerId: string;
  userId?: string;
  importType: ImportType;
  fileName: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: string[];
  status: 'success' | 'partial' | 'failed';
}) {
  const { centerId, userId, importType, fileName, totalRows, successCount, errorCount, errors, status } =
    params;
  const detailText = errors.length > 0 ? errors.join('\n') : null;

  const candidates: Array<Record<string, unknown>> = [
    {
      center_id: centerId,
      created_by: userId ?? null,
      import_type: importType,
      file_name: fileName,
      total_rows: totalRows,
      success_count: successCount,
      error_count: errorCount,
      status,
      error_details: detailText,
    },
    {
      center_id: centerId,
      user_id: userId ?? null,
      import_type: importType,
      file_name: fileName,
      total_count: totalRows,
      success_count: successCount,
      error_count: errorCount,
      status,
      error_details: detailText,
    },
    {
      center_id: centerId,
      import_type: importType,
      file_name: fileName,
      total_rows: totalRows,
      success_count: successCount,
      error_count: errorCount,
      status,
    },
  ];

  await insertFirstSuccess('import_jobs', candidates);
}

export default function ImportsPage() {
  const auth = useAuth() as any;
  const authProfile = (auth?.profile ?? null) as LooseProfile | null;
  const user = auth?.user ?? null;

  const [fallbackProfile, setFallbackProfile] = useState<LooseProfile | null>(null);
  const [importType, setImportType] = useState<ImportType>('shift');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<ImportJobRecord[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResolvingProfile, setIsResolvingProfile] = useState(false);
  const [pageError, setPageError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resolvedCenterId = authProfile?.center_id ?? fallbackProfile?.center_id ?? null;
  const resolvedRole = authProfile?.role ?? fallbackProfile?.role ?? '-';
  const resolvedEmail = authProfile?.email ?? user?.email ?? '-';
  const resolvedCenterName =
    authProfile?.centerName ??
    authProfile?.center_name ??
    authProfile?.centers?.name ??
    fallbackProfile?.centerName ??
    fallbackProfile?.center_name ??
    fallbackProfile?.centers?.name ??
    'センター未設定';

  const isViewer = String(resolvedRole ?? '').toLowerCase() === 'viewer';
  const canImport = !isViewer;

  const previewRows = useMemo(() => rows.slice(0, 5), [rows]);
  const previewHeaders = useMemo(() => {
    if (previewRows.length === 0) return [];
    return Object.keys(previewRows[0]);
  }, [previewRows]);

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
    void loadHistory(resolvedCenterId);
  }, [resolvedCenterId]);

  async function loadHistory(centerId: string) {
    const { data, error } = await supabase
      .from('import_jobs')
      .select('*')
      .eq('center_id', centerId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('取込履歴の取得に失敗しました:', error);
      return;
    }

    setHistory((data ?? []) as ImportJobRecord[]);
  }

  function resetCurrentImport() {
    setFileName('');
    setRows([]);
    setResult(null);
    setPageError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleChangeImportType(nextType: ImportType) {
    setImportType(nextType);
    resetCurrentImport();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (!canImport) {
      setPageError('viewer権限ではCSV取込できません。');
      return;
    }

    const file = event.target.files?.[0];
    setPageError('');
    setResult(null);

    if (!file) {
      setFileName('');
      setRows([]);
      return;
    }

    setFileName(file.name);
    setIsParsing(true);

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parseResult) => {
        const normalizedRows = (parseResult.data ?? [])
          .map((raw) => normalizeRow(raw))
          .filter((row) => Object.values(row).some((value) => value !== ''));

        setRows(normalizedRows);
        setIsParsing(false);
      },
      error: (error) => {
        console.error(error);
        setPageError(`CSVの読み込みに失敗しました: ${error.message}`);
        setRows([]);
        setIsParsing(false);
      },
    });
  }

  async function fetchStaffMap(centerId: string) {
    const { data, error } = await supabase.from('staff').select('*').eq('center_id', centerId);

    if (error) {
      throw new Error(`staff の取得に失敗しました: ${error.message}`);
    }

    const map = new Map<string, any>();

    (data ?? []).forEach((item: any) => {
      const employeeCode = item.employee_code ?? item.code ?? item.staff_code ?? '';
      if (employeeCode) {
        map.set(normalizeLookup(employeeCode), item);
      }
    });

    return map;
  }

  async function fetchProcessMap(centerId: string) {
    const { data, error } = await supabase.from('processes').select('*').eq('center_id', centerId);

    if (error) {
      throw new Error(`processes の取得に失敗しました: ${error.message}`);
    }

    const map = new Map<string, any>();

    (data ?? []).forEach((item: any) => {
      const processCode = item.process_code ?? item.code ?? '';
      const processName = item.name ?? item.process_name ?? '';

      if (processCode) {
        map.set(normalizeLookup(processCode), item);
      }
      if (processName) {
        map.set(normalizeLookup(processName), item);
      }
    });

    return map;
  }

  async function fetchBatchMap(centerId: string) {
    const { data, error } = await supabase
      .from('work_batches')
      .select('*')
      .eq('center_id', centerId);

    if (error) {
      throw new Error(`work_batches の取得に失敗しました: ${error.message}`);
    }

    const map = new Map<string, any>();

    (data ?? []).forEach((item: any) => {
      const candidates = [item.batch_no, item.lot_no, item.batch_id].filter(Boolean);

      candidates.forEach((code: string) => {
        map.set(normalizeLookup(code), item);
      });
    });

    return map;
  }

  async function findWorkBatchByBatchNo(centerId: string, batchNo: string) {
    const normalized = batchNo.trim();

    const primary = await supabase
      .from('work_batches')
      .select('*')
      .eq('center_id', centerId)
      .eq('batch_no', normalized)
      .maybeSingle();

    if (!primary.error && primary.data) {
      return primary.data;
    }

    const fallback = await supabase
      .from('work_batches')
      .select('*')
      .eq('batch_no', normalized)
      .maybeSingle();

    if (!fallback.error && fallback.data) {
      return fallback.data;
    }

    return null;
  }

  async function importStaffRows(centerId: string, targetRows: CsvRow[]) {
    let successCount = 0;
    const errors: string[] = [];

    for (let index = 0; index < targetRows.length; index += 1) {
      const row = targetRows[index];
      const rowNo = index + 2;

      const rowErrors = validateRow('staff', row, index);
      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        continue;
      }

      const employeeCode = getValue(row, ['employee_code', 'code', 'staff_code']);
      const name = getValue(row, ['name', 'staff_name', 'employee_name']);
      const employmentType = getValue(row, ['employment_type', 'type']);
      const status = getValue(row, ['status']) || 'active';
      const note = getValue(row, ['note', 'memo']);

      const existing = await supabase
        .from('staff')
        .select('id')
        .eq('center_id', centerId)
        .eq('employee_code', employeeCode)
        .maybeSingle();

      const payload = compactRecord({
        center_id: centerId,
        employee_code: employeeCode,
        name,
        employment_type: employmentType,
        status,
        note,
      });

      const response = existing.data?.id
        ? await supabase.from('staff').update(payload).eq('id', existing.data.id)
        : await supabase.from('staff').insert(payload);

      if (response.error) {
        errors.push(`${rowNo}行目: staff 登録に失敗しました。${response.error.message}`);
        continue;
      }

      successCount += 1;
    }

    return {
      successCount,
      errorCount: errors.length,
      errors,
    };
  }

  async function importShiftRows(centerId: string, targetRows: CsvRow[]) {
    const staffMap = await fetchStaffMap(centerId);

    let successCount = 0;
    const errors: string[] = [];

    for (let index = 0; index < targetRows.length; index += 1) {
      const row = targetRows[index];
      const rowNo = index + 2;

      const rowErrors = validateRow('shift', row, index);
      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        continue;
      }

      const employeeCode = getValue(row, ['employee_code', 'code', 'staff_code']);
      const workDate = normalizeDate(getValue(row, ['work_date', 'date', 'shift_date']));
      const plannedStart = normalizeTime(getValue(row, ['planned_start', 'start_time', 'shift_start']));
      const plannedEnd = normalizeTime(getValue(row, ['planned_end', 'end_time', 'shift_end']));
      const attendanceStatus = getValue(row, ['attendance_status', 'status']) || 'planned';
      const note = getValue(row, ['note', 'memo']);

      const staff = staffMap.get(normalizeLookup(employeeCode));

      if (!staff?.id) {
        errors.push(`${rowNo}行目: employee_code ${employeeCode} に一致する staff が見つかりません。`);
        continue;
      }

      const existing = await supabase
        .from('shifts')
        .select('id')
        .eq('staff_id', staff.id)
        .eq('work_date', workDate)
        .maybeSingle();

      const payload = compactRecord({
        staff_id: staff.id,
        work_date: workDate,
        planned_start: plannedStart,
        planned_end: plannedEnd,
        attendance_status: attendanceStatus,
        note,
      });

      const response = existing.data?.id
        ? await supabase.from('shifts').update(payload).eq('id', existing.data.id)
        : await supabase.from('shifts').insert(payload);

      if (response.error) {
        errors.push(`${rowNo}行目: shifts 登録に失敗しました。${response.error.message}`);
        continue;
      }

      successCount += 1;
    }

    return {
      successCount,
      errorCount: errors.length,
      errors,
    };
  }

  async function importBatchRows(centerId: string, targetRows: CsvRow[]) {
    const processMap = await fetchProcessMap(centerId);

    let successCount = 0;
    const errors: string[] = [];

    for (let index = 0; index < targetRows.length; index += 1) {
      const row = targetRows[index];
      const rowNo = index + 2;

      const rowErrors = validateRow('batch', row, index);
      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        continue;
      }

      const batchNo = getValue(row, ['batch_no', 'lot_no']);
      const processKey = normalizeLookup(getValue(row, ['process_code', 'process_name', 'process']));
      const batchType = getValue(row, ['batch_type', 'type']);
      const targetDate = normalizeDate(getValue(row, ['target_date', 'scheduled_date', 'work_date', 'date']));
      const plannedQty = toNumberOrNull(getValue(row, ['planned_qty', 'planned_quantity', 'quantity']));
      const actualQty = toNumberOrNull(getValue(row, ['actual_qty', 'completed_qty', 'done_qty']));
      const status = getValue(row, ['status']) || 'planned';
      const note = getValue(row, ['note', 'memo']);

      const process = processMap.get(processKey);

      if (!process?.id) {
        errors.push(`${rowNo}行目: process_code / process_name に一致する工程が見つかりません。`);
        continue;
      }

      const existing = await findWorkBatchByBatchNo(centerId, batchNo);

      const candidates: Array<Record<string, unknown>> = [
        {
          center_id: centerId,
          process_id: process.id,
          batch_no: batchNo,
          batch_type: batchType,
          target_date: targetDate,
          planned_qty: plannedQty,
          actual_qty: actualQty,
          status,
          note,
        },
        {
          center_id: centerId,
          process_id: process.id,
          batch_no: batchNo,
          batch_type: batchType,
          target_date: targetDate,
          planned_qty: plannedQty,
          actual_qty: actualQty,
          status,
        },
        {
          process_id: process.id,
          batch_no: batchNo,
          batch_type: batchType,
          target_date: targetDate,
          planned_qty: plannedQty,
          actual_qty: actualQty,
          status,
          note,
        },
        {
          process_id: process.id,
          batch_no: batchNo,
          batch_type: batchType,
          target_date: targetDate,
          planned_qty: plannedQty,
          actual_qty: actualQty,
          status,
        },
      ];

      const response = existing?.id
        ? await updateFirstSuccess('work_batches', existing.id, candidates)
        : await insertFirstSuccess('work_batches', candidates);

      if (response.error) {
        errors.push(`${rowNo}行目: work_batches 登録に失敗しました。${response.error.message}`);
        continue;
      }

      successCount += 1;
    }

    return {
      successCount,
      errorCount: errors.length,
      errors,
    };
  }

  async function importProgressRows(centerId: string, targetRows: CsvRow[]) {
    const processMap = await fetchProcessMap(centerId);
    const batchMap = await fetchBatchMap(centerId);

    let successCount = 0;
    const errors: string[] = [];

    for (let index = 0; index < targetRows.length; index += 1) {
      const row = targetRows[index];
      const rowNo = index + 2;

      const rowErrors = validateRow('progress', row, index);
      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        continue;
      }

      const rawBatchNo = getValue(row, ['batch_no', 'lot_no']);
      const batchKey = normalizeLookup(rawBatchNo);

      const processKey = normalizeLookup(getValue(row, ['process_code', 'process_name', 'process']));
      const loggedAt = normalizeDateTime(getValue(row, ['logged_at', 'recorded_at', 'logged_time']));
      const targetDate = normalizeDate(getValue(row, ['target_date', 'scheduled_date', 'work_date', 'date']));
      const completedQty = toNumberOrNull(getValue(row, ['completed_qty', 'done_qty', 'actual_qty']));
      const backlogQty = toNumberOrNull(getValue(row, ['backlog_qty', 'remaining_qty']));
      const workingStaffCount = toNumberOrNull(getValue(row, ['working_staff_count', 'worker_count']));
      const memo = getValue(row, ['memo', 'note']);

      const batch = batchMap.get(batchKey);

      if (!batch?.id) {
        errors.push(
          `${rowNo}行目: batch_no「${rawBatchNo}」に一致する work_batches が見つかりません。先に batch CSV を取り込んでください。`,
        );
        continue;
      }

      let processId = batch.process_id ?? null;

      if (processKey) {
        const process = processMap.get(processKey);
        if (!process?.id) {
          errors.push(`${rowNo}行目: process_code / process_name に一致する工程が見つかりません。`);
          continue;
        }
        processId = process.id;
      }

      let progressPercent: number | null = null;
      if (completedQty !== null && batch.planned_qty) {
        const calculated = Math.min(
          100,
          Math.max(0, Math.round((completedQty / Number(batch.planned_qty)) * 100)),
        );
        progressPercent = Number.isNaN(calculated) ? null : calculated;
      }

      const candidates: Array<Record<string, unknown>> = [
        {
          batch_id: batch.id,
          process_id: processId,
          logged_at: loggedAt || null,
          target_date: targetDate || null,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
          progress_percent: progressPercent,
        },
        {
          batch_id: batch.id,
          process_id: processId,
          logged_at: loggedAt || null,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
          progress_percent: progressPercent,
        },
        {
          batch_id: batch.id,
          process_id: processId,
          target_date: targetDate || null,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
          progress_percent: progressPercent,
        },
        {
          batch_id: batch.id,
          process_id: processId,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
        },
        {
          batch_id: batch.id,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
          memo,
        },
        {
          batch_id: batch.id,
          completed_qty: completedQty,
          backlog_qty: backlogQty,
          working_staff_count: workingStaffCount,
        },
      ];

      const response = await insertFirstSuccess('progress_logs', candidates);

      if (response.error) {
        errors.push(`${rowNo}行目: progress_logs 登録に失敗しました。${response.error.message}`);
        continue;
      }

      successCount += 1;
    }

    return {
      successCount,
      errorCount: errors.length,
      errors,
    };
  }

  async function handleImport() {
    if (!canImport) {
      setPageError('viewer権限ではCSV取込できません。');
      return;
    }

    if (!resolvedCenterId) {
      setPageError(
        'center_id が取得できません。ログイン状態または profiles.center_id を確認してください。',
      );
      return;
    }

    if (rows.length === 0) {
      setPageError('CSVファイルを選択してください。');
      return;
    }

    setIsImporting(true);
    setPageError('');
    setResult(null);

    try {
      let importResult: ImportResult;

      if (importType === 'staff') {
        importResult = await importStaffRows(resolvedCenterId, rows);
      } else if (importType === 'shift') {
        importResult = await importShiftRows(resolvedCenterId, rows);
      } else if (importType === 'batch') {
        importResult = await importBatchRows(resolvedCenterId, rows);
      } else {
        importResult = await importProgressRows(resolvedCenterId, rows);
      }

      setResult(importResult);

      const status: 'success' | 'partial' | 'failed' =
        importResult.successCount > 0 && importResult.errorCount === 0
          ? 'success'
          : importResult.successCount > 0
            ? 'partial'
            : 'failed';

      await saveImportJob({
        centerId: resolvedCenterId,
        userId: user?.id,
        importType,
        fileName: fileName || 'unknown.csv',
        totalRows: rows.length,
        successCount: importResult.successCount,
        errorCount: importResult.errorCount,
        errors: importResult.errors,
        status,
      });

      await loadHistory(resolvedCenterId);
    } catch (error: any) {
      console.error(error);
      setPageError(error?.message ?? '取込処理中にエラーが発生しました。');
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">CSV取込</h1>
            <p className="mt-1 text-sm text-slate-600">
              スタッフ・シフト・作業バッチ・進捗ログをCSVから一括登録します。
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <div>
              <span className="font-semibold">ログインユーザー:</span> {resolvedEmail}
            </div>
            <div>
              <span className="font-semibold">権限:</span> {resolvedRole}
            </div>
            <div>
              <span className="font-semibold">センター:</span> {resolvedCenterName}
            </div>
            <div>
              <span className="font-semibold">center_id:</span> {resolvedCenterId ?? '未取得'}
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
            viewer 権限のため、この画面は閲覧専用です。CSV取込は実行できません。
          </div>
        )}

        {pageError && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {pageError}
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">取込種別</h2>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {IMPORT_OPTIONS.map((option) => {
                const active = importType === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleChangeImportType(option.value)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      active
                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                    <div className="mt-1 text-sm text-slate-600">{option.description}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span className="font-semibold">必須列:</span> {getRequiredText(importType)}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">CSVファイル選択</h2>

            <div className="mt-4 space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                disabled={!canImport}
                className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              />

              <div className="text-sm text-slate-600">
                {fileName ? `選択中: ${fileName}` : 'まだファイルは選択されていません。'}
              </div>

              <div className="flex flex-wrap gap-3">
                {canImport && (
                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={isParsing || isImporting || rows.length === 0}
                    className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {isImporting ? '取込中...' : 'CSVを取り込む'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={resetCurrentImport}
                  disabled={isImporting}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  クリア
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-bold text-slate-900">CSVプレビュー</h2>
            </div>

            <div className="overflow-x-auto">
              {previewRows.length === 0 ? (
                <div className="px-6 py-10 text-sm text-slate-500">
                  CSVを選択すると、先頭5件をプレビュー表示します。
                </div>
              ) : (
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {previewHeaders.map((header) => (
                        <th
                          key={header}
                          className="whitespace-nowrap px-6 py-4 text-left font-semibold text-slate-700"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {previewRows.map((row, index) => (
                      <tr key={`preview-${index}`}>
                        {previewHeaders.map((header) => (
                          <td
                            key={`${index}-${header}`}
                            className="whitespace-nowrap px-6 py-4 text-slate-700"
                          >
                            {row[header] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {rows.length > 5 && (
              <div className="border-t border-slate-200 px-6 py-4 text-sm text-slate-500">
                全{rows.length}件中、先頭5件を表示しています。
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-bold text-slate-900">取込結果</h2>
            </div>

            <div className="space-y-4 p-6">
              {!result ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  まだ取込結果はありません。
                </div>
              ) : (
                <>
                  <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-700">
                    <span className="font-semibold">成功件数:</span> {result.successCount} /{' '}
                    <span className="font-semibold">エラー件数:</span> {result.errorCount}
                  </div>

                  {result.errors.length > 0 ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                      <div className="text-sm font-semibold text-rose-700">エラー詳細</div>
                      <ul className="mt-3 space-y-2 break-words text-sm text-rose-700">
                        {result.errors.map((error) => (
                          <li key={error}>- {error}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
                      エラーはありません。正常に取込できました。
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-bold text-slate-900">取込履歴</h2>
            </div>

            <div className="space-y-4 p-6">
              {history.length === 0 ? (
                <div className="text-sm text-slate-500">まだ履歴がありません。</div>
              ) : (
                history.map((job, index) => {
                  const totalRows = job.total_rows ?? job.total_count ?? 0;
                  const successCount = job.success_count ?? 0;
                  const errorCount = job.error_count ?? 0;

                  return (
                    <div
                      key={job.id ?? `job-${index}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {job.file_name ?? 'ファイル名なし'}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatDateTime(job.created_at)}
                          </div>
                        </div>

                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            job.status === 'success'
                              ? 'bg-emerald-100 text-emerald-700'
                              : job.status === 'partial'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          {job.status ?? '-'}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-2 text-sm text-slate-700">
                        <div>
                          <span className="font-semibold">取込種別:</span> {job.import_type ?? '-'}
                        </div>
                        <div>
                          <span className="font-semibold">総件数:</span> {totalRows}
                        </div>
                        <div>
                          <span className="font-semibold">成功:</span> {successCount} /{' '}
                          <span className="font-semibold">エラー:</span> {errorCount}
                        </div>
                      </div>

                      {job.error_details ? (
                        <div className="mt-3 rounded-xl bg-white px-4 py-3 text-xs leading-6 text-slate-600 whitespace-pre-wrap break-words">
                          {Array.isArray(job.error_details)
                            ? job.error_details.join('\n')
                            : String(job.error_details)}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}