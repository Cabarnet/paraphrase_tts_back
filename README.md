# paraphrase-tts-back

Общий бэкенд для приложений «Перефразировка» и «Озвучка текста». Работает поверх Google AI Studio (Gemini).

## Эндпоинты

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/health` | — | `{ status, textModel, ttsModel }` |
| POST | `/api/paraphrase` | `{ "text": "...", "style": "neutral / formal / casual / simple / academic" }` | `{ "result": "...", "model": "..." }` |
| GET | `/api/tts/voices` | — | `{ "voices": [...] }` |
| POST | `/api/tts` | `{ "text": "...", "voice": "Kore" }` | `audio/wav` |

Если задана переменная `APP_API_KEY`, все `/api/*` требуют заголовок `X-App-Key: <ключ>`.

## Локальный запуск

```bash
cp .env.example .env   # вписать GEMINI_API_KEY
npm install
node --env-file=.env --watch src/server.js
```

Проверка:

```bash
curl -X POST http://localhost:3000/api/paraphrase -H "Content-Type: application/json" -d "{\"text\":\"Привет, как дела?\",\"style\":\"formal\"}"
```

## Деплой на Railway

1. Запушить репозиторий на GitHub, в Railway: **New Project → Deploy from GitHub repo**.
2. В **Variables** добавить `GEMINI_API_KEY` (и при желании `APP_API_KEY`).
3. Railway сам определит Node.js, соберёт и запустит `npm start`; `PORT` подставляется автоматически.
4. В **Settings → Networking → Generate Domain** получить публичный URL — его вписать в Flutter-приложение.
