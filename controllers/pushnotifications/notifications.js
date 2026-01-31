import admin from '../../config/firebase.js';
import users from '../../models/account/users.js';
import mongoose from 'mongoose';

export const sendNotification = async (req, res) => {
  const { userId, title, body } = req.body;
  const user = await users.findById(new mongoose.Types.ObjectId(userId));
  if (!user || !user.fcmToken) {
    return res.status(404).json({ error: 'User or token not found' });
  }

  const message = {
    token: user.fcmToken,
    notification: { title, body },
    data: {
      type: 'individual',
    },
  };

  try {
    const response = await admin.messaging().send(message);
    res.json({ success: true, response });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

export const getFcmTokenOfUser = async (req, res) => {
  try {
    const userId = req.params.userId; // ✅ extract from URL
    const user = await users.findById(new mongoose.Types.ObjectId(userId));
    res.status(200).json({ success: true, user: user });
  } catch (error) {
    console.error(error.message);
    res.status(400).json({ success: false, error: error.message });
  }
};

export const updateFcmToken = async (req, res) => {
  const { userId, fcmToken } = req.body;

  if (!userId || !fcmToken) {
    return res
      .status(400)
      .json({ success: false, message: 'User ID and FCM token are required.' });
  }

  try {
    await users.findOneAndUpdate(
      { _id: userId },
      { fcmToken: fcmToken },
      { new: true, upsert: true }
    );

    res
      .status(200)
      .json({ success: true, message: 'FCM token updated successfully.' });
  } catch (error) {
    console.error('Error updating FCM token:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const sendGlobalNotification = async (req, res) => {
  //  await messaging().subscribeToTopic('global');
  const { title, body } = req.body;
  const message = {
    topic: 'global',
    notification: { title, body },
    data: {
      type: 'global',
    },
  };
  try {
    const response = await admin.messaging().send(message);
    res.json({ success: true, response });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

export const sendGroupNotification = async (req, res) => {
  const { userIds, title, body } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'Invalid user IDs' });
  }

  try {
    const usersData = await users.find({ _id: { $in: userIds } });

    const tokens = usersData
      .filter((user) => user.fcmToken)
      .map((user) => user.fcmToken);

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'No valid FCM tokens found' });
    }

    const results = [];

    for (const token of tokens) {
      try {
        const response = await admin.messaging().send({
          token,
          notification: {
            title,
            body,
            data: {
              type: 'group',
            },
          },
        });
        results.push({ token, success: true, response });
      } catch (err) {
        results.push({ token, success: false, error: err.message });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
