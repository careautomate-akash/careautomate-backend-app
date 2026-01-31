import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import User from '../../models/account/users.js';
import { triggerImmediateNotificationCheck, getQueueStats } from '../../utils/notificationQueue.js';

const router = express.Router();

/**
 * Register push token for notifications
 * POST /push-tokens/register
 */
router.post('/register', authenticateToken, async (req, res) => {
    try {
        const { token, platform, deviceId } = req.body;
        const userId = req.user.id;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Push token is required'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // For web platform, store as FCM token
        if (platform === 'web') {
            user.fcmToken = token;
            await user.save();
        } else {
            // For mobile platforms, use the addPushToken method
            await user.addPushToken(token, platform, deviceId);
        }

        res.status(200).json({
            success: true,
            message: 'Push token registered successfully'
        });
    } catch (error) {
        console.error('Error registering push token:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to register push token',
            error: error.message
        });
    }
});

/**
 * Unregister push token
 * POST /push-tokens/unregister
 */
router.post('/unregister', authenticateToken, async (req, res) => {
    try {
        const { token, platform } = req.body;
        const userId = req.user.id;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Push token is required'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (platform === 'web') {
            user.fcmToken = null;
            await user.save();
        } else {
            await user.removePushToken(token);
        }

        res.status(200).json({
            success: true,
            message: 'Push token unregistered successfully'
        });
    } catch (error) {
        console.error('Error unregistering push token:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to unregister push token',
            error: error.message
        });
    }
});

/**
 * Update notification preferences
 * PUT /push-tokens/preferences
 */
router.put('/preferences', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { notificationSettings } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Update notification settings
        user.notificationSettings = {
            ...user.notificationSettings,
            ...notificationSettings
        };

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Notification preferences updated successfully',
            data: user.notificationSettings
        });
    } catch (error) {
        console.error('Error updating notification preferences:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update notification preferences',
            error: error.message
        });
    }
});

/**
 * Get notification preferences
 * GET /push-tokens/preferences
 */
router.get('/preferences', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).select('notificationSettings');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            data: user.notificationSettings || {
                appointments: true,
                visits: true,
                claims: true,
                services: true,
                pushEnabled: true,
                emailEnabled: true
            }
        });
    } catch (error) {
        console.error('Error fetching notification preferences:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notification preferences',
            error: error.message
        });
    }
});

/**
 * Test notification endpoint
 * POST /push-tokens/test
 */
router.post('/test', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Trigger immediate notification check
        await triggerImmediateNotificationCheck();

        res.status(200).json({
            success: true,
            message: 'Test notification triggered successfully'
        });
    } catch (error) {
        console.error('Error triggering test notification:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to trigger test notification',
            error: error.message
        });
    }
});

/**
 * Get queue statistics (admin only)
 * GET /push-tokens/queue-stats
 */
router.get('/queue-stats', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin or superadmin
        if (req.user.role < 2) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Only admins can view queue statistics'
            });
        }

        const stats = await getQueueStats();

        res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error fetching queue statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch queue statistics',
            error: error.message
        });
    }
});

export default router; 