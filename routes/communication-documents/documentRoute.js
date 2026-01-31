import express from 'express';
import { uploadSingle } from '../../utils/s3.js';
import {
  uploadDocument,
  getAllDocuments,
  getDocumentById,
  deleteDocument,
  getDocumentsByCategory,
  getDocumentsByEntity,
  updateDocument,
  getDocumentsByUser,
  getDocumentsByOrganization,
  viewDocument,
  downloadDocument,
  serveDocument,
  downloadDocumentDirect,
  getAllDocumentsByAdmin,
  getDocumentsByHcm,
  createFolderOnly,
  getAllFoldersForHCM,
  getAllFoldersForTenant,
  getAllFodersForAdmin,
  deleteFolder,
} from '../../controllers/communication-documents/documentController.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

const authenticateUrlToken = (req, res, next) => {
  try {
    const token = req.query.token;

    if (!token) {
      const authHeader = req.headers['authorization'];
      const headerToken = authHeader && authHeader.split(' ')[1];

      if (!headerToken) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      jwt.verify(headerToken, process.env.JWT_SECRET, (err, user) => {
        if (err) {
          return res.status(403).json({
            success: false,
            message: 'Invalid or expired token',
          });
        }

        req.user = user;
        next();
      });
    } else {
      jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
          return res.status(403).json({
            success: false,
            message: 'Invalid or expired token',
          });
        }

        req.user = user;
        next();
      });
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
};

router.post(
  '/upload',
  authenticateUrlToken,
  uploadSingle('document'),
  uploadDocument
);
router.get('/view/:id', viewDocument);
router.get('/download/:id', downloadDocument);
router.get('/serve/:id', authenticateUrlToken, serveDocument);
router.get(
  '/download-direct/:id',
  authenticateUrlToken,
  downloadDocumentDirect
);
router.get('/category/:category', getDocumentsByCategory);
router.get('/related/:entityType/:entityId', getDocumentsByEntity);
router.get('/tenant/:userId', authenticateUrlToken, getDocumentsByUser);
router.get('/hcm/:userId', authenticateUrlToken, getDocumentsByHcm);
router.get('/organization/:organizationId', getDocumentsByOrganization);
router.get('/admin/:uploadedBy', getAllDocumentsByAdmin);
router.get('/', getAllDocuments);
router.get('/:id', getDocumentById);
router.delete('/:id', deleteDocument);
router.put('/:id', uploadSingle('document'), updateDocument);
router.post('/create-folder', authenticateUrlToken, createFolderOnly);
router.get('/hcm/folders/:userId', authenticateUrlToken, getAllFoldersForHCM);
router.get(
  '/tenant/folders/:userId',
  authenticateUrlToken,
  getAllFoldersForTenant
);
router.get(
  '/admin/folders/:companyId',
  authenticateUrlToken,
  getAllFodersForAdmin
);
router.delete('/delete-folder/:folderId', deleteFolder);

export default router;
