import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
console.log('Firebase Admin SDK initialized successfully.');


// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  // Try to use environment variable first (for Docker/production)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } catch (error) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT:', error);
      throw error;
    }
  }
  // Support providing a path to the service account file
  else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      const resolvedPath = saPath.startsWith('/') || /^[A-Za-z]:\\/.test(saPath)
        ? saPath
        : join(__dirname, '..', saPath);
      const serviceAccount = JSON.parse(readFileSync(resolvedPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } catch (error) {
      console.error('Failed to read or parse FIREBASE_SERVICE_ACCOUNT_PATH file:', error);
      throw error;
    }
  }
  // Fallback to file (for local development)
  else {
    try {
      const serviceAccount = JSON.parse(
        readFileSync(join(__dirname, '../serviceAccountKey.json'), 'utf8')
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } catch (error) {
      console.error('Firebase service account file not found. Please set FIREBASE_SERVICE_ACCOUNT environment variable or ensure serviceAccountKey.json exists.');
      throw error;
    }
  }
}

export default admin;
