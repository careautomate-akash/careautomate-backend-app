import Notification from '../../models/communication-documents/notification.js';
import User from '../../models/account/users.js';
import Appointment from '../../models/appointments-visits/appointments.js';
import Bill from '../../models/bills/bills.js';
import ServiceTracking from '../../models/bills/serviceTracking.js';
import { io } from '../../server.js';
import schedule from 'node-schedule';

// Initialize WebSocket connections map
const connectedClients = new Map();

/**
 * Create a new notification
 * @param {Object} notificationData - Notification data
 * @returns {Promise<Object>} Created notification
 */
export const createNotification = async (notificationData) => {
    try {
        const notification = new Notification(notificationData);
        await notification.save();

        // Emit socket event if recipient is connected
        emitNotification(notification);

        return notification;
    } catch (error) {
        console.error('Error creating notification:', error);
        throw error;
    }
};

/**
 * Emit notification to connected user
 * @param {Object} notification - Notification object
 */
export const emitNotification = (notification) => {
    try {
        // Get socket ID from connectedUsers map in socketEvents.js
        const recipientId = notification.recipient.toString();

        // Emit based on whether notification is for web or mobile
        if (notification.forWeb) {
            io.emit('web_notification', {
                notification,
                userId: recipientId
            });
        }

        if (notification.forMobile) {
            io.emit('mobile_notification', {
                notification,
                userId: recipientId
            });
        }
    } catch (error) {
        console.error('Error emitting notification:', error);
    }
};

/**
 * Get notifications for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getUserNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 20, unreadOnly = false } = req.query;
        const userId = req.user.id;

        const query = { recipient: userId };

        // Filter by platform (web/mobile) based on client type
        const headers = req.headers || {};
        const isMobile = headers['x-client-type'] === 'mobile';
        if (isMobile) {
            query.forMobile = true;
        } else {
            query.forWeb = true;
        }

        // Filter by read status if specified
        if (unreadOnly === 'true') {
            query.isRead = false;
        }

        const options = {
            sort: { createdAt: -1 },
            skip: (parseInt(page) - 1) * parseInt(limit),
            limit: parseInt(limit)
        };

        const notifications = await Notification.find(query, null, options);
        const total = await Notification.countDocuments(query);

        res.status(200).json({
            success: true,
            data: {
                notifications,
                totalPages: Math.ceil(total / parseInt(limit)),
                currentPage: parseInt(page),
                total
            }
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications',
            error: error.message
        });
    }
};

/**
 * Get notifications for a user (Socket.IO version)
 * @param {string} userId - User ID
 * @param {number} page - Page number
 * @param {number} limit - Limit per page
 * @param {boolean} unreadOnly - Whether to return only unread notifications
 * @param {boolean} isMobile - Whether the request is from a mobile client
 * @returns {Promise<Object>} Notifications data
 */
export const getUserNotificationsForSocket = async (userId, page = 1, limit = 20, unreadOnly = false, isMobile = false) => {
    try {
        const query = { recipient: userId };

        // Filter by platform (web/mobile)
        if (isMobile) {
            query.forMobile = true;
        } else {
            query.forWeb = true;
        }

        // Filter by read status if specified
        if (unreadOnly) {
            query.isRead = false;
        }

        const options = {
            sort: { createdAt: -1 },
            skip: (parseInt(page) - 1) * parseInt(limit),
            limit: parseInt(limit)
        };

        const notifications = await Notification.find(query, null, options);
        const total = await Notification.countDocuments(query);

        return {
            success: true,
            data: {
                notifications,
                totalPages: Math.ceil(total / parseInt(limit)),
                currentPage: parseInt(page),
                total
            }
        };
    } catch (error) {
        console.error('Error fetching notifications for socket:', error);
        return {
            success: false,
            message: 'Failed to fetch notifications',
            error: error.message
        };
    }
};

