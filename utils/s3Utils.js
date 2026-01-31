import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../config/s3Config.js';
import fs from 'fs';

export const uploadToS3 = async (file) => {
    const fileStream = fs.createReadStream(file.path);
    const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `documents/${file.filename}`,
        Body: fileStream,
        ContentType: file.mimetype
    };

    try {
        await s3Client.send(new PutObjectCommand(uploadParams));
        return {
            key: `documents/${file.filename}`,
            location: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/documents/${file.filename}`
        };
    } catch (error) {
        throw error;
    } finally {
        fs.unlink(file.path, (err) => {
            if (err) console.error('Error deleting local file:', err);
        });
    }
};

export const getSignedDownloadUrl = async (key) => {
    const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key
    });
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
};

export const deleteFromS3 = async (key) => {
    const deleteParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key
    };
    return await s3Client.send(new DeleteObjectCommand(deleteParams));
}; 