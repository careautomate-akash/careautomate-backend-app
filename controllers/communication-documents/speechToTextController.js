import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for audio file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept audio files
        const allowedMimes = [
            'audio/wav',
            'audio/mp3',
            'audio/mpeg',
            'audio/mp4',
            'audio/m4a',
            'audio/webm',
            'audio/ogg',
            'audio/flac'
        ];

        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Please upload an audio file.'), false);
        }
    }
});

/**
 * Transcribe audio using Whisper
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} language - Language code (optional)
 * @returns {Promise<string>} Transcribed text
 */
const transcribeWithWhisper = async (audioBuffer, language = 'auto') => {
    return new Promise((resolve, reject) => {
        // Create temporary file
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempFile = path.join(tempDir, `audio_${Date.now()}.wav`);

        try {
            // Write buffer to temporary file
            fs.writeFileSync(tempFile, audioBuffer);

            // Prepare whisper command
            const whisperArgs = [
                tempFile,
                '--model', 'base',
                '--output_format', 'txt',
                '--output_dir', tempDir
            ];

            if (language && language !== 'auto') {
                whisperArgs.push('--language', language);
            }

            // Run whisper
            const whisperProcess = spawn('whisper', whisperArgs);

            let output = '';
            let errorOutput = '';

            whisperProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            whisperProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            whisperProcess.on('close', (code) => {
                // Clean up temp audio file
                try {
                    fs.unlinkSync(tempFile);
                } catch (err) {
                    console.warn('Could not delete temp file:', err.message);
                }

                if (code === 0) {
                    // Read the output text file
                    const outputFile = tempFile.replace(/\.[^/.]+$/, '.txt');
                    try {
                        const transcription = fs.readFileSync(outputFile, 'utf8').trim();
                        fs.unlinkSync(outputFile); // Clean up output file
                        resolve(transcription);
                    } catch (err) {
                        reject(new Error('Could not read transcription output'));
                    }
                } else {
                    reject(new Error(`Whisper failed with code ${code}: ${errorOutput}`));
                }
            });

            whisperProcess.on('error', (err) => {
                // Clean up temp file
                try {
                    fs.unlinkSync(tempFile);
                } catch (cleanupErr) {
                    console.warn('Could not delete temp file:', cleanupErr.message);
                }
                reject(new Error(`Failed to start Whisper: ${err.message}`));
            });

        } catch (err) {
            reject(new Error(`File processing error: ${err.message}`));
        }
    });
};

/**
 * Fallback transcription using browser Web Speech API result
 * This is used when Whisper is not available
 */
const fallbackTranscription = async (audioBuffer, language = 'en-US') => {
    // For fallback, we'll return a message indicating the service is unavailable
    // In a real implementation, you might want to use another service like Google Speech-to-Text API
    return "Speech-to-text service is currently unavailable. Please ensure Whisper is installed or use the browser's built-in speech recognition.";
};

/**
 * Main speech-to-text endpoint
 */
export const transcribeAudio = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No audio file provided'
            });
        }

        const { language = 'auto' } = req.body;
        let transcription;

        try {
            // Try Whisper first
            transcription = await transcribeWithWhisper(req.file.buffer, language);
        } catch (whisperError) {
            console.warn('Whisper transcription failed:', whisperError.message);

            // Fallback to alternative method
            transcription = await fallbackTranscription(req.file.buffer, language);
        }

        res.json({
            success: true,
            text: transcription,
            language: language,
            originalFileName: req.file.originalname,
            fileSize: req.file.size
        });

    } catch (error) {
        console.error('Speech-to-text error:', error);
        res.status(500).json({
            success: false,
            message: 'Transcription failed',
            error: error.message
        });
    }
};

/**
 * Get available languages for transcription
 */
export const getAvailableLanguages = async (req, res) => {
    try {
        const languages = [
            { code: 'auto', name: 'Auto-detect' },
            { code: 'en', name: 'English' },
            { code: 'es', name: 'Spanish' },
            { code: 'fr', name: 'French' },
            { code: 'de', name: 'German' },
            { code: 'it', name: 'Italian' },
            { code: 'pt', name: 'Portuguese' },
            { code: 'ru', name: 'Russian' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'zh', name: 'Chinese' },
            { code: 'ar', name: 'Arabic' },
            { code: 'hi', name: 'Hindi' },
            { code: 'tr', name: 'Turkish' },
            { code: 'pl', name: 'Polish' },
            { code: 'nl', name: 'Dutch' },
            { code: 'sv', name: 'Swedish' },
            { code: 'da', name: 'Danish' },
            { code: 'no', name: 'Norwegian' },
            { code: 'fi', name: 'Finnish' }
        ];

        res.json({
            success: true,
            languages: languages
        });
    } catch (error) {
        console.error('Error fetching languages:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch available languages'
        });
    }
};

/**
 * Check if Whisper is available
 */
export const checkWhisperAvailability = async (req, res) => {
    try {
        const whisperProcess = spawn('whisper', ['--help']);

        whisperProcess.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    available: true,
                    message: 'Whisper is available'
                });
            } else {
                res.json({
                    success: true,
                    available: false,
                    message: 'Whisper is not available'
                });
            }
        });

        whisperProcess.on('error', () => {
            res.json({
                success: true,
                available: false,
                message: 'Whisper is not installed'
            });
        });

    } catch (error) {
        res.json({
            success: true,
            available: false,
            message: 'Could not check Whisper availability'
        });
    }
};

// Export multer upload middleware
export const uploadAudio = upload.single('audio');

export default {
    transcribeAudio,
    getAvailableLanguages,
    checkWhisperAvailability,
    uploadAudio
}; 