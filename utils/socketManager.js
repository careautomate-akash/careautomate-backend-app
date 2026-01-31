// src/utils/socketManager.js
import { io } from 'socket.io-client';

class SocketManager {
    constructor() {
        this.socket = null;
        this.messageCallbacks = [];
        this.conversationCallbacks = [];
        this.typingCallbacks = [];
        this.readCallbacks = [];
        this.statusCallbacks = [];
        this.errorCallbacks = [];
    }

    initialize() {
        if (this.socket) return;

        try {
            const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:9003';
            const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:9004';

            const currentOrigin = window.location.origin;
            const token = localStorage.getItem('token');
            if (!token) {
                console.error('No authentication token found in localStorage');
            } else {
                console.log('Token prefix:', token.substring(0, 15) + '...');
            }

            // Get userId from localStorage
            const userId = localStorage.getItem('userId');
            if (!userId) {
                console.error('No userId found in localStorage');
            } else {
            }

            this.socket = io(SOCKET_URL, {
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                timeout: 20000,
                autoConnect: true,
                transports: ['websocket', 'polling'],
                path: '/socket.io',
                withCredentials: true,
                auth: {
                    token: token,
                    userId: userId
                },
                extraHeaders: {
                    Authorization: `Bearer ${token}`
                },
            });

            this.socket.on('connect_error', (error) => {
                console.error('SOCKET CONNECT ERROR', {
                    message: error.message,
                    type: error.type,
                    description: error.description
                });
                const refreshedToken = localStorage.getItem('token');
                const userId = localStorage.getItem('userId');

                setTimeout(() => {
                    this.socket.auth = {
                        token: refreshedToken,
                        userId: userId
                    };
                    this.socket.io.opts.extraHeaders = {
                        Authorization: `Bearer ${refreshedToken}`
                    };
                    this.socket.connect();
                }, 5000);
            });

            this.socket.on('connect', () => {
                const userId = localStorage.getItem('userId');
                if (userId && userId !== 'true' && userId !== 'undefined') {
                    this.socket.emit('register', userId);
                } else {
                    console.warn('No valid userId found in localStorage, skipping registration');
                }
            });

            this.socket.on('disconnect', (reason) => {
            });

            this.socket.on('error', (error) => {
                console.error('Socket error:', error);
                this.errorCallbacks.forEach(callback => callback(error));
            });

            this.socket.on('new_message', (messageData) => {
                this.messageCallbacks.forEach(callback => callback(messageData));
            });

            this.socket.on('message_sent', (messageData) => {
                this.messageCallbacks.forEach(callback => callback(messageData));
            });

            this.socket.on('conversations_loaded', (data) => {
                this.conversationCallbacks.forEach(callback => callback(data.conversations));
            });

            // Listen for messages loaded
            this.socket.on('messages_loaded', (data) => {
                this.messageCallbacks.forEach(callback => callback(data));
            });

            this.socket.on('user_typing', (data) => {
                this.typingCallbacks.forEach(callback => callback(data));
            });

            this.socket.on('messages_read', (data) => {
                this.readCallbacks.forEach(callback => callback(data));
            });

            this.socket.on('user_status', (data) => {
                this.statusCallbacks.forEach(callback => callback(data));
            });

            return this.socket;
        } catch (err) {
            console.error('Error initializing socket:', err);
            return null;
        }
    }

    onMessage(callback) {
        this.messageCallbacks.push(callback);
    }

    onConversationsLoaded(callback) {
        this.conversationCallbacks.push(callback);
    }

    onTyping(callback) {
        this.typingCallbacks.push(callback);
    }

    onMessagesRead(callback) {
        this.readCallbacks.push(callback);
    }

    onUserStatus(callback) {
        this.statusCallbacks.push(callback);
    }

    onError(callback) {
        this.errorCallbacks.push(callback);
    }

    // Basic socket methods
    on(event, callback) {
        if (!this.socket) this.initialize();
        this.socket.on(event, callback);
    }

    off(event, callback) {
        if (!this.socket) return;
        this.socket.off(event, callback);
    }

    emit(event, data) {
        if (!this.socket) this.initialize();
        if (!this.socket.connected) {
            console.warn(`Socket not connected. Operation '${event}' queued.`);
        }
        this.socket.emit(event, data);
    }

    // Chat specific methods
    getConversations() {
        if (!this.socket) this.initialize();
        this.emit('fetch_conversations');
    }

    getMessages(conversationId) {
        if (!conversationId) return;
        this.emit('fetch_messages', { conversationId });
    }

    sendMessage(recipientId, content, attachments = []) {
        if (!recipientId || !content) {
            console.error('Missing required fields for sending message');
            return;
        }

        const senderId = localStorage.getItem('userId');
        if (!senderId) {
            console.error('User ID not found in localStorage');
            return;
        }
        this.emit('chat_message', {
            sender: senderId,
            recipient: recipientId,
            content,
            attachments
        });
    }

    markMessagesAsRead(conversationId) {
        if (!conversationId) return;
        this.emit('read_messages', { conversationId });
    }

    sendTyping(recipientId) {
        if (!recipientId) return;
        const senderId = localStorage.getItem('userId');
        if (!senderId) {
            console.error('User ID not found in localStorage');
            return;
        }
        this.emit('typing', {
            sender: senderId,
            recipient: recipientId
        });
    }

    // Document methods
    requestDocumentView(documentId) {
        if (!documentId) {
            console.error('Document ID is required');
            return;
        }
        this.emit('view_document', { documentId });
    }

    requestDocumentDownload(documentId) {
        if (!documentId) {
            console.error('Document ID is required');
            return;
        }
        this.emit('download_document', { documentId });
    }

    // Listen for document events
    onDocumentReady(callback) {
        this.on('document_ready', (data) => {
            callback(data);
        });
    }

    // Reconnect method
    reconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket.connect();
        } else {
            this.initialize();
        }
    }

    // Get connection status
    isConnected() {
        return this.socket && this.socket.connected;
    }

    // Debug method to print connection details
    debugConnection() {
        console.log('Connection status:', this.socket ? (this.socket.connected ? 'Connected' : 'Disconnected') : 'No socket');

        if (this.socket) {
        }

        console.log('Available in localStorage:', {
            token: !!localStorage.getItem('token'),
            userId: localStorage.getItem('userId')
        });
    }
}

// Create singleton instance
const socketManager = new SocketManager();
export default socketManager;