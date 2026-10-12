// Google Cloud Text-to-Speech — основной движок озвучки. В отличие от Gemini
// TTS (3 запроса в минуту и около десятка в сутки на бесплатном тарифе) здесь
// бесплатная квота считается символами: 1 млн в месяц на голоса Chirp 3 HD.
// SDK не берём: одного REST-вызова достаточно, а зависимостей меньше.

const API_KEY = process.env.GOOGLE_TTS_API_KEY;

/** Движок доступен, только если задан ключ; иначе остаётся Gemini. */
export const CLOUD_TTS_ENABLED = Boolean(API_KEY);

// Chirp 3 HD — те же имена голосов, что у Gemini TTS, поэтому клиент
// переключение не замечает. Семейство можно сменить на Wavenet или Standard
// (голоса там называются A–E, список VOICES тогда тоже нужно поменять).
const VOICE_FAMILY = process.env.GOOGLE_TTS_VOICE_FAMILY || 'Chirp3-HD';

export const VOICES = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus'];

// Предел API — 5000 байт на запрос, а не символов: кириллица в UTF-8 занимает
// два байта, поэтому по символам это примерно 2400 знаков русского текста.
export const MAX_REQUEST_BYTES = 4900;

const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const DEFAULT_LANGUAGE = process.env.GOOGLE_TTS_LANGUAGE || 'ru-RU';
const TIMEOUT_MS = Number(process.env.GOOGLE_TTS_TIMEOUT_MS || 60_000);

/**
 * Cloud TTS, в отличие от Gemini, не определяет язык сам — его задаёт имя
 * голоса. Текст с кириллицей озвучиваем русским голосом, иначе английским:
 * у Chirp 3 HD в обеих локалях одни и те же голоса, меняется только произношение.
 */
export function detectLanguage(text) {
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (cyrillic === 0 && latin > 0) return 'en-US';
  return DEFAULT_LANGUAGE;
}

export class CloudTtsError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Синтезирует речь и возвращает готовый WAV (24 кГц, 16 бит, моно) —
 * LINEAR16 приходит уже с RIFF-заголовком, доворачивать ничего не нужно.
 */
export async function synthesize(text, voice, language = detectLanguage(text)) {
  const body = {
    input: { text },
    voice: { languageCode: language, name: `${language}-${VOICE_FAMILY}-${voice}` },
    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24_000 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new CloudTtsError(
      err.name === 'AbortError' ? `Cloud TTS не ответил за ${TIMEOUT_MS} мс` : err.message,
      504,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const details = await response.text();
    let message = details.slice(0, 300);
    try {
      message = JSON.parse(details).error?.message ?? message;
    } catch {
      // Не JSON — оставляем сырой текст, он уходит только в лог.
    }
    throw new CloudTtsError(message, response.status);
  }

  const { audioContent } = await response.json();
  if (!audioContent) throw new CloudTtsError('Cloud TTS вернул пустой ответ', 502);
  return Buffer.from(audioContent, 'base64');
}
