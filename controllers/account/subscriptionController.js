import {
    getSubscriptionDetails,
    activateSubscription,
    cancelSubscription,
    reactivateAccount,
    checkSubscriptionStatus,
} from '../../services/subscriptionService.js';

/**
 * Get subscription status for current user
 */
export const getSubscriptionStatus = async (req, res) => {
    try {
        const userId = req.user._id;

        const result = await getSubscriptionDetails(userId);

        return res.status(200).json(result);
    } catch (error) {
        console.error('Error getting subscription status:', error);
        return res.status(500).json({
            success: false,
            message: 'Error retrieving subscription details',
            error: error.message,
        });
    }
};


/**
 * Activate subscription for user
 */
export const subscribe = async (req, res) => {
    try {
        const userId = req.user._id;
        const { durationMonths = 1 } = req.body;

        // Validate duration
        if (durationMonths < 1 || durationMonths > 12) {
            return res.status(400).json({
                success: false,
                message: 'Duration must be between 1 and 12 months',
            });
        }

        const result = await activateSubscription(userId, durationMonths);

        return res.status(200).json(result);
    } catch (error) {
        console.error('Error activating subscription:', error);
        return res.status(500).json({
            success: false,
            message: 'Error activating subscription',
            error: error.message,
        });
    }
};

/**
 * Cancel subscription for user
 */
export const cancelSubscriptionController = async (req, res) => {
    try {
        const userId = req.user._id;
        const { reason } = req.body;

        const result = await cancelSubscription(userId, reason);

        return res.status(200).json(result);
    } catch (error) {
        console.error('Error cancelling subscription:', error);
        return res.status(500).json({
            success: false,
            message: 'Error cancelling subscription',
            error: error.message,
        });
    }
};

/**
 * Reactivate account
 */
export const reactivateAccountController = async (req, res) => {
    try {
        const userId = req.user._id;

        const result = await reactivateAccount(userId);

        return res.status(200).json(result);
    } catch (error) {
        console.error('Error reactivating account:', error);
        return res.status(500).json({
            success: false,
            message: 'Error reactivating account',
            error: error.message,
        });
    }
};

/**
 * Check if subscription is valid (for frontend to quickly verify)
 */
export const checkSubscription = async (req, res) => {
    try {
        const userId = req.user._id;

        const result = await checkSubscriptionStatus(userId);

        return res.status(200).json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error('Error checking subscription:', error);
        return res.status(500).json({
            success: false,
            message: 'Error checking subscription',
            error: error.message,
        });
    }
};

/**
 * Admin: Get subscription details for any user
 */
export const getSubscriptionDetailsAdmin = async (req, res) => {
    try {
        const { userId } = req.params;

        // Check if requesting user is admin
        if (req.user.role !== 2 && req.user.role !== 3) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin privileges required.',
            });
        }

        const result = await getSubscriptionDetails(userId);

        return res.status(200).json(result);
    } catch (error) {
        console.error('Error getting subscription details:', error);
        return res.status(500).json({
            success: false,
            message: 'Error retrieving subscription details',
            error: error.message,
        });
    }
};

/**
 * Admin: Activate subscription for any user
 */
export const activateSubscriptionAdmin = async (req, res) => {
    try {
        const { userId } = req.params;
        const { durationMonths = 1 } = req.body;

        // Check if requesting user is admin
        if (req.user.role !== 2 && req.user.role !== 3) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin privileges required.',
            });
        }

        // Validate duration
        if (durationMonths < 1 || durationMonths > 12) {
            return res.status(400).json({
                success: false,
                message: 'Duration must be between 1 and 12 months',
            });
        }

        const result = await activateSubscription(userId, durationMonths);

        return res.status(200).json(result);
    } catch (error) {
        console.error('Error activating subscription:', error);
        return res.status(500).json({
            success: false,
            message: 'Error activating subscription',
            error: error.message,
        });
    }
};
