import { Router } from 'express';
import {
  ai,
  TEXT_MODEL,
  TEXT_FALLBACKS,
  withModelFallback,
  isRetryable,
  CALL_TIMEOUT_MS,
} from '../gemini.js';

const router = Router();

const STYLES = {
  neutral: 'нейтральном стиле',
  formal: 'официально-деловом стиле',
  casual: 'разговорном, дружелюбном стиле',
  simple: 'максимально простыми словами',
  academic: 'академическом, научном стиле',
};

const MAX_TEXT_LENGTH = 10_000;

// POST /api/paraphrase  { text: string, style?: keyof STYLES, model?: string }
// -> { result: string, model: string }
router.post('/', async (req, res) => {
  const { text, style = 'neutral', model } = req.body ?? {};

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Поле text обязательно' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(413).json({ error: `Текст длиннее ${MAX_TEXT_LENGTH} символов` });
  }
  const styleDescription = STYLES[style];
  if (!styleDescription) {
    return res.status(400).json({ error: `Неизвестный style. Доступны: ${Object.keys(STYLES).join(', ')}` });
  }

  // model в теле запроса — для диагностики; обычно идём по основной модели,
  // а при перегрузке (503) переключаемся на запасные.
  const models = model ? [model] : [TEXT_MODEL, ...TEXT_FALLBACKS];

  const systemInstruction =
    `Ты — редактор. Перефразируй текст пользователя в ${styleDescription}, ` +
    'полностью сохранив смысл, язык оригинала и форматирование (абзацы, списки). ' +
    'Не добавляй пояснений, вступлений и комментариев — верни только перефразированный текст.';

  try {
    const { result, model: usedModel } = await withModelFallback(models, async (m) => {
      const response = await ai.models.generateContent({
        model: m,
        contents: text,
        config: { systemInstruction, temperature: 0.7, httpOptions: { timeout: CALL_TIMEOUT_MS } },
      });
      const output = response.text?.trim();
      if (!output) {
        // Пустой ответ обычно означает срабатывание фильтра — повтор не поможет,
        // но другая модель может справиться, поэтому бросаем retryable-ошибку.
        const error = new Error('Модель вернула пустой ответ');
        error.status = 503;
        throw error;
      }
      return output;
    });

    res.json({ result, model: usedModel });
  } catch (err) {
    console.error('paraphrase error:', err);
    // Перегрузка бесплатного тарифа — это 503, а не «наша» ошибка: так клиент
    // может предложить повторить, не показывая «сервис сломан».
    const status = isRetryable(err) ? 503 : 502;
    res.status(status).json({
      error: status === 503
        ? 'Модель сейчас перегружена. Попробуйте ещё раз через несколько секунд.'
        : 'Ошибка при обращении к модели',
      details: err.message,
    });
  }
});

export default router;
