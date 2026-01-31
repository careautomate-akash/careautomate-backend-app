//  --> /api/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import connectDB from './config/db.js';
import authRoute from './routes/account/authRoute.js';
import tenantRoute from './routes/hcm-tenants/tenantRoute.js';
import fetchAllRoute from './routes/hcm-tenants/fetchAllRoute.js';
import hcmRoutes from './routes/hcm-tenants/hcmRoute.js';
import { setupUploadDirectories } from './utils/setupDirectories.js';
import path from 'path';
import fs from 'fs';
import appointmentRoute from './routes/appointments-visits/appointmentRoute.js';
import visitRoute from './routes/appointments-visits/visitRoute.js';
import serviceTrackingRoute from './routes/bills-service-tracking/serviceTrackingRoute.js';
import billRoute from './routes/bills-service-tracking/billRoute.js';
import dynamicBillRoute from './routes/bills-service-tracking/dynamicBillRoute.js';
import './tasks/billGeneration.js';
import settingsRoute from './routes/reports/settingsRoute.js';
import { fileURLToPath } from 'url';
import documentRoute from './routes/communication-documents/documentRoute.js';
import reportsRoute from './routes/reports/reportsRoute.js';
import accountRoute from './routes/account/accountRoute.js';
import superAdminRoute from './routes/account/superAdminRoute.js';
import callScheduleRoute from './routes/appointments-visits/callScheduleRoute.js';
import { ensureBucketExists } from './utils/s3.js';
import { mkdirSync } from 'fs';
import http from 'http';
import { Server } from 'socket.io';
import { setupSocketEvents } from './socket/socketEvents.js';
import messageRoute from './routes/communication-documents/messageRoute.js';
import imageRoutes from './routes/communication-documents/imageRoutes.js';
import conversationRoutes from './routes/communication-documents/conversations.js';
import pushNotificationRoutes from './routes/pushnotifications/notifications.js';
import { processScheduledNotifications } from './utils/appointmentReminderScheduler.js';
import speechToTextRoute from './routes/communication-documents/speechToTextRoute.js';
import serviceRoutes from './routes/services/services.js';
import sftpUploadRoute from './routes/sftp/sftp.js';
// import ediRoutes from './routes/edi/ediRoute.js';
import jwt from 'jsonwebtoken';
import { scheduleFTPUpload } from './utils/ftpUploader.js';
import twilio from 'twilio'; // full import
const { jwt: twilioJwt } = twilio; // manually extract jwt
const { AccessToken } = twilioJwt;
const { ChatGrant, SyncGrant } = AccessToken;
import { testGoogleDriveConnection } from './utils/googleDriveUploader.js';
import { authenticateToken } from './middleware/auth.js';
import { generateChatToken } from './utils/generateChatToken.js';
import multer from 'multer';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import { scheduleMnItsOperations } from './utils/mnitsUploader.js';
import { router as insuranceRoutes } from './routes/insurances/insurances.js';
import formRoutes from './routes/forms/index.js';
import { scheduleReminderProcessing } from './services/formNotificationService.js';
import './utils/ftpcronRunner.js';
import { scheduleTrialExpiryChecker } from './utils/trialExpiryScheduler.js';
import subscriptionRoute from './routes/account/subscriptionRoute.js';
const upload = multer();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

// Initialize database connection
let io;
let server;
let pythonService = null; // Initialize pythonService variable

