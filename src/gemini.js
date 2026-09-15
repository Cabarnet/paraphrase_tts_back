import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY не задан. Получить ключ: https://aistudio.google.com/apikey');
  process.exit(1);
}

export const ai = new GoogleGenAI({ apiKey });

// Модели можно переопределить через переменные окружения на Railway
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
export const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
