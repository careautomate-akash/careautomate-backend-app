import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const setupUploadDirectories = () => {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
    const uploadsDir = isProduction ? path.join('/tmp', 'uploads') : path.join(__dirname, '..', 'uploads');
    const servicesDir = path.join(uploadsDir, 'services');

    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir);
    }
    if (!fs.existsSync(servicesDir)) {
        fs.mkdirSync(servicesDir);
    }

    return {
        uploadsDir,
        servicesDir
    };
};