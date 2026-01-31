import express from 'express';
import {
    uploadProfileImage,
    getProfileImage,
    getBulkProfileImages,
    deleteProfileImage,
    updateProfileImage
} from '../../controllers/communication-documents/imageController.js';
import { uploadProfileImage as uploadMiddleware, processUpload } from '../../middleware/uploadMiddleware.js';
import User from '../../models/account/users.js';
import multer from 'multer';

const router = express.Router();

// Middleware to handle upload errors
const handleUploadErrors = (err, req, res, next) => {
    console.error('Image upload error:', err);
    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: `Upload error: ${err.message}`,
            code: 'MULTER_ERROR'
        });
    } else if (err) {
        return res.status(500).json({
            success: false,
            message: `Server error during upload: ${err.message}`,
            code: 'SERVER_ERROR'
        });
    }
    next();
};

// Routes with better error handling
router.post('/upload/:userId', (req, res, next) => {
    next();
}, uploadMiddleware, handleUploadErrors, processUpload, uploadProfileImage);

router.get('/:userId', (req, res, next) => {
    next();
}, getProfileImage);

router.post('/bulk', (req, res, next) => {
    next();
}, getBulkProfileImages);

router.put('/:userId', (req, res, next) => {
    if (req.params.userId) {
        req.body.userId = req.params.userId;
    }
    next();
}, uploadMiddleware, handleUploadErrors, processUpload, updateProfileImage);

router.delete('/:userId', (req, res, next) => {
    next();
}, deleteProfileImage);

router.get('/public-url/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        const user = await User.findById(userId);
        if (!user || !user.profileImageKey) {
            return res.status(404).json({ success: false, message: 'Image not found' });
        }

        const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${user.profileImageKey}`;

        return res.status(200).json({
            success: true,
            imageUrl
        });
    } catch (error) {
        console.error('Error getting image URL:', error);
        return res.status(500).json({
            success: false,
            message: 'Error getting image URL',
            error: error.message
        });
    }
});

export default router; 