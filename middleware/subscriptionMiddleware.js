import { checkSubscriptionStatus } from '../services/subscriptionService.js';

/**
 * Middleware to check if user's subscription/trial is valid
 * Use this middleware on routes that require active subscription
 */
export const checkSubscription = async (req, res, next) => {
    try {
        const userId = req.user._id;

        const statusCheck = await checkSubscriptionStatus(userId);

        if (!statusCheck.isValid) {
            return res.status(403).json({
                success: false,
                message: 'Access denied',
                reason: statusCheck.reason,
                subscriptionStatus: statusCheck.status,
                expired: statusCheck.expired || false,
            });
        }

        // Attach subscription info to request for use in routes
        req.subscription = statusCheck;
        next();
    } catch (error) {
        console.error('Subscription check error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error checking subscription status',
            error: error.message,
        });
    }
};

/**
 * Middleware to check subscription and warn if trial is ending soon
 * More lenient - allows access but warns user
 */
export const checkSubscriptionWithWarning = async (req, res, next) => {
    try {
        const userId = req.user._id;

        const statusCheck = await checkSubscriptionStatus(userId);

        // Attach subscription info to request
        req.subscription = statusCheck;

        // If trial and less than 3 days remaining, add warning
        if (
            statusCheck.isValid &&
            statusCheck.status === 'trial' &&
            statusCheck.daysRemaining <= 3
        ) {
            req.subscription.warning = `Your trial expires in ${statusCheck.daysRemaining} day(s)`;
        }

        // If not valid, block access
        if (!statusCheck.isValid) {
            return res.status(403).json({
                success: false,
                message: 'Access denied',
                reason: statusCheck.reason,
                subscriptionStatus: statusCheck.status,
                expired: statusCheck.expired || false,
            });
        }

        next();
    } catch (error) {
        console.error('Subscription check error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error checking subscription status',
            error: error.message,
        });
    }
};

export default checkSubscription;
