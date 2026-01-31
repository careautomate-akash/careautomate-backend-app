import cron from 'node-cron';
import ScheduledNotification from '../models/notifications/shedule-notifications.js ';
import users from '../models/account/users.js';
import { sendAppointmentNotification } from './pushnotifications.js';
import { DateTime } from 'luxon';

export const processScheduledNotifications = () => {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    // console.log(`[CRON] Running at ${new Date().toISOString()}`);

    try {
      const now = new Date();

      const notifications = await ScheduledNotification.find({
        status: 'pending',
        scheduledAt: { $lte: now },
      });

      // console.log(`[CRON] Found ${notifications.length} pending notifications`);

      for (const notif of notifications) {
        try {
          const user = await users.findById(notif.targetUserId);
          if (!user) {
            console.warn(`[CRON] User not found: ${notif.targetUserId}`);
            continue;
          }

          const userTimezone = user.timezone || 'UTC';

          // Log scheduled time in user's timezone
          const localScheduled = DateTime.fromJSDate(notif.scheduledAt)
            .setZone(userTimezone)
            .toFormat('yyyy-MM-dd HH:mm:ss ZZZZ');

          const localNow = DateTime.utc()
            .setZone(userTimezone)
            .toFormat('yyyy-MM-dd HH:mm:ss ZZZZ');
          // Send the notification
          await sendAppointmentNotification(
            notif.targetUserId,
            notif.title,
            notif.message,
            {
              type: notif.type,
              appointmentId: notif.refId?.toString() || null,
            }
          );

          notif.status = 'sent';
          notif.sentAt = new Date();
          await notif.save();
        } catch (err) {
          console.error(`[CRON] Failed to send notification:`, err.message);
          notif.status = 'failed';
          await notif.save();
        }
      }
    } catch (error) {
      console.error('[CRON] Error:', error.message);
    }
  });
};
