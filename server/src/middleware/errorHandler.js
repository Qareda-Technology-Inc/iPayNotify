export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const friendly = err.routerError;
  const message = friendly
    ? [friendly.message, friendly.hint].filter(Boolean).join('. ').replace(/\.\./g, '.')
    : status === 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Error';
  const body = { error: message };
  if (friendly) {
    body.code = friendly.code;
    body.detail = friendly.detail;
  }
  if (err.routers) body.routers = err.routers;
  res.status(status).json(body);
}
