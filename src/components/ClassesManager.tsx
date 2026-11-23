import React from 'react';
import { Download, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { GradebookClass, VIETNAM_SUBJECTS } from '../types/gradebook';

interface ClassesManagerProps {
  classes: GradebookClass[];
  activeClassId: string | null;
  onSelectClass: (id: string) => void;
  onUpdateClassMeta: (id: string, patch: Partial<GradebookClass>) => void;
  onDeleteClass: (id: string) => void;
  onExportClass: (gradebook: GradebookClass, mode: 'patched' | 'styled' | 'xls') => void;
  onOpenImport: () => void;
}

export const ClassesManager: React.FC<ClassesManagerProps> = ({
  classes,
  activeClassId,
  onSelectClass,
  onUpdateClassMeta,
  onDeleteClass,
  onExportClass,
  onOpenImport,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold text-lg text-slate-900">
            Danh sách Lớp &amp; Môn học đã lưu
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Dữ liệu được lưu cục bộ trên trình duyệt và giữ nguyên định dạng file vnEdu gốc khi xuất.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenImport}
          className="min-h-[42px] sm:min-h-[36px] px-4 py-2 rounded-xl sm:rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Nhập Excel / Thêm lớp
        </button>
      </div>

      {classes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <div className="mx-auto w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div className="font-display font-semibold text-sm text-slate-900">
            Chưa có lớp nào trong sổ điểm
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Tải lên file Excel từ vnEdu để bắt đầu quét điểm theo từng lớp và từng môn học.
          </p>
          <button
            type="button"
            onClick={onOpenImport}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium"
          >
            Tải file Excel vnEdu
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {classes.map((cls) => {
            const isActive = cls.id === activeClassId;
            const totalStudents = cls.students.length;
            const tx1Count = cls.students.filter((s) => s.tx1 !== null).length;

            return (
              <div
                key={cls.id}
                className={`bg-white rounded-xl border p-4 flex flex-col gap-3 transition-colors ${
                  isActive ? 'border-blue-600 ring-1 ring-blue-600/20' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-semibold text-base text-slate-900 truncate">
                        Lớp {cls.className} · {cls.subject}
                      </h3>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{cls.schoolName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{totalStudents} học sinh</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">TX1: {tx1Count}/{totalStudents}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDeleteClass(cls.id)}
                    title="Xóa lớp này"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Inline editable class metadata */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Môn học</label>
                    <select
                      value={cls.subject}
                      onChange={(e) => onUpdateClassMeta(cls.id, { subject: e.target.value })}
                      className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 bg-slate-50"
                    >
                      {!VIETNAM_SUBJECTS.includes(cls.subject) && (
                        <option value={cls.subject}>{cls.subject}</option>
                      )}
                      {VIETNAM_SUBJECTS.map((subj) => (
                        <option key={subj} value={subj}>
                          {subj}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Học kỳ</label>
                    <select
                      value={cls.semester}
                      onChange={(e) => onUpdateClassMeta(cls.id, { semester: e.target.value })}
                      className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 bg-slate-50"
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
                      onChange={(e) => onUpdateClassMeta(cls.id, { schoolYear: e.target.value })}
                      className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 bg-slate-50 font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => onSelectClass(cls.id)}
                    className={`min-h-[40px] sm:min-h-[32px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-800 border border-blue-200'
                        : 'bg-blue-700 hover:bg-blue-800 text-white'
                    }`}
                  >
                    {isActive ? 'Đang chọn để quét' : 'Chọn lớp này'}
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {cls.originalLayout?.rawBase64 && (
                      <button
                        type="button"
                        onClick={() => onExportClass(cls, 'patched')}
                        className="min-h-[40px] sm:min-h-[32px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1 whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Xuất file gốc ({cls.originalLayout.fileType})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onExportClass(cls, 'styled')}
                      className="min-h-[40px] sm:min-h-[32px] px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Xuất chuẩn .xlsx
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