// Bootstrap function to start the server
const bootstrap = async () => {
  try {
    await connectDB();

    // Initialize S3 bucket
    if (process.env.NODE_ENV !== 'test') {
      await ensureBucketExists().catch((err) => {
        console.error('Error ensuring S3 bucket exists:', err);
      });
    }

    const app = express();
    const httpServer = http.createServer(app);
    const socketServer = new http.Server(); // Create a separate server for sockets

    // Update the server variable to reference httpServer
    server = httpServer;

    // Initialize Socket.IO on separate socket server
    io = new Server(socketServer, {
      cors: {
        origin: [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'http://localhost:3002',
          'http://localhost:5173',
          'http://localhost:5174',
          '*',
        ],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        preflightContinue: false,
        optionsSuccessStatus: 204,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000, // Increase ping timeout
      pingInterval: 25000, // Set ping interval
    });

    // Socket.IO middleware for authentication
    io.use((socket, next) => {
      try {
        console.log('Socket authentication attempt');
        const token =
          socket.handshake.auth.token ||
          socket.handshake.headers.authorization?.split(' ')[1];

        // Log the auth data for debugging
        console.log('Socket auth data:', {
          token: !!token,
          userId: socket.handshake.auth.userId,
          headers: !!socket.handshake.headers.authorization,
        });

        if (!token) {
          console.log('No token provided for socket connection');
          return next(new Error('Authentication error: Token required'));
        }

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
          if (err) {
            console.error('JWT verification error:', err.message);
            return next(new Error('Authentication error: Invalid token'));
          }

          // Store user data in socket object
          socket.userId = decoded.id;
          socket.user = decoded;
          console.log(`Socket authenticated for user ${decoded.id}`);
          next();
        });
      } catch (error) {
        console.error('Socket authentication error:', error.message);
        next(new Error('Authentication error'));
      }
    });

    // Setup socket event handlers
    setupSocketEvents(io);

    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

    setupUploadDirectories();
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      const servicesDir = path.join(uploadsDir, 'services');
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.mkdirSync(servicesDir, { recursive: true });
      mkdirSync(path.join(process.cwd(), 'uploads/documents'), {
        recursive: true,
      });
      console.log('Upload directories created successfully');
    } catch (error) {
      console.error('Error creating upload directories:', error);
    }
    app.use(
      cors({
        origin: [
          'http://localhost:3000',
          'http://localhost:3002',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:3002',
          'https://demo.careautomate.com',
          'https://dev.careautomate.com',
          'https://app.careautomate.com',
          'http://localhost:3002',
          '*',
          'http://localhost:3003',
          'http://localhost:5173',
          'http://localhost:5174',
        ],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        preflightContinue: false,
        optionsSuccessStatus: 204,
      })
    );

    // Add a status endpoint for testing
    app.get('/api/status', (req, res) => {
      res.json({
        status: 'online',
        serverTime: new Date().toISOString(),
        socketEnabled: true,
      });
    });

    app.use('/auth', authRoute);
    app.use('/fetchAll', fetchAllRoute);
    app.use('/tenant', tenantRoute);
    app.use('/visit', visitRoute);
    app.use('/hcm', hcmRoutes);
    app.use('/appointment', appointmentRoute);
    app.use('/visits', visitRoute);
    app.use('/service-tracking', serviceTrackingRoute);
    app.use('/bill', billRoute);
    app.use('/dynamic-claims', dynamicBillRoute);
    app.use('/settings', settingsRoute);
    app.use('/document', documentRoute);
    app.use('/reports', reportsRoute);
    app.use('/account', accountRoute);
    app.use('/super-admin', superAdminRoute);
    app.use('/support', callScheduleRoute);
    app.use('/messages', messageRoute);
    app.use('/images', imageRoutes);
    app.use('/conversations', conversationRoutes);
    app.use('/api', pushNotificationRoutes);
    app.use('/api/speech-to-text', speechToTextRoute);
    app.use('/api/sftp', sftpUploadRoute);
    app.use('/api/services', serviceRoutes);
    app.use('/api/insurances', insuranceRoutes);
    app.use('/api/forms', formRoutes);
    app.use('/api/subscription', subscriptionRoute);

    // app.use('/api/edi', ediRoutes);
    app.use(express.static('public'));

    app.post('/api/chat/token', async (req, res) => {
      const { identity } = req.body;

      if (!identity) {
        return res
          .status(400)
          .json({ success: false, message: 'Missing identity' });
      }

      try {
        const token = await generateChatToken(identity);
        res.status(200).json({
          success: true,
          token,
          identity,
        });
      } catch (err) {
        console.error('Token generation failed:', err.message);
        res.status(500).json({
          success: false,
          message: 'Failed to generate chat token',
          error: err.message,
        });
      }
    });
    // Add a route to the test-upload page
    app.get('/test-upload', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'test-upload.html'));
    });

    app.get('/', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Housing Services</title>
          <style>
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              font-family: Arial, sans-serif;
              background-color: #f0f0f0;
            }
            .container {
              text-align: center;
            }
            h1 {
              color: #333;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Welcome to Housing Services</h1>
          </div>
        </body>
        </html>
      `);
    });

    // Legacy speech-to-text endpoint - redirects to new API
    app.post('/api/speech-to-text', upload.single('file'), async (req, res) => {
      // Redirect to new endpoint
      res.status(301).json({
        success: false,
        message:
          'This endpoint has been moved. Please use /api/speech-to-text/transcribe',
        newEndpoint: '/api/speech-to-text/transcribe',
      });
    });

    // Initialize MN-ITS operations scheduler
    try {
      scheduleMnItsOperations();
      console.log('✅ MN-ITS operations scheduler initialized');
    } catch (schedulerError) {
      console.error(
        '❌ Failed to initialize MN-ITS scheduler:',
        schedulerError
      );
    }

    // Start the HTTP server
    httpServer.listen(process.env.PORT, () => {
      console.log(`🚀 Server running on port ${process.env.PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(
        `🔗 Database: ${process.env.MONGODB_URI ? 'Connected' : 'Local'}`
      );
      console.log(
        `📁 Uploads directory: ${process.env.UPLOAD_DIR || './uploads'}`
      );
      console.log(
        `🏥 MN-ITS integration: ${process.env.MNITS_USERNAME ? 'Configured' : 'Not configured'
        }`
      );
      console.log('='.repeat(50));
    });

    // Start the socket server on a different port (9004)
    const SOCKET_PORT = process.env.SOCKET_PORT || 9004;
    socketServer.listen(SOCKET_PORT, () => {
      console.log(`Socket.IO server is running on port ${SOCKET_PORT}`);
    });

    // Now we can safely set maxConnections on the servers
    httpServer.maxConnections = 100; // Increase max connections for HTTP server
    socketServer.maxConnections = 100; // Also set for socket server

    // Start the scheduler
    scheduleFTPUpload();
    processScheduledNotifications();

    // Start form reminder processing
    if (process.env.NODE_ENV !== 'test') {
      scheduleReminderProcessing();
    }

    // Start trial expiry checker scheduler
    scheduleTrialExpiryChecker();

    return { app, io, server };
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
};

// Start the server if this is the main module
if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    process.exit(1);
  });
}

// Add shutdown handler
process.on('SIGINT', () => {
  console.log('Shutting down server and services...');

  if (pythonService) {
    pythonService.kill();
    console.log('Python transcription service terminated');
  }

  process.exit(0);
});

// Export for testing
export { io };
export default bootstrap;