import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
    path: path.join(__dirname, '../../.env.test')
});

// Set a default timeout for Mongoose operations
mongoose.set('bufferTimeoutMS', 30000);

export const setupTestDB = async () => {
    try {
        // Set connection options with a reasonable timeout
        const options = {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 10000
        };

        const uri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/ca-testing';
        await mongoose.connect(uri, options);
    } catch (error) {
        console.error('MongoDB connection error:', error);
        // Throw the error to fail the test explicitly instead of proceeding with a failed connection
        throw error;
    }
};

export const teardownTestDB = async () => {
    try {
        if (mongoose.connection.readyState !== 0) {
            // Clean up collections if needed
            const collections = mongoose.connection.collections;
            for (const key in collections) {
                await collections[key].deleteMany({});
            }

            await mongoose.connection.dropDatabase();
            await mongoose.connection.close();
        }
    } catch (error) {
        console.error('Error cleaning up test database:', error);
    }
}; 