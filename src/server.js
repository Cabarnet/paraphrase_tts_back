import express from 'express';
import cors from 'cors';
import { requireAppKey } from './middleware/auth.js';
import paraphraseRouter from './routes/paraphrase.js';
import ttsRouter from './routes/tts.js';
import modelsRouter from './routes/models.js';
import { TEXT_MODEL, TTS_MODEL } from './gemini.js';

const app = express();
const PORT = process.env.PORT || 3000; // Railway передаёт PORT сам

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health-check для Railway и мониторинга
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', textModel: TEXT_MODEL, ttsModel: TTS_MODEL }),
);

app.use('/api/paraphrase', requireAppKey, paraphraseRouter);
app.use('/api/tts', requireAppKey, ttsRouter);
app.use('/api/models', requireAppKey, modelsRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`Backend запущен на порту ${PORT}`));
