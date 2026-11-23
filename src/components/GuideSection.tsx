import React from 'react';
import { Camera, FileSpreadsheet, Zap, CheckCircle2 } from 'lucide-react';

export const GuideSection: React.FC = () => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
      <div>
        <h2 className="font-display font-semibold text-lg text-slate-900">
          Hướng dẫn quy trình quét điểm nhanh dưới 1 giây cho vnEdu
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Áp dụng cho cả điện thoại cầm tay / giá đỡ và máy tính bàn gắn webcam hoặc máy chiếu vật thể.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-900">
            <FileSpreadsheet className="w-4 h-4 text-blue-700" />
            <span>01. Tải danh sách lớp từ vnEdu</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Trên vnEdu, xuất file Excel sổ điểm chi tiết (.xls hoặc .xlsx) của lớp và môn cần nhập. Tải file đó lên app — hệ thống tự nhận diện cột STT, Họ và tên (kể cả định dạng tách 2 cột Họ đệm + Tên của vnEdu) và các cột TX1–TX4, ĐĐGgk, ĐĐGck.
          </p>
        </div>

        <div className="border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-900">
            <Camera className="w-4 h-4 text-blue-700" />
            <span>02. Quy ước ghi bài &amp; mở camera</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Học sinh ghi rõ <strong>STT</strong> theo sổ điểm ở góc trên bài làm cạnh phần <strong>Điểm</strong> giáo viên chấm. Mở camera hướng vào 2 ô này trong khung ngắm chữ nhật để hệ thống quét nhanh nhất.
          </p>
        </div>

        <div className="border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-900">
            <Zap className="w-4 h-4 text-blue-700" />
            <span>03. Chụp liên tiếp 3 luồng không chờ đợi</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Không cần bấm nút chụp hay nút lưu: đưa bài kiểm tra vào khung giữ yên <strong>0,15 giây</strong>, máy tự chụp ngay, phát tiếng màn trập xác nhận rồi mở khóa sang bài tiếp theo ngay lập tức (tối đa 3 bài đọc song song ở chế độ nền và tự điền vào bảng điểm).
          </p>
        </div>

        <div className="border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-900">
            <CheckCircle2 className="w-4 h-4 text-blue-700" />
            <span>04. Xuất file đúng chuẩn Thông tư 22 / vnEdu</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Hệ thống tự tính <strong>ĐTBmhk</strong> theo trọng số Thông tư 22/2021/TT-BGDĐT (TX hệ số 1, GK hệ số 2, CK hệ số 3, làm tròn 1 chữ số thập phân). Nhấn <strong>Xuất Excel vnEdu</strong> để tải file đã điền đủ điểm (giữ nguyên cấu trúc file gốc) và nhập ngược lên vnEdu.
          </p>
        </div>
      </div>
    </div>
  );
};
