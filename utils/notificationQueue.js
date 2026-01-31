// Redis/Bull queues DISABLED to prevent connection errors
// import Queue from 'bull';
import { Expo } from 'expo-server-sdk';
import admin from 'firebase-admin';
import User from '../models/account/users.js';
import Appointment from '../models/appointments-visits/appointments.js';
import Visit from '../models/appointments-visits/visits.js';
import Bill from '../models/bills/bills.js';
import ServiceTracking from '../models/bills/serviceTracking.js';
import { createNotification, emitNotification } from '../controllers/communication-documents/notificationController.js';

// Initialize Expo SDK
const expo = new Expo();

// REDIS/BULL QUEUES DISABLED - All queue operations will be no-ops
const notificationQueue = {
    add: () => Promise.resolve({ id: 'disabled' }),
    addBulk: () => Promise.resolve([{ id: 'disabled' }]),
    process: () => { },
    clean: () => Promise.resolve(),
    getStats: () => Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0 }),
    getJobCounts: () => Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0 }),
    on: () => { } // Mock event handler
};

const dataAggregationQueue = {
    add: () => Promise.resolve({ id: 'disabled' }),
    addBulk: () => Promise.resolve([{ id: 'disabled' }]),
    process: () => { },
    clean: () => Promise.resolve(),
    getStats: () => Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0 }),
    getJobCounts: () => Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0 }),
    on: () => { } // Mock event handler
};

/**
 * Efficiently fetch upcoming events for all users
 * Uses aggregation pipelines and optimized queries
 */
const fetchUpcomingEvents = async () => {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    try {
        // Use Promise.all to fetch all data concurrently
        const [appointments, visits, pendingClaims, completingServices] = await Promise.all([
            // Upcoming appointments (1 hour window)
            Appointment.aggregate([
                {
                    $match: {
                        date: { $gte: now, $lte: oneHourFromNow },
                        status: { $ne: 'cancelled' }
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'tenant_id',
                        foreignField: '_id',
                        as: 'tenant'
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'hcm_id',
                        foreignField: '_id',
                        as: 'hcm'
                    }
                },
                {
                    $project: {
                        date: 1,
                        tenant: { $arrayElemAt: ['$tenant', 0] },
                        hcm: { $arrayElemAt: ['$hcm', 0] },
                        companyId: 1
                    }
                }
            ]),

            // Upcoming visits (1 hour window)
            Visit.aggregate([
                {
                    $match: {
                        startTime: { $gte: now, $lte: oneHourFromNow },
                        status: { $ne: 'cancelled' }
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'tenant_id',
                        foreignField: '_id',
                        as: 'tenant'
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'hcm_id',
                        foreignField: '_id',
                        as: 'hcm'
                    }
                },
                {
                    $project: {
                        startTime: 1,
                        serviceType: 1,
                        tenant: { $arrayElemAt: ['$tenant', 0] },
                        hcm: { $arrayElemAt: ['$hcm', 0] },
                        companyId: 1
                    }
                }
            ]),

            // Pending claims (for admins - daily summary)
            Bill.aggregate([
                {
                    $match: {
                        status: 'pending',
                        createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
                    }
                },
                {
                    $group: {
                        _id: '$companyId',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$serviceLine.lineItemChargeAmount' }
                    }
                }
            ]),

            // Services completing soon (for admins)
            ServiceTracking.aggregate([
                {
                    $match: {
                        endDate: { $gte: now, $lte: oneDayFromNow },
                        status: { $ne: 'completed' }
                    }
                },
                {
                    $group: {
                        _id: '$companyId',
                        count: { $sum: 1 }
                    }
                }
            ])
        ]);

        return {
            appointments,
            visits,
            pendingClaims,
            completingServices,
            timestamp: now
        };
    } catch (error) {
        console.error('Error fetching upcoming events:', error);
        throw error;
    }
};

/**
 * Process data aggregation job
 * DISABLED - Redis/Bull queues are not available
 */
// dataAggregationQueue.process('aggregate-events', async (job) => {
//     console.log('Starting data aggregation job...');
//     const events = await fetchUpcomingEvents();

//     // Queue individual notification jobs based on the aggregated data
//     const notificationJobs = [];

//     // Process appointments
//     events.appointments.forEach(appointment => {
//         if (appointment.tenant) {
//             notificationJobs.push({
//                 type: 'appointment-reminder',
//                 userId: appointment.tenant._id,
//                 userType: 'tenant',
//                 data: {
//                     appointmentId: appointment._id,
//                     date: appointment.date,
//                     hcmName: appointment.hcm?.name || 'Assigned HCM'
//                 }
//             });
//         }

//         if (appointment.hcm) {
//             notificationJobs.push({
//                 type: 'appointment-reminder',
//                 userId: appointment.hcm._id,
//                 userType: 'hcm',
//                 data: {
//                     appointmentId: appointment._id,
//                     date: appointment.date,
//                     tenantName: appointment.tenant?.name || 'Assigned Tenant'
//                 }
//             });
//         }
//     });

