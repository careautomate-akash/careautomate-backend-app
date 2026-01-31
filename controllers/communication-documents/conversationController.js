import Conversation from '../../models/communication-documents/Conversation.js';
import Message from '../../models/communication-documents/message.js';
import {
    fetchUserConversations,
    fetchConversationMessages,
    saveAndEmitMessage,
    markMessagesAsRead,
    sendUserConversationsToSocket
} from './messageController.js';

export const createConversation = async (req, res) => {
    const { participants } = req.body;
    try {
        const existingConversation = await Conversation.findOne({
            participants: { $all: participants }
        });

        if (existingConversation) {
            return res.status(200).json({
                success: true,
                message: "Conversation already exists",
                conversation: existingConversation
            });
        }

        const newConversation = new Conversation({
            participants,
            unreadCount: new Map(participants.map(id => [id.toString(), 0]))
        });

        await newConversation.save();

        for (const participantId of participants) {
            await sendUserConversationsToSocket(participantId);
        }

        res.status(201).json({
            success: true,
            message: "Conversation created successfully",
            conversation: newConversation
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Error creating conversation",
            error: err.message
        });
    }
};

export const sendMessage = async (req, res) => {
    try {
        const { sender, recipient, content, attachments } = req.body;

        const sentMessage = await saveAndEmitMessage(sender, recipient, content, attachments || []);

        res.status(200).json({
            success: true,
            message: "Message sent successfully",
            message: sentMessage
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Error sending message",
            error: err.message
        });
    }
};

export const getUserConversations = async (req, res) => {
    try {
        const { userId } = req.params;
        const conversations = await fetchUserConversations(userId);

        res.status(200).json({
            success: true,
            conversations
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Error fetching conversations",
            error: err.message
        });
    }
};

export const getConversationMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const messages = await fetchConversationMessages(conversationId, page, limit);

        res.status(200).json({
            success: true,
            messages
        });
    } catch (err) {
        console.error('Error in getConversationMessages:', err);
        res.status(500).json({
            success: false,
            message: "Error fetching messages",
            error: err.message
        });
    }
};

export const markConversationAsRead = async (req, res) => {
    try {
        const { conversationId, userId } = req.body;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found"
            });
        }

        const otherParticipant = conversation.participants.find(
            p => p.toString() !== userId
        );

        if (!otherParticipant) {
            return res.status(400).json({
                success: false,
                message: "Invalid conversation participants"
            });
        }

        await markMessagesAsRead(otherParticipant.toString(), userId, conversationId);

        return res.status(200).json({
            success: true,
            message: "Conversation marked as read"
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Error marking conversation as read",
            error: err.message
        });
    }
};

// For socket integration
export function setupConversationSockets(socket) {
    socket.on('create_conversation', async (data) => {
        try {
            const { participants } = data;

            const existingConversation = await Conversation.findOne({
                participants: { $all: participants }
            });

            if (existingConversation) {
                socket.emit('conversation_created', {
                    success: true,
                    message: "Conversation already exists",
                    conversation: existingConversation
                });
                return;
            }

            const newConversation = new Conversation({
                participants,
                unreadCount: new Map(participants.map(id => [id.toString(), 0]))
            });

            await newConversation.save();

            for (const participantId of participants) {
                await sendUserConversationsToSocket(participantId);
            }

            socket.emit('conversation_created', {
                success: true,
                conversation: newConversation
            });
        } catch (error) {
            socket.emit('error', {
                message: "Error creating conversation",
                error: error.message
            });
        }
    });
}