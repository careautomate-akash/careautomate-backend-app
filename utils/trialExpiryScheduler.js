import cron from 'node-cron';
import { checkAndDeactivateExpiredTrials } from '../services/subscriptionService.js';

/**
 * Schedule trial expiry checker
 * Runs every day at 2 AM to check and deactivate expired trial accounts
 */
export const scheduleTrialExpiryChecker = () => {
    // Run every day at 2:00 AM
    cron.schedule('0 2 * * *', async () => {
        console.log('🔍 Running trial expiry checker...');
        try {
            const result = await checkAndDeactivateExpiredTrials();
            console.log(`✅ ${result.message}`);
        } catch (error) {
            console.error('❌ Error in trial expiry checker:', error);
        }
    });

    console.log('✅ Trial expiry checker scheduled (runs daily at 2:00 AM)');
};
console.log('✅ Trial expiry scheduler module loaded');

/**
 * Run trial expiry check immediately (for testing)
 */
export const runTrialExpiryCheckNow = async () => {
    console.log('🔍 Running trial expiry checker immediately...');
    try {
        const result = await checkAndDeactivateExpiredTrials();
        console.log(`✅ ${result.message}`);
        return result;
    } catch (error) {
        console.error('❌ Error in trial expiry checker:', error);
        throw error;
    }
};
