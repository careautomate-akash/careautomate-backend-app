import express from 'express';
import {
    getConversations,
    getMessages,
    sendMessage,
    markAsRead
} from '../../controllers/communication-documents/messageController.js';
import { uploadSingle } from '../../utils/s3.js';

const router = express.Router();

router.get('/conversations/:userId', getConversations);

router.get('/:userId/:recipientId', getMessages);

router.post('/', sendMessage);

router.post('/with-attachment', uploadSingle('attachment'), async (req, res, next) => {
    if (req.fileData) {
        req.body.attachments = [{
            fileKey: req.fileData.key,
            fileName: req.fileData.filename,
            fileType: req.fileData.mimetype,
            fileSize: req.fileData.size
        }];
    }
    next();
}, sendMessage);

router.put('/read', markAsRead);

export default router; 