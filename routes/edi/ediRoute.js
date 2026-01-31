// import express from 'express';
// import {
//     submitEdiFilesToGoogleDrive,
//     processScheduledEdis
// } from '../../controllers/bills-service-tracking/billController.js';

// const router = express.Router();

// // Upload batch EDIs
// router.post('/upload-to-drive', submitEdiFilesToGoogleDrive);

// // Process scheduled EDIs
// router.post('/process-scheduled', processScheduledEdis);

// // Test connection
// router.get('/test-drive-connection', async (req, res) => {
//     try {
//         const { testGoogleDriveConnection } = await import('../utils/googleDriveUploader.js');
//         const result = await testGoogleDriveConnection(req.query.folderId);
//         res.status(200).json(result);
//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: 'Error testing connection',
//             error: error.message
//         });
//     }
// });

// export default router;
