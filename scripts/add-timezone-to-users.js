import mongoose from 'mongoose';
import dotenv from 'dotenv';
import users from '../models/account/users.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

// Function to update all users with timezone information
const updateUsers = async () => {
    try {
        // Default timezone values
        const defaultTimezone = 'America/New_York';
        const defaultTimezoneOffset = -240; // -4 hours in minutes

        // Find all users without timezone information
        const usersToUpdate = await users.find({
            $or: [
                { timezone: { $exists: false } },
                { timezoneOffset: { $exists: false } }
            ]
        });
        // Update each user
        let updatedCount = 0;
        for (const user of usersToUpdate) {
            user.timezone = defaultTimezone;
            user.timezoneOffset = defaultTimezoneOffset;
            await user.save();
            updatedCount++;

            if (updatedCount % 100 === 0) {
            }
        }
        // Disconnect from MongoDB
        mongoose.disconnect();
    } catch (error) {
        console.error('Error updating users:', error);
        mongoose.disconnect();
    }
};

// Run the update function
updateUsers(); 