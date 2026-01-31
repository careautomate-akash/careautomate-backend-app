import io from 'socket.io-client';
import { getToken } from './authService';

class SocketManager {
    constructor() {
        this.socket = null;
        this.listeners = new Map();
    }

    // Initialize socket connection
    initialize() {
        if (this.socket) return;

        // Get auth token from your auth service
        const token = getToken();

        const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

        // Create socket with authentication
        this.socket = io(BACKEND_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            auth: { token }
        });

        // Set up event listeners
        this.socket.on('connect', () => {
            this.socket.emit('register', this.getUserId());
        });

        this.socket.on('connect_error', (err) => {
            console.error('Socket connection error:', err);
        });

        this.socket.on('error', (err) => {
            console.error('Socket error:', err);
        });
    }

    // Get current user ID from auth
    getUserId() {
        try {
            const token = getToken();
            if (!token) return null;

            // If you store user ID elsewhere, use that instead
            // This is a simple example assuming JWT payload has an 'id' field
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.id;
        } catch (error) {
            console.error('Error getting user ID:', error);
            return null;
        }
    }

    // Register event listeners
    on(event, callback) {
        if (!this.socket) this.initialize();

        // Store callback in our listeners map
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);

        // Register with socket.io
        this.socket.on(event, callback);

        // Return unsubscribe function
        return () => this.off(event, callback);
    }

    // Remove event listener
    off(event, callback) {
        if (!this.socket) return;

        this.socket.off(event, callback);

        // Also remove from our listeners map
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index !== -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    // Emit an event
    emit(event, data) {
        if (!this.socket) this.initialize();
        this.socket.emit(event, data);
    }

    // Get conversations for current user
    getConversations() {
        if (!this.socket) this.initialize();
        this.socket.emit('fetch_conversations');
    }

    // Get messages for a conversation
    getMessages(conversationId) {
        if (!this.socket) this.initialize();
        this.socket.emit('fetch_messages', { conversationId });
    }

    // Send a message
    sendMessage(recipientId, content, attachments = []) {
        if (!this.socket) this.initialize();
        this.socket.emit('chat_message', {
            recipient: recipientId,
            content,
            attachments
        });
    }

    // Send typing indicator
    sendTyping(recipientId) {
        if (!this.socket) this.initialize();
        this.socket.emit('typing', { recipient: recipientId });
    }

    // Mark messages as read
    markMessagesAsRead(conversationId) {
        if (!this.socket) this.initialize();
        this.socket.emit('read_messages', { conversationId });
    }

    // Disconnect socket
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.listeners.clear();
        }
    }
}

// Create singleton instance
const socketManager = new SocketManager();

export default socketManager; 