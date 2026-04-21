export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const message =
    status === 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Error';
  const body = { error: message };
  if (err.routers) body.routers = err.routers;
  res.status(status).json(body);
}
