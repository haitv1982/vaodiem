import React, { useState } from 'react';
import { FileSpreadsheet, Plus, Upload, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { GradebookClass, StudentRow, VIETNAM_SUBJECTS } from '../types/gradebook';
import {
  downloadBlankVnEduTemplate,
  normalizeVietnameseSlug,
  parseVnEduExcelFile,
  splitVietnameseName,
} from '../utils/excelVnEdu';

interface ImportClassModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportClasses: (classes: GradebookClass[]) => void;
}

export const ImportClassModal: React.FC<ImportClassModalProps> = ({
  isOpen,
  onClose,
  onImportClasses,
}) => {
  const [tab, setTab] = useState<'excel' | 'manual'>('excel');
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<GradebookClass[] | null>(null);

  // Manual entry state
  const [className, setClassName] = useState('6A2');
  const [subject, setSubject] = useState('Tin học');
  const [semester, setSemester] = useState('Học kỳ 1');
  const [schoolYear, setSchoolYear] = useState('2026-2027');
  const [schoolName, setSchoolName] = useState('THCS GIAI LẠC');
  const [schoolUnit, setSchoolUnit] = useState('ỦY BAN NHÂN DÂN XÃ GIAI LẠC');
  const [pastedNames, setPastedNames] = useState('');

  if (!isOpen) return null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setParseError(null);
    try {
      const allParsed: GradebookClass[] = [];
      for (const file of Array.from(files)) {
        const result = await parseVnEduExcelFile(file);
        allParsed.push(...result);
      }
      if (allParsed.length === 0) {
        setParseError(
          'Không tìm thấy cột STT và Họ và tên trong file Excel. Hãy kiểm tra lại đúng định dạng sổ điểm vnEdu.',
        );
        return;
      }
      setParsedPreview(allParsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi đọc file Excel.';
      setParseError(`Không thể đọc file Excel: ${msg}`);
    }
  };

  const handleConfirmExcelImport = () => {
    if (!parsedPreview || parsedPreview.length === 0) return;
    onImportClasses(parsedPreview);
    setParsedPreview(null);
    onClose();
  };

  const handleManualCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setParseError(null);

    const lines = pastedNames
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setParseError('Vui lòng nhập hoặc dán ít nhất 1 tên học sinh.');
      return;
    }

    const students: StudentRow[] = lines.map((line, index) => {
      const leadingNumMatch = line.match(/^(\d+)[\s.\t\-:]+(.+)$/);
      const stt = leadingNumMatch ? Number(leadingNumMatch[1]) : index + 1;
      const fullName = leadingNumMatch ? leadingNumMatch[2].trim() : line;
      const { hoDem, ten } = splitVietnameseName(fullName);

      return {
        stt,
        hoDem,
        ten,
        fullName,
        tx1: null,
        tx2: null,
        tx3: null,
        tx4: null,
        gk: null,
        ck: null,
        nhanXet: '',
      };
    });

    const gradeNum = className.match(/^(\d{1,2})/)?.[1] ?? '6';

    const newClass: GradebookClass = {
      id: `${normalizeVietnameseSlug(className)}_${normalizeVietnameseSlug(subject)}_${Date.now()}`,
      schoolUnit: schoolUnit.trim() || 'PHÒNG GIÁO DỤC VÀ ĐÀO TẠO',
      schoolName: schoolName.trim() || 'TRƯỜNG THCS',
      className: className.trim() || '6A1',
      gradeLevel: `Khối ${gradeNum}`,
      subject,
      semester,
      schoolYear,
      students,
      updatedAt: new Date().toISOString(),
    };

    onImportClasses([newClass]);
    setPastedNames('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl overflow-hidden shadow-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-900">
              Nhập danh sách lớp &amp; sổ điểm vnEdu
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Hỗ trợ file Excel xuất trực tiếp từ vnEdu (.xls, .xlsx) hoặc dán danh sách từ bảng tính.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-5 pt-3 border-b border-slate-200 flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              setTab('excel');
              setParseError(null);
            }}
            className={`pb-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'excel'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Tải file Excel (.xls / .xlsx)
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('manual');
              setParseError(null);
            }}
            className={`pb-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'manual'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Tạo nhanh / Dán danh sách
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {parseError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{parseError}</span>
            </div>
          )}

          {tab === 'excel' ? (
            <>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  void handleFiles(e.dataTransfer.files);
                }}
                className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-300 hover:border-blue-500 hover:bg-slate-50/60'
                }`}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  onChange={(e) => void handleFiles(e.target.files)}
                  className="hidden"
                />
                <div className="mx-auto w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 mb-3">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="font-display font-semibold text-sm text-slate-900">
                  Kéo thả file Excel sổ điểm vnEdu vào đây
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Hoặc nhấn để chọn file (.xls, .xlsx). Có thể chọn nhiều file lớp cùng lúc.
                </p>
              </label>

              <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
                <span>Chưa có file mẫu? Tải bảng điểm chuẩn vnEdu để xem cấu trúc:</span>
                <button
                  type="button"
                  onClick={() => void downloadBlankVnEduTemplate()}
                  className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap ml-2"
                >
                  Tải file mẫu (.xlsx)
                </button>
              </div>

              {parsedPreview && parsedPreview.length > 0 && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Đã nhận diện {parsedPreview.length} bảng điểm hợp lệ</span>
                  </div>

                  {parsedPreview.map((cls, idx) => (
                    <div
                      key={cls.id}
                      className="border border-slate-200 rounded-lg p-3.5 bg-slate-50/50 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <FileSpreadsheet className="w-4 h-4 text-blue-700" />
                          <span>{cls.originalLayout?.fileName}</span>
                        </div>
                        <span className="text-xs font-mono tabular-nums text-slate-600">
                          {cls.students.length} học sinh
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Lớp</label>
                          <input
                            type="text"
                            value={cls.className}
                            onChange={(e) => {
                              const next = [...parsedPreview];
                              next[idx] = { ...cls, className: e.target.value };
                              setParsedPreview(next);
                            }}
                            className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Môn học</label>
                          <input
                            type="text"
                            value={cls.subject}
                            onChange={(e) => {
                              const next = [...parsedPreview];
                              next[idx] = { ...cls, subject: e.target.value };
                              setParsedPreview(next);
                            }}
                            className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Học kỳ</label>
                          <select
                            value={cls.semester}
                            onChange={(e) => {
                              const next = [...parsedPreview];
                              next[idx] = { ...cls, semester: e.target.value };
                              setParsedPreview(next);
                            }}
                            className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 bg-white"
                          >
                            <option value="Học kỳ 1">Học kỳ 1</option>
                            <option value="Học kỳ 2">Học kỳ 2</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Năm học</label>
                          <input
                            type="text"
                            value={cls.schoolYear}
                            onChange={(e) => {
                              const next = [...parsedPreview];
                              next[idx] = { ...cls, schoolYear: e.target.value };
                              setParsedPreview(next);
                            }}
                            className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 bg-white font-mono"
                          />
                        </div>
                      </div>

                      {/* Preview detected score counts & top 3 rows */}
                      <div className="pt-1 border-t border-slate-200 space-y-2">
                        <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-2 font-mono tabular-nums">
                          <span>TX1: {cls.students.filter((s) => s.tx1 !== null).length}</span>
                          <span aria-hidden="true">·</span>
                          <span>TX2: {cls.students.filter((s) => s.tx2 !== null).length}</span>
                          <span aria-hidden="true">·</span>
                          <span>TX3: {cls.students.filter((s) => s.tx3 !== null).length}</span>
                          <span aria-hidden="true">·</span>
                          <span>TX4: {cls.students.filter((s) => s.tx4 !== null).length}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-blue-800">
                            ĐĐGgk: {cls.students.filter((s) => s.gk !== null).length}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>ĐĐGck: {cls.students.filter((s) => s.ck !== null).length}</span>
                        </div>
                        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                          <table className="w-full text-[11px]">
                            <thead className="bg-slate-100 text-slate-600">
                              <tr>
                                <th className="px-2 py-1 text-center">STT</th>
                                <th className="px-2 py-1 text-left">Họ và tên</th>
                                <th className="px-2 py-1 text-center">TX1</th>
                                <th className="px-2 py-1 text-center">ĐĐGgk</th>
                                <th className="px-2 py-1 text-center">ĐĐGck</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                              {cls.students.slice(0, 3).map((st) => (
                                <tr key={st.stt}>
                                  <td className="px-2 py-1 text-center">{st.stt}</td>
                                  <td className="px-2 py-1 text-left font-sans">{st.fullName}</td>
                                  <td className="px-2 py-1 text-center">{st.tx1 ?? '—'}</td>
                                  <td className="px-2 py-1 text-center font-semibold text-blue-800">{st.gk ?? '—'}</td>
                                  <td className="px-2 py-1 text-center">{st.ck ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <form id="manual-class-form" onSubmit={handleManualCreate} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Đơn vị chủ quản
                  </label>
                  <input
                    type="text"
                    value={schoolUnit}
                    onChange={(e) => setSchoolUnit(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tên trường
                  </label>
                  <input
                    type="text"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Lớp</label>
                  <input
                    type="text"
                    required
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="VD: 6A2"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Môn học</label>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    {VIETNAM_SUBJECTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Học kỳ</label>
                  <select
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="Học kỳ 1">Học kỳ 1</option>
                    <option value="Học kỳ 2">Học kỳ 2</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Năm học</label>
                  <input
                    type="text"
                    value={schoolYear}
                    onChange={(e) => setSchoolYear(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Danh sách họ tên học sinh (mỗi học sinh 1 dòng, có thể dán trực tiếp từ Excel)
                </label>
                <textarea
                  rows={7}
                  value={pastedNames}
                  onChange={(e) => setPastedNames(e.target.value)}
                  placeholder={'Mai Khánh An\nCung Thị Quỳnh Anh\nĐào Quang Anh\nHoàng Ngọc Anh'}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 font-sans leading-relaxed"
                />
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium"
          >
            Đóng
          </button>
          {tab === 'excel' ? (
            <button
              type="button"
              disabled={!parsedPreview || parsedPreview.length === 0}
              onClick={handleConfirmExcelImport}
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Lưu vào hệ thống
            </button>
          ) : (
            <button
              type="submit"
              form="manual-class-form"
              className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Tạo bảng điểm lớp
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
