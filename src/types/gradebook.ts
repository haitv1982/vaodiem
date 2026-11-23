export type ScoreColumnKey = 'tx1' | 'tx2' | 'tx3' | 'tx4' | 'gk' | 'ck';

export interface ScoreColumnMeta {
  key: ScoreColumnKey;
  label: string;
  shortLabel: string;
  group: string;
  weight: number;
}

export const SCORE_COLUMNS: ScoreColumnMeta[] = [
  { key: 'tx1', label: 'ĐĐGtx - TX1', shortLabel: 'TX1', group: 'ĐĐGtx', weight: 1 },
  { key: 'tx2', label: 'ĐĐGtx - TX2', shortLabel: 'TX2', group: 'ĐĐGtx', weight: 1 },
  { key: 'tx3', label: 'ĐĐGtx - TX3', shortLabel: 'TX3', group: 'ĐĐGtx', weight: 1 },
  { key: 'tx4', label: 'ĐĐGtx - TX4', shortLabel: 'TX4', group: 'ĐĐGtx', weight: 1 },
  { key: 'gk', label: 'ĐĐGgk (Giữa kỳ)', shortLabel: 'ĐĐGgk', group: 'Giữa kỳ', weight: 2 },
  { key: 'ck', label: 'ĐĐGck (Cuối kỳ)', shortLabel: 'ĐĐGck', group: 'Cuối kỳ', weight: 3 },
];

export const VIETNAM_SUBJECTS = [
  'Tin học',
  'Toán',
  'Ngữ văn',
  'Tiếng Anh',
  'Khoa học tự nhiên',
  'Lịch sử và Địa lí',
  'Giáo dục công dân',
  'Công nghệ',
  'Vật lí',
  'Hóa học',
  'Sinh học',
  'Lịch sử',
  'Địa lí',
  'Âm nhạc',
  'Mỹ thuật',
  'Giáo dục thể chất',
];

export interface StudentRow {
  stt: number;
  hoDem: string;
  ten: string;
  fullName: string;
  tx1: number | null;
  tx2: number | null;
  tx3: number | null;
  tx4: number | null;
  gk: number | null;
  ck: number | null;
  nhanXet: string;
  originalRowIndex?: number;
}

export interface OriginalSheetLayout {
  fileName: string;
  sheetName: string;
  fileType: 'xlsx' | 'xls';
  rawBase64?: string;
  headerRowIndex: number;
  colMap: {
    stt: number;
    hoDem?: number;
    ten?: number;
    fullName?: number;
    tx1?: number;
    tx2?: number;
    tx3?: number;
    tx4?: number;
    gk?: number;
    ck?: number;
    dtb?: number;
    nhanXet?: number;
  };
}

export interface GradebookClass {
  id: string;
  schoolUnit: string;
  schoolName: string;
  className: string;
  gradeLevel: string;
  subject: string;
  semester: string;
  schoolYear: string;
  students: StudentRow[];
  originalLayout?: OriginalSheetLayout;
  updatedAt: string;
}

export interface ScanApiResult {
  hasPaper: boolean;
  stt: number | null;
  score: number | null;
  sttRaw: string;
  scoreRaw: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  latencyMs: number;
  model?: string;
  error?: string;
}

export interface ScanHistoryItem {
  id: string;
  timestamp: string;
  stt: number | null;
  studentName: string | null;
  score: number | null;
  previousScore: number | null;
  columnKey: ScoreColumnKey;
  confidence: 'high' | 'medium' | 'low';
  latencyMs: number;
  status: 'applied' | 'pending_confirm' | 'unmatched' | 'invalid';
  note?: string;
  thumbnailDataUrl?: string;
}