/**
 * Mark notification as read
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const markAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.user.id;

        const notification = await Notification.findOneAndUpdate(
            { _id: notificationId, recipient: userId },
            { isRead: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found or not authorized'
            });
        }

        res.status(200).json({
            success: true,
            data: notification
        });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark notification as read',
            error: error.message
        });
    }
};

/**
 * Mark notification as read (Socket.IO version)
 * @param {string} userId - User ID
 * @param {string} notificationId - Notification ID
 * @returns {Promise<Object>} Result object
 */
export const markNotificationReadForSocket = async (userId, notificationId) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: notificationId, recipient: userId },
            { isRead: true },
            { new: true }
        );

        if (!notification) {
            return {
                success: false,
                message: 'Notification not found or not authorized'
            };
        }

        return {
            success: true,
            data: notification
        };
    } catch (error) {
        console.error('Error marking notification as read for socket:', error);
        return {
            success: false,
            message: 'Failed to mark notification as read',
            error: error.message
        };
    }
};

/**
 * Mark all notifications as read
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const markAllAsRead = async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await Notification.updateMany(
            { recipient: userId, isRead: false },
            { isRead: true }
        );

        res.status(200).json({
            success: true,
            data: {
                modifiedCount: result.nModified || result.modifiedCount
            }
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark all notifications as read',
            error: error.message
        });
    }
};

/**
 * Mark all notifications as read (Socket.IO version)
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result object
 */
export const markAllNotificationsReadForSocket = async (userId) => {
    try {
        const result = await Notification.updateMany(
            { recipient: userId, isRead: false },
            { isRead: true }
        );

        return {
            success: true,
            data: {
                modifiedCount: result.nModified || result.modifiedCount
            }
        };
    } catch (error) {
        console.error('Error marking all notifications as read for socket:', error);
        return {
            success: false,
            message: 'Failed to mark all notifications as read',
            error: error.message
        };
    }
};

/**
 * Delete a notification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteNotification = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.user.id;

        const notification = await Notification.findOneAndDelete({
            _id: notificationId,
            recipient: userId
        });

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found or not authorized'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete notification',
            error: error.message
        });
    }
};

/**
 * Schedule appointment reminders for mobile users (1 hour before)
 */
export const scheduleAppointmentReminders = async () => {
    try {
        // Cancel all existing reminders
        schedule.gracefulShutdown();

        // Get appointments within the next 24 hours
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const appointments = await Appointment.find({
            date: { $gte: now, $lte: tomorrow },
            status: { $ne: 'cancelled' }
        }).populate('tenant_id').populate('hcm_id');
        // Schedule a reminder for each appointment
        appointments.forEach(appointment => {
            // Create a date 1 hour before the appointment
            const reminderTime = new Date(appointment.date);
            reminderTime.setHours(reminderTime.getHours() - 1);

            // Skip if reminder time is in the past
            if (reminderTime <= now) {
                return;
            }

            // Schedule tenant reminder if tenant exists
            if (appointment.tenant_id) {
                const tenantJob = schedule.scheduleJob(reminderTime, async () => {
                    await createNotification({
                        recipient: appointment.tenant_id._id,
                        type: 'appointment',
                        title: 'Upcoming Appointment Reminder',
                        message: `Your appointment is in 1 hour at ${new Date(appointment.date).toLocaleTimeString()}`,
                        data: {
                            appointmentId: appointment._id,
                            date: appointment.date,
                            hcmName: appointment.hcm_id ? appointment.hcm_id.name : 'Assigned HCM'
                        },
                        forMobile: true,
                        forWeb: false
                    });
                });

            }

            // Schedule HCM reminder if HCM exists
            if (appointment.hcm_id) {
                const hcmJob = schedule.scheduleJob(reminderTime, async () => {
                    await createNotification({
                        recipient: appointment.hcm_id._id,
                        type: 'appointment',
                        title: 'Upcoming Appointment Reminder',
                        message: `Your appointment with ${appointment.tenant_id ? appointment.tenant_id.name : 'a tenant'} is in 1 hour`,
                        data: {
                            appointmentId: appointment._id,
                            date: appointment.date,
                            tenantName: appointment.tenant_id ? appointment.tenant_id.name : 'Assigned Tenant'
                        },
                        forMobile: true,
                        forWeb: false
                    });
                });

            }
        });
    } catch (error) {
        console.error('Error scheduling appointment reminders:', error);
    }
};

