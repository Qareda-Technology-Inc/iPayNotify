import { MongoMemoryServer } from 'mongodb-memory-server';

/** One in-memory mongod for the whole run; each test file gets its own database on it. */
export default async function setup({ provide }) {
  const mongod = await MongoMemoryServer.create();
  provide('mongoUri', mongod.getUri());
  return async () => {
    await mongod.stop();
  };
}
