import express from 'express';

import { fetchSecurityDetails, updateSecurityDetails, fetchPreferences, updatePreferences, insertSettingsData, fetchSettingsData } from '../../controllers/account/settingsController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

router.post('/insert-settings-data', authenticateToken, insertSettingsData);

router.get('/get-account-security-details', authenticateToken, fetchSecurityDetails);
router.put('/update-account-security-details/:id', authenticateToken, updateSecurityDetails);

router.get('/get-account-preferences-details', authenticateToken, fetchPreferences);
router.put('/update-account-preferences-details/:id', authenticateToken, updatePreferences);

router.post('/get-account-settings-data', authenticateToken, fetchSettingsData);

export default router;