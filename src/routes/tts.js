import { Router } from 'express';
import { ai, TTS_MODEL } from '../gemini.js';

const router = Router();

// Голоса Gemini TTS: https://ai.google.dev/gemini-api/docs/speech-generation#voices
const VOICES = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus'];
const MAX_TEXT_LENGTH = 5_000;

// Gemini TTS отдаёт сырой PCM 16-bit mono 24kHz — оборачиваем в WAV-заголовок,
// чтобы клиент мог проиграть файл без дополнительной обработки.
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

// GET /api/tts/voices -> { voices: string[] }
router.get('/voices', (_req, res) => res.json({ voices: VOICES }));

// POST /api/tts  { text: string, voice?: string, model?: string }
// model — необязательно, только TTS-модели (например gemini-3.1-flash-tts-preview)
// -> audio/wav (бинарный файл)
router.post('/', async (req, res) => {
  const { text, voice = 'Kore', model = TTS_MODEL } = req.body ?? {};

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Поле text обязательно' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(413).json({ error: `Текст длиннее ${MAX_TEXT_LENGTH} символов` });
  }
  if (typeof model !== 'string' || !model.includes('tts')) {
    return res.status(400).json({ error: 'model должна быть TTS-моделью' });
  }
  if (!VOICES.includes(voice)) {
    return res.status(400).json({ error: `Неизвестный voice. Доступны: ${VOICES.join(', ')}` });
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: text,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    });

    const candidate = response.candidates?.[0];
    const audioPart = candidate?.content?.parts?.find((p) => p.inlineData?.data);
    if (!audioPart) {
      console.error('tts: no audio in response', JSON.stringify(response, null, 2));
      return res.status(502).json({
        error: 'Модель не вернула аудио',
        details: {
          model,
          finishReason: candidate?.finishReason,
          promptFeedback: response.promptFeedback,
          text: response.text,
        },
      });
    }
    const base64 = audioPart.inlineData.data;

    const wav = pcmToWav(Buffer.from(base64, 'base64'));
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': wav.length,
      'Content-Disposition': 'inline; filename="speech.wav"',
    });
    res.send(wav);
  } catch (err) {
    console.error('tts error:', err);
    res.status(502).json({ error: 'Ошибка при обращении к модели', details: err.message });
  }
});

export default router;