/**
 * Schedule daily admin notifications for claims and service completions
 */
export const scheduleDailyAdminNotifications = async () => {
    try {
        // Schedule job to run at 9:00 AM every day
        const dailyJob = schedule.scheduleJob('0 9 * * *', async () => {
            await sendAdminNotifications();
        });
    } catch (error) {
        console.error('Error scheduling daily admin notifications:', error);
    }
};

/**
 * Send notifications to admins about claims and service completions
 */
export const sendAdminNotifications = async () => {
    try {
        // Get all admin users
        const admins = await User.find({ role: 2 });

        // Get claims submitted in the last 24 hours
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const recentClaims = await Bill.find({
            submittedDate: { $gte: yesterday },
            status: 'submitted'
        }).countDocuments();

        // Get services completing in the next 7 days
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);

        const completingServices = await ServiceTracking.find({
            endDate: { $gte: new Date(), $lte: nextWeek },
            status: { $ne: 'completed' }
        }).countDocuments();

        // Send notifications to each admin
        for (const admin of admins) {
            // Claims notification
            if (recentClaims > 0) {
                await createNotification({
                    recipient: admin._id,
                    type: 'claim',
                    title: 'New Claims Submitted',
                    message: `${recentClaims} new claim${recentClaims === 1 ? ' has' : 's have'} been submitted in the last 24 hours.`,
                    data: {
                        count: recentClaims
                    },
                    forWeb: true,
                    forMobile: false
                });
            }

            // Services notification
            if (completingServices > 0) {
                await createNotification({
                    recipient: admin._id,
                    type: 'service',
                    title: 'Services Completing Soon',
                    message: `${completingServices} service${completingServices === 1 ? '' : 's'} will be completed in the next 7 days.`,
                    data: {
                        count: completingServices
                    },
                    forWeb: true,
                    forMobile: false
                });
            }
        }

        // Get all superadmin users and send them notifications too
        const superAdmins = await User.find({ role: 3 });

        for (const superAdmin of superAdmins) {
            // Combined notification for superadmins
            if (recentClaims > 0 || completingServices > 0) {
                await createNotification({
                    recipient: superAdmin._id,
                    type: 'system',
                    title: 'System Status Update',
                    message: `System update: ${recentClaims} new claims and ${completingServices} services completing soon.`,
                    data: {
                        claims: recentClaims,
                        services: completingServices
                    },
                    forWeb: true,
                    forMobile: false
                });
            }
        }
    } catch (error) {
        console.error('Error sending admin notifications:', error);
    }
};

/**
 * Send test notifications to all users for testing purposes
 */
export const sendTestNotifications = async () => {
    try {
        // Get all users
        const users = await User.find({});
        for (const user of users) {
            try {
                // Create a test notification
                const notification = new Notification({
                    recipient: user._id,
                    type: 'test',
                    title: 'Test Notification',
                    message: `This is a test notification for ${user.name} - ${new Date().toLocaleTimeString()}`,
                    data: {
                        testData: 'This is test data',
                        timestamp: new Date()
                    },
                    forWeb: true,
                    forMobile: false
                });

                await notification.save();
                console.log(`Created notification for user ${user.name} (${user._id})`);

                // Emit the notification through socket.io
                io.emit('web_notification', {
                    notification,
                    userId: user._id.toString()
                });
            } catch (error) {
                console.error(`Error sending notification to user ${user.name}:`, error);
            }
        }
        return true;
    } catch (error) {
        console.error('Error sending test notifications:', error);
        throw error;
    }
};

/**
 * Send test notifications to all users for testing purposes by company
 * @param {string} companyId - Company ID
 */
