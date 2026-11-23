import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

let cachedAiClient: GoogleGenAI | null = null;

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình trên máy chủ.');
  }
  if (!cachedAiClient) {
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedAiClient;
}

const SCAN_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    ok: {
      type: Type.BOOLEAN,
      description: 'true nếu là bài kiểm tra có STT và Điểm rõ, false nếu không phải bài hoặc trống.',
    },
    stt: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Số thứ tự học sinh (1..60), null nếu không rõ.',
    },
    score: {
      type: Type.NUMBER,
      nullable: true,
      description: 'Điểm (0..10, đổi dấu phẩy->chấm, vd 8,5->8.5), null nếu không rõ.',
    },
    low: {
      type: Type.BOOLEAN,
      description: 'true nếu ảnh mờ hoặc chữ số không chắc chắn.',
    },
  },
  required: ['ok', 'stt', 'score', 'low'],
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`TIMEOUT:${label}`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('TIMEOUT') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('500') ||
    msg.includes('INTERNAL') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('429')
  );
}

function toFriendlyErrorMessage(err: unknown): { status: number; message: string; transient: boolean } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand') || raw.includes('TIMEOUT')) {
    return {
      status: 503,
      message: 'Máy chủ AI đang bận tạm thời, tiếp tục quét bình thường.',
      transient: true,
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Đang chạm giới hạn tốc độ tạm thời, vui lòng đợi 1 giây.',
      transient: true,
    };
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED')) {
    return {
      status: 500,
      message: 'Lỗi xác thực GEMINI_API_KEY trên máy chủ.',
      transient: false,
    };
  }
  return {
    status: 500,
    message: 'Lỗi kết nối máy chủ nhận dạng ảnh.',
    transient: false,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, hasKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.post('/api/scan', async (req, res) => {
    const startedAt = Date.now();
    try {
      const { imageBase64, mimeType = 'image/jpeg', maxStt = 60, columnLabel = 'TX1' } = req.body ?? {};

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return res.status(400).json({ error: 'Thiếu dữ liệu ảnh để quét.' });
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const ai = getGeminiClient();

      const systemInstruction = `Đọc STT (1..${maxStt}) và Điểm (0..10, đổi dấu phẩy->chấm) cột ${columnLabel} trên bài kiểm tra. Nếu không phải bài kiểm tra hoặc thiếu STT/Điểm rõ ràng: ok=false, stt=null, score=null.`;

      const contents = {
        parts: [
          {
            inlineData: {
              mimeType,
              data: cleanBase64,
            },
          },
          {
            text: 'STT, Điểm',
          },
        ],
      };

      const callLite = () =>
        withTimeout(
          ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents,
            config: {
              systemInstruction,
              mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              responseMimeType: 'application/json',
              responseSchema: SCAN_RESPONSE_SCHEMA,
            },
          }),
          6500,
          'lite',
        );

      const callHydrogen = () =>
        withTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents,
            config: {
              systemInstruction,
              mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: SCAN_RESPONSE_SCHEMA,
            },
          }),
          6500,
          'hydrogen',
        );

      let usedModel = 'gemini-3.1-flash-lite';
      let response;

      try {
        response = await callLite();
      } catch (err1: unknown) {
        if (!isRetryableError(err1)) {
          throw err1;
        }
        usedModel = 'gemini-4-hydrogen';
        response = await callHydrogen();
      }

      const latencyMs = Date.now() - startedAt;
      const rawText = (response.text ?? '{}').trim();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return res.status(502).json({
          error: 'Kết quả nhận dạng không đúng định dạng.',
          latencyMs,
        });
      }

      const scoreVal: number | null =
        typeof parsed.score === 'number' && !Number.isNaN(parsed.score)
          ? Math.round(parsed.score * 100) / 100
          : null;
      const outOfBounds = scoreVal !== null && (scoreVal < 0 || scoreVal > 10);

      const sttVal: number | null =
        typeof parsed.stt === 'number' && Number.isInteger(parsed.stt) && parsed.stt > 0
          ? parsed.stt
          : typeof parsed.stt === 'number' && !Number.isNaN(parsed.stt)
            ? Math.round(parsed.stt)
            : null;

      const isLow = Boolean(parsed.low) || outOfBounds;

      return res.json({
        hasPaper: Boolean(parsed.ok),
        stt: sttVal,
        score: scoreVal,
        sttRaw: '',
        scoreRaw: '',
        confidence: isLow ? 'low' : 'high',
        reason: outOfBounds ? `Điểm (${scoreVal}) ngoài thang 0–10` : '',
        latencyMs,
        model: usedModel,
      });
    } catch (err: unknown) {
      const latencyMs = Date.now() - startedAt;
      const friendly = toFriendlyErrorMessage(err);
      console.error('[/api/scan] Error:', err instanceof Error ? err.message : err);
      return res.status(friendly.status).json({
        error: friendly.message,
        transient: friendly.transient,
        latencyMs,
      });
    }
  });

  // Đảm bảo mọi lỗi ở /api/* luôn trả JSON, không bao giờ lọt xuống HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Không tìm thấy API.' });
  });

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api/')) {
      const message = err instanceof Error ? err.message : 'Lỗi dữ liệu gửi lên máy chủ.';
      return res.status(400).json({ error: message });
    }
    return next(err);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
