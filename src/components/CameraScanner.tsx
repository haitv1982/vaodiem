import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  FlipHorizontal,
  ScanLine,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  SCORE_COLUMNS,
  ScanApiResult,
  ScoreColumnKey,
  StudentRow,
} from '../types/gradebook';
import { playShutterSound } from '../utils/audioFeedback';

interface CameraScannerProps {
  students: StudentRow[];
  activeColumn: ScoreColumnKey;
  classNameLabel: string;
  subjectLabel: string;
  onApplyScore: (stt: number, column: ScoreColumnKey, score: number) => void;
  onFocusStudentRow: (stt: number) => void;
  onFinishScanning?: (scannedCount: number) => void;
}

type DetectorStatus =
  | 'idle'
  | 'no_paper'
  | 'moving'
  | 'settling'
  | 'waiting_next_paper';

const MAX_CONCURRENT_SCANS = 3;
const SETTLE_MS = 120;
const ROI_W_RATIO = 0.72;
const ROI_H_RATIO = 0.48;

/**
 * Kiểm tra cục bộ cực nhanh (< 0.15ms trên 64x48) xem khung hình có phải bài kiểm tra:
 * - Nền giấy sáng + có nét mực đen/xanh/đỏ
 * - Tính mức thay đổi so với khung trước (chống rung tay) và so với ảnh vừa chụp (mở khóa nhanh khi lật sang tờ mới trên xấp bài)
 */
function evaluateRoiFrame(
  curr: Uint8ClampedArray,
  prev: Uint8ClampedArray | null,
  capturedLuma: Uint8Array | null,
  width: number,
  height: number,
): {
  avgDiff: number;
  diffFromCaptured: number;
  isPaperLike: boolean;
  lumaSnapshot: Uint8Array;
} {
  const totalPixels = width * height;
  let lumaSum = 0;
  let brightCount = 0;
  let edgeCount = 0;
  let diffSum = 0;
  let capturedDiffSum = 0;

  const luma = new Uint8Array(totalPixels);

  for (let i = 0, p = 0; p < totalPixels; i += 4, p++) {
    const y = (curr[i] * 77 + curr[i + 1] * 150 + curr[i + 2] * 29) >> 8;
    luma[p] = y;
    lumaSum += y;
    if (y >= 112) brightCount++;

    if (prev) {
      diffSum +=
        Math.abs(curr[i] - prev[i]) +
        Math.abs(curr[i + 1] - prev[i + 1]) +
        Math.abs(curr[i + 2] - prev[i + 2]);
    }
    if (capturedLuma) {
      capturedDiffSum += Math.abs(y - capturedLuma[p]);
    }
  }

  for (let row = 0; row < height - 1; row++) {
    const rowOffset = row * width;
    for (let col = 0; col < width - 1; col++) {
      const idx = rowOffset + col;
      const gx = Math.abs(luma[idx] - luma[idx + 1]);
      const gy = Math.abs(luma[idx] - luma[idx + width]);
      if (gx > 22 || gy > 22) {
        edgeCount++;
      }
    }
  }

  const avgLuma = lumaSum / totalPixels;
  const brightRatio = brightCount / totalPixels;
  const edgeRatio = edgeCount / totalPixels;
  const avgDiff = prev ? diffSum / (totalPixels * 3) : 99;
  const diffFromCaptured = capturedLuma ? capturedDiffSum / totalPixels : 99;

  const isPaperLike =
    avgLuma >= 96 &&
    brightRatio >= 0.30 &&
    edgeRatio >= 0.015 &&
    edgeRatio <= 0.56;

  return { avgDiff, diffFromCaptured, isPaperLike, lumaSnapshot: luma };
}

