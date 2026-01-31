import users from './models/account/users.js';
import connectDB from './config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Migration script to add subscription fields to existing users
 * Run this once to migrate existing users in the database
 * 
 * Usage: node scripts/migrateSubscriptionFields.js
 */

const migrateExistingUsers = async () => {
    try {
        await connectDB();
        console.log('🔄 Starting subscription fields migration...');

        // Get all users
        const allUsers = await users.find({});
        console.log(`📊 Found ${allUsers.length} users to migrate`);

        let migratedCount = 0;
        let skippedCount = 0;

        for (const user of allUsers) {
            // Skip if user already has subscription_status set
            if (user.subscription_status) {
                console.log(`⏭️  Skipping user ${user.email} - already has subscription status`);
                skippedCount++;
                continue;
            }

            // Set all existing users to subscribed status with 1 year validity
            user.subscription_status = 'subscribed';
            user.is_active = true;
            user.subscription_start_date = user.dateCreated || new Date();

            // Set subscription end date to 1 year from now
            const endDate = new Date();
            endDate.setFullYear(endDate.getFullYear() + 1);
            user.subscription_end_date = endDate;

            await user.save();
            migratedCount++;
            console.log(`✅ Migrated user: ${user.email}`);
        }

        console.log('\n📈 Migration Summary:');
        console.log(`   Total users: ${allUsers.length}`);
        console.log(`   Migrated: ${migratedCount}`);
        console.log(`   Skipped: ${skippedCount}`);
        console.log('✅ Migration completed successfully!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
};



// Run the migration
// Change this to migrateExistingUsersToTrial() if you want existing users to have trial
migrateExistingUsers();
