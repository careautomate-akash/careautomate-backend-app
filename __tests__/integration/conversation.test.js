import request from 'supertest';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import app from '../setup/testApp.js';
import User from '../../models/account/users.js';
import Conversation from '../../models/communication-documents/Conversation.js';
import Message from '../../models/communication-documents/message.js';
import { setupTestDB, teardownTestDB } from '../setup/testSetup.js';
import { createConversation, sendMessage, getUserConversations, getConversationMessages } from '../../controllers/communication-documents/conversationController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Increase timeout for all tests in this file
const TIMEOUT = 60000; // 60 seconds

// Set up routes for testing
app.post('/conversations', createConversation);
app.post('/messages', sendMessage);
app.get('/conversations/user/:userId', getUserConversations);
app.get('/conversations/:conversationId/messages', getConversationMessages);
// Add other routes as needed

describe('Conversation API Tests', () => {
    let user1Id;
    let user2Id;
    let conversationId;
    let authToken;

    // Set timeout for the test suite
    beforeAll(async () => {
        // Set timeout for Jest in ESM context
        await setupTestDB();
        const user1 = await User.create({
            name: 'Test User 1',
            email: 'test1@example.com',
            password: 'password123'
        });

        const user2 = await User.create({
            name: 'Test User 2',
            email: 'test2@example.com',
            password: 'password123'
        });

        user1Id = user1._id;
        user2Id = user2._id;
    }, TIMEOUT); // Using the timeout constant here

    afterAll(async () => {
        await teardownTestDB();
    }, TIMEOUT); // Using the timeout constant here

    describe('POST /conversations', () => {
        it('should create a new conversation', async () => {
            const response = await request(app)
                .post('/conversations')
                .send({
                    participants: [user1Id, user2Id]
                });

            expect(response.status).toBe(201);
            expect(response.body.success).toBe(true);
            expect(response.body.conversation).toHaveProperty('_id');

            conversationId = response.body.conversation._id;
        });

        it('should not create duplicate conversation', async () => {
            const response = await request(app)
                .post('/conversations')
                .send({
                    participants: [user1Id, user2Id]
                });

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Conversation already exists');
        });
    });

    describe('POST /messages', () => {
        it('should send a message', async () => {
            const response = await request(app)
                .post('/messages')
                .send({
                    sender: user1Id,
                    recipient: user2Id,
                    content: 'Hello, this is a test message'
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toHaveProperty('content');
        });
    });

    describe('GET /conversations/user/:userId', () => {
        it('should get all conversations for a user', async () => {
            const response = await request(app)
                .get(`/conversations/user/${user1Id}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(Array.isArray(response.body.conversations)).toBe(true);
            expect(response.body.conversations.length).toBeGreaterThan(0);
        });
    });

    describe('GET /conversations/:conversationId/messages', () => {
        it('should get messages for a conversation', async () => {
            const response = await request(app)
                .get(`/conversations/${conversationId}/messages`)
                .query({ page: 1, limit: 20 });

            // Log the error response
            if (response.status !== 200) {
            }

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(Array.isArray(response.body.messages)).toBe(true);
        });

        it('should create test messages', async () => {
            // Create a few test messages
            const message1 = new Message({
                sender: user1Id,
                recipient: user2Id,
                content: 'Hello from user 1'
            });

            const message2 = new Message({
                sender: user2Id,
                recipient: user1Id,
                content: 'Hello from user 2'
            });

            await message1.save();
            await message2.save();

            expect(message1).toHaveProperty('_id');
            expect(message2).toHaveProperty('_id');
        });
    });
}); 