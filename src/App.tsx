import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FolderKanban,
  Plus,
  Table2,
} from 'lucide-react';
import {
  GradebookClass,
  SCORE_COLUMNS,
  ScoreColumnKey,
  VIETNAM_SUBJECTS,
} from './types/gradebook';
import {
  deleteGradebook,
  getStoredActiveClassId,
  loadAllGradebooks,
  saveGradebook,
  setStoredActiveClassId,
} from './utils/storage';
import {
  downloadBlankVnEduTemplate,
  exportPatchedOriginalExcel,
  exportStyledVnEduXlsx,
} from './utils/excelVnEdu';
import { CameraScanner } from './components/CameraScanner';
import { GradebookTable } from './components/GradebookTable';
import { ImportClassModal } from './components/ImportClassModal';
import { ClassesManager } from './components/ClassesManager';
import { GuideSection } from './components/GuideSection';

type ActiveTab = 'workspace' | 'table' | 'classes' | 'guide';

export default function App() {
  const [classes, setClasses] = useState<GradebookClass[]>([]);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [activeColumn, setActiveColumn] = useState<ScoreColumnKey>('tx1');
  const [activeTab, setActiveTab] = useState<ActiveTab>('workspace');

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [highlightedStt, setHighlightedStt] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    void (async () => {
      const loaded = await loadAllGradebooks();
      setClasses(loaded);
      const savedId = getStoredActiveClassId();
      if (savedId && loaded.some((c) => c.id === savedId)) {
        setActiveClassId(savedId);
      } else if (loaded.length > 0) {
        setActiveClassId(loaded[0].id);
      }
    })();
  }, []);

  const activeClass = useMemo(
    () => classes.find((c) => c.id === activeClassId) ?? null,
    [classes, activeClassId],
  );

  const handleSelectClass = useCallback((id: string) => {
    setActiveClassId(id);
    setStoredActiveClassId(id);
  }, []);

  const handleImportClasses = useCallback(
    async (imported: GradebookClass[]) => {
      for (const cls of imported) {
        await saveGradebook(cls);
      }
      const updated = await loadAllGradebooks();
      setClasses(updated);
      if (imported[0]) {
        handleSelectClass(imported[0].id);
      }
      showToast(`Đã tải lên ${imported.length} bảng điểm lớp thành công.`);
    },
    [handleSelectClass, showToast],
  );

  const activeClassIdRef = useRef<string | null>(activeClassId);
  activeClassIdRef.current = activeClassId;

  useEffect(() => {
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';
    void fetch(`${apiBase}/api/health`).catch(() => {});
  }, []);

  const persistClassUpdate = useCallback(async (updatedClass: GradebookClass) => {
    const stamped = { ...updatedClass, updatedAt: new Date().toISOString() };
    setClasses((prev) => prev.map((c) => (c.id === stamped.id ? stamped : c)));
    await saveGradebook(stamped);
  }, []);

  const handleUpdateScore = useCallback(
    (stt: number, column: ScoreColumnKey, value: number | null) => {
      const targetId = activeClassIdRef.current;
      if (!targetId) return;
      setClasses((prev) =>
        prev.map((cls) => {
          if (cls.id !== targetId) return cls;
          const nextStudents = cls.students.map((st) =>
            st.stt === stt ? { ...st, [column]: value } : st,
          );
          const stamped: GradebookClass = {
            ...cls,
            students: nextStudents,
            updatedAt: new Date().toISOString(),
          };
          void saveGradebook(stamped);
          return stamped;
        }),
      );
    },
    [],
  );

  const handleUpdateComment = useCallback(
    (stt: number, comment: string) => {
      const targetId = activeClassIdRef.current;
      if (!targetId) return;
      setClasses((prev) =>
        prev.map((cls) => {
          if (cls.id !== targetId) return cls;
          const nextStudents = cls.students.map((st) =>
            st.stt === stt ? { ...st, nhanXet: comment } : st,
          );
          const stamped: GradebookClass = {
            ...cls,
            students: nextStudents,
            updatedAt: new Date().toISOString(),
          };
          void saveGradebook(stamped);
          return stamped;
        }),
      );
    },
    [],
  );

  const handleUpdateClassMeta = useCallback(
    (id: string, patch: Partial<GradebookClass>) => {
      const target = classes.find((c) => c.id === id);
      if (!target) return;
      void persistClassUpdate({ ...target, ...patch });
    },
    [classes, persistClassUpdate],
  );

  const handleDeleteClass = useCallback(
    async (id: string) => {
      await deleteGradebook(id);
      const remaining = await loadAllGradebooks();
      setClasses(remaining);
      if (activeClassId === id) {
        const nextId = remaining[0]?.id ?? null;
        setActiveClassId(nextId);
        setStoredActiveClassId(nextId);
      }
      showToast('Đã xóa bảng điểm lớp.');
    },
    [activeClassId, showToast],
  );

  const handleExport = useCallback(
    async (target: GradebookClass | null, mode: 'patched' | 'styled' | 'xls') => {
      if (!target) {
        setIsImportOpen(true);
        return;
      }
      setIsExportMenuOpen(false);
      try {
        let fileName = '';
        if (mode === 'patched') {
          fileName = await exportPatchedOriginalExcel(target);
        } else if (mode === 'xls') {
          fileName = await exportPatchedOriginalExcel(target, 'xls');
        } else {
          fileName = await exportStyledVnEduXlsx(target);
        }
        showToast(`Đã xuất file Excel: ${fileName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi xuất file Excel';
        showToast(msg);
      }
    },
    [showToast],
  );

  const handleFocusStudentRow = useCallback((stt: number) => {
    setHighlightedStt(stt);
    window.setTimeout(() => {
      setHighlightedStt((curr) => (curr === stt ? null : curr));
    }, 1400);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="bg-white border-b border-slate-200 md:sticky md:top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-13 sm:h-14 flex items-center justify-between gap-4 md:gap-8">
          {/* Zone 1: Single-line Brand wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('workspace');
            }}
            className="font-display font-bold text-base sm:text-lg tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Sổ Điểm Camera
          </a>

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('workspace')}
              className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'workspace'
                  ? 'border-blue-700 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Quét Camera
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('table')}
              className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'table'
                  ? 'border-blue-700 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Bảng Điểm
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('classes')}
              className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'classes'
                  ? 'border-blue-700 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Lớp &amp; Môn
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('guide')}
              className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'guide'
                  ? 'border-blue-700 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Hướng Dẫn
            </button>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="relative shrink-0" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => {
                if (!activeClass) {
                  setIsImportOpen(true);
                } else {
                  setIsExportMenuOpen((v) => !v);
                }
              }}
              className="min-h-[40px] sm:min-h-[34px] px-3.5 sm:px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{activeClass ? 'Xuất Excel vnEdu' : 'Nhập Excel vnEdu'}</span>
              {activeClass && <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {isExportMenuOpen && activeClass && (
              <div className="absolute right-0 mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-40">
                {activeClass.originalLayout?.rawBase64 && (
                  <button
                    type="button"
                    onClick={() => void handleExport(activeClass, 'patched')}
                    className="w-full px-3.5 py-2 text-left text-xs hover:bg-slate-50 flex flex-col gap-0.5"
                  >
                    <span className="font-semibold text-slate-900">
                      Ghi đè vào file gốc (.{activeClass.originalLayout.fileType})
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Giữ nguyên cấu trúc cột &amp; sheet vnEdu đã tải lên
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleExport(activeClass, 'styled')}
                  className="w-full px-3.5 py-2 text-left text-xs hover:bg-slate-50 flex flex-col gap-0.5"
                >
                  <span className="font-semibold text-slate-900">
                    Xuất chuẩn Bộ GD&amp;ĐT (.xlsx)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Kèm công thức ĐTBmhk theo Thông tư 22
                  </span>
                </button>
                {activeClass.originalLayout?.rawBase64 && activeClass.originalLayout.fileType === 'xlsx' && (
                  <button
                    type="button"
                    onClick={() => void handleExport(activeClass, 'xls')}
                    className="w-full px-3.5 py-2 text-left text-xs hover:bg-slate-50 flex flex-col gap-0.5"
                  >
                    <span className="font-semibold text-slate-900">
                      Xuất tương thích cũ (.xls)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Định dạng Excel 97-2003 cho cổng vnEdu cũ
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Workspace Selector Toolbar: Chọn Lớp, Chọn Môn, Chọn Cột Điểm */}
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-3.5 sm:px-6 py-2.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
          {/* Class & Subject Selectors */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="class-select"
              aria-label="Chọn lớp"
              value={activeClassId ?? ''}
              onChange={(e) => handleSelectClass(e.target.value)}
              disabled={classes.length === 0}
              className="min-h-[40px] sm:min-h-[34px] px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50 text-slate-900 flex-1 sm:flex-initial min-w-[140px] max-w-full sm:max-w-[240px] truncate"
            >
              {classes.length === 0 ? (
                <option value="">Chưa có lớp</option>
              ) : (
                classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    Lớp {cls.className} · {cls.subject} ({cls.students.length} HS)
                  </option>
                ))
              )}
            </select>

            {activeClass && (
              <select
                id="subject-select"
                aria-label="Chọn môn học"
                value={activeClass.subject}
                onChange={(e) => handleUpdateClassMeta(activeClass.id, { subject: e.target.value })}
                className="min-h-[40px] sm:min-h-[34px] px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50 text-slate-900"
              >
                {!VIETNAM_SUBJECTS.includes(activeClass.subject) && (
                  <option value={activeClass.subject}>{activeClass.subject}</option>
                )}
                {VIETNAM_SUBJECTS.map((subj) => (
                  <option key={subj} value={subj}>
                    {subj}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => setIsImportOpen(true)}
              className="min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Nhập Excel
            </button>
          </div>

          {/* Target Score Column Segmented Control */}
          <div className="flex items-center gap-2 overflow-x-auto max-w-full pb-0.5 lg:pb-0">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0 hidden sm:inline">
              Cột điểm:
            </span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl sm:rounded-lg shrink-0">
              {SCORE_COLUMNS.map((col) => {
                const isSelected = activeColumn === col.key;
                const filledCount = activeClass
                  ? activeClass.students.filter((s) => s[col.key] !== null).length
                  : 0;
                const total = activeClass?.students.length ?? 0;

                return (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => setActiveColumn(col.key)}
                    className={`min-h-[36px] sm:min-h-[30px] px-2.5 py-1 text-xs font-medium rounded-lg sm:rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-white text-blue-800 font-semibold shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>{col.shortLabel}</span>
                    {activeClass && (
                      <span className="font-mono tabular-nums text-[10px] text-slate-400">
                        {filledCount}/{total}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3.5 sm:px-6 pt-3.5 pb-20 md:py-5">
        {activeTab === 'workspace' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
            <div className="lg:col-span-5">
              {activeClass ? (
                <CameraScanner
                  students={activeClass.students}
                  activeColumn={activeColumn}
                  classNameLabel={activeClass.className}
                  subjectLabel={activeClass.subject}
                  onApplyScore={handleUpdateScore}
                  onFocusStudentRow={handleFocusStudentRow}
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl lg:rounded-xl p-8 text-center space-y-3">
                  <div className="mx-auto w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-semibold text-sm text-slate-900">
                    Tải danh sách lớp trước khi quét
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Hệ thống cần danh sách STT học sinh từ file Excel vnEdu để tự động đối chiếu họ tên khi quét bài.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsImportOpen(true)}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium"
                  >
                    Tải lên danh sách Excel
                  </button>
                </div>
              )}
            </div>

            <div className="hidden lg:block lg:col-span-7">
              <GradebookTable
                gradebook={activeClass}
                activeColumn={activeColumn}
                highlightedStt={highlightedStt}
                onSelectColumn={setActiveColumn}
                onUpdateCell={handleUpdateScore}
                onUpdateComment={handleUpdateComment}
                onOpenImport={() => setIsImportOpen(true)}
                onDownloadTemplate={() => void downloadBlankVnEduTemplate()}
              />
            </div>
          </div>
        )}

        {activeTab === 'table' && (
          <GradebookTable
            gradebook={activeClass}
            activeColumn={activeColumn}
            highlightedStt={highlightedStt}
            onSelectColumn={setActiveColumn}
            onUpdateCell={handleUpdateScore}
            onUpdateComment={handleUpdateComment}
            onOpenImport={() => setIsImportOpen(true)}
            onDownloadTemplate={() => void downloadBlankVnEduTemplate()}
          />
        )}

        {activeTab === 'classes' && (
          <ClassesManager
            classes={classes}
            activeClassId={activeClassId}
            onSelectClass={(id) => {
              handleSelectClass(id);
              setActiveTab('workspace');
            }}
            onUpdateClassMeta={handleUpdateClassMeta}
            onDeleteClass={(id) => void handleDeleteClass(id)}
            onExportClass={(cls, mode) => void handleExport(cls, mode)}
            onOpenImport={() => setIsImportOpen(true)}
          />
        )}

        {activeTab === 'guide' && <GuideSection />}
      </main>

      {/* Fixed Mobile Bottom Tab Bar (Thumb Zone, <= 8% viewport height) */}
      <nav
        aria-label="Điều hướng điện thoại"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-4 h-14"
      >
        <button
          type="button"
          onClick={() => setActiveTab('workspace')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            activeTab === 'workspace' ? 'text-blue-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <Camera className="w-5 h-5" />
          <span>Quét</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('table')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            activeTab === 'table' ? 'text-blue-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <Table2 className="w-5 h-5" />
          <span>Bảng điểm</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('classes')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            activeTab === 'classes' ? 'text-blue-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <FolderKanban className="w-5 h-5" />
          <span>Lớp &amp; Môn</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('guide')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            activeTab === 'guide' ? 'text-blue-700 font-semibold' : 'text-slate-500'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span>Hướng dẫn</span>
        </button>
      </nav>

      {/* Import Modal */}
      <ImportClassModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportClasses={(imported) => void handleImportClasses(imported)}
      />

      {/* Non-blocking Toast */}
      {toastMessage && (
        <div className="fixed bottom-16 md:bottom-4 right-4 left-4 md:left-auto z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
