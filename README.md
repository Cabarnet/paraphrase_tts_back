# paraphrase-tts-back

Общий бэкенд для приложений «Перефразировка» и «Озвучка текста». Работает поверх Google AI Studio (Gemini).

## Эндпоинты

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/health` | — | `{ status, textModel, ttsModel }` |
| POST | `/api/paraphrase` | `{ "text": "...", "style": "neutral / formal / casual / simple / academic" }` | `{ "result": "...", "model": "..." }` |
| GET | `/api/tts/voices` | — | `{ "voices": [...] }` |
| GET | `/api/models` | — | список моделей, доступных ключу (диагностика) |
| POST | `/api/tts` | `{ "text": "...", "voice": "Kore", "model": "необязательно, TTS-модель" }` | `audio/wav` |

Если задана переменная `APP_API_KEY`, все `/api/*` требуют заголовок `X-App-Key: <ключ>`.

## Устойчивость к перегрузке Gemini

Бесплатный тариф отвечает `503 high demand` при перегрузке модели и `429` при
исчерпании квоты (она у каждой модели своя и невелика — у части моделей это
десятки запросов в сутки). `/api/paraphrase` поэтому пробует основную модель
дважды, затем по разу каждую запасную из `GEMINI_TEXT_FALLBACKS`, укладываясь в
общий бюджет `GEMINI_TOTAL_BUDGET_MS` (по умолчанию 45 с). При `429` повтор той же
модели пропускается — квота повтором не лечится, и переход к следующей модели
одновременно складывает их суточные квоты.

Клиент получает `503` («перегружена, попробуйте ещё раз») или `429` («слишком
много запросов, подождите минуту») — в обоих случаях это сигнал повторить, а не
поломка сервиса. Какая модель ответила, видно в поле `model`.

Чтобы снять потолок совсем, нужно подключить биллинг в Google AI Studio: Flash-модели
стоят копейки, а лимиты вырастают на порядки.

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
