/**
 * Batch Processing Service
 * Handles background job processing for dynamic claims system
 */

import { EventEmitter } from 'events';

class BatchProcessingService extends EventEmitter {
    constructor() {
        super();
        this.jobs = new Map();
        this.jobQueue = [];
        this.isProcessing = false;
        this.maxConcurrentJobs = 3;
        this.currentJobs = 0;

        // Start processing queue
        this.startProcessing();
    }

    /**
     * Queue a new batch job
     * @param {Object} jobData - Job configuration
     * @returns {string} Job ID
     */
    queueBatchJob(jobData) {
        const jobId = this.generateJobId();
        const job = {
            id: jobId,
            type: jobData.type,
            priority: jobData.priority || 'medium',
            companyId: jobData.companyId,
            userId: jobData.userId,
            data: jobData.data,
            status: 'queued',
            createdAt: new Date(),
            attempts: 0,
            maxAttempts: jobData.maxAttempts || 3,
            progress: 0,
            result: null,
            error: null
        };

        this.jobs.set(jobId, job);
        this.jobQueue.push(jobId);

        // Sort queue by priority
        this.sortQueueByPriority();

        // Emit job queued event
        this.emit('jobQueued', job);

        // Try to process immediately if not at capacity
        this.processNext();

        return jobId;
    }

    /**
     * Get job status
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job status
     */
    getJobStatus(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return null;

        return {
            id: job.id,
            type: job.type,
            status: job.status,
            progress: job.progress,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            result: job.result,
            error: job.error,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts
        };
    }

    /**
     * Cancel a job
     * @param {string} jobId - Job ID
     * @returns {boolean} Success status
     */
    cancelJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return false;

        if (job.status === 'queued') {
            job.status = 'cancelled';
            this.removeFromQueue(jobId);
            this.emit('jobCancelled', job);
            return true;
        }

