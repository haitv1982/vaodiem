import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Search, Upload } from 'lucide-react';
import {
  GradebookClass,
  SCORE_COLUMNS,
  ScoreColumnKey,
} from '../types/gradebook';
import { calculateDTBmhk, splitVietnameseName } from '../utils/excelVnEdu';

interface GradebookTableProps {
  gradebook: GradebookClass | null;
  activeColumn: ScoreColumnKey;
  highlightedStt: number | null;
  onSelectColumn: (col: ScoreColumnKey) => void;
  onUpdateCell: (stt: number, column: ScoreColumnKey, value: number | null) => void;
  onUpdateComment: (stt: number, comment: string) => void;
  onOpenImport: () => void;
  onDownloadTemplate: () => void;
}

export const GradebookTable: React.FC<GradebookTableProps> = ({
  gradebook,
  activeColumn,
  highlightedStt,
  onSelectColumn,
  onUpdateCell,
  onUpdateComment,
  onOpenImport,
  onDownloadTemplate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'missing' | 'graded'>('all');
  const [editingCell, setEditingCell] = useState<{ stt: number; col: ScoreColumnKey | 'nhanXet' } | null>(null);
  const [editValue, setEditValue] = useState('');

  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (highlightedStt !== null && rowRefs.current[highlightedStt]) {
      rowRefs.current[highlightedStt]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [highlightedStt]);

  const filteredStudents = useMemo(() => {
    if (!gradebook) return [];
    const q = searchQuery.trim().toLowerCase();

    return gradebook.students.filter((st) => {
      if (filterMode === 'missing' && st[activeColumn] !== null) return false;
      if (filterMode === 'graded' && st[activeColumn] === null) return false;
      if (!q) return true;
      return (
        String(st.stt).includes(q) ||
        st.fullName.toLowerCase().includes(q)
      );
    });
  }, [gradebook, searchQuery, filterMode, activeColumn]);

  if (!gradebook) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-12 text-center flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
          <FileSpreadsheet className="w-6 h-6" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h3 className="font-display font-semibold text-base text-slate-900">
            Chưa có danh sách lớp nào được tải lên
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            Hãy tải lên file Excel sổ điểm xuất từ vnEdu (.xls hoặc .xlsx) để hệ thống tự động đối chiếu STT và ghi điểm trực tiếp vào đúng mẫu của Bộ GD&amp;ĐT.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={onOpenImport}
            className="min-h-[44px] px-4 py-2.5 rounded-xl sm:rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            Tải lên Excel vnEdu
          </button>
          <button
            type="button"
            onClick={onDownloadTemplate}
            className="min-h-[44px] px-4 py-2.5 rounded-xl sm:rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors whitespace-nowrap"
          >
            Tải file mẫu chuẩn
          </button>
        </div>
      </div>
    );
  }

  const gradedCount = gradebook.students.filter((s) => s[activeColumn] !== null).length;
  const totalCount = gradebook.students.length;

  const commitScoreEdit = (stt: number, col: ScoreColumnKey) => {
    const cleaned = editValue.trim().replace(',', '.');
    if (cleaned === '') {
      onUpdateCell(stt, col, null);
    } else {
      const num = Number(cleaned);
      if (!Number.isNaN(num) && num >= 0 && num <= 10) {
        onUpdateCell(stt, col, Math.round(num * 100) / 100);
      }
    }
    setEditingCell(null);
  };

  const commitCommentEdit = (stt: number) => {
    onUpdateComment(stt, editValue.trim());
    setEditingCell(null);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
      {/* Official vnEdu Gradebook Metadata Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-slate-500 truncate">
            {gradebook.schoolUnit} · {gradebook.schoolName}
          </div>
          <h2 className="font-display font-semibold text-sm text-slate-900 truncate">
            Bảng điểm chi tiết · Môn {gradebook.subject} · {gradebook.gradeLevel} - Lớp {gradebook.className}
          </h2>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-600 shrink-0 tabular-nums">
          <span>{gradebook.semester}</span>
          <span aria-hidden="true">·</span>
          <span>Năm học {gradebook.schoolYear}</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-slate-900">
            {gradedCount}/{totalCount} đã nhập
          </span>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-white">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo STT hoặc họ tên..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filterMode === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tất cả ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('missing')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filterMode === 'missing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Chưa có điểm ({totalCount - gradedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('graded')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              filterMode === 'graded' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Đã nhập ({gradedCount})
          </button>
        </div>
      </div>

      {/* High-Density vnEdu Table */}
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-800 border-b border-slate-300">
            <tr>
              <th
                rowSpan={2}
                className="border-r border-slate-200 px-2.5 py-2 text-center font-semibold w-12"
              >
                STT
              </th>
              <th
                rowSpan={2}
                colSpan={2}
                className="border-r border-slate-200 px-3 py-2 text-left font-semibold min-w-[180px]"
              >
                Họ và tên
              </th>
              <th
                colSpan={4}
                className="border-b border-r border-slate-200 px-2 py-1 text-center font-semibold"
              >
                ĐĐGtx
              </th>
              <th
                rowSpan={2}
                onClick={() => onSelectColumn('gk')}
                className={`border-r border-slate-200 px-2.5 py-2 text-center font-semibold cursor-pointer select-none w-16 transition-colors ${
                  activeColumn === 'gk' ? 'bg-blue-100 text-blue-900' : 'hover:bg-slate-200/60'
                }`}
              >
                ĐĐGgk
              </th>
              <th
                rowSpan={2}
                onClick={() => onSelectColumn('ck')}
                className={`border-r border-slate-200 px-2.5 py-2 text-center font-semibold cursor-pointer select-none w-16 transition-colors ${
                  activeColumn === 'ck' ? 'bg-blue-100 text-blue-900' : 'hover:bg-slate-200/60'
                }`}
              >
                ĐĐGck
              </th>
              <th
                rowSpan={2}
                className="border-r border-slate-200 px-2.5 py-2 text-center font-semibold w-16"
                title="Tính tự động theo Thông tư 22/2021/TT-BGDĐT"
              >
                ĐTBmhk
              </th>
              <th
                rowSpan={2}
                className="px-3 py-2 text-left font-semibold min-w-[120px]"
              >
                Nhận xét
              </th>
            </tr>
            <tr>
              {(['tx1', 'tx2', 'tx3', 'tx4'] as ScoreColumnKey[]).map((colKey) => {
                const label = SCORE_COLUMNS.find((c) => c.key === colKey)?.shortLabel ?? colKey;
                const isActive = activeColumn === colKey;
                return (
                  <th
                    key={colKey}
                    onClick={() => onSelectColumn(colKey)}
                    className={`border-r border-slate-200 px-2 py-1 text-center font-medium cursor-pointer select-none w-14 transition-colors ${
                      isActive ? 'bg-blue-100 text-blue-900 font-semibold' : 'hover:bg-slate-200/60'
                    }`}
                  >
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 bg-white">
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                  Không tìm thấy học sinh phù hợp bộ lọc hiện tại.
                </td>
              </tr>
            ) : (
              filteredStudents.map((st) => {
                const isFlashed = highlightedStt === st.stt;
                const dtb = calculateDTBmhk(st);
                const split = st.hoDem || st.ten ? { hoDem: st.hoDem, ten: st.ten } : splitVietnameseName(st.fullName);

                return (
                  <tr
                    key={st.stt}
                    ref={(el) => {
                      rowRefs.current[st.stt] = el;
                    }}
                    className={`h-9 hover:bg-slate-50/90 transition-colors ${
                      isFlashed ? 'animate-row-flash bg-emerald-50/70' : ''
                    }`}
                  >
                    <td className="border-r border-slate-200 px-2.5 text-center font-mono tabular-nums font-medium text-slate-700">
                      {st.stt}
                    </td>
                    <td className="px-2.5 text-left text-slate-800 whitespace-nowrap">
                      {split.hoDem}
                    </td>
                    <td className="border-r border-slate-200 pr-2.5 pl-1 text-left font-medium text-slate-900 whitespace-nowrap">
                      {split.ten}
                    </td>

                    {(['tx1', 'tx2', 'tx3', 'tx4', 'gk', 'ck'] as ScoreColumnKey[]).map((colKey) => {
                      const isTargetCol = activeColumn === colKey;
                      const isEditing =
                        editingCell?.stt === st.stt && editingCell.col === colKey;
                      const val = st[colKey];

                      return (
                        <td
                          key={colKey}
                          onClick={() => {
                            if (!isEditing) {
                              setEditingCell({ stt: st.stt, col: colKey });
                              setEditValue(val !== null ? String(val) : '');
                            }
                          }}
                          className={`border-r border-slate-200 px-1.5 text-center font-mono tabular-nums cursor-pointer ${
                            isTargetCol ? 'bg-blue-50/60' : ''
                          }`}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              autoFocus
                              inputMode="decimal"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitScoreEdit(st.stt, colKey)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitScoreEdit(st.stt, colKey);
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                              className="w-12 px-1 py-0.5 text-center border border-blue-600 rounded bg-white text-slate-900 focus:outline-none"
                            />
                          ) : (
                            <span
                              className={
                                val !== null
                                  ? val < 5
                                    ? 'text-red-700 font-semibold'
                                    : 'text-slate-900 font-medium'
                                  : 'text-slate-300'
                              }
                            >
                              {val !== null ? val : '—'}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    <td className="border-r border-slate-200 px-2 text-center font-mono tabular-nums font-semibold text-slate-900 bg-slate-50/70">
                      {dtb !== null ? dtb.toFixed(1) : '—'}
                    </td>

                    <td
                      onClick={() => {
                        if (!(editingCell?.stt === st.stt && editingCell.col === 'nhanXet')) {
                          setEditingCell({ stt: st.stt, col: 'nhanXet' });
                          setEditValue(st.nhanXet || '');
                        }
                      }}
                      className="px-2.5 text-left text-slate-700 cursor-pointer"
                    >
                      {editingCell?.stt === st.stt && editingCell.col === 'nhanXet' ? (
                        <input
                          type="text"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitCommentEdit(st.stt)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitCommentEdit(st.stt);
                            if (e.key === 'Escape') setEditingCell(null);
                          }}
                          className="w-full px-1.5 py-0.5 border border-blue-600 rounded bg-white text-xs text-slate-900 focus:outline-none"
                        />
                      ) : (
                        <span className="truncate block max-w-[150px]">
                          {st.nhanXet || ''}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
