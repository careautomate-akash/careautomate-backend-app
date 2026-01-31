import Document from '../../models/communication-documents/document.js';
import users from '../../models/account/users.js';
import { deleteFileFromS3 } from '../../utils/s3.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../../utils/s3.js';
import { getSignedUrl as s3GetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Buffer } from 'buffer';
import mongoose from 'mongoose';

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a temp directory for document downloads if it doesn't exist
const tempDir = path.join(__dirname, '../../temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

export const uploadDocument = async (req, res) => {
  try {
    if (!process.env.AWS_BUCKET_NAME) {
      return res.status(500).json({
        success: false,
        message: 'S3 bucket not configured',
      });
    }

    if (!req.fileData) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const {
      name,
      description,
      category,
      tags,
      tenantId,
      folderName,
      uploadedBy,
      companyId,
    } = req.body;

    // Validate required fields
    if (!tenantId) {
      console.warn('Document upload attempted without tenantId');
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required for document upload',
      });
    }

    if (!companyId) {
      console.warn('Document upload attempted without companyId');
      return res.status(400).json({
        success: false,
        message: 'Company ID is required for document upload',
      });
    }

    // Validate MongoDB ObjectId format for tenantId
    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      console.error(`Invalid tenant ID format: ${tenantId}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid tenant ID format',
      });
    }

    const uploadedYear = new Date().getFullYear();

    const document = new Document({
      name: name || req.fileData.filename,
      userId: tenantId,
      description,
      fileKey: req.fileData.key,
      fileType: req.fileData.mimetype,
      fileSize: req.fileData.size,
      s3Location: req.fileData.location,
      uploadedBy,
      companyId: companyId || req.user?.companyId,
      category,
      tags: tags ? JSON.parse(tags) : [],
      folderName: folderName || uploadedYear.toString(),
      uploadedYear,
    });

    const savedDocument = await document.save();
    await savedDocument.populate('uploadedBy', 'name email phone');
    return res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      document: savedDocument,
    });
  } catch (error) {
    console.error('Error uploading document:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading document',
      error: error.message,
    });
  }
};

export const getAllDocuments = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required',
      });
    }

    const documents = await Document.find({ userId }).sort({ createdAt: -1 });

    const documentsWithUrls = await Promise.all(
      documents.map(async (doc) => {
        const docObject = doc.toObject();
        try {
          const viewCommand = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: doc.fileKey,
            ResponseContentDisposition: 'inline',
            ResponseContentType: doc.fileType,
          });

          const downloadCommand = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: doc.fileKey,
            ResponseContentDisposition: `attachment; filename="${doc.name}"`,
            ResponseContentType: doc.fileType,
          });

          const [viewUrl, downloadUrl] = await Promise.all([
            s3GetSignedUrl(s3Client, viewCommand, { expiresIn: 3600 }),
            s3GetSignedUrl(s3Client, downloadCommand, { expiresIn: 3600 }),
          ]);

          const sizeInMB = (docObject.fileSize / (1024 * 1024)).toFixed(2);

          return {
            id: docObject._id,
            name: docObject.name,
            category: docObject.category,
            userId: docObject.userId,
            companyId: docObject.companyId,
            uploadDate: new Date(docObject.createdAt).toLocaleString(),
            size: `${sizeInMB} MB`,
            type: docObject.fileType.split('/')[1].toUpperCase(),
            uploadedBy: docObject.uploadedBy,
            tags: docObject.tags,
            viewUrl,
            downloadUrl,
          };
        } catch (err) {
          console.error(`Error processing document ${doc._id}:`, err);
          return {
            ...docObject,
            viewUrl: null,
            downloadUrl: null,
            error: 'Error generating URLs',
          };
        }
      })
    );

    return res.status(200).json({
      success: true,
      count: documentsWithUrls.length,
      documents: documentsWithUrls,
    });
  } catch (error) {
    console.error('Error in getAllDocuments:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching documents',
      error: error.message,
    });
  }
};

export const getDocumentById = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id).populate(
      'uploadedBy',
      'name email'
    );

    if (!document) {
      return res
        .status(404)
        .json({ success: false, message: 'Document not found' });
    }

    const url = getPublicUrl(document.fileKey);

    const docWithUrl = document.toObject();
    docWithUrl.url = url;

    return res.status(200).json({
      success: true,
      document: docWithUrl,
    });
  } catch (error) {
    console.error('Error in getDocumentById:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching document',
      error: error.message,
    });
  }
};

export const deleteDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res
        .status(404)
        .json({ success: false, message: 'Document not found' });
    }

    await deleteFileFromS3(document.fileKey);
    await Document.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('Error in deleteDocument:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting document',
      error: error.message,
    });
  }
};

export const getDocumentsByCategory = async (req, res) => {
  try {
    const { category } = req.params;

    const documents = await Document.find({ category })
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'name email');

    const documentsWithUrls = await Promise.all(
      documents.map(async (doc) => {
        const docObject = doc.toObject();
        docObject.url = getPublicUrl(doc.fileKey);
        return docObject;
      })
    );

    return res.status(200).json({
      success: true,
      count: documentsWithUrls.length,
      documents: documentsWithUrls,
    });
  } catch (error) {
    console.error('Error in getDocumentsByCategory:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching documents',
      error: error.message,
    });
  }
};

export const getDocumentsByEntity = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;

    const documents = await Document.find({
      'relatedTo.entityType': entityType,
      'relatedTo.entityId': entityId,
    })
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'name email');

    const documentsWithUrls = await Promise.all(
      documents.map(async (doc) => {
        const docObject = doc.toObject();
        docObject.url = getPublicUrl(doc.fileKey);
        return docObject;
      })
    );

    return res.status(200).json({
      success: true,
      count: documentsWithUrls.length,
      documents: documentsWithUrls,
    });
  } catch (error) {
    console.error('Error in getDocumentsByEntity:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching documents',
      error: error.message,
    });
  }
};

export const updateDocument = async (req, res) => {
  try {
    const documentId = req.params.id;
    const document = await Document.findById(documentId);

    if (!document) {
      return res
        .status(404)
        .json({ success: false, message: 'Document not found' });
    }

    if (req.fileData) {
      await deleteFileFromS3(document.fileKey);

      document.fileKey = req.fileData.key;
      document.fileType = req.fileData.mimetype;
      document.fileSize = req.fileData.size;
      document.s3Location = req.fileData.location;
    }

    const { name, description, category, tags, relatedTo } = req.body;

    if (name) document.name = name;
    if (description) document.description = description;
    if (category) document.category = category;
    if (tags) document.tags = JSON.parse(tags);
    if (relatedTo) document.relatedTo = JSON.parse(relatedTo);

    const updatedDocument = await document.save();
    const url = getPublicUrl(updatedDocument.fileKey);
    const docWithUrl = updatedDocument.toObject();
    docWithUrl.url = url;

    return res.status(200).json({
      success: true,
      message: 'Document updated successfully',
      document: docWithUrl,
    });
  } catch (error) {
    console.error('Error updating document:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating document',
      error: error.message,
    });
  }
};

export const viewDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const url = getPublicUrl(document.fileKey);

    return res.status(200).json({
      success: true,
      document: {
        name: document.name,
        type: document.fileType,
        viewUrl: url,
      },
    });
  } catch (error) {
    console.error('Error in viewDocument:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generating view URL',
      error: error.message,
    });
  }
};

export const downloadDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const url = getPublicUrl(document.fileKey);

    return res.status(200).json({
      success: true,
      document: {
        name: document.name,
        type: document.fileType,
        downloadUrl: url,
      },
    });
  } catch (error) {
    console.error('Error in downloadDocument:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generating download URL',
      error: error.message,
    });
  }
};

export const getDocumentsByOrganization = async (req, res) => {
  const { organizationId } = req.params;
  if (!organizationId) {
    return res
      .status(400)
      .json({ success: false, message: 'Organization ID is required' });
  }

  try {
    const documents = await Document.find({ organizationId });
    const groupedDocuments = documents.reduce((acc, doc) => {
      const folder = doc.folderName || 'General';
      if (!acc[folder]) {
        acc[folder] = [];
      }

      // Convert to plain object and add id field for consistency
      const docObj = doc.toObject();
      docObj.id = docObj._id;

      acc[folder].push(docObj);
      return acc;
    }, {});

    return res.status(200).json({ success: true, documents: groupedDocuments });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch documents',
      error: error.message,
    });
  }
};

export const getAllDocumentsByAdmin = async (req, res) => {
  try {
    const { uploadedBy, companyId } = req.query;

    const filter = {};

    if (uploadedBy) {
      filter.uploadedBy = uploadedBy;
    }

    // IMPORTANT: Filter by companyId to prevent cross-company access
    if (companyId) {
      filter.companyId = companyId;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required',
      });
    }

    const documents = await Document.find(filter)
      .populate('userId', 'name email phone role')
      .populate('uploadedBy', 'name email phone role')
      .sort({ createdAt: -1 });

    const organizedDocuments = documents.reduce((acc, doc) => {
      const folder = doc.folderName || 'General';

      const year = doc.uploadedYear || new Date().getFullYear();

      const tenantId = doc.userId?._id?.toString() || 'unassigned';
      const tenantName = doc.userId?.name || 'Unassigned';
      const tenantEmail = doc.userId?.email || 'Unassigned';

      const uploadedById = doc.uploadedBy?._id?.toString() || 'unknown';
      const uploaderName = doc.uploadedBy?.name || 'Unknown User';

      if (!acc[folder]) {
        acc[folder] = {
          name: folder,
          years: {},
        };
      }

      // Initialize year structure if not exists
      if (!acc[folder].years[year]) {
        acc[folder].years[year] = {
          year,
          tenants: {},
        };
      }

      if (!acc[folder].years[year].tenants[tenantId]) {
        acc[folder].years[year].tenants[tenantId] = {
          id: tenantId,
          name: tenantName,
          email: tenantEmail,
          uploaders: {},
          documents: [],
        };
      }

      if (!acc[folder].years[year].tenants[tenantId].uploaders[uploadedById]) {
        acc[folder].years[year].tenants[tenantId].uploaders[uploadedById] = {
          id: uploadedById,
          name: uploaderName,
          documents: [],
        };
      }

      // Convert document to plain object and add id field for consistency
      const docObj = doc.toObject();
      docObj.id = docObj._id.toString();

      acc[folder].years[year].tenants[tenantId].documents.push(docObj);

      acc[folder].years[year].tenants[tenantId].uploaders[
        uploadedById
      ].documents.push(docObj);

      return acc;
    }, {});

    const result = Object.values(organizedDocuments).map((folder) => {
      folder.years = Object.values(folder.years).map((year) => {
        year.tenants = Object.values(year.tenants).map((tenant) => {
          tenant.uploaders = Object.values(tenant.uploaders);
          return tenant;
        });
        return year;
      });
      return folder;
    });

    return res.status(200).json({
      success: true,
      documents: result,
    });
  } catch (error) {
    console.error('Error fetching organized documents:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch documents',
      error: error.message,
    });
  }
};

export const getDocumentsByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const companyId = req.query.companyId || req.user?.companyId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required for security',
      });
    }

    // Find documents for this specific user AND company
    const documents = await Document.find({
      userId,
      companyId, // Ensure documents are company-specific
    })
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 });

    const documentsWithUrls = await Promise.all(
      documents.map(async (doc) => {
        const docObject = doc.toObject();
        try {
          const viewCommand = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: doc.fileKey,
            ResponseContentDisposition: 'inline',
            ResponseContentType: doc.fileType,
          });

          const downloadCommand = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: doc.fileKey,
            ResponseContentDisposition: `attachment; filename="${doc.name}"`,
            ResponseContentType: doc.fileType,
          });

          const [viewUrl, downloadUrl] = await Promise.all([
            s3GetSignedUrl(s3Client, viewCommand, { expiresIn: 3600 }),
            s3GetSignedUrl(s3Client, downloadCommand, { expiresIn: 3600 }),
          ]);

          const sizeInMB = (docObject.fileSize / (1024 * 1024)).toFixed(2);

          return {
            id: docObject._id,
            name: docObject.name,
            category: docObject.category,
            userId: docObject.userId,
            companyId: docObject.companyId,
            uploadDate: new Date(docObject.createdAt).toLocaleString(),
            size: `${sizeInMB} MB`,
            type: docObject.fileType.split('/')[1].toUpperCase(),
            uploadedBy: docObject.uploadedBy,
            tags: docObject.tags,
            folderName:
              docObject.folderName || docObject.uploadedYear?.toString(),
            viewUrl,
            downloadUrl,
          };
        } catch (err) {
          console.error(`Error processing document ${doc._id}:`, err);
          return {
            ...docObject,
            id: docObject._id,
            folderName:
              docObject.folderName || docObject.uploadedYear?.toString(),
            viewUrl: null,
            downloadUrl: null,
            error: 'Error generating URLs',
          };
        }
      })
    );

    // Only include folders that have documents (no empty default folders)
    const groupedDocuments = documentsWithUrls.reduce((acc, doc) => {
      const folder = doc.folderName || 'General';
      if (!acc[folder]) {
        acc[folder] = [];
      }
      acc[folder].push(doc);
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      count: documentsWithUrls.length,
      documents: groupedDocuments,
    });
  } catch (error) {
    console.error('Error fetching tenant documents:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching documents',
      error: error.message,
    });
  }
};

export const serveDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Get the public URL for the document
    const publicUrl = getPublicUrl(document.fileKey);

    return res.redirect(publicUrl);
  } catch (error) {
    console.error('Error in serveDocument:', error);
    return res.status(500).json({
      success: false,
      message: 'Error serving document',
      error: error.message,
    });
  }
};

export const downloadDocumentDirect = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Get the public URL for the document
    const publicUrl = getPublicUrl(document.fileKey);

    // Redirect to the public URL with download disposition
    return res.redirect(publicUrl);
  } catch (error) {
    console.error('Error in downloadDocumentDirect:', error);
    return res.status(500).json({
      success: false,
      message: 'Error downloading document',
      error: error.message,
    });
  }
};

const getPublicUrl = (fileKey) => {
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
};

export const getDocumentsByHcm = async (req, res) => {
  try {
    const { userId } = req.params;
    const companyId = req.query.companyId || req.user?.companyId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID is required',
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required for security',
      });
    }

    // Find documents for this specific HCM AND company
    const documents = await Document.find({
      userId,
      companyId, // Ensure documents are company-specific
    })
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 });

    const documentsWithUrls = await Promise.all(
      documents.map(async (doc) => {
        const docObject = doc.toObject();
        try {
          const viewCommand = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: doc.fileKey,
            ResponseContentDisposition: 'inline',
            ResponseContentType: doc.fileType,
          });

          const downloadCommand = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: doc.fileKey,
            ResponseContentDisposition: `attachment; filename="${doc.name}"`,
            ResponseContentType: doc.fileType,
          });

          const [viewUrl, downloadUrl] = await Promise.all([
            s3GetSignedUrl(s3Client, viewCommand, { expiresIn: 3600 }),
            s3GetSignedUrl(s3Client, downloadCommand, { expiresIn: 3600 }),
          ]);

          const sizeInMB = (docObject.fileSize / (1024 * 1024)).toFixed(2);

          return {
            id: docObject._id,
            name: docObject.name,
            category: docObject.category,
            userId: docObject.userId,
            companyId: docObject.companyId,
            uploadDate: new Date(docObject.createdAt).toLocaleString(),
            size: `${sizeInMB} MB`,
            type: docObject.fileType.split('/')[1].toUpperCase(),
            uploadedBy: docObject.uploadedBy,
            tags: docObject.tags,
            folderName:
              docObject.folderName || docObject.uploadedYear?.toString(),
            viewUrl,
            downloadUrl,
          };
        } catch (err) {
          console.error(`Error processing document ${doc._id}:`, err);
          return {
            ...docObject,
            id: docObject._id,
            folderName:
              docObject.folderName || docObject.uploadedYear?.toString(),
            viewUrl: null,
            downloadUrl: null,
            error: 'Error generating URLs',
          };
        }
      })
    );

    // Only include folders that have documents (no empty default folders)
    const groupedDocuments = documentsWithUrls.reduce((acc, doc) => {
      const folder = doc.folderName || 'General';
      if (!acc[folder]) {
        acc[folder] = [];
      }
      acc[folder].push(doc);
      return acc;
    }, {});

    // Group by year within each folder
    const foldersByYear = {};
    Object.keys(groupedDocuments).forEach((folderName) => {
      const folderDocs = groupedDocuments[folderName];
      foldersByYear[folderName] = folderDocs.reduce((acc, doc) => {
        const date = new Date(doc.uploadDate);
        const year = date.getFullYear().toString();
        if (!acc[year]) {
          acc[year] = [];
        }
        acc[year].push(doc);
        return acc;
      }, {});
    });

    return res.status(200).json({
      success: true,
      count: documentsWithUrls.length,
      documents: foldersByYear,
    });
  } catch (error) {
    console.error('Error fetching HCM documents:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching documents',
      error: error.message,
    });
  }
};

export const createFolderOnly = async (req, res) => {
  try {
    const {
      folderName,
      uploadedBy,
      companyId,
      userId,
      isPublic = false,
    } = req.body;

    if (!folderName || !companyId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'folderName, companyId, and userId are required',
      });
    }

    const uploadedYear = new Date().getFullYear();

    const folderDocument = new Document({
      folderName,
      uploadedYear,
      isFolderOnly: true,
      isPublic,
      uploadedBy,
      userId,
      companyId,
      name: folderName,
    });

    const savedFolder = await folderDocument.save();

    return res.status(201).json({
      success: true,
      message: 'Folder created successfully',
      folder: savedFolder,
    });
  } catch (error) {
    console.error('Error creating folder:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const deleteFolder = async (req, res) => {
  // delete empty folders only
  // if not empty, return error
  try {
    const { folderId } = req.params;
    if (!folderId) {
      return res.status(400).json({
        success: false,
        message: 'Folder ID is required',
      });
    }

    const folder = await Document.findById(folderId);
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found',
      });
    }

    // Check if the folder is empty
    const hasDocuments = await Document.exists({
      folderName: folder.folderName,
      companyId: folder.companyId,
      isFolderOnly: false,
      userId: folder.userId,
    });

    if (hasDocuments) {
      return res.status(400).json({
        success: false,
        message: 'Folder is not empty. Please delete documents inside first.',
      });
    }

    // Delete the folder
    await Document.findByIdAndDelete(folderId);
    return res.status(200).json({
      success: true,
      message: 'Folder deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting folder:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const getAllFoldersForHCM = async (req, res) => {
  try {
    const { userId } = req.params;

    const userDetails = await users.findById(userId);
    if (!userDetails) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // ✅ Only allow role 1 (HCM)
    if (userDetails.role !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only HCM can view folders.',
      });
    }

    // ✅ Fetch public folders (excluding tenant-created and self-created)
    const rawPublicFolders = await Document.find({
      isFolderOnly: true,
      isPublic: true,
      companyId: userDetails.companyId,
      userId: { $ne: userId },
    })
      .populate({ path: 'userId', select: 'role' }) // needed for filtering
      .populate({ path: 'uploadedBy', select: 'name email phone' }); // ✅ get uploader info

    const publicFolders = rawPublicFolders.filter(
      (folder) => folder.userId?.role !== 0
    );

    // ✅ Private folders created by this HCM
    const privateFoldersAndFiles = await Document.find({
      userId: userId,
      companyId: userDetails.companyId,
    }).populate({ path: 'uploadedBy', select: 'name email phone' });

    // ✅ Combine and group by folder name
    const allFolders = [...publicFolders, ...privateFoldersAndFiles].reduce(
      (acc, doc) => {
        const folderName = doc.folderName || 'General';
        if (!acc[folderName]) {
          acc[folderName] = [];
        }
        acc[folderName].push(doc);
        return acc;
      },
      {}
    );

    return res.status(200).json({
      success: true,
      folders: allFolders,
    });
  } catch (error) {
    console.error('Error fetching folders for HCM:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching folders',
      error: error.message,
    });
  }
};

export const getAllFoldersForTenant = async (req, res) => {
  try {
    const { userId } = req.params;

    const userDetails = await users.findById(userId);
    if (!userDetails) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // ✅ Only allow role 0 (Tenant)
    if (userDetails.role !== 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Tenant can view folders.',
      });
    }

    // ✅ Fetch public folders (excluding HCM-created and self-created)
    const rawPublicFolders = await Document.find({
      isFolderOnly: true,
      isPublic: true,
      companyId: userDetails.companyId,
      userId: { $ne: userId },
    })
      .populate({ path: 'userId', select: 'role' }) // needed for filtering
      .populate({ path: 'uploadedBy', select: 'name email phone' }); // ✅ get uploader info

    const publicFolders = rawPublicFolders.filter(
      (folder) => folder.userId?.role !== 1
    );

    // ✅ Private folders created by this Tenant
    const privateFoldersAndFiles = await Document.find({
      userId: userId,
      companyId: userDetails.companyId,
    }).populate({ path: 'uploadedBy', select: 'name email phone' });

    // ✅ Combine and group by folder name
    const allFolders = [...publicFolders, ...privateFoldersAndFiles].reduce(
      (acc, doc) => {
        const folderName = doc.folderName || 'General';
        if (!acc[folderName]) {
          acc[folderName] = [];
        }
        acc[folderName].push(doc);
        return acc;
      },
      {}
    );

    return res.status(200).json({
      success: true,
      folders: allFolders,
    });
  } catch (error) {
    console.error('Error fetching folders for Tenant:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching folders',
      error: error.message,
    });
  }
};

export const getAllFodersForAdmin = async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required',
      });
    }

    const allDocuments = await Document.find({ companyId }).populate([
      { path: 'userId', select: 'role name' },
      { path: 'uploadedBy', select: 'name email phone' },
    ]);

    let totalFolders = 0;
    let totalPrivateFolders = 0;
    let totalPublicFolders = 0;
    let totalUploadedFiles = 0;
    let totalTenantsUploaded = 0;
    let totalHcmsUploaded = 0;

    const tenantUploadedDocuments = {};
    const hcmUploadedDocuments = {};

    allDocuments.forEach((doc) => {
      const folderName = doc.folderName || 'General';
      const year =
        doc.uploadedYear?.toString() || new Date().getFullYear().toString();
      const isFolder = doc.isFolderOnly;
      const isPublic = doc.isPublic;
      const role = doc.userId?.role;
      const uploaderName = doc.userId?.name || 'Unknown'; // ✅ Updated here

      if (isFolder) {
        totalFolders++;
        isPublic ? totalPublicFolders++ : totalPrivateFolders++;

        const target =
          role === 0
            ? tenantUploadedDocuments
            : role === 1
            ? hcmUploadedDocuments
            : null;

        if (target) {
          if (!target[uploaderName]) target[uploaderName] = {};
          if (!target[uploaderName][year]) target[uploaderName][year] = {};
          if (!target[uploaderName][year][folderName]) {
            target[uploaderName][year][folderName] = [];
          }
        }
      } else {
        totalUploadedFiles++;

        const target =
          role === 0
            ? tenantUploadedDocuments
            : role === 1
            ? hcmUploadedDocuments
            : null;

        if (target) {
          role === 0 ? totalTenantsUploaded++ : totalHcmsUploaded++;

          if (!target[uploaderName]) target[uploaderName] = {};
          if (!target[uploaderName][year]) target[uploaderName][year] = {};
          if (!target[uploaderName][year][folderName]) {
            target[uploaderName][year][folderName] = [];
          }

          target[uploaderName][year][folderName].push(doc);
        }
      }
    });

    return res.status(200).json({
      success: true,
      totalFolders,
      totalPrivateFolders,
      totalPublicFolders,
      totalUploadedFiles,
      totalTenantsUploaded,
      totalHcmsUploaded,
      tenantUploadedDocuments,
      hcmUploadedDocuments,
    });
  } catch (error) {
    console.error('Error fetching folders for admin:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching folders',
      error: error.message,
    });
  }
};
