import express from 'express';
import {
    createConversation,
    sendMessage,
    getUserConversations,
    getConversationMessages,
    markConversationAsRead
} from '../../controllers/communication-documents/conversationController.js';

const router = express.Router();

router.post('/', createConversation);
router.get('/user/:userId', getUserConversations);
router.get('/:conversationId/messages', getConversationMessages);
router.post('/message', sendMessage);
router.put('/read', markConversationAsRead);

export default router;