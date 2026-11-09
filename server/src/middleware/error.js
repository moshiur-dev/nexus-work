export function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
}

// Central error handler. Never leaks stack traces in production.
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  // Log server errors so the real cause shows in the Vercel logs (the client only gets a generic message)
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
  const body = { message: err.expose || status < 500 ? err.message : 'Something went wrong' };
  if (err.details) body.details = err.details;
  if (process.env.NODE_ENV !== 'production' && status >= 500) body.stack = err.stack;
  res.status(status).json(body);
}