//     // Process visits
//     events.visits.forEach(visit => {
//         if (visit.tenant) {
//             notificationJobs.push({
//                 type: 'visit-reminder',
//                 userId: visit.tenant._id,
//                 userType: 'tenant',
//                 data: {
//                     visitId: visit._id,
//                     startTime: visit.startTime,
//                     serviceType: visit.serviceType,
//                     hcmName: visit.hcm?.name || 'Assigned HCM'
//                 }
//             });
//         }

//         if (visit.hcm) {
//             notificationJobs.push({
//                 type: 'visit-reminder',
//                 userId: visit.hcm._id,
//                 userType: 'hcm',
//                 data: {
//                     visitId: visit._id,
//                     startTime: visit.startTime,
//                     serviceType: visit.serviceType,
//                     tenantName: visit.tenant?.name || 'Assigned Tenant'
//                 }
//             });
//         }
//     });

//     // Process pending claims (for admins)
//     for (const claimSummary of events.pendingClaims) {
//         const admins = await User.find({
//             companyId: claimSummary._id,
//             role: { $gte: 2 }
//         }).select('_id');

//         admins.forEach(admin => {
//             notificationJobs.push({
//                 type: 'claims-summary',
//                 userId: admin._id,
//                 userType: 'admin',
//                 data: {
//                     count: claimSummary.count,
//                     totalAmount: claimSummary.totalAmount
//                 }
//             });
//         });
//     }

//     // Process completing services (for admins)
//     for (const serviceSummary of events.completingServices) {
//         const admins = await User.find({
//             companyId: serviceSummary._id,
//             role: { $gte: 2 }
//         }).select('_id');

//         admins.forEach(admin => {
//             notificationJobs.push({
//                 type: 'services-completing',
//                 userId: admin._id,
//                 userType: 'admin',
//                 data: {
//                     count: serviceSummary.count
//                 }
//             });
//         });
//     }

//     // Queue all notification jobs
//     const batchSize = 50; // Process in batches to avoid overwhelming the queue
//     for (let i = 0; i < notificationJobs.length; i += batchSize) {
//         const batch = notificationJobs.slice(i, i + batchSize);
//         await notificationQueue.addBulk(
//             batch.map(job => ({
//                 name: 'send-notification',
//                 data: job,
//                 opts: {
//                     delay: Math.floor(i / batchSize) * 1000 // Stagger batches by 1 second
//                 }
//             }))
//         );
//     }

//     console.log(`Queued ${notificationJobs.length} notification jobs in ${Math.ceil(notificationJobs.length / batchSize)} batches`);
//     return { processedJobs: notificationJobs.length };
// });

/**
 * Process individual notification job
 * DISABLED - Redis/Bull queues are not available
 */
// notificationQueue.process('send-notification', async (job) => {

/**
 * Schedule hourly notification job
 * DISABLED - Redis/Bull queues are not available
 */
export const scheduleHourlyNotifications = () => {
    // DISABLED - Redis/Bull functionality not available
    // dataAggregationQueue.add('aggregate-events', {}, {
    //     repeat: { cron: '0 * * * *' }, // Every hour at minute 0
    //     jobId: 'hourly-notifications' // Prevent duplicate jobs
    // });
    // console.log('Scheduled hourly notification aggregation job');
};

/**
 * Add immediate notification job (for testing or manual triggers)
 * DISABLED - Redis/Bull queues are not available
 */
export const triggerImmediateNotificationCheck = async () => {
    // DISABLED - Redis/Bull functionality not available
    return Promise.resolve({ message: 'Queue functionality disabled' });
    // await dataAggregationQueue.add('aggregate-events', {}, {
    //     priority: 10 // High priority for immediate processing
    // });
};

/**
 * Get queue statistics
 */
export const getQueueStats = async () => {
    // Return mock stats since queues are disabled
    return {
        dataAggregation: { waiting: 0, active: 0, completed: 0, failed: 0 },
        notifications: { waiting: 0, active: 0, completed: 0, failed: 0 }
    };

    // DISABLED - Redis/Bull functionality not available
    // const [dataStats, notificationStats] = await Promise.all([
    //     dataAggregationQueue.getJobCounts(),
    //     notificationQueue.getJobCounts()
    // ]);
    // return {
    //     dataAggregation: dataStats,
    //     notifications: notificationStats
    // };
};

// DISABLED - Redis/Bull event handling not available
// dataAggregationQueue.on('failed', (job, err) => {
//     console.error(`Data aggregation job ${job.id} failed:`, err);
// });

// notificationQueue.on('failed', (job, err) => {
//     console.error(`Notification job ${job.id} failed:`, err);
// });

// dataAggregationQueue.on('completed', (job, result) => {
//     console.log(`Data aggregation job ${job.id} completed:`, result);
// });

export { notificationQueue, dataAggregationQueue }; 