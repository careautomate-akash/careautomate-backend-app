import Message from '../../models/communication-documents/message.js';
import Conversation from '../../models/communication-documents/Conversation.js';
import { getSignedUrl } from '../../utils/s3.js';

// Get conversations for a user
export const getConversations = async (req, res) => {
    try {
        const userId = req.params.userId;
        const conversations = await fetchUserConversations(userId);

        return res.status(200).json({
            success: true,
            conversations
        });
    } catch (error) {
        console.error('Error getting conversations:', error);
        return res.status(500).json({
            success: false,
            message: 'Error retrieving conversations',
            error: error.message
        });
    }
};

// Get messages for a conversation
export const getMessages = async (req, res) => {
    try {
        const { userId, recipientId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const messages = await fetchMessagesForUsers(userId, recipientId, page, limit);

        return res.status(200).json({
            success: true,
            messages: messages.data,
            pagination: messages.pagination
        });
    } catch (error) {
        console.error('Error getting messages:', error);
        return res.status(500).json({
            success: false,
            message: 'Error retrieving messages',
            error: error.message
        });
    }
};

// Send message through REST API (for fallback)
export const sendMessage = async (req, res) => {
    try {
        const { sender, recipient, content, attachments = [] } = req.body;

        if (!sender || !recipient || !content) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        const sentMessage = await saveAndEmitMessage(sender, recipient, content, attachments);

        return res.status(201).json({
            success: true,
            message: sentMessage
        });
    } catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).json({
            success: false,
            message: 'Error sending message',
            error: error.message
        });
    }
};

export const markAsRead = async (req, res) => {
    try {
        const { conversationId, senderId, recipientId } = req.body;

        if (!recipientId || !senderId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        await markMessagesAsRead(senderId, recipientId, conversationId);

        return res.status(200).json({
            success: true,
            message: 'Messages marked as read'
        });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        return res.status(500).json({
            success: false,
            message: 'Error marking messages as read',
            error: error.message
        });
    }
};

// Socket-compatible functions (can be used by both REST API and sockets)
export async function fetchUserConversations(userId) {
    const conversations = await Conversation.find({
        participants: userId
    })
        .populate('lastMessage')
        .populate('participants', 'name email profilePicture profileImageUrl')
        .sort({ updatedAt: -1 });

    return await Promise.all(conversations.map(async (conv) => {
        const otherParticipants = conv.participants.filter(
            p => p._id.toString() !== userId
        );

        return {
            _id: conv._id,
            participants: otherParticipants,
            lastMessage: conv.lastMessage ? {
                _id: conv.lastMessage._id,
                content: conv.lastMessage.content,
                sender: conv.lastMessage.sender,
                createdAt: conv.lastMessage.createdAt
            } : null,
            unreadCount: conv.unreadCount.get(userId) || 0,
            updatedAt: conv.updatedAt
        };
    }));
}

export async function fetchMessagesForUsers(userId, recipientId, page = 1, limit = 20) {
    const skip = (page - 1) * parseInt(limit);

    const messages = await Message.find({
        $or: [
            { sender: userId, recipient: recipientId },
            { sender: recipientId, recipient: userId }
        ]
    })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('sender', 'name email profileImageUrl')
        .populate('recipient', 'name email profileImageUrl')
        .lean();

    const messagesWithUrls = await Promise.all(messages.map(async (message) => {
        if (message.attachments && message.attachments.length > 0) {
            message.attachments = await Promise.all(message.attachments.map(async (attachment) => {
                return {
                    ...attachment,
                    url: attachment.fileKey ? await getSignedUrl(attachment.fileKey) : null
                };
            }));
        }
        return message;
    }));

    const total = await Message.countDocuments({
        $or: [
            { sender: userId, recipient: recipientId },
            { sender: recipientId, recipient: userId }
        ]
    });

    return {
        data: messagesWithUrls.reverse(),
        pagination: {
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit))
        }
    };
}

export async function fetchConversationMessages(conversationId, page = 1, limit = 20) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        throw new Error('Conversation not found');
    }

    const participants = conversation.participants;

    const messages = await Message.find({
        $or: [
            { sender: { $in: participants }, recipient: { $in: participants } }
        ]
    })
        .sort({ createdAt: -1 })
        .skip((page - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .populate('sender', 'name email profileImageUrl')
        .populate('recipient', 'name email profileImageUrl')
        .lean();

    return messages.reverse();
}

export async function saveAndEmitMessage(sender, recipient, content, attachments = [], ioInstance = null) {
    const newMessage = new Message({
        sender,
        recipient,
        content,
        attachments
    });

    await newMessage.save();

    let conversation = await Conversation.findOne({
        participants: { $all: [sender, recipient] }
    });

    if (!conversation) {
        conversation = new Conversation({
            participants: [sender, recipient],
            lastMessage: newMessage._id,
            unreadCount: new Map([[recipient, 1]])
        });
    } else {
        conversation.lastMessage = newMessage._id;
        const currentCount = conversation.unreadCount.get(recipient) || 0;
        conversation.unreadCount.set(recipient, currentCount + 1);
    }

    await conversation.save();

    const populatedMessage = await Message.findById(newMessage._id)
        .populate('sender', 'name email profileImageUrl')
        .populate('recipient', 'name email profileImageUrl');

    const messageToSend = populatedMessage.toObject();

    if (messageToSend.attachments && messageToSend.attachments.length > 0) {
        messageToSend.attachments = await Promise.all(messageToSend.attachments.map(async (attachment) => {
            if (attachment.fileKey) {
                return {
                    ...attachment,
                    url: await getSignedUrl(attachment.fileKey)
                };
            }
            return attachment;
        }));
    }

    if (ioInstance) {
        emitToUser(recipient, 'new_message', messageToSend, ioInstance);
        emitToUser(sender, 'message_sent', messageToSend, ioInstance);

        // Update conversations for both users
        await sendUserConversationsToSocket(sender, ioInstance);
        await sendUserConversationsToSocket(recipient, ioInstance);
    }

    return messageToSend;
}

export async function markMessagesAsRead(senderId, recipientId, conversationId, ioInstance = null) {
    await Message.updateMany(
        {
            recipient: recipientId,
            sender: senderId,
            read: false
        },
        { read: true }
    );

    if (conversationId) {
        const conversation = await Conversation.findById(conversationId);
        if (conversation) {
            conversation.unreadCount.set(recipientId, 0);
            await conversation.save();

            if (ioInstance) {
                emitToUser(senderId, 'messages_read', {
                    conversationId,
                    readBy: recipientId
                }, ioInstance);

                // Update conversations for both users
                await sendUserConversationsToSocket(senderId, ioInstance);
                await sendUserConversationsToSocket(recipientId, ioInstance);
            }
        }
    }
}

export async function sendUserConversationsToSocket(userId, ioInstance = null) {
    if (!ioInstance) return;

    const conversations = await fetchUserConversations(userId);
    emitToUser(userId, 'conversations_loaded', { conversations }, ioInstance);
}

function emitToUser(userId, event, data, ioInstance = null) {
    if (!ioInstance) return;

    const sockets = Array.from(ioInstance.sockets.sockets.values())
        .filter(socket => socket.userId === userId);

    sockets.forEach(socket => {
        socket.emit(event, data);
    });
} 