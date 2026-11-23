import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from '@google/genai';

let cachedAiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
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

export function toFriendlyScanError(err: unknown): {
  status: number;
  message: string;
  transient: boolean;
} {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('GEMINI_API_KEY')) {
    return {
      status: 500,
      message: 'Chưa cấu hình biến môi trường GEMINI_API_KEY trên máy chủ.',
      transient: false,
    };
  }
  if (
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('high demand') ||
    raw.includes('TIMEOUT')
  ) {
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

export interface ScanInput {
  imageBase64: string;
  mimeType?: string;
  maxStt?: number;
  columnLabel?: string;
}

export interface ScanOutput {
  status: number;
  body: Record<string, unknown>;
}

export async function runScanRequest(input: ScanInput): Promise<ScanOutput> {
  const startedAt = Date.now();
  try {
    const {
      imageBase64,
      mimeType = 'image/jpeg',
      maxStt = 60,
      columnLabel = 'TX1',
    } = input;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return {
        status: 400,
        body: { error: 'Thiếu dữ liệu ảnh để quét.' },
      };
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
      return {
        status: 502,
        body: {
          error: 'Kết quả nhận dạng không đúng định dạng.',
          latencyMs,
        },
      };
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

    return {
      status: 200,
      body: {
        hasPaper: Boolean(parsed.ok),
        stt: sttVal,
        score: scoreVal,
        sttRaw: '',
        scoreRaw: '',
        confidence: isLow ? 'low' : 'high',
        reason: outOfBounds ? `Điểm (${scoreVal}) ngoài thang 0–10` : '',
        latencyMs,
        model: usedModel,
      },
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startedAt;
    const friendly = toFriendlyScanError(err);
    console.error('[/api/scan] Error:', err instanceof Error ? err.message : err);
    return {
      status: friendly.status,
      body: {
        error: friendly.message,
        transient: friendly.transient,
        latencyMs,
      },
    };
  }
}
