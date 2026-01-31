import { S3Client, HeadBucketCommand, CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from "@aws-sdk/lib-storage";
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { getSignedUrl as s3GetSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from 'fs';
dotenv.config();

export const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

export const ensureBucketExists = async () => {
    try {
        await s3Client.send(new HeadBucketCommand({
            Bucket: process.env.AWS_BUCKET_NAME
        }));
        // Ensure default profile image exists
        await ensureDefaultProfileImage();
    } catch (error) {
        if (error.name === 'NotFound') {
            await s3Client.send(new CreateBucketCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                CreateBucketConfiguration: {
                    LocationConstraint: process.env.AWS_REGION
                }
            }));
            // Create default profile image
            await ensureDefaultProfileImage();
        } else {
            console.error('Error checking bucket:', error);
            throw error;
        }
    }
};

// Check if a file exists in S3
export const checkFileExists = async (key) => {
    // Create a promise that rejects after timeout
    const timeout = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('S3 check operation timed out after 3 seconds'));
        }, 3000); // 3 second timeout
    });

    try {
        // Use Promise.race to race between the actual operation and the timeout
        await Promise.race([
            s3Client.send(new HeadObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: key
            })),
            timeout
        ]);
        return true;
    } catch (error) {
        if (error.name === 'NotFound') {
            return false;
        }
        if (error.message.includes('timed out')) {
            console.error(`S3 check operation timed out for key: ${key}`);
            return false; // Assume not found if timed out
        }
        console.error(`Error checking if file exists (${key}):`, error);
        return false; // To avoid blocking the flow, assume not found
    }
};

// Ensure a default profile image exists in the bucket
export const ensureDefaultProfileImage = async () => {
    const defaultProfileKey = 'default-profile.png';

    try {
        const exists = await checkFileExists(defaultProfileKey);
        if (exists) {
            return;
        }
        // Check if a local default image exists, otherwise use a placeholder
        let imageBuffer;
        const localPath = path.join(process.cwd(), 'public', 'default-profile.png');

        if (fs.existsSync(localPath)) {
            imageBuffer = fs.readFileSync(localPath);
        } else {
            // Create a simple SVG as a placeholder
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
                <circle cx="100" cy="70" r="50" fill="#CCCCCC" />
                <circle cx="100" cy="230" r="100" fill="#CCCCCC" />
            </svg>`;
            imageBuffer = Buffer.from(svg);
        }

        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: defaultProfileKey,
            Body: imageBuffer,
            ContentType: 'image/png',
            ACL: 'public-read'
        }));
    } catch (error) {
        console.error('Error creating default profile image:', error);
    }
};

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg',
        'image/png',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type'));
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024
    },
    fileFilter: fileFilter
});

export const processUpload = async (file) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const extension = path.extname(file.originalname);
    const key = `documents/${Date.now()}-${uniqueSuffix}${extension}`;

    const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'private'
    };

    try {
        const upload = new Upload({
            client: s3Client,
            params: uploadParams
        });

        const result = await upload.done();

        return {
            key: key,
            location: result.Location,
            mimetype: file.mimetype,
            size: file.size,
            filename: file.originalname
        };
    } catch (error) {
        console.error('Error uploading to S3:', error);
        throw error;
    }
};

// Helper function to delete a file from S3
export const deleteFileFromS3 = async (key) => {
    // Create a promise that rejects after timeout
    const timeout = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('S3 delete operation timed out after 5 seconds'));
        }, 5000); // 5 second timeout
    });

    try {
        // Use Promise.race to race between the actual operation and the timeout
        await Promise.race([
            (async () => {
                // First check if the file exists
                const exists = await checkFileExists(key);
                if (!exists) {
                    return true;
                }
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key
                }));
                return true;
            })(),
            timeout
        ]);

        return true;
    } catch (error) {
        // Check for permission errors specifically
        if (error.name === 'AccessDenied') {
            console.error(`Permission denied to delete file ${key}. Check IAM policies.`);
            throw new Error(`Permission denied: Cannot delete file from S3 - ${error.message}`);
        }

        if (error.message.includes('timed out')) {
            console.error(`S3 deletion operation timed out for key: ${key}`);
        } else {
            console.error(`Error deleting file ${key} from S3:`, error);
        }

        throw error;
    }
};

export const getSignedUrl = async (fileKey) => {
    try {
        if (!fileKey) return null;

        const command = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: fileKey
        });

        return await s3GetSignedUrl(s3Client, command, { expiresIn: 3600 });
    } catch (error) {
        console.error('Error generating signed URL:', error);
        return null;
    }
};

export const uploadSingle = (fieldName) => {
    return async (req, res, next) => {
        upload.single(fieldName)(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }
            if (!req.file) {
                return next();
            }
            try {
                req.fileData = await processUpload(req.file);
                next();
            } catch (error) {
                next(error);
            }
        });
    };
};

export const uploadMultiple = (fieldName, maxCount) => {
    return async (req, res, next) => {
        upload.array(fieldName, maxCount)(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }
            if (!req.files) {
                return next();
            }
            try {
                req.filesData = await Promise.all(req.files.map(file => processUpload(file)));
                next();
            } catch (error) {
                next(error);
            }
        });
    };
};

export const uploadFields = (fields) => {
    return async (req, res, next) => {
        upload.fields(fields)(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }
            if (!req.files) {
                return next();
            }
            try {
                req.filesData = {};
                for (const [fieldName, files] of Object.entries(req.files)) {
                    req.filesData[fieldName] = await Promise.all(files.map(file => processUpload(file)));
                }
                next();
            } catch (error) {
                next(error);
            }
        });
    };
}; 