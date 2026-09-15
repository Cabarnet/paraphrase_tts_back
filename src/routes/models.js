import { Router } from 'express';
import { ai } from '../gemini.js';

const router = Router();

// GET /api/models -> список моделей, доступных ключу (для диагностики)
router.get('/', async (_req, res) => {
  try {
    const models = [];
    for await (const m of await ai.models.list()) {
      models.push({ name: m.name, actions: m.supportedActions });
    }
    res.json({ models });
  } catch (err) {
    res.status(502).json({ error: 'Не удалось получить список моделей', details: err.message });
  }
});

export default router;
