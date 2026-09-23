import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY не задан. Получить ключ: https://aistudio.google.com/apikey');
  process.exit(1);
}

export const ai = new GoogleGenAI({ apiKey });

// Модели можно переопределить через переменные окружения на Railway.
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.6-flash';
export const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';

// Бесплатный тариф Gemini регулярно отвечает 503 «high demand». Когда основная
// модель перегружена, пробуем запасные — список задаётся через GEMINI_TEXT_FALLBACKS
// (через запятую) и проходится по порядку.
export const TEXT_FALLBACKS = (process.env.GEMINI_TEXT_FALLBACKS ||
  'gemini-3.5-flash,gemini-flash-latest,gemini-2.5-flash-lite')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

/** HTTP-коды, при которых имеет смысл повторить запрос. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function statusOf(err) {
  // SDK кладёт код и в err.status, и в JSON внутри err.message.
  if (typeof err?.status === 'number') return err.status;
  const match = /"code"\s*:\s*(\d{3})/.exec(err?.message ?? '');
  return match ? Number(match[1]) : undefined;
}

export function isRetryable(err) {
  const status = statusOf(err);
  // Без распознанного кода это, как правило, сетевой сбой — его тоже повторяем.
  return status === undefined || RETRYABLE.has(status);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Выполняет `call(model)` по очереди для каждой модели из списка, повторяя
 * попытки с экспоненциальной задержкой. Возвращает результат первой успешной.
 */
export async function withModelFallback(models, call, { attemptsPerModel = 2, baseDelayMs = 700 } = {}) {
  let lastError;
  for (const model of models) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      try {
        return { result: await call(model), model };
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
        console.warn(`model ${model} attempt ${attempt + 1} failed: ${statusOf(err) ?? 'network'}`);
        const isLastTry = attempt === attemptsPerModel - 1 && model === models[models.length - 1];
        if (!isLastTry) await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
