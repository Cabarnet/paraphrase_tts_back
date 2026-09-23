import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY не задан. Получить ключ: https://aistudio.google.com/apikey');
  process.exit(1);
}

export const ai = new GoogleGenAI({ apiKey });

// Модели можно переопределить через переменные окружения на Railway.
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash';
export const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';

// Бесплатный тариф Gemini регулярно отвечает 503 «high demand». Когда основная
// модель перегружена, пробуем запасные — список задаётся через GEMINI_TEXT_FALLBACKS
// (через запятую) и проходится по порядку.
export const TEXT_FALLBACKS = (process.env.GEMINI_TEXT_FALLBACKS ||
  'gemini-3.6-flash,gemini-3.5-flash-lite')
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

/** 429 RESOURCE_EXHAUSTED: исчерпан лимит запросов в минуту для этой модели. */
export function isQuotaError(err) {
  return statusOf(err) === 429;
}

export function isRetryable(err) {
  const status = statusOf(err);
  // Без распознанного кода это, как правило, сетевой сбой — его тоже повторяем.
  return status === undefined || RETRYABLE.has(status);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Обрывает зависший вызов: httpOptions.timeout в SDK отрабатывает не всегда,
 * а перегруженный Gemini способен держать соединение дольше минуты.
 */
export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Модель не ответила за ${ms} мс`);
      error.status = 504;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Предел на один вызов модели: перегруженный Gemini может «думать» минуту. */
export const CALL_TIMEOUT_MS = Number(process.env.GEMINI_CALL_TIMEOUT_MS || 20_000);

/** Общий бюджет на все попытки — клиент ждёт ответа не дольше минуты. */
const TOTAL_BUDGET_MS = Number(process.env.GEMINI_TOTAL_BUDGET_MS || 45_000);

/**
 * Выполняет `call(model)` по очереди для каждой модели из списка: основную
 * пробуем дважды, запасные — по разу, и всё это в пределах общего бюджета
 * времени. Возвращает результат первой успешной попытки.
 */
export async function withModelFallback(models, call, { baseDelayMs = 600 } = {}) {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let lastError;

  for (const [index, model] of models.entries()) {
    // Вторая попытка есть только у основной модели: перегрузка обычно
    // держится дольше паузы, и время лучше потратить на другую модель.
    const attempts = index === 0 ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (Date.now() >= deadline) throw lastError ?? new Error('Истёк бюджет времени на запрос');
      try {
        return { result: await call(model), model };
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
        console.warn(`model ${model} attempt ${attempt + 1} failed: ${statusOf(err) ?? 'network'}`);
        // Лимит запросов в минуту повтором не лечится и только усугубляется —
        // сразу уходим на следующую модель, у неё своя квота.
        if (isQuotaError(err)) break;
        if (Date.now() + baseDelayMs < deadline) await sleep(baseDelayMs);
      }
    }
  }
  throw lastError;
}
