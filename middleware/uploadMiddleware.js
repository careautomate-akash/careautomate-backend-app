import multer from 'multer';
import multerS3 from 'multer-s3';
import { s3Client } from '../utils/s3.js';

const documentUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_BUCKET_NAME,
    metadata: function (req, file, cb) {
      const folderName =
        req.body.folderName || new Date().getFullYear().toString();
      cb(null, {
        fieldName: file.fieldname,
        tenantId: req.body.tenantId,
        folderName: folderName,
      });
    },
    key: function (req, file, cb) {
      const folderName =
        req.body.folderName || new Date().getFullYear().toString();
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(
        null,
        `${req.body.tenantId || 'public'}/${folderName}/${uniqueSuffix}-${
          file.originalname
        }`,
      );
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit
    },
  }),
});

const profileImageUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_BUCKET_NAME,
    key: function (req, file, cb) {
      // Log incoming file details
      // Prioritize userId from params, query, then body
      const userId =
        req.params.userId || req.query.userId || (req.body && req.body.userId);
      if (!userId || userId === 'undefined' || userId === 'null') {
        console.error('Invalid userId for profile image upload:', userId);
        return cb(new Error('Valid userId is required for upload'));
      }

      if (!file) {
        console.error('No file provided in request');
        return cb(new Error('No file provided'));
      }

      const uniqueSuffix = Date.now();
      const key = `profile-images/${userId}/${uniqueSuffix}-${file.originalname}`;
      cb(null, key);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

const signatureImageUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_BUCKET_NAME,
    key: function (req, file, cb) {
      let updateData;
      try {
        updateData =
          typeof req.body.updateData === 'string'
            ? JSON.parse(req.body.updateData)
            : req.body.updateData || req.body;
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: 'Invalid updateData format',
        });
      }

      const tenantId = updateData.tenantId;
      const hcmId = updateData.hcmId;
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);

      // Create a descriptive key for signature images
      const key = `signature-images/${tenantId}/${hcmId}/${uniqueSuffix}-${file.originalname}`;
      cb(null, key);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for signature upload'));
    }
  },
});

export const uploadDocument = documentUpload.single('document');
export const uploadProfileImage = profileImageUpload.single('profileImage');
export const uploadSignatureImage =
  signatureImageUpload.single('signatureImage');

export const processUpload = (req, res, next) => {
  // Capture userId from multiple sources
  const userId = req.body.userId || req.params.userId || req.query.userId;
  if (userId) {
    // Ensure userId is in the body for later use
    req.body.userId = userId;
  } else {
    // console.warn('No userId found in request');
  }

  if (req.file) {
    const directUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${req.file.key}`;

    req.fileData = {
      key: req.file.key,
      location: directUrl,
      mimetype: req.file.mimetype,
      size: req.file.size,
      filename: req.file.originalname,
    };
  } else {
    // console.warn('No file found in request');
  }
  next();
};
