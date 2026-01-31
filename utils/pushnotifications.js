import admin from '../config/firebase.js';
import users from '../models/account/users.js';
import ScheduledNotification from '../models/notifications/shedule-notifications.js';

export const sendAppointmentNotification = async (
  userId,
  title,
  body,
  data = {}
) => {
  try {
    const user = await users.findById(userId);
    if (!user?.fcmToken) return;

    await admin.messaging().send({
      token: user.fcmToken,
      notification: { title, body },
      data,
    });
  } catch (err) {
    console.error(
      `❌ Failed to send appointment FCM to ${userId}:`,
      err.message
    );
  }
};

export const sendVisitNotification = async (userId, title, body, data = {}) => {
  try {
    const user = await users.findById(userId);
    if (!user?.fcmToken) return;

    const message = {
      token: user.fcmToken,
      notification: { title, body },
      data,
    };

    await admin.messaging().send(message);
  } catch (err) {
    console.error(`❌ Failed to send FCM to ${userId}:`, err.message);
  }
};

export const createAppointmentReminders = async (
  appointment,
  hcmDetails,
  tenantName
) => {
  const intervals = [10, 60];
  for (const minsBefore of intervals) {
    const scheduledTime = new Date(
      appointment.startTime.getTime() - minsBefore * 60 * 1000
    );
    await ScheduledNotification.create({
      targetUserId: appointment.hcmId,
      title: 'Upcoming Appointment Reminder',
      message: `You have an appointment with ${tenantName} at ${appointment.startTime.toLocaleString(
        'en-US',
        {
          timeZone: hcmDetails?.timezone || 'Asia/Kolkata',
        }
      )}`,
      type: 'appointment',
      refId: appointment._id,
      refType: 'Appointments',
      scheduledAt: scheduledTime,
      timezone: hcmDetails?.timezone || 'Asia/Kolkata',
    });
  }
};

export const removePendingAppointmentReminders = async (appointmentId) => {
  await ScheduledNotification.deleteMany({
    refId: appointmentId,
    refType: 'Appointments',
    type: 'appointment',
    status: 'pending',
  });
};