export const CameraScanner: React.FC<CameraScannerProps> = ({
  students,
  activeColumn,
  classNameLabel,
  subjectLabel,
  onApplyScore,
  onFocusStudentRow,
  onFinishScanning,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const capturedLumaRef = useRef<Uint8Array | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [mirrorCapture, setMirrorCapture] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);

  const [inFlightCount, setInFlightCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [detectorStatus, setDetectorStatus] = useState<DetectorStatus>('idle');
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [lastSavedBanner, setLastSavedBanner] = useState<{
    stt: number;
    name: string;
    score: number;
    col: string;
  } | null>(null);

  const studentsRef = useRef(students);
  studentsRef.current = students;
  const audioEnabledRef = useRef(audioEnabled);
  audioEnabledRef.current = audioEnabled;
  const onApplyScoreRef = useRef(onApplyScore);
  onApplyScoreRef.current = onApplyScore;
  const onFocusStudentRowRef = useRef(onFocusStudentRow);
  onFocusStudentRowRef.current = onFocusStudentRow;
  const inFlightRef = useRef(0);
  const sessionCountRef = useRef(0);
  const lastLumaSnapshotRef = useRef<Uint8Array | null>(null);

  const waitingNextPaperRef = useRef(false);
  const sawPaperRemovedRef = useRef(false);
  const stableStartAtRef = useRef<number>(0);
  const lastAutoScanAtRef = useRef<number>(0);

  const activeColMeta = SCORE_COLUMNS.find((c) => c.key === activeColumn) ?? SCORE_COLUMNS[0];

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setDetectorStatus('idle');
    setStatusHint(null);
    waitingNextPaperRef.current = false;
    sawPaperRemovedRef.current = false;
    prevFrameDataRef.current = null;
    capturedLumaRef.current = null;
  }, []);

  const handleFinishSession = useCallback(() => {
    stopCamera();
    try {
      sessionStorage.removeItem('vnedu_camera_started');
    } catch {
      // ignore
    }
    onFinishScanning?.(sessionCountRef.current);
  }, [stopCamera, onFinishScanning]);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      setCameraError(null);
      setStatusHint(null);
      stopCamera();
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError('Trình duyệt không hỗ trợ camera. Hãy mở bằng Chrome hoặc Safari qua HTTPS.');
          return;
        }

        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? {
                deviceId: { exact: deviceId },
                width: { ideal: 960 },
                height: { ideal: 540 },
                frameRate: { ideal: 30, min: 15 },
              }
            : {
                facingMode: { ideal: 'environment' },
                width: { ideal: 960 },
                height: { ideal: 540 },
                frameRate: { ideal: 30, min: 15 },
              },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        waitingNextPaperRef.current = false;
        sawPaperRemovedRef.current = false;
        stableStartAtRef.current = 0;
        prevFrameDataRef.current = null;
        capturedLumaRef.current = null;
        sessionCountRef.current = 0;
        setSessionCount(0);
        setCameraActive(true);
        try {
          sessionStorage.setItem('vnedu_camera_started', '1');
        } catch {
          // ignore
        }

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
        setDevices(videoInputs);

        const activeTrack = stream.getVideoTracks()[0];
        const activeSettings = activeTrack?.getSettings();
        if (activeSettings?.deviceId) {
          setSelectedDeviceId(activeSettings.deviceId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Không thể mở camera';
        setCameraError(
          msg.includes('Permission') || msg.includes('NotAllowed')
            ? 'Chưa có quyền Camera. Hãy bấm "Mở Camera" và cho phép truy cập.'
            : `Không mở được camera (${msg}).`,
        );
      }
    },
    [stopCamera],
  );

  // Tự mở camera ngay nếu trình duyệt đã cấp quyền sẵn hoặc vừa mở trong phiên
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let shouldStart = false;
      try {
        if (sessionStorage.getItem('vnedu_camera_started') === '1') {
          shouldStart = true;
        }
      } catch {
        // ignore
      }
      if (!shouldStart) {
        try {
          if (navigator.permissions?.query) {
            const perm = await navigator.permissions.query({ name: 'camera' as PermissionName });
            if (perm.state === 'granted') {
              shouldStart = true;
            }
          }
        } catch {
          // iOS Safari không hỗ trợ permissions.query('camera')
        }
      }
      if (!cancelled && shouldStart) {
        await startCamera();
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const processScanResult = useCallback(
    (result: ScanApiResult, targetCol: ScoreColumnKey) => {
      setLastLatencyMs(result.latencyMs);

      if (!result.hasPaper || result.stt === null || result.score === null) {
        waitingNextPaperRef.current = false;
        sawPaperRemovedRef.current = false;
        setStatusHint('Chưa thấy đủ STT (mực đen/xanh) và Điểm (mực đỏ), giữ lại vào khung.');
        return;
      }

      const currentStudents = studentsRef.current;
      const colMeta = SCORE_COLUMNS.find((c) => c.key === targetCol) ?? SCORE_COLUMNS[0];

      const sttNum = result.stt;
      const scoreNum = result.score;
      const matched = currentStudents.find((s) => s.stt === sttNum) ?? null;
      const isValidScore = scoreNum >= 0 && scoreNum <= 10;

      if (!matched) {
        waitingNextPaperRef.current = false;
        setStatusHint(`STT ${sttNum} không có trong danh sách lớp ${classNameLabel}`);
        return;
      }

      if (!isValidScore || result.confidence === 'low') {
        waitingNextPaperRef.current = false;
        setStatusHint(`Bài #${sttNum} hơi mờ, giữ yên để đọc lại.`);
        return;
      }

      // Hợp lệ -> đối chiếu STT & nhập điểm ngay lập tức vào danh sách
      setStatusHint(null);
      onApplyScoreRef.current(matched.stt, targetCol, scoreNum);
      onFocusStudentRowRef.current(matched.stt);
      sessionCountRef.current += 1;
      setSessionCount(sessionCountRef.current);

      setLastSavedBanner({
        stt: matched.stt,
        name: matched.fullName,
        score: scoreNum,
        col: colMeta.shortLabel,
      });
    },
    [classNameLabel],
  );

  const sendImageForScan = useCallback(
    async (base64DataUrl: string, targetCol: ScoreColumnKey) => {
      if (inFlightRef.current >= MAX_CONCURRENT_SCANS) return;
      inFlightRef.current += 1;
      setInFlightCount(inFlightRef.current);

      const colMeta = SCORE_COLUMNS.find((c) => c.key === targetCol) ?? SCORE_COLUMNS[0];
      const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

      const requestScan = async (): Promise<ScanApiResult> => {
        const maxStt = studentsRef.current.reduce((max, s) => Math.max(max, s.stt), 45);
        const res = await fetch(`${apiBase}/api/scan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            imageBase64: base64DataUrl,
            mimeType: 'image/jpeg',
            maxStt,
            columnLabel: colMeta.shortLabel,
          }),
        });

        const rawText = await res.text();
        let data: ScanApiResult;
        try {
          data = JSON.parse(rawText) as ScanApiResult;
        } catch {
          throw new Error('TRANSIENT_HTML');
        }

        if (!res.ok) {
          if (res.status === 429) {
            throw new Error(`RATE_LIMIT:${data.error || 'Đang chạm giới hạn tốc độ'}`);
          }
          if (res.status === 502 || res.status === 503 || res.status === 504) {
            throw new Error(`TRANSIENT:${data.error || 'Máy chủ AI đang bận'}`);
          }
          throw new Error(data.error || 'Lỗi máy chủ nhận dạng.');
        }

        return data;
      };

      try {
        let data: ScanApiResult;
        try {
          data = await requestScan();
        } catch (firstErr) {
          const msg = firstErr instanceof Error ? firstErr.message : '';
          if (msg.startsWith('RATE_LIMIT:')) {
            await new Promise((r) => setTimeout(r, 1000));
            data = await requestScan();
          } else if (msg === 'TRANSIENT_HTML' || msg.startsWith('TRANSIENT:')) {
            await new Promise((r) => setTimeout(r, 400));
            data = await requestScan();
          } else {
            throw firstErr;
          }
        }

        processScanResult(data, targetCol);
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : '';
        const friendlyMsg =
          rawMsg === 'TRANSIENT_HTML'
            ? 'Máy chủ đang khởi động lại, vui lòng giữ bài trong giây lát...'
            : rawMsg.startsWith('RATE_LIMIT:')
              ? rawMsg.replace('RATE_LIMIT:', '')
              : rawMsg.startsWith('TRANSIENT:')
                ? rawMsg.replace('TRANSIENT:', '')
                : rawMsg || 'Máy chủ AI đang bận, tiếp tục quét bình thường.';
        setStatusHint(friendlyMsg);
      } finally {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        setInFlightCount(inFlightRef.current);
      }
    },
    [processScanResult],
  );

  // Chụp ngay lập tức không chờ kết quả bài trước (3 luồng song song, ảnh gọn <=384px JPEG)
  const captureAndScanFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    if (inFlightRef.current >= MAX_CONCURRENT_SCANS) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    if (audioEnabledRef.current) {
      playShutterSound();
    }
    setShutterFlash(true);
    window.setTimeout(() => setShutterFlash(false), 80);

    const sw = Math.round(vw * ROI_W_RATIO);
    const sh = Math.round(vh * ROI_H_RATIO);
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);

    const targetWidth = Math.min(384, sw);
    const targetHeight = Math.round((sh / sw) * targetWidth);

    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }
    const canvas = captureCanvasRef.current;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    if (mirrorCapture) {
      ctx.translate(targetWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    if (lastLumaSnapshotRef.current) {
      capturedLumaRef.current = new Uint8Array(lastLumaSnapshotRef.current);
    }
    lastAutoScanAtRef.current = Date.now();
    waitingNextPaperRef.current = true;
    sawPaperRemovedRef.current = false;
    setDetectorStatus('waiting_next_paper');

    void sendImageForScan(dataUrl, activeColumn);
  }, [mirrorCapture, activeColumn, sendImageForScan]);

  // Vòng lặp 45ms: phát hiện bài trên tay nhanh (~0,12s), mở khóa tức thì khi lật sang bài tiếp theo
  useEffect(() => {
    if (!cameraActive) {
      setDetectorStatus('idle');
      return;
    }

    let timerId: number | null = null;

    const analyzeMotionAndPaper = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        timerId = window.setTimeout(analyzeMotionAndPaper, 80);
        return;
      }

      if (!motionCanvasRef.current) {
        motionCanvasRef.current = document.createElement('canvas');
        motionCanvasRef.current.width = 64;
        motionCanvasRef.current.height = 48;
      }
      const mCanvas = motionCanvasRef.current;
      const mCtx = mCanvas.getContext('2d', { willReadFrequently: true });
      if (!mCtx) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const sw = Math.round(vw * ROI_W_RATIO);
      const sy = Math.round((vh - Math.round(vh * ROI_H_RATIO)) / 2);
      const sx = Math.round((vw - sw) / 2);
      const sh = Math.round(vh * ROI_H_RATIO);

      mCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 64, 48);
      const frame = mCtx.getImageData(0, 0, 64, 48).data;

      const { avgDiff, diffFromCaptured, isPaperLike, lumaSnapshot } = evaluateRoiFrame(
        frame,
        prevFrameDataRef.current,
        capturedLumaRef.current,
        64,
        48,
      );
      lastLumaSnapshotRef.current = lumaSnapshot;
      const now = Date.now();

      if (waitingNextPaperRef.current) {
        // Mở khóa ngay khi: rút bài ra (!isPaperLike), hoặc lật/đưa sang bài khác (avgDiff > 10 hoặc khác ảnh đã chụp > 8.5)
        if (!isPaperLike) {
          sawPaperRemovedRef.current = true;
          setDetectorStatus('no_paper');
        } else if (sawPaperRemovedRef.current || avgDiff > 10 || diffFromCaptured > 8.5) {
          waitingNextPaperRef.current = false;
          sawPaperRemovedRef.current = false;
          capturedLumaRef.current = null;
          stableStartAtRef.current = 0;
          setDetectorStatus('moving');
        } else {
          setDetectorStatus('waiting_next_paper');
        }
      } else if (!isPaperLike) {
        stableStartAtRef.current = 0;
        setDetectorStatus('no_paper');
      } else if (avgDiff > 8.5) {
        stableStartAtRef.current = 0;
        setDetectorStatus('moving');
      } else {
        const cooldownOk = now - lastAutoScanAtRef.current > 240;
        const slotReady = inFlightRef.current < MAX_CONCURRENT_SCANS;
        if (cooldownOk && slotReady) {
          if (stableStartAtRef.current === 0) {
            stableStartAtRef.current = now;
            setDetectorStatus('settling');
          } else if (now - stableStartAtRef.current >= SETTLE_MS) {
            stableStartAtRef.current = 0;
            captureAndScanFrame();
          }
        }
      }

      prevFrameDataRef.current = new Uint8ClampedArray(frame);
      timerId = window.setTimeout(analyzeMotionAndPaper, 45);
    };

    timerId = window.setTimeout(analyzeMotionAndPaper, 80);
    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [cameraActive, captureAndScanFrame]);

  const getOverlayPrompt = () => {
    if (inFlightCount >= MAX_CONCURRENT_SCANS) {
      return `Đang xử lý ${inFlightCount} bài song song...`;
    }
    switch (detectorStatus) {
      case 'waiting_next_paper':
        return 'Đã chụp! Đưa sang bài tiếp theo';
      case 'settling':
        return 'Đang chụp...';
      case 'moving':
        return 'Giữ nhẹ...';
      case 'no_paper':
      default:
        return 'Đưa STT (mực đen/xanh) & Điểm (mực đỏ) vào khung';
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl lg:rounded-xl overflow-hidden">
      {/* Top Scanner Control Strip */}
      <div className="flex items-center justify-between gap-2 px-3.5 sm:px-4 py-2.5 border-b border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-2 min-w-0">
          <ScanLine className="w-4 h-4 text-blue-700 shrink-0" />
          <span className="font-display font-semibold text-sm text-slate-900 truncate">
            {classNameLabel} · {subjectLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {inFlightCount > 0 ? (
            <span className="text-xs font-medium text-blue-700 tabular-nums px-1">
              Đang đọc {inFlightCount}...
            </span>
          ) : (
            lastLatencyMs !== null && (
              <span className="font-mono tabular-nums text-xs text-slate-500 px-1">
                {(lastLatencyMs / 1000).toFixed(1)}s
              </span>
            )
          )}
          <button
            type="button"
            onClick={() => setAudioEnabled((v) => !v)}
            title={audioEnabled ? 'Tắt tiếng chụp' : 'Bật tiếng chụp'}
            className="min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors"
          >
            {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
          </button>
          <button
            type="button"
            onClick={() => setMirrorCapture((v) => !v)}
            title="Lật ngang ảnh camera"
            className={`min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-lg border transition-colors ${
              mirrorCapture
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            <FlipHorizontal className="w-4 h-4" />
          </button>
          {cameraActive && (
            <button
              type="button"
              onClick={handleFinishSession}
              className="min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
            >
              <Square className="w-3 h-3 fill-current" />
              Kết thúc
            </button>
          )}
        </div>
      </div>

      {/* Live Video Frame */}
      <div
        onClick={() => {
          if (cameraActive && waitingNextPaperRef.current) {
            waitingNextPaperRef.current = false;
            sawPaperRemovedRef.current = true;
            capturedLumaRef.current = null;
            setDetectorStatus('idle');
          }
        }}
        className="relative bg-slate-950 aspect-[4/3] sm:aspect-[16/10] w-full overflow-hidden flex items-center justify-center"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover ${mirrorCapture ? '-scale-x-100' : ''} ${
            cameraActive ? 'opacity-100' : 'opacity-0 pointer-events-none absolute'
          }`}
        />

        {/* Immediate Shutter Flash */}
        {shutterFlash && (
          <div className="absolute inset-0 bg-white/70 pointer-events-none z-20 transition-opacity duration-75" />
        )}

        {/* Focused ROI Overlay (72% x 48%) */}
        {cameraActive && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              className={`w-[72%] h-[48%] border-2 rounded-xl shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] flex flex-col justify-between p-2.5 transition-colors ${
                detectorStatus === 'settling'
                  ? 'border-emerald-400'
                  : detectorStatus === 'waiting_next_paper'
                    ? 'border-blue-400'
                    : 'border-dashed border-white/85'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-medium text-white drop-shadow gap-2">
                <span>Đen/Xanh: STT · Đỏ: Điểm</span>
                <span className="font-mono tabular-nums shrink-0">
                  {activeColMeta.shortLabel}{sessionCount > 0 ? ` · ${sessionCount} bài` : ''}
                </span>
              </div>
              <div className="text-center text-xs font-medium text-white drop-shadow bg-slate-900/55 rounded-md py-1 px-2">
                {getOverlayPrompt()}
              </div>
            </div>
          </div>
        )}

        {/* Inactive / Open Camera Button */}
        {!cameraActive && (
          <div className="relative z-10 p-5 text-center max-w-sm flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200">
              <Camera className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display font-semibold text-base text-white">
                Quét nhanh STT &amp; Điểm mực đỏ
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {cameraError
                  ? cameraError
                  : 'Mở camera, máy tự nhận STT (mực đen/xanh) và Điểm (mực đỏ) rồi ghi thẳng vào sổ điểm đến khi bạn bấm Kết thúc.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void startCamera(selectedDeviceId || undefined)}
              className="min-h-[46px] px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap"
            >
              <Camera className="w-4 h-4" />
              Mở Camera
            </button>
          </div>
        )}
      </div>

      {/* Immediate Last Saved Result Strip */}
      {lastSavedBanner && (
        <div className="px-4 py-3 bg-emerald-50 border-t border-emerald-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="text-sm font-semibold text-emerald-950 truncate">
              TT {lastSavedBanner.stt} · {lastSavedBanner.name}
            </span>
          </div>
          <div className="font-mono tabular-nums text-base font-bold text-emerald-800 shrink-0">
            {lastSavedBanner.score} ({lastSavedBanner.col})
          </div>
        </div>
      )}

      {/* Quiet status hint (only when needed) */}
      {statusHint && (
        <div className="px-4 py-2 bg-slate-100 border-t border-slate-200 text-xs text-slate-700 text-center">
          {statusHint}
        </div>
      )}

      {/* Optional camera selector only when device has >1 camera */}
      {devices.length > 1 && (
        <div className="px-3.5 py-2 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">Ống kính:</span>
          <select
            value={selectedDeviceId}
            onChange={(e) => {
              setSelectedDeviceId(e.target.value);
              if (cameraActive) void startCamera(e.target.value);
            }}
            className="min-h-[38px] max-w-[230px] truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
          >
            {devices.map((d, idx) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
