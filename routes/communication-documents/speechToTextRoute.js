import express from 'express';
import {
    transcribeAudio,
    getAvailableLanguages,
    checkWhisperAvailability,
    uploadAudio
} from '../../controllers/communication-documents/speechToTextController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// POST /api/speech-to-text/transcribe - Transcribe audio file
router.post('/transcribe', uploadAudio, transcribeAudio);

// GET /api/speech-to-text/languages - Get available languages
router.get('/languages', getAvailableLanguages);

// GET /api/speech-to-text/check-availability - Check if Whisper is available
router.get('/check-availability', checkWhisperAvailability);

export default router; 