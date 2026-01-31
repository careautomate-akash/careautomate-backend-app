import { upload } from '../config/s3Config.js';

export const uploadSingle = (fieldName) => upload.single(fieldName);

export const uploadMultiple = (fieldName, maxCount) => upload.array(fieldName, maxCount);

export const uploadFields = (fields) => upload.fields(fields);

export const processUploadedFile = async (req, res, next) => {
    try {
        if (!req.file && !req.files) {
            return next();
        }

        if (req.file) {
            req.fileData = {
                key: req.file.key,
                filename: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
                location: req.file.location
            };
        } else if (req.files) {
            if (Array.isArray(req.files)) {
                req.filesData = req.files.map(file => ({
                    key: file.key,
                    filename: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                    location: file.location
                }));
            } else {
                req.filesData = {};
                for (const field in req.files) {
                    req.filesData[field] = req.files[field].map(file => ({
                        key: file.key,
                        filename: file.originalname,
                        mimetype: file.mimetype,
                        size: file.size,
                        location: file.location
                    }));
                }
            }
        }

        next();
    } catch (error) {
        console.error('Error processing uploaded file:', error);
        return res.status(500).json({ success: false, message: 'Error processing uploaded file' });
    }
}; 