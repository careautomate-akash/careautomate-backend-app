// routes/billRoutes.js
import express from 'express';
import fetch from 'node-fetch';
import {
    getTenantsRunningByUnits,
    planUsage,
    markBillAsPaid,
    getBillsDone,
    getBillsPending,
    getBillsRejected,
    getBillClaim,
    getPendingEdis,
    getBillsPendingCount,
    getHcmClaims,
    getTenantClaims,
    updateBillStatus,
    generateAndUploadEdi,

    getClaimVisits,
    updatePlanUsage,
    deleteAllBills,
    updateBatchStatus,
    cancelBatch,
} from '../../controllers/bills-service-tracking/billController.js';
import { authenticateToken } from '../../middleware/auth.js';
// Import only what we need from mnitsUploader
import {
    processAndUploadMnItsEDIs,
    testMnItsConnection
} from '../../utils/mnitsUploader.js';

const router = express.Router();

// Standard routes for bill management
router.get('/tenants-running-out-of-units/:companyId', authenticateToken, getTenantsRunningByUnits);
router.post('/plan-usage', authenticateToken, planUsage);
router.post("/mark-bill-as-paid/:companyId", authenticateToken, markBillAsPaid);
router.get('/get-bills-done/:companyId', authenticateToken, getBillsDone);
router.get('/get-bills-pending/:companyId', authenticateToken, getBillsPending);
router.get("/get-bill-claim/:companyId", authenticateToken, getBillClaim);
router.get('/get-bills-rejected', authenticateToken, getBillsRejected);

router.post('/get-pending-edis/:companyId', authenticateToken, getPendingEdis);
router.get('/get-pending-bills-count/:companyId', authenticateToken, getBillsPendingCount);
router.post('/update-bill-status', authenticateToken, updateBillStatus);
router.post('/update-batch-status', authenticateToken, updateBillStatus);

///TENANT CLAIMS
router.get("/get-tenant-claims/:tenantId", authenticateToken, getTenantClaims);
///HCM CLAIMS
router.get('/get-hcm-claims/:hcmId', authenticateToken, getHcmClaims);

// Google Drive EDI upload route
router.post('/generate-upload-edi/:billId', authenticateToken, generateAndUploadEdi);

// SINGLE MN-ITS UPLOAD ROUTE - The only route for MN-ITS
router.post('/process-mnits-claims', authenticateToken, async (req, res) => {
    try {
        // Call the function that handles everything in one go
        const result = await processAndUploadMnItsEDIs();

        return res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
        console.error('Error in MN-ITS processing and upload:', error);
        return res.status(500).json({
            success: false,
            message: 'Error in MN-ITS processing and upload',
            error: error.message
        });
    }
});

// Test MN-ITS Connection
router.get('/test-mnits-connection', authenticateToken, async (req, res) => {
    try {
        const result = await testMnItsConnection();
        return res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Error testing MN-ITS connection',
            error: error.message
        });
    }
});

// Check VPN and Upload to MN-ITS (Complete Solution)
router.post('/check-vpn-and-upload-mnits', authenticateToken, async (req, res) => {
    try {
        // Check VPN connection first
        const vpnCheck = await fetch('https://mn-its.dhs.state.mn.us/gatewayweb/login', {
            method: 'HEAD',
            timeout: 10000
        });

        if (!vpnCheck.ok) {
            return res.status(400).json({
                success: false,
                message: 'VPN connection required',
                error: 'Cannot reach MN-ITS web interface. Please connect to VPN first.',
                instructions: [
                    '1. Connect to your VPN',
                    '2. Verify you can access https://mn-its.dhs.state.mn.us/gatewayweb/login in browser',
                    '3. Try this upload again'
                ]
            });
        }

        // If VPN is connected, proceed with upload
        const result = await processAndUploadMnItsEDIs();

        return res.status(result.success ? 200 : 500).json({
            ...result,
            vpnStatus: 'Connected and verified'
        });

    } catch (error) {
        console.error('Error in VPN check and MN-ITS upload:', error);
        return res.status(500).json({
            success: false,
            message: 'Error in VPN check and MN-ITS upload',
            error: error.message
        });
    }
});

// Add the new route for getting claim visits
router.get('/get-claim-visits/:claimId', authenticateToken, getClaimVisits);

// Add the new route for deleting all bills
router.delete('/delete-all-bills', authenticateToken, deleteAllBills);

// Add new routes for batch operations

router.post('/update-batch-status', authenticateToken, updateBatchStatus);

// Add route for cancelling individual claims
router.post('/cancel-batch', authenticateToken, cancelBatch);

export default router;