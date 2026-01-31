import users from '../models/account/users.js';

const TRIAL_PERIOD_DAYS = 14;

/**
 * Initialize trial period for new user
 * @param {String} userId - User ID
 * @returns {Object} Updated user
 */
export const initializeTrialPeriod = async (userId) => {
    try {
        const user = await users.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const trialStartDate = new Date();
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + TRIAL_PERIOD_DAYS);

        user.subscription_status = 'trial';
        user.trial_start_date = trialStartDate;
        user.trial_end_date = trialEndDate;
        user.is_active = true;

        await user.save();

        return {
            success: true,
            message: 'Trial period initialized successfully',
            trialEndDate,
        };
    } catch (error) {
        console.error('Error initializing trial period:', error);
        throw error;
    }
};

/**
 * Check if user's trial/subscription is valid
 * @param {String} userId - User ID
 * @returns {Object} Validity status
 */
export const checkSubscriptionStatus = async (userId) => {
    try {
        const user = await users.findById(userId);
        if (!user) {
            return { isValid: false, reason: 'User not found' };
        }

        // BACKWARD COMPATIBILITY: If user doesn't have subscription fields set,
        // treat them as subscribed (for existing users before migration)
        if (!user.subscription_status || user.is_active === undefined) {
            return {
                isValid: true,
                status: 'subscribed',
                legacy: true, // Flag to indicate this is a legacy user
            };
        }

        // Check if account is deactivated
        if (user.is_active === false) {
            return {
                isValid: false,
                reason: 'Account is deactivated',
                status: user.subscription_status,
            };
        }

        const now = new Date();

        // Check trial status
        if (user.subscription_status === 'trial') {
            if (user.trial_end_date && now > user.trial_end_date) {
                return {
                    isValid: false,
                    reason: 'Trial period expired',
                    status: 'trial',
                    expired: true,
                };
            }
            return {
                isValid: true,
                status: 'trial',
                daysRemaining: Math.ceil(
                    (user.trial_end_date - now) / (1000 * 60 * 60 * 24)
                ),
            };
        }

        // Check subscribed status
        if (user.subscription_status === 'subscribed') {
            if (user.subscription_end_date && now > user.subscription_end_date) {
                return {
                    isValid: false,
                    reason: 'Subscription expired',
                    status: 'subscribed',
                    expired: true,
                };
            }
            return {
                isValid: true,
                status: 'subscribed',
            };
        }

        // Cancelled or expired status
        if (
            user.subscription_status === 'cancelled' ||
            user.subscription_status === 'expired'
        ) {
            return {
                isValid: false,
                reason: 'Subscription cancelled or expired',
                status: user.subscription_status,
            };
        }

        return { isValid: false, reason: 'Invalid subscription status' };
    } catch (error) {
        console.error('Error checking subscription status:', error);
        throw error;
    }
};

/**
 * Activate subscription for user
 * @param {String} userId - User ID
 * @param {Number} durationMonths - Subscription duration in months
 * @returns {Object} Updated user
 */
export const activateSubscription = async (userId, durationMonths = 1) => {
    try {
        const user = await users.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const subscriptionStartDate = new Date();
        const subscriptionEndDate = new Date();
        subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + durationMonths);

        user.subscription_status = 'subscribed';
        user.subscription_start_date = subscriptionStartDate;
        user.subscription_end_date = subscriptionEndDate;
        user.is_active = true;
        user.deactivation_date = null;
        user.deactivation_reason = null;

        await user.save();

        return {
            success: true,
            message: 'Subscription activated successfully',
            subscriptionEndDate,
        };
    } catch (error) {
        console.error('Error activating subscription:', error);
        throw error;
    }
};

/**
 * Cancel subscription for user
 * @param {String} userId - User ID
 * @param {String} reason - Cancellation reason
 * @returns {Object} Updated user
 */
export const cancelSubscription = async (userId, reason = null) => {
    try {
        const user = await users.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        user.subscription_status = 'cancelled';
        user.is_active = false;
        user.deactivation_date = new Date();
        user.deactivation_reason = reason || 'User cancelled subscription';

        await user.save();

        return {
            success: true,
            message: 'Subscription cancelled successfully',
        };
    } catch (error) {
        console.error('Error cancelling subscription:', error);
        throw error;
    }
};

/**
 * Deactivate account (for expired trials)
 * @param {String} userId - User ID
 * @param {String} reason - Deactivation reason
 * @returns {Object} Result
 */
export const deactivateAccount = async (userId, reason) => {
    try {
        const user = await users.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        user.subscription_status = 'expired';
        user.is_active = false;
        user.deactivation_date = new Date();
        user.deactivation_reason = reason;

        await user.save();

        return {
            success: true,
            message: 'Account deactivated successfully',
        };
    } catch (error) {
        console.error('Error deactivating account:', error);
        throw error;
    }
};

/**
 * Reactivate account
 * @param {String} userId - User ID
 * @returns {Object} Result
 */
export const reactivateAccount = async (userId) => {
    try {
        const user = await users.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Reactivate as trial for 14 days
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + TRIAL_PERIOD_DAYS);

        user.subscription_status = 'trial';
        user.trial_start_date = new Date();
        user.trial_end_date = trialEndDate;
        user.is_active = true;
        user.deactivation_date = null;
        user.deactivation_reason = null;

        await user.save();

        return {
            success: true,
            message: 'Account reactivated with trial period',
            trialEndDate,
        };
    } catch (error) {
        console.error('Error reactivating account:', error);
        throw error;
    }
};

/**
 * Check and deactivate expired trial accounts
 * This function should be called by a scheduled job
 * @returns {Object} Result with count of deactivated accounts
 */
export const checkAndDeactivateExpiredTrials = async () => {
    try {
        const now = new Date();

        // Find all users with expired trials
        const expiredTrialUsers = await users.find({
            subscription_status: 'trial',
            trial_end_date: { $lt: now },
            is_active: true,
        });

        let deactivatedCount = 0;

        for (const user of expiredTrialUsers) {
            await deactivateAccount(
                user._id,
                'Trial period expired without subscription'
            );
            deactivatedCount++;
            console.log(`Deactivated trial account for user: ${user.email}`);
        }

        return {
            success: true,
            message: `Deactivated ${deactivatedCount} expired trial accounts`,
            count: deactivatedCount,
        };
    } catch (error) {
        console.error('Error checking expired trials:', error);
        throw error;
    }
};

/**
 * Get subscription details for user
 * @param {String} userId - User ID
 * @returns {Object} Subscription details
 */
export const getSubscriptionDetails = async (userId) => {
    try {
        const user = await users.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const validityCheck = await checkSubscriptionStatus(userId);

        return {
            success: true,
            subscription: {
                status: user.subscription_status,
                isActive: user.is_active,
                trialStartDate: user.trial_start_date,
                trialEndDate: user.trial_end_date,
                subscriptionStartDate: user.subscription_start_date,
                subscriptionEndDate: user.subscription_end_date,
                deactivationDate: user.deactivation_date,
                deactivationReason: user.deactivation_reason,
                ...validityCheck,
            },
        };
    } catch (error) {
        console.error('Error getting subscription details:', error);
        throw error;
    }
};
