import Message from '../models/communication-documents/message.js';
import Conversation from '../models/communication-documents/Conversation.js';
import {
    fetchUserConversations,
    fetchConversationMessages,
    saveAndEmitMessage,
    markMessagesAsRead
} from '../controllers/communication-documents/messageController.js';
import { setupConversationSockets } from '../controllers/communication-documents/conversationController.js';
import { viewDocument, downloadDocument, serveDocument, downloadDocumentDirect } from '../controllers/communication-documents/documentController.js';
import { getUserNotifications, markAsRead, markAllAsRead } from '../controllers/communication-documents/notificationController.js';

// Map to track connected users - key: userId, value: socketId
const connectedUsers = new Map();

export const setupSocketEvents = (io) => {
    io.on('connection', async (socket) => {

        try {
            // Socket already has userId from JWT auth middleware
            if (socket.userId) {
                // Register user with their socket
                registerUser(socket);

                // Send initial data to user
                await sendUserConversations(socket);
                await sendUserNotifications(socket);
            }
        } catch (error) {
            console.error('Error during socket initialization:', error);
        }

        // Register the user
        socket.on('register', async (userId) => {
            try {
                // Use userId from token if not provided explicitly
                const authenticatedUserId = userId || socket.userId;

                if (authenticatedUserId) {
                    socket.userId = authenticatedUserId;
                    registerUser(socket);

                    await sendUserConversations(socket);
                } else {
                    socket.emit('error', { message: 'User not authenticated' });
                }
            } catch (error) {
                console.error('Error in register event:', error);
                socket.emit('error', { message: 'Error registering user' });
            }
        });

        // Fetch conversations for user
        socket.on('fetch_conversations', async () => {
            try {
                if (!socket.userId) {
                    socket.emit('error', { message: 'User not authenticated' });
                    return;
                }

                await sendUserConversations(socket);
            } catch (error) {
                console.error('Error fetching conversations:', error);
                socket.emit('error', { message: 'Error fetching conversations' });
            }
        });

        // Fetch messages for a conversation
        socket.on('fetch_messages', async ({ conversationId, page = 1, limit = 20 }) => {
            try {
                if (!socket.userId) {
                    socket.emit('error', { message: 'User not authenticated' });
                    return;
                }

                const conversation = await Conversation.findById(conversationId);
                if (!conversation) {
                    socket.emit('error', { message: 'Conversation not found' });
                    return;
                }

                // Check if user is part of the conversation
                if (!conversation.participants.some(p => p.toString() === socket.userId)) {
                    socket.emit('error', { message: 'Access denied to this conversation' });
                    return;
                }

                const messages = await fetchConversationMessages(conversationId, page, limit);

                socket.emit('messages_loaded', {
                    conversationId,
                    messages
                });
            } catch (error) {
                console.error('Error fetching messages:', error);
                socket.emit('error', { message: 'Error fetching messages' });
            }
        });

        // Send a chat message
        socket.on('chat_message', async ({ recipient, content, attachments = [] }) => {
            try {
                if (!socket.userId) {
                    socket.emit('error', { message: 'User not authenticated' });
                    return;
                }

                if (!recipient || !content) {
                    socket.emit('error', { message: 'Invalid message data' });
                    return;
                }

                const messageData = await saveAndEmitMessage(socket.userId, recipient, content, attachments);

                // Let sender know message was sent successfully
                socket.emit('message_sent', messageData);

                // Deliver to recipient if they're online
                deliverToUser(recipient, 'new_message', messageData);

                // Update conversations for both users
                await sendUserConversationsToAll([socket.userId, recipient]);
            } catch (error) {
                console.error('Error sending message:', error);
                socket.emit('error', { message: 'Error sending message' });
            }
        });

        // Send typing indicator
        socket.on('typing', ({ recipient }) => {
            try {
                if (!socket.userId || !recipient) return;

                deliverToUser(recipient, 'user_typing', {
                    sender: socket.userId,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error('Error sending typing indicator:', error);
            }
        });

        // Mark messages as read
        socket.on('read_messages', async ({ conversationId }) => {
            try {
                if (!socket.userId) {
                    socket.emit('error', { message: 'User not authenticated' });
                    return;
                }

                const conversation = await Conversation.findById(conversationId);
                if (!conversation) {
                    socket.emit('error', { message: 'Conversation not found' });
                    return;
                }

                // Find the other participant
                const otherParticipant = conversation.participants.find(
                    p => p.toString() !== socket.userId
                );

                if (otherParticipant) {
                    await markMessagesAsRead(otherParticipant.toString(), socket.userId, conversationId);

                    // Notify other user that messages were read
                    deliverToUser(otherParticipant.toString(), 'messages_read', {
                        conversationId,
                        readBy: socket.userId
                    });

                    // Update conversations for both users
                    await sendUserConversationsToAll([socket.userId, otherParticipant.toString()]);
                }
            } catch (error) {
                console.error('Error marking messages as read:', error);
                socket.emit('error', { message: 'Error marking messages as read' });
            }
        });

        // Set up conversation-specific socket handlers
        setupConversationSockets(socket);

        // Handle disconnect
        socket.on('disconnect', () => {
            if (socket.userId) {
                connectedUsers.delete(socket.userId);

                // Notify other users that this user went offline
                io.emit('user_status', {
                    userId: socket.userId,
                    status: 'offline',
                    timestamp: Date.now()
                });

            }
        });

        // Document handling
        socket.on('view_document', async (data) => {
            try {
                const { documentId } = data;
                if (!documentId) {
                    socket.emit('document_error', {
                        message: 'Document ID is required',
                        error: 'MISSING_DOCUMENT_ID'
                    });
                    return;
                }

                // Get user ID from socket authentication
                const userId = socket.user?._id || socket.user?.id;
                if (!userId) {
                    socket.emit('document_error', {
                        message: 'Authentication required',
                        error: 'AUTH_REQUIRED'
                    });
                    return;
                }

                // Create a mock response object to capture the response
                const res = {
                    status: (code) => ({
                        json: (data) => {
                            if (code >= 200 && code < 300) {
                                // Success response
                                socket.emit('document_ready', {
                                    ...data,
                                    documentId,
                                    type: 'view'
                                });
                            } else {
                                // Error response
                                socket.emit('document_error', {
                                    ...data,
                                    documentId,
                                    statusCode: code
                                });
                            }
                            return res;
                        }
                    })
                };

                // Create a mock request object
                const req = {
                    params: { id: documentId },
                    user: { _id: userId }
                };

                // Call the document controller function
                await viewDocument(req, res);
            } catch (error) {
                console.error('Socket error in view_document:', error);
                socket.emit('document_error', {
                    message: 'Failed to view document',
                    error: error.message
                });
            }
        });

        socket.on('download_document', async (data) => {
            try {
                const { documentId } = data;
                if (!documentId) {
                    socket.emit('document_error', {
                        message: 'Document ID is required',
                        error: 'MISSING_DOCUMENT_ID'
                    });
                    return;
                }

                // Get user ID from socket authentication
                const userId = socket.user?._id || socket.user?.id;
                if (!userId) {
                    socket.emit('document_error', {
                        message: 'Authentication required',
                        error: 'AUTH_REQUIRED'
                    });
                    return;
                }

                // Create a mock response object to capture the response
                const res = {
                    status: (code) => ({
                        json: (data) => {
                            if (code >= 200 && code < 300) {
                                // Success response
                                socket.emit('document_ready', {
                                    ...data,
                                    documentId,
                                    type: 'download'
                                });
                            } else {
                                // Error response
                                socket.emit('document_error', {
                                    ...data,
                                    documentId,
                                    statusCode: code
                                });
                            }
                            return res;
                        }
                    })
                };

                // Create a mock request object
                const req = {
                    params: { id: documentId },
                    user: { _id: userId }
                };

                // Call the document controller function
                await downloadDocument(req, res);
            } catch (error) {
                console.error('Socket error in download_document:', error);
                socket.emit('document_error', {
                    message: 'Failed to download document',
                    error: error.message
                });
            }
        });

        // Notification handling
        socket.on('fetch_notifications', async () => {
            try {
                if (!socket.userId) {
                    socket.emit('error', { message: 'User not authenticated' });
                    return;
                }

                await sendUserNotifications(socket);
            } catch (error) {
                console.error('Error fetching notifications:', error);
                socket.emit('error', { message: 'Error fetching notifications' });
            }
        });

        socket.on('mark_notification_read', async ({ notificationId }) => {
            try {
                if (!socket.userId) {
                    socket.emit('error', { message: 'User not authenticated' });
                    return;
                }

                // Create mock request and response objects
                const req = {
                    params: { notificationId },
                    user: { id: socket.userId }
                };

                const res = {
                    status: (code) => ({
                        json: (data) => {
                            if (code >= 200 && code < 300) {
                                socket.emit('notification_marked_read', { notificationId });
                            } else {
                                socket.emit('error', { message: 'Error marking notification as read' });
                            }
                            return res;
                        }
                    })
                };

                await markAsRead(req, res);
            } catch (error) {
                console.error('Error marking notification as read:', error);
                socket.emit('error', { message: 'Error marking notification as read' });
            }
        });

        socket.on('mark_all_notifications_read', async () => {
            try {
                if (!socket.userId) {
                    socket.emit('error', { message: 'User not authenticated' });
                    return;
                }

                // Create mock request and response objects
                const req = {
                    user: { id: socket.userId }
                };

                const res = {
                    status: (code) => ({
                        json: (data) => {
                            if (code >= 200 && code < 300) {
                                socket.emit('all_notifications_marked_read');
                            } else {
                                socket.emit('error', { message: 'Error marking all notifications as read' });
                            }
                            return res;
                        }
                    })
                };

                await markAllAsRead(req, res);
            } catch (error) {
                console.error('Error marking all notifications as read:', error);
                socket.emit('error', { message: 'Error marking all notifications as read' });
            }
        });
    });

    // Helper functions
    function registerUser(socket) {
        const userId = socket.userId;

        // Add to connected users map
        connectedUsers.set(userId, socket.id);
        socket.join(userId); // Join a room with their user ID


        // Broadcast user online status to all connected clients
        io.emit('user_status', {
            userId: userId,
            status: 'online',
            timestamp: Date.now()
        });
    }

    async function sendUserConversations(socket) {
        try {
            const conversations = await fetchUserConversations(socket.userId);
            socket.emit('conversations_loaded', { conversations });
        } catch (error) {
            console.error('Error sending user conversations:', error);
            socket.emit('error', { message: 'Error loading conversations' });
        }
    }

    async function sendUserConversationsToAll(userIds) {
        for (const userId of userIds) {
            const socketId = connectedUsers.get(userId);
            if (socketId) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    await sendUserConversations(socket);
                }
            }
        }
    }

    function deliverToUser(userId, event, data) {
        const socketId = connectedUsers.get(userId);
        if (socketId) {
            io.to(socketId).emit(event, data);
        }
    }

    async function sendUserNotifications(socket) {
        try {
            if (!socket.userId) return;

            // Create a mock request object for the controller
            const req = {
                user: { id: socket.userId },
                query: {},
                headers: {}  // Add empty headers object
            };

            // Create a mock response object to capture the response
            const res = {
                status: (code) => ({
                    json: (data) => {
                        if (code >= 200 && code < 300) {
                            socket.emit('notifications_loaded', data);
                        } else {
                            socket.emit('error', { message: 'Failed to load notifications' });
                        }
                        return res;
                    }
                })
            };

            // Call the controller function
            await getUserNotifications(req, res);
        } catch (error) {
            console.error('Error sending user notifications:', error);
            socket.emit('error', { message: 'Error loading notifications' });
        }
    }
}; 