import { Router } from 'express';
import { ai, GEMINI_ENABLED, TTS_MODEL } from '../gemini.js';
import {
  CLOUD_TTS_ENABLED,
  MAX_REQUEST_BYTES,
  VOICES,
  CloudTtsError,
  synthesize as cloudSynthesize,
} from '../cloud-tts.js';

const router = Router();

const MAX_TEXT_LENGTH = 5_000;

// Gemini TTS отдаёт сырой PCM 16-bit mono 24kHz — оборачиваем в WAV-заголовок,
// чтобы клиент мог проиграть файл без дополнительной обработки. Cloud TTS
// в режиме LINEAR16 присылает WAV сразу, там это не нужно.
function pcmToWav(pcm, sampleRate = 24_000, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Запасной движок: та же фраза голосом Gemini TTS. */
async function geminiSynthesize(text, voice, model = TTS_MODEL) {
  if (!GEMINI_ENABLED) {
    const error = new Error('Gemini не настроен');
    error.status = 502;
    throw error;
  }
  const response = await ai.models.generateContent({
    model,
    contents: text,
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });

  const candidate = response.candidates?.[0];
  const audioPart = candidate?.content?.parts?.find((p) => p.inlineData?.data);
  if (!audioPart) {
    const error = new Error(`Gemini не вернул аудио (finishReason: ${candidate?.finishReason})`);
    error.status = 502;
    throw error;
  }
  return pcmToWav(Buffer.from(audioPart.inlineData.data, 'base64'));
}

// GET /api/tts/voices -> { voices: string[] }
router.get('/voices', (_req, res) => res.json({ voices: VOICES }));

// POST /api/tts  { text: string, voice?: string, language?: string }
// -> audio/wav (бинарный файл)
router.post('/', async (req, res) => {
  const { text, voice = 'Kore', language } = req.body ?? {};

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Поле text обязательно' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(413).json({ error: `Текст длиннее ${MAX_TEXT_LENGTH} символов` });
  }
  // Предел Cloud TTS — в байтах, а русская буква занимает два: по символам
  // граница плавает, поэтому проверяем ровно то, что проверит сам API.
  if (CLOUD_TTS_ENABLED && Buffer.byteLength(text) > MAX_REQUEST_BYTES) {
    return res.status(413).json({ error: 'Текст слишком длинный для одной озвучки' });
  }
  if (!VOICES.includes(voice)) {
    return res.status(400).json({ error: `Неизвестный voice. Доступны: ${VOICES.join(', ')}` });
  }

  let wav;
  try {
    if (CLOUD_TTS_ENABLED) {
      try {
        wav = await cloudSynthesize(text, voice, language);
      } catch (err) {
        // Квота Cloud TTS считается помесячно, так что её исчерпание — повод
        // доработать месяц на Gemini, а не отдавать пользователю ошибку.
        console.error('cloud tts error:', err.status, err.message);
        if (err instanceof CloudTtsError && err.status === 400) throw err;
        wav = await geminiSynthesize(text, voice);
      }
    } else {
      wav = await geminiSynthesize(text, voice);
    }
  } catch (err) {
    console.error('tts error:', err);
    const status = err.status === 429 ? 429 : 502;
    return res.status(status).json({
      error:
        status === 429
          ? 'Слишком много запросов. Подождите минуту и попробуйте снова.'
          : 'Ошибка при обращении к модели',
      details: err.message,
    });
  }

  res.set({
    'Content-Type': 'audio/wav',
    'Content-Length': wav.length,
    'Content-Disposition': 'inline; filename="speech.wav"',
  });
  res.send(wav);
});

export default router;
