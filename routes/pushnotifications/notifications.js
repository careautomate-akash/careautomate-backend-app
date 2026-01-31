import express from 'express';
import {
  sendNotification,
  sendGlobalNotification,
  updateFcmToken,
  getFcmTokenOfUser,
  sendGroupNotification,
} from '../../controllers/pushnotifications/notifications.js';

const router = express.Router();

router.post('/send-notification', sendNotification);
router.post('/send-global-notification', sendGlobalNotification);
router.post('/update-fcm-token', updateFcmToken);
router.get('/get-fcm-token/:userId', getFcmTokenOfUser);
router.post('/send-group-notification', sendGroupNotification);

export default router;
