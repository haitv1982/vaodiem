import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
  GradebookClass,
  OriginalSheetLayout,
  ScoreColumnKey,
  StudentRow,
} from '../types/gradebook';

export function normalizeVietnameseSlug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function splitVietnameseName(fullName: string): { hoDem: string; ten: string } {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { hoDem: '', ten: '' };
  const parts = cleaned.split(' ');
  if (parts.length === 1) {
    return { hoDem: '', ten: parts[0] };
  }
  const ten = parts[parts.length - 1];
  const hoDem = parts.slice(0, -1).join(' ');
  return { hoDem, ten };
}

export function parseScoreCell(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    if (Number.isNaN(val) || val < 0 || val > 10) return null;
    return Math.round(val * 100) / 100;
  }
  const str = String(val)
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .trim()
    .replace(',', '.');
  if (!str) return null;
  const num = Number(str);
  if (Number.isNaN(num) || num < 0 || num > 10) return null;
  return Math.round(num * 100) / 100;
}

/**
 * Tính điểm trung bình môn học kỳ (ĐTBmhk) theo Thông tư 22/2021/TT-BGDĐT:
 * (Tổng ĐĐGtx + 2 * ĐĐGgk + 3 * ĐĐGck) / (Số bài ĐĐGtx + 2 (nếu có ĐĐGgk) + 3 (nếu có ĐĐGck))
 * Làm tròn đến 1 chữ số thập phân.
 */
