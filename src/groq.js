/**
 * Groq — второй провайдер в цепочке. У него отдельный от Google пул квот
 * (бесплатно 1000 запросов и 200 000 токенов в сутки), поэтому он подхватывает
 * запросы, когда дневная квота Gemini исчерпана.
 *
 * Работает по OpenAI-совместимому протоколу, отдельный SDK не нужен.
 */

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const GROQ_ENABLED = Boolean(process.env.GROQ_API_KEY);

// gpt-oss-120b — самая крупная из бесплатных моделей Groq. Альтернатива для
// сравнения на русском: qwen/qwen3.8-27b.
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

/**
 * Дневной лимит Groq считается в токенах, а не в запросах, поэтому рассуждения
 * модели — это прямой расход квоты. Для перефразирования они не нужны.
 */
const REASONING_EFFORT = process.env.GROQ_REASONING_EFFORT || 'low';

export async function groqGenerate({ model, systemInstruction, text, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: text },
        ],
        temperature: 0.7,
        reasoning_effort: REASONING_EFFORT,
      }),
    });
  } catch (err) {
    // Обрыв по таймауту приходит как AbortError — отдаём его как 504,
    // чтобы цепочка сочла ошибку повторяемой.
    const error = new Error(err.name === 'AbortError' ? `Groq не ответил за ${timeoutMs} мс` : err.message);
    error.status = 504;
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text();
    // Статус кладём в err.status — на него смотрят isRetryable/isQuotaError.
    const error = new Error(`Groq ${response.status}: ${body.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}