export const sendTestNotificationsByCompany = async (companyId) => {
    try {
        // Fetch users by role and companyId
        const tenants = await User.find({ role: 0, companyId });
        const hcms = await User.find({ role: 1, companyId });
        const admins = await User.find({ role: 2, companyId });

        // Send test notifications to tenants (mobile)
        for (const tenant of tenants) {
            await createNotification({
                recipient: tenant._id,
                type: 'test',
                title: 'Test Notification for Tenant',
                message: `This is a test notification for tenant user ${tenant.name}`,
                data: {
                    testData: 'This is test data for tenant'
                },
                forMobile: true,
                forWeb: false
            });
        }

        // Send test notifications to HCMs (mobile)
        for (const hcm of hcms) {
            await createNotification({
                recipient: hcm._id,
                type: 'test',
                title: 'Test Notification for HCM',
                message: `This is a test notification for HCM user ${hcm.name}`,
                data: {
                    testData: 'This is test data for HCM'
                },
                forMobile: true,
                forWeb: false
            });
        }

        // Send test notifications to admins (web)
        for (const admin of admins) {
            await createNotification({
                recipient: admin._id,
                type: 'test',
                title: 'Test Notification for Admin',
                message: `This is a test notification for admin user ${admin.name}`,
                data: {
                    testData: 'This is test data for admin',
                    claimsCount: 5,
                    servicesCount: 3
                },
                forWeb: true,
                forMobile: false
            });
        }
    } catch (error) {
        console.error('Error sending test notifications by company:', error);
    }
};

// Export scheduling functions
export const initializeNotificationSchedulers = (io) => {
    // Store socket.io instance
    global.io = io;

    // Send test notification every minute
    setInterval(async () => {
        try {
            // Get all users
            const users = await User.find({});

            for (const user of users) {
                // Create a test notification
                const notification = new Notification({
                    userId: user._id,
                    title: 'Test Notification',
                    message: `This is a test notification - ${new Date().toLocaleTimeString()}`,
                    type: 'info',
                    data: {
                        timestamp: new Date()
                    }
                });

                await notification.save();

                // Send notification through socket if user is connected
                const userSockets = connectedClients.get(user._id.toString());
                if (userSockets) {
                    userSockets.forEach(socket => {
                        socket.emit('notification', {
                            title: notification.title,
                            message: notification.message,
                            type: notification.type,
                            data: notification.data
                        });
                    });
                }
            }
        } catch (error) {
            console.error('Error sending test notifications:', error);
        }
    }, 60 * 1000); // Run every minute

    // Check for scheduled notifications
    setInterval(async () => {
        try {
            const now = new Date();
            // Find all notifications scheduled for this hour or before
            const notifications = await Notification.find({
                scheduledFor: { $lte: now },
                isRead: false
            }).populate('userId');

            for (const notification of notifications) {
                // Send notification through socket if user is connected
                const userSockets = connectedClients.get(notification.userId.toString());
                if (userSockets) {
                    userSockets.forEach(socket => {
                        socket.emit('notification', {
                            title: notification.title,
                            message: notification.message,
                            type: notification.type,
                            data: notification.data
                        });
                    });
                }

                // Mark notification as read
                notification.isRead = true;
                await notification.save();
            }
        } catch (error) {
            console.error('Error processing scheduled notifications:', error);
        }
    }, 60 * 1000); // Check every minute
};

// Socket connection handler
export const handleSocketConnection = (socket) => {
    const userId = socket.userId; // Set by auth middleware

    if (!connectedClients.has(userId)) {
        connectedClients.set(userId, new Set());
    }
    connectedClients.get(userId).add(socket);

    // Handle disconnect
    socket.on('disconnect', () => {
        const userSockets = connectedClients.get(userId);
        if (userSockets) {
            userSockets.delete(socket);
            if (userSockets.size === 0) {
                connectedClients.delete(userId);
            }
        }
    });
}; 