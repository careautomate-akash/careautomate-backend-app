import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { getAllHCMsTenants, getUserContacts } from '../../controllers/hcm-tenants/fetchAllController.js';

const router = express.Router();

//routing 
router.get("/fetchAllHCMsTenants", authenticateToken, getAllHCMsTenants);
export default router;

// Add new route for user contacts
router.get("/get-user-contacts/:userId", authenticateToken, getUserContacts);