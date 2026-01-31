import express from 'express';
import multer from 'multer';
import sftpUploader from '../../utils/sftpUploader.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const localPath = req.file.path;
    const remotePath = req.file.originalname;

    await sftpUploader(localPath, remotePath);

    res
      .status(200)
      .json({ success: true, message: 'File uploaded to SFTP successfully.' });
  } catch (err) {
    console.error('SFTP Upload Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
