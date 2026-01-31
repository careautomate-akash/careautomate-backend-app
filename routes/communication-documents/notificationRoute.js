import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import {
    getUserNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    sendTestNotifications
} from '../../controllers/communication-documents/notificationController.js';

const router = express.Router();

// Get user notifications
router.get('/', authenticateToken, getUserNotifications);

// Get notifications for a specific user
router.get('/user/:userId', authenticateToken, async (req, res) => {
    try {
        // Check if user is requesting their own notifications or is admin
        if (req.user.id !== req.params.userId && req.user.role < 2) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Can only access your own notifications'
            });
        }

        // Temporarily set the user ID in the request for the controller
        const originalUserId = req.user.id;
        req.user.id = req.params.userId;

        await getUserNotifications(req, res);

        // Restore original user ID
        req.user.id = originalUserId;
    } catch (error) {
        console.error('Error fetching user notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications',
            error: error.message
        });
    }
});

// Mark notification as read
router.put('/:notificationId/read', authenticateToken, markAsRead);

// Mark all notifications as read
router.put('/read-all', authenticateToken, markAllAsRead);

// Delete notification
router.delete('/:notificationId', authenticateToken, deleteNotification);

// Test endpoint to send test notifications
router.post('/send-test', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin or superadmin
        if (req.user.role < 2) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: Only admins can send test notifications'
            });
        }

        await sendTestNotifications();
        res.status(200).json({
            success: true,
            message: 'Test notifications sent successfully'
        });
    } catch (error) {
        console.error('Error sending test notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send test notifications',
            error: error.message
        });
    }
});

export default router; 