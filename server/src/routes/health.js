import express from 'express';
import mongoose from 'mongoose';

export const healthRouter = express.Router();

healthRouter.get('/', (req, res) => {
  res.json({
    ok: true,
    app: 'QareFi Billing',
    mongo:
      mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});
