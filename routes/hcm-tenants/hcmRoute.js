import express from 'express';
import multer from 'multer';
import {
  createHcm,
  assignServicesAndDocuments,
  getServicesAndDocuments,
  uploadDocument,
  fetchDocuments,
  getAssignedTenantsToHcm,
  getHcmInfo,
  assignTenantsToHcm,
  getHcm,
  getHcms,
  updateHcm,
  deleteHcm,
  getHcmChartInfo,
  getHCMNamesByCompany,
  getAssignedTenantsWithServices,
  approveHcmVisit,
  rejectHcmVisit,
  withdrawApprovalHcmVisit,
  withdrawRejectionHcmVisit,
  oldhcmVisitHistory,
} from '../../controllers/hcm-tenants/hcmController.js';
import { getHcmVisitHistory } from '../../controllers/hcm-tenants/hcmVisitHistory.js';
import { authenticateToken } from '../../middleware/auth.js';
import { getHcmUnitsStats } from '../../controllers/bills-service-tracking/serviceTrackingController.js';
import {
  uploadProfileImage as uploadMiddleware,
  processUpload,
} from '../../middleware/uploadMiddleware.js';

const router = express.Router();

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({ storage: storage });

// Error handling middleware for image uploads
const handleUploadErrors = (err, req, res, next) => {
  if (err) {
    console.error('Image upload error:', err);
    return res.status(400).json({
      success: false,
      message: `Upload error: ${err.message}`,
      code: 'UPLOAD_ERROR',
    });
  }
  next();
};

// HCM management routes - updated with image upload support
router.post('/create-hcm', authenticateToken, processUpload, createHcm);

router.get('/get-hcm/:id', authenticateToken, getHcm);
router.get('/get-hcms/:companyId', authenticateToken, getHcms);
router.put('/update-hcm', authenticateToken, updateHcm);
router.delete('/delete-hcm/:id', authenticateToken, deleteHcm);

router.get('/get-hcm-info/:id', authenticateToken, getHcmInfo);

router.get(
  '/get-hcm-chart-info/:companyId',
  authenticateToken,
  getHcmChartInfo
);

router.post('/assign-tenants-to-hcm', authenticateToken, assignTenantsToHcm);

// Service and Document management routes
router.post(
  '/assign-services-documents',
  authenticateToken,
  upload.array('document'),
  assignServicesAndDocuments
);
router.post(
  '/get-services-documents',
  authenticateToken,
  getServicesAndDocuments
);

// Add these new routes
router.post(
  '/upload-document',
  authenticateToken,
  upload.single('document'),
  uploadDocument
);

router.post('/fetch-documents', authenticateToken, fetchDocuments);

// router.post("/assign-tenants-to-hcm", authenticateToken, assignTenantsToHcm);
router.post('/hcmUnitsStats', authenticateToken, getHcmUnitsStats);
router.post(
  '/get-assigned-tenants-to-hcm',
  authenticateToken,
  getAssignedTenantsToHcm
);
router.post(
  '/get-assigned-tenants-with-services',
  authenticateToken,
  getAssignedTenantsWithServices
);
router.post('/approve-visit', authenticateToken, approveHcmVisit);
router.post('/reject-visit', authenticateToken, rejectHcmVisit);
router.post('/withdraw-approval', authenticateToken, withdrawApprovalHcmVisit);
router.post(
  '/withdraw-rejection',
  authenticateToken,
  withdrawRejectionHcmVisit
);
router.post('/old-hcm-visit-history', authenticateToken, oldhcmVisitHistory);
router.get('/get-All-hcms/:companyId', authenticateToken, getHCMNamesByCompany);

// Add profile image upload route
router.post(
  '/upload-image',
  authenticateToken,
  uploadMiddleware,
  handleUploadErrors,
  processUpload,
  (req, res) => {
    try {
      if (!req.fileData) {
        return res
          .status(400)
          .json({ success: false, message: 'No image uploaded' });
      }

      const { userId } = req.body;

      // Find user and update their profile image
      users
        .findById(userId)
        .then(async (user) => {
          if (!user) {
            return res.status(404).json({
              success: false,
              message: 'User not found',
            });
          }

          // If user already has a profile image, we don't need to delete it here
          // as that's handled by the image controller

          // Update user with new image details
          const key = req.fileData.key;
          user.profileImageKey = key;

          // Direct public URL
          const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
          user.profileImageUrl = imageUrl;

          await user.save();

          return res.status(200).json({
            success: true,
            message: 'Profile image uploaded successfully',
            imageUrl: user.profileImageUrl,
          });
        })
        .catch((error) => {
          console.error('Error uploading profile image:', error);
          return res.status(500).json({
            success: false,
            message: 'Error uploading profile image',
            error: error.message,
          });
        });
    } catch (error) {
      console.error('Error in profile image upload:', error);
      return res.status(500).json({
        success: false,
        message: 'Error uploading profile image',
        error: error.message,
      });
    }
  }
);

router.post('/hcm-visit-history/:hcmId', authenticateToken, getHcmVisitHistory);

export default router;
