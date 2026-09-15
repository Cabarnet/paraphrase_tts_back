// Простая защита от чужого использования бэкенда: если задан APP_API_KEY,
// клиент обязан присылать его в заголовке X-App-Key.
export function requireAppKey(req, res, next) {
  const expected = process.env.APP_API_KEY;
  if (!expected) return next();
  if (req.get('X-App-Key') !== expected) {
    return res.status(401).json({ error: 'Неверный или отсутствующий X-App-Key' });
  }
  next();
}
