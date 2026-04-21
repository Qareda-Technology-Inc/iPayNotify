import mongoose from 'mongoose';
import { config } from '../config.js';
import '../models/index.js';

async function main() {
  await mongoose.connect(config.mongoUri);
  try {
    for (const name of mongoose.modelNames()) {
      const Model = mongoose.model(name);
      await Model.syncIndexes();
      console.log('synced indexes:', name);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
