import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import {
  applyDynamicFilters,
  updateVisitStatus,
  generateBatchEDI,
  getBatches,
  generateIndividualVisitEDI,
  getPayerWiseAmount,
  getPayerWiseMonthlyAmount,
  getPayerNames,
  generateEDIHandler,
  storeBatchDetails,
  getBatchesofCompany,
  getVisitHistory,
} from '../../controllers/bills-service-tracking/dynamicBillController.js';
import batchProcessingService from '../../services/batchProcessingService.js';

const router = express.Router();

// Apply middleware to all routes
router.use(authenticateToken);

/**
 * @route POST /api/dynamic-claims/filters
 * @desc Apply dynamic filters to get visits and organize them into batches/claims
 * @access Private
 */
router.post('/filters', applyDynamicFilters);

router.post('/payer-wise-amount', getPayerWiseAmount);

router.post('/payer-wise-monthly-amount', getPayerWiseMonthlyAmount);

router.post('/payer-names', getPayerNames);

router.post('/batches', storeBatchDetails);

router.get('/batches/:companyId', getBatchesofCompany);

router.post('/visit/history', getVisitHistory);

/**
 * @route POST /api/dynamic-claims/visits/update-status
 * @desc Update visit status (schedule, submit, cancel, bill)
 * @access Private
 */
router.post('/visits/update-status', updateVisitStatus);

/**
 * @route POST /api/dynamic-claims/batch/:batchId/edi
 * @desc Generate EDI files for a batch or claim
 * @access Private
 */
router.post('/batch/:batchId/edi', generateBatchEDI);

/**
 * @route POST /api/dynamic-claims/batch/:batchId/edi-background
 * @desc Queue background EDI generation for a batch
 * @access Private
 */
router.post('/batch/:batchId/edi-background', async (req, res) => {
  try {
    const { batchId } = req.params;
    const { companyId, claimId } = req.body;
    const userId = req.user?.id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required',
      });
    }

    // Queue background EDI generation job
    const jobId = batchProcessingService.queueBatchJob({
      type: 'BATCH_EDI_GENERATION',
      priority: 'medium',
      companyId,
      userId,
      data: {
        batchId,
        claimId,
        companyId,
      },
      maxAttempts: 2,
    });

    res.status(202).json({
      success: true,
      message: 'EDI generation queued for background processing',
      data: {
        jobId,
        batchId,
        claimId,
        estimatedTime: '2-10 minutes',
        status: 'queued',
      },
    });
  } catch (error) {
    console.error('Error queueing EDI generation:', error);
    res.status(500).json({
      success: false,
      message: 'Error queueing EDI generation',
      error: error.message,
    });
  }
});

/**
 * @route POST /api/dynamic-claims/individual-visit/:visitId/edi
 * @desc Generate EDI file for a single visit
 * @access Private
 */
router.post('/individual-visit/:visitId/edi', generateIndividualVisitEDI);

/**
 * @route POST /api/dynamic-claims/individual-visit/:visitId/edi-background
 * @desc Queue background EDI generation for a single visit
 * @access Private
 */
router.post('/individual-visit/:visitId/edi-background', async (req, res) => {
  try {
    const { visitId } = req.params;
    const { companyId } = req.body;
    const userId = req.user?.id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required',
      });
    }

    // Queue background EDI generation job
    const jobId = batchProcessingService.queueBatchJob({
      type: 'INDIVIDUAL_VISIT_EDI_GENERATION',
      priority: 'medium',
      companyId,
      userId,
      data: {
        visitId,
        companyId,
      },
      maxAttempts: 2,
    });

    res.status(202).json({
      success: true,
      message:
        'Individual visit EDI generation queued for background processing',
      data: {
        jobId,
        visitId,
        estimatedTime: '2-10 minutes',
        status: 'queued',
      },
    });
  } catch (error) {
    console.error('Error queueing individual visit EDI generation:', error);
    res.status(500).json({
      success: false,
      message: 'Error queueing individual visit EDI generation',
      error: error.message,
    });
  }
});

/**
 * @route GET /api/dynamic-claims/batches/:companyId
 * @desc Get batches for a company with filtering and pagination
 * @access Private
 */
router.get('/batches/:companyId', getBatches);

/**
 * @route POST /api/dynamic-claims/visits/bulk-update
 * @desc Bulk update multiple visits with different actions
 * @access Private
 */
router.post('/visits/bulk-update', async (req, res) => {
  try {
    const {
      companyId,
      operations = [], // Array of { visitIds: [], action: 'schedule|submit|cancel|bill', scheduledDate?, cancellationReason? }
    } = req.body;

    const userId = req.user?.id;

    if (!companyId || operations.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Company ID and operations are required',
      });
    }

    const allResults = {
      successful: [],
      failed: [],
    };

    // Process each operation
    for (const operation of operations) {
      const { visitIds, action, scheduledDate, cancellationReason } = operation;

      // Call the updateVisitStatus function for each operation
      const mockReq = {
        body: {
          visitIds,
          action,
          scheduledDate,
          cancellationReason,
          companyId,
        },
        user: { id: userId },
      };

      const mockRes = {
        json: (data) => data,
        status: (code) => ({ json: (data) => ({ statusCode: code, ...data }) }),
      };

      try {
        const result = await updateVisitStatus(mockReq, mockRes);
        if (result.success) {
          allResults.successful.push(...result.data.results.successful);
          allResults.failed.push(...result.data.results.failed);
        } else {
          allResults.failed.push(
            ...visitIds.map((id) => ({
              visitId: id,
              error: result.message,
            }))
          );
        }
      } catch (error) {
        allResults.failed.push(
          ...visitIds.map((id) => ({
            visitId: id,
            error: error.message,
          }))
        );
      }
    }

    res.status(200).json({
      success: true,
      message: `Bulk update completed: ${allResults.successful.length} successful, ${allResults.failed.length} failed`,
      data: {
        results: allResults,
        summary: {
          totalOperations: operations.length,
          totalVisits: operations.reduce(
            (sum, op) => sum + op.visitIds.length,
            0
          ),
          successful: allResults.successful.length,
          failed: allResults.failed.length,
        },
      },
    });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({
      success: false,
      message: 'Error in bulk update',
      error: error.message,
    });
  }
});

/**
 * @route GET /api/dynamic-claims/job/:jobId/status
 * @desc Get status of a background job
 * @access Private
 */
router.get('/job/:jobId/status', async (req, res) => {
  try {
    const { jobId } = req.params;

    const jobStatus = batchProcessingService.getJobStatus(jobId);

    if (!jobStatus) {
      return res.status(404).json({
        success: false,
        message: 'Job not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Job status retrieved successfully',
      data: jobStatus,
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting job status',
      error: error.message,
    });
  }
});

router.post('/batch/v2/generate-edi', generateEDIHandler);

export default router;
