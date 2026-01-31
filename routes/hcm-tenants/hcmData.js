import mongoose from 'mongoose';
import users from '../../models/account/users.js';

const hcmData = [
    {
        name: 'Dr. Smith',
        role: 'hcm',
        email: 'dr.smith@example.com',
        password: 'password123',
        phoneNo: '123-456-7890',
        photoUrl: 'https://example.com/photos/dr-smith.jpg',
    },
    {
        name: 'Dr. Brown',
        role: 'hcm',
        email: 'dr.brown@example.com',
        password: 'password123',
        phoneNo: '987-654-3210',
        photoUrl: 'https://example.com/photos/dr-brown.jpg',
    },
    {
        name: 'Dr. Green',
        role: 'hcm',
        email: 'dr.green@example.com',
        password: 'password123',
        phoneNo: '555-666-7777',
        photoUrl: 'https://example.com/photos/dr-green.jpg',
    },
];

const insertHCMData = async () => {
    try {
        await users.insertMany(hcmData);
    } catch (error) {
        console.error("Error inserting HCM data:", error);
    }
};

export default insertHCMData;
