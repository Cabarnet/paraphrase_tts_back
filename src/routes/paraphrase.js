import { Router } from 'express';
import { ai, TEXT_MODEL } from '../gemini.js';

const router = Router();

const STYLES = {
  neutral: 'нейтральном стиле',
  formal: 'официально-деловом стиле',
  casual: 'разговорном, дружелюбном стиле',
  simple: 'максимально простыми словами',
  academic: 'академическом, научном стиле',
};

const MAX_TEXT_LENGTH = 10_000;

// POST /api/paraphrase  { text: string, style?: keyof STYLES }
// -> { result: string, model: string }
router.post('/', async (req, res) => {
  const { text, style = 'neutral' } = req.body ?? {};

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

  try {
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: text,
      config: {
        systemInstruction:
          `Ты — редактор. Перефразируй текст пользователя в ${styleDescription}, ` +
          'полностью сохранив смысл, язык оригинала и форматирование (абзацы, списки). ' +
          'Не добавляй пояснений, вступлений и комментариев — верни только перефразированный текст.',
        temperature: 0.7,
      },
    });

    const result = response.text?.trim();
    if (!result) {
      return res.status(502).json({ error: 'Модель вернула пустой ответ' });
    }
    res.json({ result, model: TEXT_MODEL });
  } catch (err) {
    console.error('paraphrase error:', err);
    res.status(502).json({ error: 'Ошибка при обращении к модели', details: err.message });
  }
});

export default router;
