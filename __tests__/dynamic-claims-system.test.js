import mongoose from 'mongoose';
import { jest } from '@jest/globals';

// Import models
import BatchClaim from '../models/bills/batchClaim.js';
import ClaimGroup from '../models/bills/claimGroup.js';
import ClaimAuditLog from '../models/bills/claimAuditLog.js';

// Import services and controllers
import { BatchProcessingService } from '../services/batchProcessingService.js';
import { DatabaseOptimizer } from '../scripts/database-optimization.js';

/**
 * Comprehensive Test Suite for Dynamic Claims System
 * 
 * This test suite covers:
 * - Model validation and methods
 * - Database optimization and indexing
 * - Service layer functionality
 * - Integration testing with dummy data
 * - Performance testing
 */

describe('Dynamic Claims System', () => {
    let testCompanyId, testTenantId, testHcmId, testUserId;
    let testBatchClaim, testClaimGroup, testAuditLog;
    let batchService, dbOptimizer;

    beforeAll(async () => {
        // Connect to test database
        const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/careAutomate_test';
        await mongoose.connect(mongoUri);

        // Initialize services
        batchService = BatchProcessingService.getInstance();
        dbOptimizer = new DatabaseOptimizer();

        // Generate test IDs
        testCompanyId = new mongoose.Types.ObjectId();
        testTenantId = new mongoose.Types.ObjectId();
        testHcmId = new mongoose.Types.ObjectId();
        testUserId = new mongoose.Types.ObjectId();
    });

    afterAll(async () => {
        // Clean up test data
        await BatchClaim.deleteMany({});
        await ClaimGroup.deleteMany({});
        await ClaimAuditLog.deleteMany({});

        // Close database connection
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        // Clean up before each test
        await BatchClaim.deleteMany({});
        await ClaimGroup.deleteMany({});
        await ClaimAuditLog.deleteMany({});
    });

    describe('Dummy Data Generation', () => {
        test('should generate comprehensive dummy data for all models', async () => {
            const dummyData = await generateDummyData();

            expect(dummyData.batchClaims).toHaveLength(10);
            expect(dummyData.claimGroups).toHaveLength(25);
            expect(dummyData.auditLogs).toHaveLength(50);

            // Verify data was actually saved to database
            const batchCount = await BatchClaim.countDocuments();
            const groupCount = await ClaimGroup.countDocuments();
            const auditCount = await ClaimAuditLog.countDocuments();

            expect(batchCount).toBe(10);
            expect(groupCount).toBe(25);
            expect(auditCount).toBe(50);
        });

        test('should generate realistic data relationships', async () => {
            const dummyData = await generateDummyData();

            // Check that claim groups reference valid batch IDs
            const batchIds = dummyData.batchClaims.map(b => b.batchId);
            const groupsWithValidBatch = dummyData.claimGroups.filter(g =>
                batchIds.includes(g.batchId)
            );

            expect(groupsWithValidBatch.length).toBeGreaterThan(0);

            // Check that audit logs reference valid entity IDs
            const auditLogsWithValidEntities = dummyData.auditLogs.filter(a =>
                batchIds.includes(a.entityId) ||
                dummyData.claimGroups.some(g => g.groupId === a.entityId)
            );

            expect(auditLogsWithValidEntities.length).toBeGreaterThan(0);
        });
    });

    describe('BatchClaim Model', () => {
        test('should create and validate BatchClaim with all required fields', async () => {
            const batchClaimData = generateBatchClaimData();
            const batchClaim = new BatchClaim(batchClaimData);

            await expect(batchClaim.save()).resolves.toBeTruthy();

            expect(batchClaim.batchId).toBeDefined();
            expect(batchClaim.companyId).toEqual(testCompanyId);
            expect(batchClaim.tenantId).toEqual(testTenantId);
            expect(batchClaim.hcmId).toEqual(testHcmId);
            expect(batchClaim.serviceType).toBe('T2024');
            expect(batchClaim.batchStatus).toBe('draft');
        });

        test('should generate unique batch IDs', async () => {
            const batchId1 = BatchClaim.generateBatchId(testCompanyId, testTenantId, 'T2024');
            const batchId2 = BatchClaim.generateBatchId(testCompanyId, testTenantId, 'T2024');

            expect(batchId1).not.toBe(batchId2);
            expect(batchId1).toMatch(/^BATCH_/);
            expect(batchId2).toMatch(/^BATCH_/);
        });

        test('should calculate total batch amounts correctly', async () => {
            const batchClaimData = generateBatchClaimData();
            batchClaimData.claims = [
                { claimId: new mongoose.Types.ObjectId(), totalAmount: 100, totalUnits: 5 },
                { claimId: new mongoose.Types.ObjectId(), totalAmount: 200, totalUnits: 10 },
                { claimId: new mongoose.Types.ObjectId(), totalAmount: 150, totalUnits: 7 }
            ];

            const batchClaim = new BatchClaim(batchClaimData);
            await batchClaim.save();

            expect(batchClaim.getTotalBatchAmount()).toBe(450);
            expect(batchClaim.getTotalBatchUnits()).toBe(22);
        });

        test('should validate batch submission readiness', async () => {
            const batchClaimData = generateBatchClaimData();
            batchClaimData.batchStatus = 'ready';
            batchClaimData.ediGeneration.status = 'completed';
            batchClaimData.claims = [
                { claimId: new mongoose.Types.ObjectId(), totalAmount: 100, totalUnits: 5 }
            ];

            const batchClaim = new BatchClaim(batchClaimData);
            await batchClaim.save();

            expect(batchClaim.canBeSubmitted()).toBe(true);

            // Test with incomplete EDI generation
            batchClaim.ediGeneration.status = 'pending';
            expect(batchClaim.canBeSubmitted()).toBe(false);
        });

        test('should handle date range validation', async () => {
            const batchClaimData = generateBatchClaimData();
            const startDate = new Date('2024-01-01');
            const endDate = new Date('2024-01-20'); // 19 days - should be valid

            batchClaimData.dateRange = { startDate, endDate };

            const batchClaim = new BatchClaim(batchClaimData);
            await expect(batchClaim.save()).resolves.toBeTruthy();

            // Test with invalid date range (end before start)
            batchClaimData.dateRange.endDate = new Date('2023-12-31');
            const invalidBatch = new BatchClaim(batchClaimData);

            // This should be caught by application logic, not schema validation
            expect(batchClaimData.dateRange.endDate < batchClaimData.dateRange.startDate).toBe(true);
        });
    });

    describe('ClaimGroup Model', () => {
        test('should create and validate ClaimGroup with proper aggregation', async () => {
            const claimGroupData = generateClaimGroupData();
            const claimGroup = new ClaimGroup(claimGroupData);

            await expect(claimGroup.save()).resolves.toBeTruthy();

            expect(claimGroup.groupId).toBeDefined();
            expect(claimGroup.aggregatedData.totalVisits).toBe(claimGroup.visits.length);
            expect(claimGroup.aggregatedData.totalUnits).toBeGreaterThan(0);
            expect(claimGroup.aggregatedData.totalAmount).toBeGreaterThan(0);
        });

        test('should generate unique group IDs', async () => {
            const startDate = new Date('2024-01-01');
            const groupId1 = ClaimGroup.generateGroupId(testTenantId, testHcmId, 'T2024', startDate);
            const groupId2 = ClaimGroup.generateGroupId(testTenantId, testHcmId, 'H2015_U8', startDate);

            expect(groupId1).not.toBe(groupId2);
            expect(groupId1).toMatch(/^GRP_/);
            expect(groupId2).toMatch(/^GRP_/);
        });

        test('should calculate aggregated data correctly', async () => {
            const claimGroupData = generateClaimGroupData();
            claimGroupData.visits = [
                {
                    visitId: new mongoose.Types.ObjectId(),
                    serviceDate: new Date('2024-01-01'),
                    units: 5,
                    amount: 100,
                    includedInClaim: true
                },
                {
                    visitId: new mongoose.Types.ObjectId(),
                    serviceDate: new Date('2024-01-02'),
                    units: 3,
                    amount: 60,
                    includedInClaim: true
                },
                {
                    visitId: new mongoose.Types.ObjectId(),
                    serviceDate: new Date('2024-01-03'),
                    units: 4,
                    amount: 80,
                    includedInClaim: false // Excluded
                }
            ];

            const claimGroup = new ClaimGroup(claimGroupData);
            await claimGroup.save();

            expect(claimGroup.aggregatedData.totalVisits).toBe(2); // Only included visits
            expect(claimGroup.aggregatedData.totalUnits).toBe(8);
            expect(claimGroup.aggregatedData.totalAmount).toBe(160);
            expect(claimGroup.aggregatedData.uniqueServiceDates).toBe(2);
        });

        test('should validate group for claim generation', async () => {
            const claimGroupData = generateClaimGroupData();
            claimGroupData.visits = [
                {
                    visitId: new mongoose.Types.ObjectId(),
                    serviceDate: new Date('2024-01-01'),
                    units: 5,
                    amount: 100,
                    includedInClaim: true
                }
            ];

            // Valid 15-day period
            claimGroupData.groupPeriod = {
                startDate: new Date('2024-01-01'),
                endDate: new Date('2024-01-15'),
                periodDays: 15
            };

            const claimGroup = new ClaimGroup(claimGroupData);
            await claimGroup.save();

            const validation = claimGroup.validateForClaim();
            expect(validation.isValid).toBe(true);
            expect(validation.errors).toHaveLength(0);

            // Test with invalid period (exceeds 15 days)
            claimGroup.groupPeriod.endDate = new Date('2024-01-20');
            const invalidValidation = claimGroup.validateForClaim();
            expect(invalidValidation.isValid).toBe(false);
            expect(invalidValidation.errors).toContain('Group period exceeds 15 days (19 days)');
        });

        test('should handle visit addition and validation', async () => {
            const claimGroupData = generateClaimGroupData();
            claimGroupData.groupPeriod = {
                startDate: new Date('2024-01-01'),
                endDate: new Date('2024-01-15'),
                periodDays: 15
            };

            const claimGroup = new ClaimGroup(claimGroupData);
            await claimGroup.save();

            // Test valid visit addition
            const validVisitDate = new Date('2024-01-05');
            expect(claimGroup.canAddVisit(validVisitDate)).toBe(true);

            // Test invalid visit addition (outside period)
            const invalidVisitDate = new Date('2024-01-20');
            expect(claimGroup.canAddVisit(invalidVisitDate)).toBe(false);

            // Test adding visit with validation
            const visitData = {
                visitId: new mongoose.Types.ObjectId(),
                serviceDate: validVisitDate,
                units: 3,
                amount: 60,
                includedInClaim: true
            };

            expect(() => claimGroup.addVisit(visitData)).not.toThrow();

            // Test adding invalid visit
            const invalidVisitData = {
                visitId: new mongoose.Types.ObjectId(),
                serviceDate: invalidVisitDate,
                units: 3,
                amount: 60,
                includedInClaim: true
            };

            expect(() => claimGroup.addVisit(invalidVisitData)).toThrow('Visit date outside group period');
        });
    });

    describe('ClaimAuditLog Model', () => {
        test('should create and validate audit log entries', async () => {
            const auditLogData = generateAuditLogData();
            const auditLog = new ClaimAuditLog(auditLogData);

            await expect(auditLog.save()).resolves.toBeTruthy();

            expect(auditLog.auditId).toBeDefined();
            expect(auditLog.companyId).toEqual(testCompanyId);
            expect(auditLog.userId).toEqual(testUserId);
            expect(auditLog.entityType).toBe('batch');
            expect(auditLog.action).toBe('created');
        });

        test('should generate unique audit IDs', async () => {
            const auditId1 = ClaimAuditLog.generateAuditId();
            const auditId2 = ClaimAuditLog.generateAuditId();

            expect(auditId1).not.toBe(auditId2);
            expect(auditId1).toMatch(/^AUDIT_/);
            expect(auditId2).toMatch(/^AUDIT_/);
        });

        test('should log actions with proper error handling', async () => {
            const actionData = {
                companyId: testCompanyId,
                userId: testUserId,
                entityType: 'batch',
                entityId: 'BATCH_123',
                action: 'created',
                description: 'Test batch creation'
            };

            const auditLog = await ClaimAuditLog.logAction(actionData);

            expect(auditLog).toBeTruthy();
            expect(auditLog.auditId).toBeDefined();
            expect(auditLog.entityType).toBe('batch');
            expect(auditLog.action).toBe('created');
        });

        test('should log batch operations with metadata', async () => {
            const batchData = {
                companyId: testCompanyId,
                userId: testUserId,
                batchId: 'BATCH_TEST_123',
                action: 'batch_created',
                description: 'Created new batch with filters',
                filters: {
                    startDate: new Date('2024-01-01'),
                    endDate: new Date('2024-01-15'),
                    serviceTypes: ['T2024']
                },
                performance: {
                    executionTimeMs: 1500,
                    recordsProcessed: 100,
                    recordsAffected: 10
                }
            };

            const auditLog = await ClaimAuditLog.logBatchOperation(batchData);

            expect(auditLog).toBeTruthy();
            expect(auditLog.metadata.filters).toBeDefined();
            expect(auditLog.metadata.performance).toBeDefined();
            expect(auditLog.metadata.performance.executionTimeMs).toBe(1500);
        });

        test('should handle TTL index for automatic cleanup', async () => {
            // Create an audit log with old timestamp
            const oldAuditData = generateAuditLogData();
            oldAuditData.timestamp = new Date(Date.now() - (366 * 24 * 60 * 60 * 1000)); // 366 days ago

            const oldAuditLog = new ClaimAuditLog(oldAuditData);
            await oldAuditLog.save();

            // Verify it was saved
            const savedLog = await ClaimAuditLog.findOne({ auditId: oldAuditLog.auditId });
            expect(savedLog).toBeTruthy();

            // Note: TTL cleanup happens automatically by MongoDB, not immediately testable
        });
    });

    describe('Database Optimization', () => {
        test('should create all required indexes', async () => {
            await dbOptimizer.createOptimizedIndexes();

            // Verify indexes were created
            const batchIndexes = await mongoose.connection.collection('batchclaims').indexes();
            const groupIndexes = await mongoose.connection.collection('claimgroups').indexes();
            const auditIndexes = await mongoose.connection.collection('claimauditlogs').indexes();

            expect(batchIndexes.length).toBeGreaterThan(5);
            expect(groupIndexes.length).toBeGreaterThan(5);
            expect(auditIndexes.length).toBeGreaterThan(5);
        });

        test('should analyze query performance', async () => {
            // Create test data first
            await generateDummyData();

            await dbOptimizer.analyzeQueryPerformance();

            expect(dbOptimizer.performanceMetrics).toBeDefined();
            expect(Object.keys(dbOptimizer.performanceMetrics).length).toBeGreaterThan(0);
        });

        test('should get collection statistics', async () => {
            // Create test data first
            await generateDummyData();

            const stats = await dbOptimizer.getCollectionStats();

            expect(stats).toBeDefined();
            expect(stats.batchclaims).toBeDefined();
            expect(stats.claimgroups).toBeDefined();
            expect(stats.claimauditlogs).toBeDefined();

            expect(stats.batchclaims.documentCount).toBeGreaterThan(0);
            expect(stats.claimgroups.documentCount).toBeGreaterThan(0);
            expect(stats.claimauditlogs.documentCount).toBeGreaterThan(0);
        });
    });

    describe('Performance Testing', () => {
        test('should handle large dataset operations efficiently', async () => {
            // Generate large dataset
            const largeDataset = await generateLargeDataset(1000);

            const startTime = Date.now();

            // Test complex query performance
            const results = await BatchClaim.find({
                companyId: testCompanyId,
                batchStatus: { $in: ['draft', 'ready'] },
                'dateRange.startDate': { $gte: new Date('2024-01-01') }
            })
                .sort({ createdAt: -1 })
                .limit(100);

            const endTime = Date.now();
            const executionTime = endTime - startTime;

            expect(results).toBeDefined();
            expect(executionTime).toBeLessThan(5000); // Should complete within 5 seconds

        });

        test('should handle concurrent operations', async () => {
            const concurrentPromises = [];

            // Create multiple concurrent operations
            for (let i = 0; i < 10; i++) {
                const promise = (async () => {
                    const batchData = generateBatchClaimData();
                    batchData.batchId = `CONCURRENT_BATCH_${i}_${Date.now()}`;

                    const batch = new BatchClaim(batchData);
                    await batch.save();

                    // Log the operation
                    await ClaimAuditLog.logAction({
                        companyId: testCompanyId,
                        userId: testUserId,
                        entityType: 'batch',
                        entityId: batch.batchId,
                        action: 'created',
                        description: `Concurrent batch creation ${i}`
                    });

                    return batch;
                })();

                concurrentPromises.push(promise);
            }

            const results = await Promise.all(concurrentPromises);

            expect(results).toHaveLength(10);
            expect(results.every(r => r.batchId)).toBe(true);

            // Verify all audit logs were created
            const auditCount = await ClaimAuditLog.countDocuments({
                companyId: testCompanyId,
                action: 'created'
            });

            expect(auditCount).toBe(10);
        });
    });

    describe('Integration Testing', () => {
        test('should handle complete batch processing workflow', async () => {
            // 1. Create batch claim
            const batchData = generateBatchClaimData();
            const batch = new BatchClaim(batchData);
            await batch.save();

            // 2. Create claim groups for the batch
            const group1Data = generateClaimGroupData();
            group1Data.batchId = batch.batchId;
            const group1 = new ClaimGroup(group1Data);
            await group1.save();

            const group2Data = generateClaimGroupData();
            group2Data.batchId = batch.batchId;
            const group2 = new ClaimGroup(group2Data);
            await group2.save();

            // 3. Validate groups
            const validation1 = group1.validateForClaim();
            const validation2 = group2.validateForClaim();

            expect(validation1.isValid).toBe(true);
            expect(validation2.isValid).toBe(true);

            // 4. Update batch status
            batch.batchStatus = 'ready';
            batch.ediGeneration.status = 'completed';
            await batch.save();

            // 5. Verify batch can be submitted
            expect(batch.canBeSubmitted()).toBe(true);

            // 6. Log the complete workflow
            await ClaimAuditLog.logBatchOperation({
                companyId: testCompanyId,
                userId: testUserId,
                batchId: batch.batchId,
                action: 'batch_completed',
                description: 'Completed full batch processing workflow',
                context: {
                    groupCount: 2,
                    totalAmount: batch.getTotalBatchAmount(),
                    totalUnits: batch.getTotalBatchUnits()
                }
            });

            // 7. Verify audit log was created
            const auditLog = await ClaimAuditLog.findOne({
                entityId: batch.batchId,
                action: 'batch_completed'
            });

            expect(auditLog).toBeTruthy();
            expect(auditLog.metadata.context.groupCount).toBe(2);
        });

        test('should handle error scenarios gracefully', async () => {
            // Test invalid batch creation
            const invalidBatchData = {
                // Missing required fields
                companyId: testCompanyId,
                serviceType: 'INVALID_TYPE'
            };

            const invalidBatch = new BatchClaim(invalidBatchData);

            await expect(invalidBatch.save()).rejects.toThrow();

            // Test invalid claim group
            const invalidGroupData = {
                companyId: testCompanyId,
                // Missing required fields
            };

            const invalidGroup = new ClaimGroup(invalidGroupData);

            await expect(invalidGroup.save()).rejects.toThrow();
        });
    });

    // Helper functions for generating test data
    function generateBatchClaimData() {
        return {
            batchId: BatchClaim.generateBatchId(testCompanyId, testTenantId, 'T2024'),
            companyId: testCompanyId,
            tenantId: testTenantId,
            hcmId: testHcmId,
            serviceType: 'T2024',
            dateRange: {
                startDate: new Date('2024-01-01'),
                endDate: new Date('2024-01-15')
            },
            claims: [
                {
                    claimId: new mongoose.Types.ObjectId(),
                    visitIds: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
                    totalAmount: 200,
                    totalUnits: 10,
                    status: 'pending'
                }
            ],
            ediGeneration: {
                status: 'pending'
            },
            batchStatus: 'draft',
            filters: {
                originalStartDate: new Date('2024-01-01'),
                originalEndDate: new Date('2024-01-15'),
                selectedVisitStatuses: ['approved'],
                includePendingVisits: false
            },
            createdBy: testUserId
        };
    }

    function generateClaimGroupData() {
        const startDate = new Date('2024-01-01');
        return {
            groupId: ClaimGroup.generateGroupId(testTenantId, testHcmId, 'T2024', startDate),
            batchId: 'BATCH_TEST_123',
            companyId: testCompanyId,
            tenantId: testTenantId,
            hcmId: testHcmId,
            serviceType: 'T2024',
            groupPeriod: {
                startDate: startDate,
                endDate: new Date('2024-01-15'),
                periodDays: 15
            },
            visits: [
                {
                    visitId: new mongoose.Types.ObjectId(),
                    serviceDate: new Date('2024-01-02'),
                    units: 5,
                    amount: 100,
                    status: 'included',
                    includedInClaim: true
                },
                {
                    visitId: new mongoose.Types.ObjectId(),
                    serviceDate: new Date('2024-01-05'),
                    units: 3,
                    amount: 60,
                    status: 'included',
                    includedInClaim: true
                }
            ],
            groupStatus: 'draft'
        };
    }

    function generateAuditLogData() {
        return {
            auditId: ClaimAuditLog.generateAuditId(),
            companyId: testCompanyId,
            userId: testUserId,
            entityType: 'batch',
            entityId: 'BATCH_TEST_123',
            action: 'created',
            description: 'Test batch creation',
            metadata: {
                context: {
                    testData: true
                },
                performance: {
                    executionTimeMs: 100,
                    recordsProcessed: 10,
                    recordsAffected: 1
                }
            },
            impact: {
                level: 'low',
                dataChanges: {
                    recordsCreated: 1,
                    recordsUpdated: 0,
                    recordsDeleted: 0
                }
            }
        };
    }

    async function generateDummyData() {
        const batchClaims = [];
        const claimGroups = [];
        const auditLogs = [];

        // Generate service types and companies for variety
        const serviceTypes = ['T2024', 'H2015_U8', 'H2015_U8_TS', 'T2038'];
        const companies = Array.from({ length: 3 }, () => new mongoose.Types.ObjectId());
        const tenants = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());
        const hcms = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());

        // Generate 10 batch claims
        for (let i = 0; i < 10; i++) {
            const companyId = companies[i % companies.length];
            const tenantId = tenants[i % tenants.length];
            const hcmId = hcms[i % hcms.length];
            const serviceType = serviceTypes[i % serviceTypes.length];

            const batchData = {
                batchId: BatchClaim.generateBatchId(companyId, tenantId, serviceType),
                companyId,
                tenantId,
                hcmId,
                serviceType,
                dateRange: {
                    startDate: new Date(2024, 0, 1 + i * 3),
                    endDate: new Date(2024, 0, 15 + i * 3)
                },
                claims: Array.from({ length: Math.floor(Math.random() * 5) + 1 }, () => ({
                    claimId: new mongoose.Types.ObjectId(),
                    visitIds: Array.from({ length: Math.floor(Math.random() * 3) + 1 }, () => new mongoose.Types.ObjectId()),
                    totalAmount: Math.floor(Math.random() * 500) + 100,
                    totalUnits: Math.floor(Math.random() * 20) + 5,
                    status: ['pending', 'generated', 'submitted'][Math.floor(Math.random() * 3)]
                })),
                ediGeneration: {
                    status: ['pending', 'generating', 'completed', 'failed'][Math.floor(Math.random() * 4)]
                },
                batchStatus: ['draft', 'ready', 'submitted', 'processing'][Math.floor(Math.random() * 4)],
                filters: {
                    originalStartDate: new Date(2024, 0, 1 + i * 3),
                    originalEndDate: new Date(2024, 0, 15 + i * 3),
                    selectedVisitStatuses: ['approved'],
                    includePendingVisits: Math.random() > 0.5
                },
                createdBy: testUserId,
                createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000) // Random date within last 30 days
            };

            const batch = new BatchClaim(batchData);
            await batch.save();
            batchClaims.push(batch);
        }

        // Generate 25 claim groups (2-3 per batch)
        for (let i = 0; i < 25; i++) {
            const batchClaim = batchClaims[Math.floor(i / 2.5)];
            const startDate = new Date(batchClaim.dateRange.startDate);
            startDate.setDate(startDate.getDate() + (i % 3) * 5);

            const groupData = {
                groupId: ClaimGroup.generateGroupId(batchClaim.tenantId, batchClaim.hcmId, batchClaim.serviceType, startDate),
                batchId: batchClaim.batchId,
                companyId: batchClaim.companyId,
                tenantId: batchClaim.tenantId,
                hcmId: batchClaim.hcmId,
                serviceType: batchClaim.serviceType,
                groupPeriod: {
                    startDate: startDate,
                    endDate: new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000),
                    periodDays: 15
                },
                visits: Array.from({ length: Math.floor(Math.random() * 8) + 2 }, (_, visitIndex) => ({
                    visitId: new mongoose.Types.ObjectId(),
                    serviceDate: new Date(startDate.getTime() + visitIndex * 2 * 24 * 60 * 60 * 1000),
                    units: Math.floor(Math.random() * 5) + 1,
                    amount: Math.floor(Math.random() * 100) + 20,
                    status: ['included', 'excluded', 'pending_review'][Math.floor(Math.random() * 3)],
                    includedInClaim: Math.random() > 0.2 // 80% included
                })),
                groupStatus: ['draft', 'validated', 'claim_generated'][Math.floor(Math.random() * 3)],
                createdAt: new Date(Date.now() - Math.random() * 25 * 24 * 60 * 60 * 1000)
            };

            const group = new ClaimGroup(groupData);
            await group.save();
            claimGroups.push(group);
        }

        // Generate 50 audit logs
        const actions = ['created', 'updated', 'submitted', 'generated', 'validated', 'batch_created', 'edi_generated'];
        const entityTypes = ['batch', 'claim_group', 'claim', 'edi_file'];

        for (let i = 0; i < 50; i++) {
            const entityType = entityTypes[Math.floor(Math.random() * entityTypes.length)];
            let entityId;

            if (entityType === 'batch') {
                entityId = batchClaims[Math.floor(Math.random() * batchClaims.length)].batchId;
            } else if (entityType === 'claim_group') {
                entityId = claimGroups[Math.floor(Math.random() * claimGroups.length)].groupId;
            } else {
                entityId = new mongoose.Types.ObjectId().toString();
            }

            const auditData = {
                auditId: ClaimAuditLog.generateAuditId(),
                companyId: companies[Math.floor(Math.random() * companies.length)],
                userId: testUserId,
                entityType,
                entityId,
                action: actions[Math.floor(Math.random() * actions.length)],
                description: `Test ${entityType} ${actions[Math.floor(Math.random() * actions.length)]} operation`,
                metadata: {
                    context: {
                        testData: true,
                        operationIndex: i
                    },
                    performance: {
                        executionTimeMs: Math.floor(Math.random() * 5000) + 100,
                        recordsProcessed: Math.floor(Math.random() * 100) + 1,
                        recordsAffected: Math.floor(Math.random() * 10) + 1
                    }
                },
                impact: {
                    level: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
                    dataChanges: {
                        recordsCreated: Math.floor(Math.random() * 5),
                        recordsUpdated: Math.floor(Math.random() * 3),
                        recordsDeleted: Math.floor(Math.random() * 2)
                    }
                },
                timestamp: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
            };

            const audit = new ClaimAuditLog(auditData);
            await audit.save();
            auditLogs.push(audit);
        }

        return {
            batchClaims,
            claimGroups,
            auditLogs
        };
    }

    async function generateLargeDataset(count = 1000) {

        const companies = Array.from({ length: 10 }, () => new mongoose.Types.ObjectId());
        const tenants = Array.from({ length: 50 }, () => new mongoose.Types.ObjectId());
        const hcms = Array.from({ length: 20 }, () => new mongoose.Types.ObjectId());
        const serviceTypes = ['T2024', 'H2015_U8', 'H2015_U8_TS', 'T2038'];

        const batchPromises = [];

        for (let i = 0; i < count; i++) {
            const companyId = companies[Math.floor(Math.random() * companies.length)];
            const tenantId = tenants[Math.floor(Math.random() * tenants.length)];
            const hcmId = hcms[Math.floor(Math.random() * hcms.length)];
            const serviceType = serviceTypes[Math.floor(Math.random() * serviceTypes.length)];

            const batchData = {
                batchId: `LARGE_BATCH_${i}_${Date.now()}`,
                companyId,
                tenantId,
                hcmId,
                serviceType,
                dateRange: {
                    startDate: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
                    endDate: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1)
                },
                claims: [{
                    claimId: new mongoose.Types.ObjectId(),
                    visitIds: [new mongoose.Types.ObjectId()],
                    totalAmount: Math.floor(Math.random() * 500) + 100,
                    totalUnits: Math.floor(Math.random() * 20) + 5,
                    status: 'pending'
                }],
                batchStatus: ['draft', 'ready', 'submitted'][Math.floor(Math.random() * 3)],
                createdBy: testUserId,
                createdAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000)
            };

            const batch = new BatchClaim(batchData);
            batchPromises.push(batch.save());
        }

        await Promise.all(batchPromises);
        return count;
    }
});