export function calculateDTBmhk(student: StudentRow): number | null {
  const txScores = [student.tx1, student.tx2, student.tx3, student.tx4].filter(
    (v): v is number => typeof v === 'number' && !Number.isNaN(v),
  );
  let totalScore = txScores.reduce((acc, cur) => acc + cur, 0);
  let totalWeight = txScores.length;

  if (typeof student.gk === 'number' && !Number.isNaN(student.gk)) {
    totalScore += student.gk * 2;
    totalWeight += 2;
  }
  if (typeof student.ck === 'number' && !Number.isNaN(student.ck)) {
    totalScore += student.ck * 3;
    totalWeight += 3;
  }

  if (totalWeight === 0) return null;
  return Math.round((totalScore / totalWeight) * 10) / 10;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function normalizeHeaderToken(val: unknown): string {
  return String(val ?? '')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, '')
    .replace(/[đĐðÐ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function cleanText(val: unknown): string {
  return String(val ?? '')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function parseVnEduExcelFile(file: File): Promise<GradebookClass[]> {
  const buffer = await file.arrayBuffer();
  const rawBase64 = arrayBufferToBase64(buffer);
  const fileType: 'xlsx' | 'xls' = file.name.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx';
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', raw: true });

  const parsedClasses: GradebookClass[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: true,
    });

    if (rows.length < 3) continue;

    // 1. Locate header row containing STT
    let headerRowIndex = -1;
    let sttColIndex = -1;
    for (let r = 0; r < Math.min(rows.length, 25); r++) {
      const row = rows[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        const cell = normalizeHeaderToken(row[c]);
        if (cell === 'stt' || cell === 'tt') {
          const rowJoined = row.map(normalizeHeaderToken).join('|');
          const prevJoined = r > 0 ? (rows[r - 1] ?? []).map(normalizeHeaderToken).join('|') : '';
          const combinedJoined = `${prevJoined}|${rowJoined}`;
          if (combinedJoined.includes('ho') || combinedJoined.includes('ten') || combinedJoined.includes('hovaten')) {
            headerRowIndex = r;
            sttColIndex = c;
            break;
          }
        }
      }
      if (headerRowIndex !== -1) break;
    }

    if (headerRowIndex === -1 || sttColIndex === -1) continue;

    // 2. Check if there is a 2-row merged header (e.g., Row 6: ĐĐGtx, Row 7: TX1..TX4)
    const rowHeaderPrev = headerRowIndex > 0 ? (rows[headerRowIndex - 1] ?? []) : [];
    const rowHeader1 = rows[headerRowIndex] ?? [];
    const rowHeader2 = rows[headerRowIndex + 1] ?? [];
    const row2Joined = rowHeader2.map(normalizeHeaderToken).join('|');
    const hasSubHeaderRow =
      row2Joined.includes('tx1') ||
      row2Joined.includes('tx2') ||
      row2Joined.includes('m1') ||
      row2Joined.includes('ddgtx') ||
      row2Joined.includes('ddggk') ||
      row2Joined.includes('gk');

    const dataStartRow = hasSubHeaderRow ? headerRowIndex + 2 : headerRowIndex + 1;
    const merges = sheet['!merges'] ?? [];

    // 3. Detect column indices from header rows + sheet merges
    const colMap: OriginalSheetLayout['colMap'] = {
      stt: sttColIndex,
    };

    const maxCols = Math.max(
      rowHeaderPrev.length,
      rowHeader1.length,
      rowHeader2.length,
      20,
    );
    let nameSpanStart = -1;
    let nameSpanEnd = -1;

    // Helper: if a non-TX header cell spans multiple hidden/spacer columns, find the column that actually holds numeric data
    const resolveDataColInMerge = (headerRow: number, col: number): number => {
      for (const m of merges) {
        if (m.s.r <= headerRow && m.e.r >= headerRow && m.s.c <= col && m.e.c >= col && m.e.c > m.s.c) {
          let bestCol = col;
          let bestCount = -1;
          for (let mc = m.s.c; mc <= m.e.c; mc++) {
            let count = 0;
            for (let r = dataStartRow; r < Math.min(rows.length, dataStartRow + 15); r++) {
              if (parseScoreCell((rows[r] ?? [])[mc]) !== null) count++;
            }
            if (count > bestCount) {
              bestCount = count;
              bestCol = mc;
            }
          }
          return bestCount > 0 ? bestCol : col;
        }
      }
      return col;
    };

    for (let c = 0; c < maxCols; c++) {
      const tPrev = normalizeHeaderToken(rowHeaderPrev[c]);
      const t1 = normalizeHeaderToken(rowHeader1[c]);
      const t2 = hasSubHeaderRow ? normalizeHeaderToken(rowHeader2[c]) : '';

      // Name column detection (check t1 and tPrev)
      const nameToken = t1.includes('hovaten') || t1.includes('hoten') ? t1 : tPrev;
      const nameRowIdx = t1.includes('hovaten') || t1.includes('hoten') ? headerRowIndex : headerRowIndex - 1;
      if (nameToken.includes('hovaten') || nameToken.includes('hoten')) {
        nameSpanStart = c;
        nameSpanEnd = c;
        for (const m of merges) {
          if (m.s.r <= nameRowIdx && m.e.r >= nameRowIdx && m.s.c === c) {
            nameSpanStart = m.s.c;
            nameSpanEnd = m.e.c;
            break;
          }
        }
      } else if (t1 === 'hodem' || t1 === 'holot' || t1 === 'ho' || tPrev === 'hodem' || tPrev === 'holot' || tPrev === 'ho') {
        colMap.hoDem = c;
      } else if ((t1 === 'ten' || tPrev === 'ten') && colMap.ten === undefined) {
        colMap.ten = c;
      }

      // Check tokens independently (prefer t2 for TX1..TX4, check both t1 & t2 & tPrev for GK/CK/DTB/NhanXet)
      const tokensToCheck = [t2, t1, tPrev].filter(Boolean);
      for (const tok of tokensToCheck) {
        if (colMap.tx1 === undefined && (tok === 'tx1' || tok === 'ddgtx1' || tok === 'm1' || tok === 'dtx1')) {
          colMap.tx1 = c;
        } else if (colMap.tx2 === undefined && (tok === 'tx2' || tok === 'ddgtx2' || tok === 'm2' || tok === 'dtx2')) {
          colMap.tx2 = c;
        } else if (colMap.tx3 === undefined && (tok === 'tx3' || tok === 'ddgtx3' || tok === 'm3' || tok === 'dtx3')) {
          colMap.tx3 = c;
        } else if (colMap.tx4 === undefined && (tok === 'tx4' || tok === 'ddgtx4' || tok === 'm4' || tok === 'dtx4')) {
          colMap.tx4 = c;
        } else if (
          colMap.gk === undefined &&
          (tok.includes('ddggk') ||
            tok === 'dggk' ||
            tok === 'dgk' ||
            tok === 'gk' ||
            tok.includes('giuaky') ||
            tok.includes('giuaki') ||
            (tok.includes('gk') && !tok.includes('ck') && !tok.includes('tx')))
        ) {
          const matchedRow = tok === t2 ? headerRowIndex + 1 : tok === t1 ? headerRowIndex : headerRowIndex - 1;
          colMap.gk = resolveDataColInMerge(matchedRow, c);
        } else if (
          colMap.ck === undefined &&
          (tok.includes('ddgck') ||
            tok === 'dgck' ||
            tok === 'dck' ||
            tok === 'ck' ||
            tok.includes('cuoiky') ||
            tok.includes('cuoiki') ||
            (tok.includes('ck') && !tok.includes('gk') && !tok.includes('tx')))
        ) {
          const matchedRow = tok === t2 ? headerRowIndex + 1 : tok === t1 ? headerRowIndex : headerRowIndex - 1;
          colMap.ck = resolveDataColInMerge(matchedRow, c);
        } else if (
          colMap.dtb === undefined &&
          (tok.includes('dtbm') || tok === 'dtb' || tok === 'tbm' || tok.includes('diemtb'))
        ) {
          const matchedRow = tok === t2 ? headerRowIndex + 1 : tok === t1 ? headerRowIndex : headerRowIndex - 1;
          colMap.dtb = resolveDataColInMerge(matchedRow, c);
        } else if (
          colMap.nhanXet === undefined &&
          (tok.includes('nhanxet') || tok.includes('ghichu'))
        ) {
          colMap.nhanXet = c;
        }
      }
    }

    // Resolve split Họ đệm + Tên inside merged "Họ và tên" span (matching screenshot C + D!)
    if (nameSpanStart !== -1) {
      if (nameSpanEnd > nameSpanStart) {
        const populatedCols = new Set<number>();
        for (let r = dataStartRow; r < Math.min(rows.length, dataStartRow + 8); r++) {
          const rData = rows[r] ?? [];
          for (let c = nameSpanStart; c <= nameSpanEnd; c++) {
            if (cleanText(rData[c])) populatedCols.add(c);
          }
        }
        const sortedCols = Array.from(populatedCols).sort((a, b) => a - b);
        if (sortedCols.length >= 2) {
          colMap.hoDem = sortedCols[0];
          colMap.ten = sortedCols[1];
        } else if (sortedCols.length === 1) {
          colMap.fullName = sortedCols[0];
        } else {
          colMap.fullName = nameSpanStart;
        }
      } else {
        colMap.fullName = nameSpanStart;
      }
    }

    // Fallback default TX1..TX4 if ĐĐGtx header exists without TX1..TX4 sublabels
    if (colMap.tx1 === undefined) {
      for (let c = 0; c < maxCols; c++) {
        if (normalizeHeaderToken(rowHeader1[c]).includes('ddgtx')) {
          colMap.tx1 = c;
          colMap.tx2 = c + 1;
          colMap.tx3 = c + 2;
          colMap.tx4 = c + 3;
          break;
        }
      }
    }

    // Positional fallback: if gk is still missing after text matching, inspect columns right after TX4 up to DTB/NhanXet
    if (colMap.gk === undefined && colMap.tx4 !== undefined) {
      const endBound = colMap.ck ?? colMap.dtb ?? colMap.nhanXet ?? Math.min(maxCols, colMap.tx4 + 4);
      for (let c = colMap.tx4 + 1; c < endBound; c++) {
        let hasScore = false;
        for (let r = dataStartRow; r < Math.min(rows.length, dataStartRow + 15); r++) {
          if (parseScoreCell((rows[r] ?? [])[c]) !== null) {
            hasScore = true;
            break;
          }
        }
        const hasHeaderText = Boolean(normalizeHeaderToken(rowHeader1[c]) || normalizeHeaderToken(rowHeader2[c]));
        if (hasScore || hasHeaderText) {
          colMap.gk = c;
          break;
        }
      }
    }

    // 4. Parse metadata above headerRowIndex
    let schoolUnit = 'PHÒNG GIÁO DỤC VÀ ĐÀO TẠO';
    let schoolName = 'TRƯỜNG THCS';
    let subject = 'Tin học';
    let semester = 'Học kỳ 1';
    let schoolYear = '2026-2027';
    let gradeLevel = '';
    let className = '';

    const topLines: string[] = [];
    for (let r = 0; r < headerRowIndex; r++) {
      const lineText = (rows[r] ?? []).map(cleanText).filter(Boolean).join(' ');
      if (lineText) topLines.push(lineText);
    }

    if (topLines.length >= 1 && !topLines[0].toUpperCase().includes('BẢNG ĐIỂM')) {
      schoolUnit = topLines[0];
    }
    if (topLines.length >= 2 && !topLines[1].toUpperCase().includes('BẢNG ĐIỂM')) {
      schoolName = topLines[1];
    }

    for (const line of topLines) {
      const monMatch = line.match(/MÔN\s+([^-–|]+?)(?:\s*[-–|]|$)/i);
      if (monMatch) subject = cleanText(monMatch[1]);

      const hkMatch = line.match(/HỌC\s*KỲ\s*([12I]+)/i);
      if (hkMatch) {
        const hkVal = hkMatch[1].toUpperCase() === 'II' || hkMatch[1] === '2' ? '2' : '1';
        semester = `Học kỳ ${hkVal}`;
      }

      const yearMatch = line.match(/NĂM\s*HỌC\s*(\d{4}\s*[-–]\s*\d{4})/i);
      if (yearMatch) schoolYear = yearMatch[1].replace(/\s+/g, '');

      const khoiMatch = line.match(/Khối\s*(\d+)/i);
      if (khoiMatch) gradeLevel = `Khối ${khoiMatch[1]}`;

      const lopMatch = line.match(/Lớp\s*[:\-]?\s*([A-Za-z0-9_.-]+)/i);
      if (lopMatch) className = lopMatch[1];
    }

    if (!className) {
      // Try inferring from sheetName like "tin_hoc_6a2" or filename
      const sheetClassMatch = sheetName.match(/(\d{1,2}[a-zA-Z]\d*)/);
      const fileClassMatch = file.name.match(/(\d{1,2}[a-zA-Z]\d*)/);
      className = (sheetClassMatch?.[1] || fileClassMatch?.[1] || sheetName).toUpperCase();
    }
    if (!gradeLevel) {
      const gradeNum = className.match(/^(\d{1,2})/);
      gradeLevel = gradeNum ? `Khối ${gradeNum[1]}` : 'Khối 6';
    }

    // 5. Parse student rows
    const students: StudentRow[] = [];
    for (let r = dataStartRow; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const sttRaw = cleanText(row[colMap.stt]);
      const sttNum = Number(sttRaw);
      if (!sttRaw || !Number.isInteger(sttNum) || sttNum <= 0) {
        // Stop if we already collected students and hit summary/signature block
        const joined = row.map(cleanText).join(' ').toLowerCase();
        if (students.length > 0 && (joined.includes('tổng') || joined.includes('giáo viên') || joined.includes('hiệu trưởng'))) {
          break;
        }
        continue;
      }

      let hoDem = '';
      let ten = '';
      let fullName = '';

      if (colMap.hoDem !== undefined && colMap.ten !== undefined) {
        hoDem = cleanText(row[colMap.hoDem]);
        ten = cleanText(row[colMap.ten]);
        fullName = `${hoDem} ${ten}`.trim();
      } else if (colMap.fullName !== undefined) {
        fullName = cleanText(row[colMap.fullName]);
        const split = splitVietnameseName(fullName);
        hoDem = split.hoDem;
        ten = split.ten;
      }

      if (!fullName) continue;

      students.push({
        stt: sttNum,
        hoDem,
        ten,
        fullName,
        tx1: colMap.tx1 !== undefined ? parseScoreCell(row[colMap.tx1]) : null,
        tx2: colMap.tx2 !== undefined ? parseScoreCell(row[colMap.tx2]) : null,
        tx3: colMap.tx3 !== undefined ? parseScoreCell(row[colMap.tx3]) : null,
        tx4: colMap.tx4 !== undefined ? parseScoreCell(row[colMap.tx4]) : null,
        gk: colMap.gk !== undefined ? parseScoreCell(row[colMap.gk]) : null,
        ck: colMap.ck !== undefined ? parseScoreCell(row[colMap.ck]) : null,
        nhanXet: colMap.nhanXet !== undefined ? cleanText(row[colMap.nhanXet]) : '',
        originalRowIndex: r,
      });
    }

    if (students.length === 0) continue;

    parsedClasses.push({
      id: `${normalizeVietnameseSlug(className)}_${normalizeVietnameseSlug(subject)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      schoolUnit,
      schoolName,
      className,
      gradeLevel,
      subject,
      semester,
      schoolYear,
      students,
      originalLayout: {
        fileName: file.name,
        sheetName,
        fileType,
        rawBase64,
        headerRowIndex,
        colMap,
      },
      updatedAt: new Date().toISOString(),
    });
  }

  return parsedClasses;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Xuất bảng điểm chuẩn vnEdu / Bộ GD&ĐT (.xlsx) với định dạng giống hệt sổ điểm chi tiết vnEdu
 */
export async function exportStyledVnEduXlsx(gradebook: GradebookClass): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheetTabName = `${normalizeVietnameseSlug(gradebook.subject)}_${normalizeVietnameseSlug(gradebook.className)}`.slice(0, 31) || 'bang_diem';
  const ws = wb.addWorksheet(sheetTabName, {
    views: [{ state: 'frozen', ySplit: 7 }],
  });

  // Column widths matching vnEdu layout (STT | Họ đệm | Tên | TX1..TX4 | ĐĐGgk | ĐĐGck | ĐTBmhk | Nhận xét)
  ws.columns = [
    { width: 6 },   // A: STT
    { width: 22 },  // B: Họ đệm
    { width: 11 },  // C: Tên
    { width: 7 },   // D: TX1
    { width: 7 },   // E: TX2
    { width: 7 },   // F: TX3
    { width: 7 },   // G: TX4
    { width: 8.5 }, // H: ĐĐGgk
    { width: 8.5 }, // I: ĐĐGck
    { width: 9 },   // J: ĐTBmhk
    { width: 24 },  // K: Nhận xét
  ];

  // Top header titles
  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = gradebook.schoolUnit;
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('A1').font = { name: 'Calibri', size: 11 };

  ws.mergeCells('A2:K2');
  ws.getCell('A2').value = gradebook.schoolName;
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('A2').font = { name: 'Calibri', size: 11 };

  ws.mergeCells('A3:K3');
  ws.getCell('A3').value = `BẢNG ĐIỂM CHI TIẾT - MÔN ${gradebook.subject.toUpperCase()} - ${gradebook.semester.toUpperCase()} - NĂM HỌC ${gradebook.schoolYear}`;
  ws.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('A3').font = { name: 'Calibri', size: 11, bold: true };

  ws.mergeCells('A4:K4');
  ws.getCell('A4').value = `${gradebook.gradeLevel} - Lớp ${gradebook.className}`;
  ws.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('A4').font = { name: 'Calibri', size: 11, bold: true };

  ws.getRow(5).height = 8;

  // Table headers (Row 6 & Row 7)
  ws.mergeCells('A6:A7');
  ws.getCell('A6').value = 'STT';

  ws.mergeCells('B6:C7');
  ws.getCell('B6').value = 'Họ và tên';

  ws.mergeCells('D6:G6');
  ws.getCell('D6').value = 'ĐĐGtx';
  ws.getCell('D7').value = 'TX1';
  ws.getCell('E7').value = 'TX2';
  ws.getCell('F7').value = 'TX3';
  ws.getCell('G7').value = 'TX4';

  ws.mergeCells('H6:H7');
  ws.getCell('H6').value = 'ĐĐGgk';

  ws.mergeCells('I6:I7');
  ws.getCell('I6').value = 'ĐĐGck';

  ws.mergeCells('J6:J7');
  ws.getCell('J6').value = 'ĐTBmhk';

  ws.mergeCells('K6:K7');
  ws.getCell('K6').value = 'Nhận xét';

  const solidBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };

  const dataBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'dotted' },
    left: { style: 'dotted' },
    bottom: { style: 'dotted' },
    right: { style: 'dotted' },
  };

  for (let r = 6; r <= 7; r++) {
    const row = ws.getRow(r);
    row.height = 20;
    for (let c = 1; c <= 11; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 11, bold: r === 6 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = solidBorder;
    }
  }

  // Student rows
  gradebook.students.forEach((st, idx) => {
    const rowNum = 8 + idx;
    const row = ws.getRow(rowNum);
    row.height = 19;

    const hoDemVal = st.hoDem || splitVietnameseName(st.fullName).hoDem;
    const tenVal = st.ten || splitVietnameseName(st.fullName).ten;

    row.getCell(1).value = st.stt;
    row.getCell(2).value = hoDemVal;
    row.getCell(3).value = tenVal;
    row.getCell(4).value = st.tx1 ?? null;
    row.getCell(5).value = st.tx2 ?? null;
    row.getCell(6).value = st.tx3 ?? null;
    row.getCell(7).value = st.tx4 ?? null;
    row.getCell(8).value = st.gk ?? null;
    row.getCell(9).value = st.ck ?? null;

    // Official Thông tư 22 Excel formula + cached result
    const dtbResult = calculateDTBmhk(st);
    row.getCell(10).value = {
      formula: `IF(COUNT(D${rowNum}:G${rowNum},H${rowNum},I${rowNum})=0,"",ROUND((SUM(D${rowNum}:G${rowNum})+IF(ISNUMBER(H${rowNum}),H${rowNum}*2,0)+IF(ISNUMBER(I${rowNum}),I${rowNum}*3,0))/(COUNT(D${rowNum}:G${rowNum})+IF(ISNUMBER(H${rowNum}),2,0)+IF(ISNUMBER(I${rowNum}),3,0)),1))`,
      result: dtbResult ?? undefined,
    };
    row.getCell(10).numFmt = '0.0';
    row.getCell(11).value = st.nhanXet || '';

    for (let c = 1; c <= 11; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 11 };
      cell.border = {
        ...dataBorder,
        left: c === 1 || c === 2 || c === 4 || c === 8 || c === 9 || c === 10 || c === 11 ? { style: 'thin' } : { style: 'dotted' },
        right: c === 11 ? { style: 'thin' } : undefined,
        bottom: idx === gradebook.students.length - 1 ? { style: 'thin' } : { style: 'dotted' },
      };
      if (c === 2 || c === 3 || c === 11) {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `so_diem_chi_tiet_lop_${normalizeVietnameseSlug(gradebook.className)}_mon_${normalizeVietnameseSlug(gradebook.subject)}.xlsx`;
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  );
  return filename;
}

/**
 * Ghi đè trực tiếp điểm mới vào đúng file Excel gốc đã tải lên từ vnEdu (giữ nguyên cấu trúc cột, sheet, định dạng)
 */
export async function exportPatchedOriginalExcel(
  gradebook: GradebookClass,
  formatOverride?: 'xlsx' | 'xls',
): Promise<string> {
  const layout = gradebook.originalLayout;
  if (!layout?.rawBase64) {
    return exportStyledVnEduXlsx(gradebook);
  }

  const rawBytes = base64ToUint8Array(layout.rawBase64);
  const targetFormat = formatOverride ?? layout.fileType;

  // If original is .xlsx and we want .xlsx, ExcelJS preserves 100% of formatting/borders/merged cells
  if (layout.fileType === 'xlsx' && targetFormat === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(rawBytes.buffer as ArrayBuffer);
    const ws = wb.getWorksheet(layout.sheetName) ?? wb.worksheets[0];

    const colKeys: ScoreColumnKey[] = ['tx1', 'tx2', 'tx3', 'tx4', 'gk', 'ck'];
    for (const st of gradebook.students) {
      if (st.originalRowIndex === undefined) continue;
      const excelRow = ws.getRow(st.originalRowIndex + 1);

      for (const k of colKeys) {
        const cIdx = layout.colMap[k];
        if (cIdx !== undefined) {
          excelRow.getCell(cIdx + 1).value = st[k] ?? null;
        }
      }
      if (layout.colMap.nhanXet !== undefined) {
        excelRow.getCell(layout.colMap.nhanXet + 1).value = st.nhanXet || null;
      }
      if (layout.colMap.dtb !== undefined) {
        const dtbCell = excelRow.getCell(layout.colMap.dtb + 1);
        const dtbVal = calculateDTBmhk(st);
        // Only write literal if not already a formula cell
        const isFormula = typeof dtbCell.value === 'object' && dtbCell.value !== null && 'formula' in dtbCell.value;
        if (!isFormula) {
          dtbCell.value = dtbVal ?? null;
        }
      }
    }

    const outBuffer = await wb.xlsx.writeBuffer();
    const outName = layout.fileName.replace(/\.(xlsx|xls)$/i, '') + '_da_nhap_diem.xlsx';
    triggerDownload(
      new Blob([outBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      outName,
    );
    return outName;
  }

  // For legacy .xls (vnEdu Compatibility Mode) or explicit .xls export, patch with SheetJS
  const wb = XLSX.read(rawBytes, { type: 'array', raw: true });
  const ws = wb.Sheets[layout.sheetName] ?? wb.Sheets[wb.SheetNames[0]];
  const colKeys: ScoreColumnKey[] = ['tx1', 'tx2', 'tx3', 'tx4', 'gk', 'ck'];

  for (const st of gradebook.students) {
    if (st.originalRowIndex === undefined) continue;
    const r = st.originalRowIndex;

    for (const k of colKeys) {
      const c = layout.colMap[k];
      if (c === undefined) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      const val = st[k];
      if (val === null || val === undefined) {
        delete ws[addr];
      } else {
        ws[addr] = { t: 'n', v: val };
      }
    }

    if (layout.colMap.nhanXet !== undefined) {
      const addr = XLSX.utils.encode_cell({ r, c: layout.colMap.nhanXet });
      if (st.nhanXet) {
        ws[addr] = { t: 's', v: st.nhanXet };
      } else {
        delete ws[addr];
      }
    }

    if (layout.colMap.dtb !== undefined) {
      const addr = XLSX.utils.encode_cell({ r, c: layout.colMap.dtb });
      const existing = ws[addr];
      if (!existing?.f) {
        const dtb = calculateDTBmhk(st);
        if (dtb !== null) {
          ws[addr] = { t: 'n', v: dtb, z: '0.0' };
        }
      }
    }
  }

  const bookType = targetFormat === 'xls' ? 'biff8' : 'xlsx';
  const outBytes = XLSX.write(wb, { type: 'array', bookType });
  const ext = targetFormat === 'xls' ? 'xls' : 'xlsx';
  const outName = layout.fileName.replace(/\.(xlsx|xls)$/i, '') + `_da_nhap_diem.${ext}`;
  triggerDownload(
    new Blob([outBytes], {
      type: targetFormat === 'xls'
        ? 'application/vnd.ms-excel'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    outName,
  );
  return outName;
}

/**
 * Tạo file Excel mẫu chuẩn vnEdu để giáo viên tải về hoặc nhập danh sách nhanh
 */
export async function downloadBlankVnEduTemplate(
  className = '6A2',
  subject = 'Tin học',
  studentCount = 15,
): Promise<void> {
  const sampleNames = [
    'Mai Khánh An',
    'Cung Thị Quỳnh Anh',
    'Đào Quang Anh',
    'Hoàng Ngọc Anh',
    'Nguyễn Thị Tú Anh',
    'Phạm Thục Anh',
    'Hoàng Danh Bảo',
    'Hồ Văn Gia Bảo',
    'Nguyễn Thị Thanh Bình',
    'Hồ Quỳnh Chi',
    'Lại Thùy Chi',
    'Phạm Thị Quỳnh Chi',
    'Nguyễn Hồ Cường',
    'Đoàn Thị Vân Dung',
    'Trần Minh Đức',
  ];

  const students: StudentRow[] = Array.from({ length: studentCount }, (_, i) => {
    const fullName = sampleNames[i] ?? `Học sinh ${i + 1}`;
    const { hoDem, ten } = splitVietnameseName(fullName);
    return {
      stt: i + 1,
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

  await exportStyledVnEduXlsx({
    id: 'template',
    schoolUnit: 'ỦY BAN NHÂN DÂN XÃ / PHÒNG GD&ĐT',
    schoolName: 'TRƯỜNG THCS MẪU',
    className,
    gradeLevel: `Khối ${className.match(/^\d+/)?.[0] ?? '6'}`,
    subject,
    semester: 'Học kỳ 1',
    schoolYear: '2026-2027',
    students,
    updatedAt: new Date().toISOString(),
  });
}