        return false;
    }

    /**
     * Start processing jobs from the queue
     */
    startProcessing() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        setInterval(() => {
            this.processNext();
        }, 1000); // Check every second
    }

    /**
     * Process the next job in queue
     */
    async processNext() {
        if (this.currentJobs >= this.maxConcurrentJobs || this.jobQueue.length === 0) {
            return;
        }

        const jobId = this.jobQueue.shift();
        const job = this.jobs.get(jobId);

        if (!job || job.status !== 'queued') {
            return;
        }

        this.currentJobs++;
        job.status = 'processing';
        job.startedAt = new Date();
        job.attempts++;

        this.emit('jobStarted', job);

        try {
            const result = await this.executeJob(job);

            job.status = 'completed';
            job.completedAt = new Date();
            job.result = result;
            job.progress = 100;

            this.emit('jobCompleted', job);
        } catch (error) {
            console.error(`Job ${jobId} failed:`, error);

            job.error = {
                message: error.message,
                stack: error.stack,
                timestamp: new Date()
            };

            if (job.attempts < job.maxAttempts) {
                // Retry the job
                job.status = 'queued';
                this.jobQueue.unshift(jobId); // Add to front for retry
                this.emit('jobRetry', job);
            } else {
                // Max attempts reached
                job.status = 'failed';
                job.completedAt = new Date();
                this.emit('jobFailed', job);
            }
        } finally {
            this.currentJobs--;
        }
    }

    /**
     * Execute a specific job based on its type
     * @param {Object} job - Job object
     * @returns {Promise<any>} Job result
     */
    async executeJob(job) {
        switch (job.type) {
            case 'LARGE_DATASET_CLAIMS':
                return await this.processLargeDatasetClaims(job);
            case 'BATCH_EDI_GENERATION':
                return await this.processBatchEDIGeneration(job);
            case 'BATCH_SUBMISSION':
                return await this.processBatchSubmission(job);
            case 'BATCH_VALIDATION':
                return await this.processBatchValidation(job);
            default:
                throw new Error(`Unknown job type: ${job.type}`);
        }
    }

    /**
     * Process large dataset claims generation
     * @param {Object} job - Job object
     * @returns {Promise<Object>} Result
     */
    async processLargeDatasetClaims(job) {
        const { generateDynamicClaims } = await import('../controllers/bills-service-tracking/dynamicBillController.js');

        // Update progress periodically
        const progressInterval = setInterval(() => {
            job.progress = Math.min(job.progress + 10, 90);
            this.emit('jobProgress', job);
        }, 5000);

        try {
            // Simulate the claims generation process
            const result = await this.simulateClaimsGeneration(job.data);

            clearInterval(progressInterval);
            job.progress = 100;

            return result;
        } catch (error) {
            clearInterval(progressInterval);
            throw error;
        }
    }

    /**
     * Process batch EDI generation
     * @param {Object} job - Job object
     * @returns {Promise<Object>} Result
     */
    async processBatchEDIGeneration(job) {
        const { generateBatchEDI } = await import('../controllers/bills-service-tracking/dynamicBillController.js');

        // Update progress
        job.progress = 25;
        this.emit('jobProgress', job);

        // Simulate EDI generation
        const result = await this.simulateEDIGeneration(job.data);

        job.progress = 100;
        return result;
    }

    /**
     * Process batch submission
     * @param {Object} job - Job object
     * @returns {Promise<Object>} Result
     */
    async processBatchSubmission(job) {
        const { submitBatches } = await import('../controllers/bills-service-tracking/dynamicBillController.js');

        // Update progress
        job.progress = 50;
        this.emit('jobProgress', job);

        // Simulate submission
        const result = await this.simulateSubmission(job.data);

        job.progress = 100;
        return result;
    }

    /**
     * Process batch validation
     * @param {Object} job - Job object
     * @returns {Promise<Object>} Result
     */
    async processBatchValidation(job) {
        // Update progress
        job.progress = 75;
        this.emit('jobProgress', job);

        // Simulate validation
        const result = await this.simulateValidation(job.data);

        job.progress = 100;
        return result;
    }

    /**
     * Simulate claims generation for demo purposes
     */
    async simulateClaimsGeneration(data) {
        await this.delay(3000); // Simulate processing time

        return {
            batchClaim: {
                batchId: `BATCH_${Date.now()}`,
                claimsGenerated: Math.floor(Math.random() * 50) + 10,
                totalAmount: Math.floor(Math.random() * 10000) + 1000
            },
            claimGroups: [],
            summary: {
                totalGroups: Math.floor(Math.random() * 10) + 1,
                totalVisits: Math.floor(Math.random() * 100) + 20
            }
        };
    }

    /**
     * Simulate EDI generation for demo purposes
     */
    async simulateEDIGeneration(data) {
        await this.delay(2000); // Simulate processing time

        return {
            ediFileName: `BATCH_${data.batchId}_${Date.now()}.dat`,
            claimsProcessed: Math.floor(Math.random() * 20) + 5,
            fileSize: Math.floor(Math.random() * 50000) + 10000
        };
    }

    /**
     * Simulate submission for demo purposes
     */
    async simulateSubmission(data) {
        await this.delay(1500); // Simulate processing time

        return {
            results: data.batchIds.map(batchId => ({
                batchId,
                success: Math.random() > 0.1, // 90% success rate
                confirmationNumber: `CONF_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
            })),
            summary: {
                totalSubmitted: data.batchIds.length,
                totalFailed: 0
            }
        };
    }

    /**
     * Simulate validation for demo purposes
     */
    async simulateValidation(data) {
        await this.delay(1000); // Simulate processing time

        return {
            isValid: Math.random() > 0.2, // 80% valid rate
            validationErrors: [],
            warnings: []
        };
    }

    /**
     * Utility methods
     */
    generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    sortQueueByPriority() {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };

        this.jobQueue.sort((a, b) => {
            const jobA = this.jobs.get(a);
            const jobB = this.jobs.get(b);
            return priorityOrder[jobB.priority] - priorityOrder[jobA.priority];
        });
    }

    removeFromQueue(jobId) {
        const index = this.jobQueue.indexOf(jobId);
        if (index > -1) {
            this.jobQueue.splice(index, 1);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get queue statistics
     */
    getQueueStats() {
        const stats = {
            totalJobs: this.jobs.size,
            queuedJobs: 0,
            processingJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            currentJobs: this.currentJobs,
            maxConcurrentJobs: this.maxConcurrentJobs
        };

        for (const job of this.jobs.values()) {
            switch (job.status) {
                case 'queued':
                    stats.queuedJobs++;
                    break;
                case 'processing':
                    stats.processingJobs++;
                    break;
                case 'completed':
                    stats.completedJobs++;
                    break;
                case 'failed':
                    stats.failedJobs++;
                    break;
            }
        }

        return stats;
    }

    /**
     * Clean up old completed jobs
     */
    cleanupOldJobs(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
        const cutoffTime = new Date(Date.now() - maxAge);

        for (const [jobId, job] of this.jobs.entries()) {
            if ((job.status === 'completed' || job.status === 'failed') &&
                job.completedAt && job.completedAt < cutoffTime) {
                this.jobs.delete(jobId);
            }
        }
    }
}

// Create singleton instance
const batchProcessingService = new BatchProcessingService();

// Clean up old jobs every hour
setInterval(() => {
    batchProcessingService.cleanupOldJobs();
}, 60 * 60 * 1000);

export default batchProcessingService; 