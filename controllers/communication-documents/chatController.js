
import { Server } from 'socket.io';
import Conversation from '../../models/communication-documents/Conversation.js';
import { setupConversationSockets } from './conversationController.js';
import {
    fetchUserConversations,
    fetchConversationMessages,
    saveAndEmitMessage,
    markMessagesAsRead,
    sendUserConversationsToSocket
} from './messageController.js';

const connectedUsers = new Map();

export const setupChat = (server) => {
    const io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        socket.on('register', async (userId) => {
            if (userId) {
                connectedUsers.set(userId, socket.id);
                socket.join(userId);
                socket.userId = userId;

                io.emit('user_status', {
                    userId: userId,
                    status: 'online'
                });

                await sendUserConversationsToSocket(userId);
            }
        });

        socket.on('fetch_conversations', async (userId) => {
            await sendUserConversationsToSocket(userId);
        });

        socket.on('chat_message', async (messageData) => {
            try {
                const { sender, recipient, content, attachments = [] } = messageData;

                if (!sender || !recipient || !content) {
                    socket.emit('error', { message: 'Invalid message data' });
                    return;
                }

                await saveAndEmitMessage(sender, recipient, content, attachments);
            } catch (error) {
                console.error('Error sending message:', error);
                socket.emit('error', { message: 'Error sending message' });
            }
        });

        socket.on('fetch_messages', async ({ conversationId, userId }) => {
            try {
                const messages = await fetchConversationMessages(conversationId);

                socket.emit('messages_loaded', {
                    conversationId,
                    messages
                });
            } catch (error) {
                console.error('Error fetching messages:', error);
                socket.emit('error', { message: 'Error fetching messages' });
            }
        });

        socket.on('typing', ({ sender, recipient }) => {
            if (connectedUsers.has(recipient)) {
                const recipientSocketId = connectedUsers.get(recipient);
                io.to(recipientSocketId).emit('user_typing', { sender });
            }
        });

        socket.on('read_messages', async ({ userId, conversationId }) => {
            try {
                const conversation = await Conversation.findById(conversationId);
                if (conversation) {
                    const otherParticipant = conversation.participants.find(
                        p => p.toString() !== userId
                    );

                    if (otherParticipant) {
                        await markMessagesAsRead(otherParticipant.toString(), userId, conversationId);
                    }
                }
            } catch (error) {
                console.error('Error marking messages as read:', error);
                socket.emit('error', { message: 'Error marking messages as read' });
            }
        });

        socket.on('disconnect', () => {
            if (socket.userId) {
                connectedUsers.delete(socket.userId);
                io.emit('user_status', {
                    userId: socket.userId,
                    status: 'offline'
                });
            }
        });

        // Set up conversation-specific socket handlers
        setupConversationSockets(socket);
    });

    return io;
};

async function sendUserConversations(socket, userId) {
    try {
        const conversations = await Conversation.find({ participants: userId })
            .populate('participants', 'name email profileImageUrl')
            .populate('lastMessage')
            .sort({ updatedAt: -1 });

        socket.emit('conversations_loaded', { conversations });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        socket.emit('error', { message: 'Error fetching conversations' });
    }
}