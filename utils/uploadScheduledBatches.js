import Batches from '../models/bills/batches.js';
import sftpUploader from './sftpUploader.js';
import fs from 'fs/promises';
import path from 'path';

export const uploadScheduledBatches = async () => {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  try {
    const scheduledBatches = await Batches.find({
      batchStatus: 'schedule',
      batchDate: { $lte: endOfToday },
    });
    for (const batch of scheduledBatches) {
      for (const file of batch.ediFiles) {
        const localPath = path.join('/tmp', file.fileName); // adjust if using actual path

        try {
          await sftpUploader(localPath, file.fileName);
          await fs.unlink(localPath); // optional: cleanup
        } catch (err) {
          console.error(`❌ Failed to upload ${file.fileName}: ${err.message}`);
        }
      }

      // ✅ Update batch status
      batch.batchStatus = 'billed';
      await batch.save();
    }
  } catch (err) {
    console.error('❌ Error in uploading scheduled batches:', err);
  }
};
