import mongoose from 'mongoose';
import { config } from '../config.js';

export async function connectDb() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(config.mongoUri);
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
