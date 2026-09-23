import { Router } from 'express';
import {
  ai,
  TEXT_MODEL,
  TEXT_FALLBACKS,
  withModelFallback,
  isRetryable,
  withTimeout,
  isQuotaError,
} from '../gemini.js';
import { GROQ_ENABLED, GROQ_MODEL, groqGenerate } from '../groq.js';

const router = Router();

const STYLES = {
  neutral: 'нейтральном стиле',
  formal: 'официально-деловом стиле',
  casual: 'разговорном, дружелюбном стиле',
  simple: 'максимально простыми словами',
  academic: 'академическом, научном стиле',
};

const MAX_TEXT_LENGTH = 10_000;

/** Записи цепочки с этим префиксом уходят в Groq, остальные — в Gemini. */
const GROQ_PREFIX = 'groq:';

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

  // model в теле запроса — для диагностики; обычно идём по основной модели, а при
  // перегрузке (503) или исчерпанной квоте (429) переключаемся на запасные.
  // Groq стоит последним: это отдельный провайдер со своим пулом квот, который
  // подхватывает запросы, когда дневная квота Google уже закончилась.
  const models = model
    ? [model]
    : [TEXT_MODEL, ...TEXT_FALLBACKS, ...(GROQ_ENABLED ? [`${GROQ_PREFIX}${GROQ_MODEL}`] : [])];

  const systemInstruction =
    `Ты — редактор. Перефразируй текст пользователя в ${styleDescription}, ` +
    'полностью сохранив смысл, язык оригинала и форматирование (абзацы, списки). ' +
    'Не добавляй пояснений, вступлений и комментариев — верни только перефразированный текст.';

  try {
    const { result, model: usedModel } = await withModelFallback(models, async (m, timeoutMs) => {
      const output = m.startsWith(GROQ_PREFIX)
        ? await groqGenerate({
            model: m.slice(GROQ_PREFIX.length),
            systemInstruction,
            text,
            timeoutMs,
          })
        : await generateWithGemini(m, systemInstruction, text, timeoutMs);

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
    // 429 отдаём как есть: клиент показывает «слишком много запросов»,
    // а не «перегружена» — причина и совет пользователю разные.
    const status = isQuotaError(err) ? 429 : isRetryable(err) ? 503 : 502;
    const messages = {
      429: 'Слишком много запросов. Подождите минуту и попробуйте снова.',
      503: 'Модель сейчас перегружена. Попробуйте ещё раз через несколько секунд.',
      502: 'Ошибка при обращении к модели',
    };
    res.status(status).json({ error: messages[status], details: err.message });
  }
});

async function generateWithGemini(model, systemInstruction, text, timeoutMs) {
  // Gemma не поддерживает systemInstruction — для неё инструкция уходит
  // в само сообщение, иначе API отвечает 500 INTERNAL.
  const isGemma = model.startsWith('gemma');
  const response = await withTimeout(
    ai.models.generateContent({
      model,
      contents: isGemma ? `${systemInstruction}\n\nТекст:\n${text}` : text,
      config: {
        ...(isGemma ? {} : { systemInstruction }),
        temperature: 0.7,
        httpOptions: { timeout: timeoutMs },
      },
    }),
    timeoutMs,
  );
  return response.text?.trim();
}

export default router;
