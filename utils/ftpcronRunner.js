// cronRunner.js
import cron from 'node-cron';
import { uploadScheduledBatches } from './uploadScheduledBatches.js';

// Runs every 1 hour — adjust as needed
cron.schedule('0 * * * *', async () => {
  await uploadScheduledBatches();
});
