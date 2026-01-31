import Visits from '../../models/appointments-visits/visits.js';
import users from '../../models/account/users.js';
import ServiceTracking from '../../models/bills/serviceTracking.js';
import ClaimVisitMap from '../../models/bills/claimVisitMap.js';
import {
    getProcedureCodeFromServiceType,
    getServiceTypeFromProcedureCode,
    getProcedureCodeAndModifier,
} from '../../utils/procedureCodeMapper.js';
import {
    markVisitAsApproved,
    updateBillandEDI,
    removeBill,
} from './vistiBillController.js';
import hcmVisitHistory from '../../models/appointments-visits/hcmVisitHistory.js';
import mongoose from 'mongoose';
import appsDirectlyFromVisits from '../../models/appointments-visits/appsDirectlyFromVisits.js';
import Bills from '../../models/bills/bills.js';
import { sendVisitNotification } from '../../utils/pushnotifications.js';
import { generateBill } from '../../tasks/billGeneration.js';
import { regenerateBatchEDI } from '../../tasks/billGeneration.js';

export const fetchVisits = async (req, res) => {
    try {
        const { companyId } = req.params;
        const visits = await Visits.find({ companyId })
            .populate({
                path: 'creatorId',
                select: 'name email role',
                model: 'users',
            })
            .populate({
                path: 'hcmId',
                select: 'name email phoneNo',
                model: 'users',
            })
            .populate({
                path: 'tenantId',
                select: 'name email phoneNo',
                model: 'users',
            })
            .sort({ dateOfService: 1, startTime: 1 });

        res.status(200).json({
            success: true,
            message: 'All visits fetched successfully',
            response: visits,
        });
    } catch (error) {
        console.error('Error in fetchVisits:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

export const markVisitApproved = async (req, res) => {
    try {
        const { visitId } = req.body;

        // Find the visit
        const visit = await Visits.findById(visitId);
        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found'
            });
        }

        // Calculate duration and units
        const visitStartTime = new Date(visit.startTime);
        const visitEndTime = new Date(visit.endTime);
        const durationInMinutes = (visitEndTime - visitStartTime) / 60000;
        const serviceUnits = durationInMinutes / 15;
        const workedHours = durationInMinutes / 60;

        // Update visit status
        visit.status = 'approved';
        visit.timeOfApproval = new Date();
        await visit.save();

        // Generate bill and EDI
        const billResult = await generateBillandEDI(visitId);

        if (!billResult.success) {
            console.error('Failed to generate bill:', billResult.message);
            return res.status(400).json({
                success: false,
                message: 'Failed to generate bill: ' + billResult.message
            });
        }

        // Get procedure code info for claim mapping
        const procedureCodeInfo = getProcedureCodeAndModifier(visit.serviceType, visit.methodOfContact);

        if (!mappingResult.success) {
            console.error('Failed to create claim mapping:', mappingResult.error);
        }

        // Create visit history entry
        await hcmVisitHistory.create({
            hcmId: visit.hcmId,
            visitId: visit._id,
            tenantId: visit.tenantId,
            serviceType: visit.serviceType,
            serviceDate: visit.date,
            serviceUnits: serviceUnits,
            workedHours: workedHours,
            status: 'approved',
        });

        // Update visit with bill ID
        visit.billId = billResult.billId;
        await visit.save();

        return res.status(200).json({
            success: true,
            message: 'Visit approved and bill generated successfully',
            billId: billResult.billId,
            mappingCreated: mappingResult.success
        });

    } catch (error) {
        console.error('Error in markVisitApproved:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Add helper function for date normalization
const normalizeDate = (date) => {
    if (!date) return null;
    try {
        // If it's a string, parse it
        const inputDate = typeof date === 'string' ? new Date(date) : date;

        // Create a new UTC date using the local date parts
        return new Date(Date.UTC(
            inputDate.getFullYear(),
            inputDate.getMonth(),
            inputDate.getDate(),
            0, 0, 0, 0
        ));
    } catch (error) {
        console.error('Error normalizing date:', error);
        return null;
    }
};

// Add helper function to check for overlapping visits
const findOverlappingVisits = async (tenantId, hcmId, visitDate, startTime, endTime) => {
    if (!startTime || !endTime) return [];

    return await Visits.find({
        tenantId,
        hcmId,
        date: visitDate,
        $or: [
            {
                startTime: { $lt: endTime },
                endTime: { $gt: startTime }
            }
        ]
    }).sort({ startTime: 1 });
};

// Add helper function to merge visit times
const mergeVisitTimes = (visits) => {
    if (!visits || visits.length === 0) return null;

    const sortedVisits = visits.sort((a, b) => a.startTime - b.startTime);

    return {
        startTime: sortedVisits[0].startTime,
        endTime: sortedVisits[sortedVisits.length - 1].endTime
    };
};

export const createVisit = async (req, res) => {
    try {
        const {
            tenantId,
            hcmId,
            serviceType,
            activity,
            date,
            startTime,
            endTime,
            place,
            methodOfContact,
            reasonForRemote,
            notes,
            travel,
            totalMiles,
            travelWithTenant,
            travelWithoutTenant,
            status,
            signature,
            response,
            companyId,
            fromAppointment,
            creatorId,
            reasonForRejection
        } = req.body;

const procedureCodeId = getProcedureCodeFromServiceType(serviceType);
        const serviceTypeName = getServiceTypeFromProcedureCode(procedureCodeId);
        if (!tenantId || !hcmId || !date || !serviceType) {
            return res.status(400).json({
                success: false,
                message: 'tenantId, hcmId, date, and serviceType are required fields',
            });
        }

        if (
            procedureCodeId !== 'T2038' &&
            procedureCodeId !== 'T2024' &&
            (!startTime || !endTime)
        ) {
            return res.status(400).json({
                success: false,
                message: 'startTime and endTime are required for this service type',
            });
        }

        const creator = await users.findById(creatorId);
        if (!creator) {
            return res.status(404).json({
                success: false,
                message: 'Creator not found',
            });
        }

        let visitStatus = 'pending';
        if (creator.role === 2) {
            visitStatus = 'approved';
        } else if (creator.role === 0) {
            return res.status(403).json({
                success: false,
                message: 'Tenants cannot create visits',
            });
        }

        let visitDate = null;
        if (date) {
            try {
                const dateParts = date.split('T')[0].split('-');
                const year = parseInt(dateParts[0], 10);
                const month = parseInt(dateParts[1], 10) - 1;
                const day = parseInt(dateParts[2], 10);

                visitDate = new Date(Date.UTC(year, month, day));
            } catch (error) {
                console.error("Error parsing visit date:", error);
                visitDate = new Date(date);
            }
        }

        let visitStartTime = null;
        let visitEndTime = null;
        let durationInMinutes = 0;
        let unitsUsed = 0;

        if (procedureCodeId === 'T2038') {
            const existingMovingExpense = await Visits.findOne({
                tenantId,
                serviceType: 'T2038',
                companyId,
            });

            if (existingMovingExpense) {
                return res.status(400).json({
                    success: false,
                    message: 'Moving Expenses can only be claimed once per tenant.',
                });
            }

            unitsUsed = 1;
        } else if (procedureCodeId === 'T2024') {
            unitsUsed = 1;

            if (!startTime || !endTime) {
                const year = visitDate.getUTCFullYear();
                const month = visitDate.getUTCMonth();
                const day = visitDate.getUTCDate();
                const defaultStart = new Date(Date.UTC(year, month, day, 9, 0));
                const defaultEnd = new Date(Date.UTC(year, month, day, 10, 0));
                visitStartTime = defaultStart;
                visitEndTime = defaultEnd;
            } else {
                try {
                    const startParts = startTime.split('T')[1].split(':');
                    const startHour = parseInt(startParts[0], 10);
                    const startMinute = parseInt(startParts[1], 10);

                    const endParts = endTime.split('T')[1].split(':');
                    const endHour = parseInt(endParts[0], 10);
                    const endMinute = parseInt(endParts[1], 10);

                    const dateParts = startTime.split('T')[0].split('-');
                    const year = parseInt(dateParts[0], 10);
                    const month = parseInt(dateParts[1], 10) - 1;
                    const day = parseInt(dateParts[2], 10);

                    visitStartTime = new Date(Date.UTC(year, month, day, startHour, startMinute));
                    visitEndTime = new Date(Date.UTC(year, month, day, endHour, endMinute));
                } catch (error) {
                    console.error("Error parsing visit times:", error);
                    visitStartTime = new Date(startTime);
                    visitEndTime = new Date(endTime);
                }
            }
        } else {
            if (!startTime || !endTime) {
                return res.status(400).json({
                    success: false,
                    message: 'startTime and endTime are required for this service type',
                });
            }

            try {
                const startParts = startTime.split('T')[1].split(':');
                const startHour = parseInt(startParts[0], 10);
                const startMinute = parseInt(startParts[1], 10);

                const endParts = endTime.split('T')[1].split(':');
                const endHour = parseInt(endParts[0], 10);
                const endMinute = parseInt(endParts[1], 10);

                const dateParts = startTime.split('T')[0].split('-');
                const year = parseInt(dateParts[0], 10);
                const month = parseInt(dateParts[1], 10) - 1;
                const day = parseInt(dateParts[2], 10);

                visitStartTime = new Date(Date.UTC(year, month, day, startHour, startMinute));
                visitEndTime = new Date(Date.UTC(year, month, day, endHour, endMinute));
            } catch (error) {
                console.error("Error parsing visit times:", error);
                visitStartTime = new Date(startTime);
                visitEndTime = new Date(endTime);
            }

            if (visitStartTime >= visitEndTime) {
                return res.status(400).json({
                    success: false,
                    message: 'End time must be after start time.',
                });
            }

            const overlappingVisit = await Visits.findOne({
                tenantId,
                hcmId,
                date: visitDate,
                serviceType: serviceType,
                $or: [
                    {
                        startTime: { $lt: visitEndTime },
                        endTime: { $gt: visitStartTime },
                    },
                ],
            });

            if (overlappingVisit) {
                return res.status(400).json({
                    success: false,
                    message: 'A visit already exists in the selected timeslot.',
                });
            }

            durationInMinutes = (visitEndTime - visitStartTime) / 60000;
            unitsUsed = Math.ceil(durationInMinutes / 15);
        }

        const service = await ServiceTracking.findOne({
            tenantId,
            serviceType: procedureCodeId,
        });

        if (!service) {
            return res.status(400).json({
                success: false,
                message: `No ${serviceTypeName} service found for this tenant. Please create a service first.`,
            });
        }

        if (service && unitsUsed > service.unitsRemaining) {
            return res.status(400).json({
                success: false,
                message: `Insufficient units remaining. Available: ${service.unitsRemaining}, Required: ${unitsUsed}`,
            });
        }

        const visitData = {
            creatorId: new mongoose.Types.ObjectId(creatorId),
            hcmId: new mongoose.Types.ObjectId(hcmId),
            tenantId: new mongoose.Types.ObjectId(tenantId),
            date: visitDate,
            startTime: visitStartTime,
            endTime: visitEndTime,
            activity: activity || '',
            methodOfContact: methodOfContact || 'in-person',
            reasonForRemote: reasonForRemote || '',
            place: place || 'Office',
            serviceType: procedureCodeId,
            serviceTypeName: serviceTypeName,
            totalMiles: totalMiles || 0,
            travelWithTenant: travelWithTenant || 0,
            travelWithoutTenant: travelWithoutTenant || 0,
            signature: signature || 'pending',
            response: response || '',
            status: visitStatus,
            travel: travel || 'no',
            notes: notes || '',
            reasonForRejection: reasonForRejection || '',
            companyId,
            fromAppointment: fromAppointment || false,
        };

        const newVisit = new Visits(visitData);
        const visit = await newVisit.save();

        const hcmUser = await users.findById(hcmId);
        if (hcmUser && creator?.fcmToken) {
            const visitDateStr = visit.date.toDateString();
            const visitTimeStr = visit.startTime
                ? new Date(visit.startTime).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                })
                : '';

            await sendVisitNotification(
                creatorId,
                'Visit Logged',
                `${hcmUser?.fullName || 'The HCM'
                } just logged a visit for the tenant on ${visitDateStr} at ${visitTimeStr}.`,
                {
                    visitId: visit._id.toString(),
                    tenantId: tenantId.toString(),
                }
            );
        }

        if (!fromAppointment) {
            const appsDirectlyFromVisitsRecord = new appsDirectlyFromVisits({
                visitId: visit._id,
                tenantId: visit.tenantId,
                hcmId: visit.hcmId,
                date: visit?.date,
                startTime: visit?.startTime,
                endTime: visit?.endTime,
                serviceType: visit?.serviceType,
                activity: visit?.activity,
                methodOfContact: visit?.methodOfContact,
                reasonForRemote: visit?.reasonForRemote,
                placeOfService: visit?.place,
                signature: visit?.signature,
                status: 'completed',
                companyId,
                billId: null,
            });

            await appsDirectlyFromVisitsRecord.save();
        }

        // Update service tracking with worked units
        if (service) {
            // Update overall worked units for the service
            service.workedUnits = (service.workedUnits || 0) + unitsUsed;

            // Find or create the HCM entry in the service tracking
            let hcmEntry = service.hcms.find(
                (hcm) => hcm.hcmId && hcm.hcmId.toString() === newVisit.hcmId.toString()
            );

            const billAmount = unitsUsed * service.billRate;

            if (hcmEntry) {
                // Update existing HCM entry
                hcmEntry.workedUnits = (hcmEntry.workedUnits || 0) + unitsUsed;
                hcmEntry.billAmount = (hcmEntry.billAmount || 0) + billAmount;

                // Add service detail for this visit
                if (!hcmEntry.serviceDetails) {
                    hcmEntry.serviceDetails = [];
                }

                hcmEntry.serviceDetails.push({
                    dateOfService: newVisit.date,
                    workedUnits: unitsUsed,
                    billAmount: billAmount,
                });
            } else {
                // Create new HCM entry
                service.hcms.push({
                    hcmId: newVisit.hcmId,
                    workedUnits: unitsUsed,
                    scheduledUnits: 0,
                    billAmount: billAmount,
                    serviceDetails: [
                        {
                            dateOfService: newVisit.date,
                            workedUnits: unitsUsed,
                            billAmount: billAmount,
                        },
                    ],
                    scheduledDetails: []
                });
            }

            // Recalculate remaining units: total - worked - scheduled
            service.unitsRemaining = Math.max(0,
                service.totalUnits - service.workedUnits - (service.scheduledUnits || 0)
            );

            await service.save();
        }

        if (creator.role === 2) {
            const result = await markVisitAsApproved(newVisit._id);
            const serviceUnits = durationInMinutes / 15;
            const workedHours = durationInMinutes / 60;

            await hcmVisitHistory.create({
                hcmId: visit.hcmId,
                visitId: visit._id,
                tenantId: visit.tenantId,
                serviceType: visit.serviceType,
                serviceDate: visit.date,
                serviceUnits: serviceUnits,
                workedHours: workedHours,
                status: 'approved',
            });

            // Create claim-visit mapping when admin creates visit and bill is generated
            if (result.success && result.billId) {
                // Get procedure code information for the mapping
                const procedureCodeInfo = getProcedureCodeAndModifier(visit.serviceType, visit.methodOfContact);

                const mappingResult = await createClaimVisitMapping(
                    newVisit._id,
                    result.billId,
                    visit,
                    procedureCodeInfo
                );

                if (mappingResult.success) {
                } else {
                    console.error('[BACKEND] Failed to create claim-visit mapping:', mappingResult.error);
                }
            }

            if (result.success) {
                return res.status(200).json({
                    success: true,
                    message: 'Visit created, approved, and claim mapping generated successfully',
                    billId: result.billId,
                    mappingCreated: result.billId ? true : false
                });
            } else {
                return res.status(200).json({
                    success: false,
                    message: result.message,
                });
            }
        }

        const serviceUnits = durationInMinutes / 15;
        const workedHours = durationInMinutes / 60;

        await hcmVisitHistory.create({
            hcmId: visit.hcmId,
            visitId: visit._id,
            tenantId: visit.tenantId,
            serviceType: visit.serviceType,
            serviceDate: visit.date,
            serviceUnits: serviceUnits,
            workedHours: workedHours,
        });

        res.status(200).json({
            success: true,
            message: 'Visit created successfully',
        });
    } catch (error) {
        console.error('Error creating visit:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error',
            error: error.message,
        });
    }
};

export const getVisits = async (req, res) => {
    const { companyId } = req.params;
    try {
        const visits = await Visits.find({ companyId })
            .populate({
                path: 'creatorId',
                select: 'name email role',
                model: 'causers',
            })
            .populate({
                path: 'hcmId',
                select: 'name email phoneNo',
                model: 'causers',
            })
            .populate({
                path: 'tenantId',
                select: 'name email phoneNo',
                model: 'causers',
            });
        const tenantIds = [...new Set(visits.map((visit) => visit.tenantId?._id))];

        const services = await ServiceTracking.find({
            tenantId: { $in: tenantIds },
        }).select('tenantId serviceType unitsRemaining');

        // Attach remaining units to each visit
        const visitsWithServices = visits.map((visit) => {
            const service = services.find(
                (s) =>
                    s.tenantId.toString() === visit.tenantId?._id.toString() &&
                    s.serviceType === visit.serviceType
            );

            return {
                ...visit.toObject(), // Convert Mongoose document to plain object
                // unitsRemaining: service ? service.unitsRemaining : null,
            };
        });

        res.status(200).json({
            success: true,
            message: 'Visits fetched successfully',
            response: {
                visits: visitsWithServices,
            },
        });
    } catch (error) {
        console.error('Error in getVisits:', error);
        res
            .status(500)
            .json({ success: false, message: 'Server error', error: error.message });
    }
};

export const updateVisit = async (req, res) => {
    try {
        const { id: visitId } = req.params;
        const updateData = req.body.updateData || req.body;
        const { companyId } = req.body;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(visitId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid visit ID format',
            });
        }

        // Find the visit
        const visit = await Visits.findById(visitId);
        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found',
            });
        }

        // Store original data for comparison and potential service tracking adjustments
        const originalData = {
            tenantId: visit.tenantId,
            hcmId: visit.hcmId,
            serviceType: visit.serviceType,
            date: visit.date,
            startTime: visit.startTime,
            endTime: visit.endTime,
            methodOfContact: visit.methodOfContact,
            status: visit.status
        };

        // Calculate original units
        let originalUnits = 0;
        if (originalData.startTime && originalData.endTime) {
            const originalDurationInMinutes =
                (new Date(originalData.endTime) - new Date(originalData.startTime)) /
                (1000 * 60);
            originalUnits = Math.ceil(originalDurationInMinutes / 15);
        }
        // Process each field in the update data
        Object.keys(updateData).forEach((key) => {
            if (updateData[key] !== undefined && updateData[key] !== null) {
                if (key === 'date') {
                    // Parse date as UTC
                    const dateValue = updateData[key];
                    visit[key] = new Date(dateValue);
                }
                else if (key === 'startTime' || key === 'endTime') {
                    // Parse time as UTC
                    const timeValue = updateData[key];
                    if (timeValue) {
                        visit[key] = new Date(timeValue);
                    }
                }
                else {
                    // Handle other fields normally
                    visit[key] = updateData[key];
                }
            }
        });

        // Calculate new units
        let newUnits = 0;
        if (visit.startTime && visit.endTime) {
            const newDurationInMinutes =
                (new Date(visit.endTime) - new Date(visit.startTime)) / (1000 * 60);
            newUnits = Math.ceil(newDurationInMinutes / 15);

            if (newDurationInMinutes <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'End time must be after start time',
                });
            }
        }

        // Save the updated visit
        await visit.save();

        // Find and update any associated claim-visit mapping and bills
        try {
            const claimMapping = await ClaimVisitMap.findOne({ visitId: visitId });

            if (claimMapping) {
                // Check if this is part of a merged visit group or single visit
                if (claimMapping.visitIds && claimMapping.visitIds.length > 1) {
                    // Update units and amount in the mapping for merged visits
                    const unitsDifference = newUnits - originalUnits;
                    claimMapping.mergedUnits = Math.max(0, claimMapping.mergedUnits + unitsDifference);

                    // Calculate amount difference based on service rate
                    const service = await ServiceTracking.findOne({
                        tenantId: visit.tenantId,
                        serviceType: visit.serviceType,
                    });

                    const amountDifference = service ? unitsDifference * service.billRate : 0;
                    claimMapping.mergedAmount = Math.max(0, claimMapping.mergedAmount + amountDifference);

                    // Update visit data in the mapping
                    if (claimMapping.visitData && Array.isArray(claimMapping.visitData)) {
                        const visitDataIndex = claimMapping.visitData.findIndex(
                            data => data.visitId === visitId.toString()
                        );

                        if (visitDataIndex !== -1) {
                            claimMapping.visitData[visitDataIndex] = {
                                ...claimMapping.visitData[visitDataIndex],
                                units: newUnits,
                                amount: service ? newUnits * service.billRate : 0,
                                startTime: visit.startTime,
                                endTime: visit.endTime
                            };
                        }
                    }

                    await claimMapping.save();
                } else {
                    // Handle single visit updates
                    const service = await ServiceTracking.findOne({
                        tenantId: visit.tenantId,
                        serviceType: visit.serviceType,
                    });

                    claimMapping.mergedUnits = newUnits;
                    claimMapping.mergedAmount = service ? newUnits * service.billRate : 0;

                    await claimMapping.save();
                }

                // Update the associated bill regardless of visit type (merged or single)
                if (claimMapping.claimId) {
                    const bill = await Bills.findById(claimMapping.claimId);
                    if (bill) {
                        // Find the service line for this date and service type
                        const serviceLineIndex = bill.serviceLines.findIndex(line =>
                            new Date(line.serviceDate).toDateString() === new Date(visit.date).toDateString() &&
                            line.serviceType === visit.serviceType
                        );

                        if (serviceLineIndex !== -1) {
                            // Update the service line with the new units and amount
                            bill.serviceLines[serviceLineIndex].serviceUnitCount = claimMapping.mergedUnits;
                            bill.serviceLines[serviceLineIndex].lineItemChargeAmount = claimMapping.mergedAmount;
                        } else {
                            // If no specific service line found, update the main service line
                            if (bill.serviceLine) {
                                bill.serviceLine.serviceUnitCount = claimMapping.mergedUnits;
                                bill.serviceLine.lineItemChargeAmount = claimMapping.mergedAmount;
                            }
                        }

                        // Recalculate total amounts from all service lines
                        const totalAmount = bill.serviceLines.reduce((sum, line) => sum + (line.lineItemChargeAmount || 0), 0);
                        const totalUnits = bill.serviceLines.reduce((sum, line) => sum + (line.serviceUnitCount || 0), 0);

                        // Update main service line totals
                        if (bill.serviceLine) {
                            bill.serviceLine.serviceUnitCount = totalUnits;
                            bill.serviceLine.lineItemChargeAmount = totalAmount;
                        }

                        // Update bill claim information
                        if (bill.bill && bill.bill.claimInformation) {
                            bill.bill.claimInformation.totalClaimChargeAmount = totalAmount;
                        }

                        await bill.save();
                        // Regenerate EDI for this bill
                        const visitDate = new Date(visit.date);
                        const monthYearKey = `${visitDate.getFullYear()}-${(visitDate.getMonth() + 1).toString().padStart(2, '0')}`;

                        try {
                            await regenerateBatchEDI(companyId || visit.companyId, monthYearKey);
                        } catch (ediError) {
                            console.error(`Error regenerating EDI batch: ${ediError.message}`);
                        }
                    }
                }
            }
        } catch (mappingError) {
            console.error('Error updating claim-visit mapping:', mappingError);
        }

        // Update service tracking for all visit updates (approved status or units changed)
        if (visit.status === 'approved' && originalUnits !== newUnits) {
            try {
                // Find the service tracking record
                const serviceTracking = await ServiceTracking.findOne({
                    tenantId: visit.tenantId,
                    serviceType: visit.serviceType,
                });

                if (serviceTracking) {
                    // Calculate the difference in units
                    const unitsDifference = newUnits - originalUnits;

                    // Update total units used and remaining
                    serviceTracking.unitsUsed = Math.max(0, serviceTracking.unitsUsed + unitsDifference);
                    serviceTracking.unitsRemaining = Math.max(0, serviceTracking.unitsRemaining - unitsDifference);
                    // Update HCM's units
                    const hcmRecord = serviceTracking.hcms.find(
                        (hcm) => hcm.hcmId && hcm.hcmId.toString() === visit.hcmId.toString()
                    );

                    if (hcmRecord) {
                        // Update HCM's total units
                        hcmRecord.unitsUsed = Math.max(0, (hcmRecord.unitsUsed || 0) + unitsDifference);
                        // Find service detail for the date
                        const visitDate = new Date(visit.date);
                        const dateString = visitDate.toISOString().split('T')[0];

                        const serviceDetailIndex = hcmRecord.serviceDetails.findIndex(
                            (detail) =>
                                new Date(detail.dateOfService).toISOString().split('T')[0] === dateString
                        );

                        if (serviceDetailIndex !== -1) {
                            // Update existing service detail
                            const serviceDetail = hcmRecord.serviceDetails[serviceDetailIndex];
                            serviceDetail.unitsUsed = Math.max(0, (serviceDetail.unitsUsed || 0) + unitsDifference);
                            hcmRecord.serviceDetails[serviceDetailIndex] = serviceDetail;
                        } else if (unitsDifference > 0) {
                            // Create new service detail if it doesn't exist and we're adding units
                            hcmRecord.serviceDetails.push({
                                dateOfService: visitDate,
                                unitsUsed: unitsDifference,
                            });
                        }
                    } else {
                        // Create new HCM record if it doesn't exist
                        serviceTracking.hcms.push({
                            hcmId: visit.hcmId,
                            unitsUsed: Math.max(0, unitsDifference),
                            serviceDetails: unitsDifference > 0 ? [{
                                dateOfService: new Date(visit.date),
                                unitsUsed: unitsDifference,
                            }] : []
                        });
                    }

                    await serviceTracking.save();
                } else {
                }
            } catch (error) {
                console.error('Error updating service tracking:', error);
                // Continue with response even if service tracking update fails
            }
        }

        // send notification to creator
        const hcmUser = await users.findById(visit.hcmId);
        if (hcmUser && visit.creatorId) {
            const visitDateStr = visit.date.toDateString();
            const visitTimeStr = visit.startTime
                ? new Date(visit.startTime).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                })
                : '';
            await sendVisitNotification(
                visit.creatorId,
                'Visit Updated',
                `The visit for the tenant on ${visitDateStr} at ${visitTimeStr} has been updated.`,
                {
                    visitId: visit._id.toString(),
                    tenantId: visit.tenantId.toString(),
                }
            );
        }

        // Handle status changes and update claims/bills
        if (originalData.status !== visit.status) {
            // Status has changed
            if (visit.status === 'approved') {
                // Visit was approved - generate bill
                const result = await markVisitAsApproved(visit._id);

                // Create claim-visit mapping when visit is approved
                if (result.success && result.billId) {
                    // Get procedure code information for the mapping
                    const procedureCodeInfo = getProcedureCodeAndModifier(visit.serviceType, visit.methodOfContact);

if (mappingResult.success) {
                    } else {
                        console.error('[BACKEND] Failed to create claim-visit mapping:', mappingResult.error);
                    }
                }

                // Notify HCM about approval
                const visitDateStr = visit.date.toDateString();
                const visitTimeStr = visit.startTime
                    ? new Date(visit.startTime).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                    })
                    : '';
                await sendVisitNotification(
                    visit.hcmId,
                    'Visit Approved',
                    `Your visit for the tenant on ${visitDateStr} at ${visitTimeStr} has been approved.`,
                    {
                        visitId: visit._id.toString(),
                        tenantId: visit.tenantId.toString(),
                    }
                );

                if (!result.success) {
                    return res.status(400).json({
                        success: false,
                        message: result.message || 'Failed to approve visit',
                    });
                }
            } else if (visit.status === 'rejected') {
                // Visit was rejected
                visit.reasonForRejection =
                    updateData?.reasonForRejection || visit.reasonForRejection;
                visit.timeOfRejection = new Date();
                await visit.save();

                // Remove claim-visit mapping when visit is rejected
                try {
                    const claimMapping = await ClaimVisitMap.findOne({ visitId: visit._id });
                    if (claimMapping) {
                        // If this is part of a merged visit group, update the mapping
                        if (claimMapping.visitIds && claimMapping.visitIds.length > 1) {
                            // Remove this visit ID from the visitIds array
                            const visitIdIndex = claimMapping.visitIds.indexOf(visit._id.toString());
                            if (visitIdIndex !== -1) {
                                claimMapping.visitIds.splice(visitIdIndex, 1);
                            }

                            // Update mergedUnits and mergedAmount
                            claimMapping.mergedUnits = Math.max(0, claimMapping.mergedUnits - originalUnits);

                            // Calculate amount to subtract based on service rate
                            const service = await ServiceTracking.findOne({
                                tenantId: visit.tenantId,
                                serviceType: visit.serviceType,
                            });

                            const amountToSubtract = service ? originalUnits * service.billRate : 0;
                            claimMapping.mergedAmount = Math.max(0, claimMapping.mergedAmount - amountToSubtract);

                            // Remove visit data entry
                            if (claimMapping.visitData && Array.isArray(claimMapping.visitData)) {
                                const visitDataIndex = claimMapping.visitData.findIndex(
                                    data => data.visitId === visit._id.toString()
                                );

                                if (visitDataIndex !== -1) {
                                    claimMapping.visitData.splice(visitDataIndex, 1);
                                }
                            }

                            // If there are still visits in the mapping, save it; otherwise delete it
                            if (claimMapping.visitIds.length > 0) {
                                await claimMapping.save();
                            } else {
                                await ClaimVisitMap.findByIdAndDelete(claimMapping._id);
                            }
                        } else {
                            // This is a single visit mapping - delete it
                            await ClaimVisitMap.findByIdAndDelete(claimMapping._id);
                        }

                        // Update the bill if it exists
                        if (claimMapping.claimId) {
                            const bill = await Bills.findById(claimMapping.claimId);
                            if (bill) {
                                // Find the service line for this date and service type
                                const serviceLineIndex = bill.serviceLines.findIndex(line =>
                                    new Date(line.serviceDate).toDateString() === new Date(visit.date).toDateString() &&
                                    line.serviceType === visit.serviceType
                                );

                                if (serviceLineIndex !== -1) {
                                    // Update the service line with the new units and amount
                                    bill.serviceLines[serviceLineIndex].serviceUnitCount = claimMapping.mergedUnits;
                                    bill.serviceLines[serviceLineIndex].lineItemChargeAmount = claimMapping.mergedAmount;

                                    // If no units left, remove the service line
                                    if (bill.serviceLines[serviceLineIndex].serviceUnitCount <= 0) {
                                        bill.serviceLines.splice(serviceLineIndex, 1);
                                    }

                                    // Update total amounts
                                    const totalAmount = bill.serviceLines.reduce((sum, line) => sum + (line.lineItemChargeAmount || 0), 0);
                                    const totalUnits = bill.serviceLines.reduce((sum, line) => sum + (line.serviceUnitCount || 0), 0);

                                    if (bill.serviceLine) {
                                        bill.serviceLine.serviceUnitCount = totalUnits;
                                        bill.serviceLine.lineItemChargeAmount = totalAmount;
                                    }

                                    if (bill.bill && bill.bill.claimInformation) {
                                        bill.bill.claimInformation.totalClaimChargeAmount = totalAmount;
                                    }

                                    // If no service lines left, delete the bill
                                    if (bill.serviceLines.length === 0) {
                                        await Bills.findByIdAndDelete(bill._id);
                                    } else {
                                        await bill.save();
                                        // Regenerate EDI for this bill
                                        const visitDate = new Date(visit.date);
                                        const monthYearKey = `${visitDate.getFullYear()}-${(visitDate.getMonth() + 1).toString().padStart(2, '0')}`;

                                        try {
                                            await regenerateBatchEDI(companyId || visit.companyId, monthYearKey);
                                        } catch (ediError) {
                                            console.error(`Error regenerating EDI batch: ${ediError.message}`);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (mappingError) {
                    console.error('[BACKEND] Error handling claim-visit mapping on rejection:', mappingError);
                }

                // Notify HCM about rejection
                const visitDateStr = visit.date.toDateString();
                const visitTimeStr = visit.startTime
                    ? new Date(visit.startTime).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                    })
                    : '';

                await sendVisitNotification(
                    visit.hcmId,
                    'Visit Rejected',
                    `Your visit for the tenant on ${visitDateStr} at ${visitTimeStr} has been rejected.`,
                    {
                        visitId: visit._id.toString(),
                        tenantId: visit.tenantId.toString(),
                    }
                );
            } else if (visit.status === 'pending') {
                // Visit changed to pending - remove bill and claim mapping
                await removeBill(visit._id);

                // Remove claim-visit mapping when visit changes to pending
                try {
                    const claimMapping = await ClaimVisitMap.findOne({ visitId: visit._id });
                    if (claimMapping) {
                        // If this is part of a merged visit group, update the mapping
                        if (claimMapping.visitIds && claimMapping.visitIds.length > 1) {
                            // Handle same as rejection - remove this visit from the merged group
                            const visitIdIndex = claimMapping.visitIds.indexOf(visit._id.toString());
                            if (visitIdIndex !== -1) {
                                claimMapping.visitIds.splice(visitIdIndex, 1);
                            }

                            // Update mergedUnits and mergedAmount
                            claimMapping.mergedUnits = Math.max(0, claimMapping.mergedUnits - originalUnits);

                            // Calculate amount to subtract based on service rate
                            const service = await ServiceTracking.findOne({
                                tenantId: visit.tenantId,
                                serviceType: visit.serviceType,
                            });

                            const amountToSubtract = service ? originalUnits * service.billRate : 0;
                            claimMapping.mergedAmount = Math.max(0, claimMapping.mergedAmount - amountToSubtract);

                            // Remove visit data entry
                            if (claimMapping.visitData && Array.isArray(claimMapping.visitData)) {
                                const visitDataIndex = claimMapping.visitData.findIndex(
                                    data => data.visitId === visit._id.toString()
                                );

                                if (visitDataIndex !== -1) {
                                    claimMapping.visitData.splice(visitDataIndex, 1);
                                }
                            }

                            // If there are still visits in the mapping, save it; otherwise delete it
                            if (claimMapping.visitIds.length > 0) {
                                await claimMapping.save();
                                // Update the bill
                                if (claimMapping.claimId) {
                                    const bill = await Bills.findById(claimMapping.claimId);
                                    if (bill) {
                                        // Find the service line for this date and service type
                                        const serviceLineIndex = bill.serviceLines.findIndex(line =>
                                            new Date(line.serviceDate).toDateString() === new Date(visit.date).toDateString() &&
                                            line.serviceType === visit.serviceType
                                        );

                                        if (serviceLineIndex !== -1) {
                                            // Update the service line with the new units and amount
                                            bill.serviceLines[serviceLineIndex].serviceUnitCount = claimMapping.mergedUnits;
                                            bill.serviceLines[serviceLineIndex].lineItemChargeAmount = claimMapping.mergedAmount;

                                            // Update total amounts
                                            const totalAmount = bill.serviceLines.reduce((sum, line) => sum + (line.lineItemChargeAmount || 0), 0);
                                            const totalUnits = bill.serviceLines.reduce((sum, line) => sum + (line.serviceUnitCount || 0), 0);

                                            if (bill.serviceLine) {
                                                bill.serviceLine.serviceUnitCount = totalUnits;
                                                bill.serviceLine.lineItemChargeAmount = totalAmount;
                                            }

                                            if (bill.bill && bill.bill.claimInformation) {
                                                bill.bill.claimInformation.totalClaimChargeAmount = totalAmount;
                                            }

                                            await bill.save();
                                            // Regenerate EDI for this bill
                                            const visitDate = new Date(visit.date);
                                            const monthYearKey = `${visitDate.getFullYear()}-${(visitDate.getMonth() + 1).toString().padStart(2, '0')}`;

                                            try {
                                                await regenerateBatchEDI(companyId || visit.companyId, monthYearKey);
                                            } catch (ediError) {
                                                console.error(`Error regenerating EDI batch: ${ediError.message}`);
                                            }
                                        }
                                    }
                                }
                            } else {
                                await ClaimVisitMap.findByIdAndDelete(claimMapping._id);
                            }
                        } else {
                            // This is a single visit mapping - delete it
                            await ClaimVisitMap.findByIdAndDelete(claimMapping._id);
                        }
                    }
                } catch (mappingError) {
                    console.error('[BACKEND] Error handling claim-visit mapping on pending status:', mappingError);
                }
            } else if (originalData.status === 'approved') {
                // If the visit was already approved and we're updating other fields
                await updateBillandEDI(visit._id);
            }

            return res.status(200).json({
                success: true,
                message: 'Visit updated successfully with status change',
                updatedVisit: visit,
            });
        }

        // Add return statement for when status hasn't changed
        return res.status(200).json({
            success: true,
            message: 'Visit updated successfully',
            updatedVisit: visit,
        });
    } catch (error) {
        console.error('Error updating visit:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

export const deleteVisit = async (req, res) => {
    const { id } = req.params;
    try {
        // Find the visit first to get its data
        const visit = await Visits.findById(id);

        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found',
            });
        }

        // Store visit data before deletion for reference
        const visitData = {
            _id: visit._id,
            tenantId: visit.tenantId,
            hcmId: visit.hcmId,
            serviceType: visit.serviceType,
            date: visit.date,
            startTime: visit.startTime,
            endTime: visit.endTime,
            status: visit.status,
            companyId: visit.companyId,
            billId: visit.billId,
        };

        // Calculate units for this visit
        let units = 0;
        if (visitData.startTime && visitData.endTime) {
            const durationInMinutes =
                (new Date(visitData.endTime) - new Date(visitData.startTime)) /
                (1000 * 60);
            units = Math.ceil(durationInMinutes / 15);
        }

        // Delete the visit
        const deletedVisit = await Visits.findByIdAndDelete(id);

        // Find claim-visit mapping for this visit
        let claimMapping = null;
        try {
            claimMapping = await ClaimVisitMap.findOne({ visitId: id });

            if (claimMapping) {
                // Check if this is part of a merged visit group
                if (claimMapping.visitIds && claimMapping.visitIds.length > 1) {
                    // This is a merged visit - update the mapping instead of deleting it
                    // Remove this visit ID from the visitIds array
                    const visitIdIndex = claimMapping.visitIds.indexOf(id.toString());
                    if (visitIdIndex !== -1) {
                        claimMapping.visitIds.splice(visitIdIndex, 1);
                    }

                    // Update mergedUnits and mergedAmount
                    claimMapping.mergedUnits = Math.max(0, claimMapping.mergedUnits - units);

                    // Calculate amount to subtract based on service rate
                    const service = await ServiceTracking.findOne({
                        tenantId: visitData.tenantId,
                        serviceType: visitData.serviceType,
                    });

                    const amountToSubtract = service ? units * service.billRate : 0;
                    claimMapping.mergedAmount = Math.max(0, claimMapping.mergedAmount - amountToSubtract);

                    // If there are still visits in the mapping, save it; otherwise delete it
                    if (claimMapping.visitIds.length > 0) {
                        await claimMapping.save();
                    } else {
                        await ClaimVisitMap.findByIdAndDelete(claimMapping._id);
                    }
                } else {
                    // This is a single visit mapping - delete it
                    await ClaimVisitMap.findByIdAndDelete(claimMapping._id);
                }
            }
        } catch (mappingError) {
            console.error('[BACKEND] Error handling claim-visit mapping:', mappingError);
        }

        // send notification to hcm
        const hcmUser = await users.findById(visitData.hcmId);
        if (hcmUser && visit.creatorId) {
            const visitDateStr = visitData.date.toDateString();
            const visitTimeStr = visitData.startTime
                ? new Date(visitData.startTime).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                })
                : '';
            await sendVisitNotification(
                visitData.hcmId,
                'Visit Deleted',
                `The visit for the tenant on ${visitDateStr} at ${visitTimeStr} has been deleted.`,
                {
                    visitId: visitData._id.toString(),
                    tenantId: visitData.tenantId.toString(),
                }
            );
        }

        // Try to update the bill instead of deleting it
        try {
            // If the visit had a billId, use it to find and update the bill
            if (visitData.billId) {
                const bill = await Bills.findById(visitData.billId);

                if (bill) {
                    // Update HCM entry
                    const hcmIndex = bill.hcms.findIndex(hcmEntry =>
                        hcmEntry.id.toString() === visitData.hcmId.toString()
                    );

                    if (hcmIndex !== -1) {
                        // Subtract units and amount
                        bill.hcms[hcmIndex].workedUnits = Math.max(0, bill.hcms[hcmIndex].workedUnits - units);

                        // Calculate amount to subtract based on service rate
                        const service = await ServiceTracking.findOne({
                            tenantId: visitData.tenantId,
                            serviceType: visitData.serviceType,
                        });

                        const amountToSubtract = service ? units * service.billRate : 0;
                        bill.hcms[hcmIndex].billAmount = Math.max(0, bill.hcms[hcmIndex].billAmount - amountToSubtract);

                        // If no units left for this HCM, remove the entry
                        if (bill.hcms[hcmIndex].workedUnits <= 0) {
                            bill.hcms.splice(hcmIndex, 1);
                        }
                    }

                    // Find and update the service line
                    const serviceLineIndex = bill.serviceLines.findIndex(line =>
                        new Date(line.serviceDate).toDateString() === new Date(visitData.date).toDateString() &&
                        (line.serviceType === visitData.serviceType || line.serviceName === visitData.serviceType)
                    );

                    if (serviceLineIndex !== -1) {
                        // Subtract units and amount
                        bill.serviceLines[serviceLineIndex].serviceUnitCount = Math.max(0, bill.serviceLines[serviceLineIndex].serviceUnitCount - units);

                        const service = await ServiceTracking.findOne({
                            tenantId: visitData.tenantId,
                            serviceType: visitData.serviceType,
                        });
                        const amountToSubtract = service ? units * service.billRate : 0;
                        bill.serviceLines[serviceLineIndex].lineItemChargeAmount = Math.max(0, bill.serviceLines[serviceLineIndex].lineItemChargeAmount - amountToSubtract);

                        // Remove visit ID from merged list if it exists
                        if (bill.serviceLines[serviceLineIndex].mergedVisitIds) {
                            const visitIdIndex = bill.serviceLines[serviceLineIndex].mergedVisitIds.indexOf(id.toString());
                            if (visitIdIndex !== -1) {
                                bill.serviceLines[serviceLineIndex].mergedVisitIds.splice(visitIdIndex, 1);
                            }

                            // If no visits left in this service line, remove it
                            if (bill.serviceLines[serviceLineIndex].mergedVisitIds.length === 0) {
                                bill.serviceLines.splice(serviceLineIndex, 1);
                            }
                        } else if (bill.serviceLines[serviceLineIndex].visitId && bill.serviceLines[serviceLineIndex].visitId.toString() === id.toString()) {
                            // If this was the only visit for this service line, remove it
                            bill.serviceLines.splice(serviceLineIndex, 1);
                        }
                    }

                    // Update total amounts
                    const totalAmount = bill.serviceLines?.reduce((sum, line) => sum + (line.lineItemChargeAmount || 0), 0) || 0;
                    const totalUnits = bill.serviceLines?.reduce((sum, line) => sum + (line.serviceUnitCount || 0), 0) || 0;

                    if (bill.serviceLine) {
                        bill.serviceLine.serviceUnitCount = totalUnits;
                        bill.serviceLine.lineItemChargeAmount = totalAmount;
                    }

                    if (bill.bill && bill.bill.claimInformation) {
                        bill.bill.claimInformation.totalClaimChargeAmount = totalAmount;
                    }

                    // If no service lines left, delete the bill
                    if (bill.serviceLines.length === 0) {
                        await Bills.findByIdAndDelete(bill._id);
                    } else {
                        await bill.save();
                        // Regenerate EDI for this bill
                        const visitDate = new Date(visitData.date);
                        const monthYearKey = `${visitDate.getFullYear()}-${(visitDate.getMonth() + 1).toString().padStart(2, '0')}`;

                        try {
                            await regenerateBatchEDI(visitData.companyId, monthYearKey);
                        } catch (ediError) {
                            console.error(`Error regenerating EDI batch: ${ediError.message}`);
                        }
                    }
                }
            }

            // If the visit was approved, we need to update service tracking
            if (visitData.status === 'approved' && units > 0) {
                // Find the service tracking record
                const serviceTracking = await ServiceTracking.findOne({
                    tenantId: visitData.tenantId,
                    serviceType: visitData.serviceType,
                });

                if (serviceTracking) {
                    // Update total worked units and remaining
                    serviceTracking.workedUnits = Math.max(
                        0,
                        serviceTracking.workedUnits - units
                    );
                    serviceTracking.unitsRemaining =
                        serviceTracking.unitsRemaining + units;
                    // Update HCM's units
                    const hcmRecord = serviceTracking.hcms.find(
                        (hcm) =>
                            hcm.hcmId && hcm.hcmId.toString() === visitData.hcmId.toString()
                    );

                    if (hcmRecord) {
                        // Update HCM's total units
                        hcmRecord.workedUnits = Math.max(
                            0,
                            (hcmRecord.workedUnits || 0) - units
                        );
                        // Find service detail for the date
                        const visitDate = new Date(visitData.date);
                        const dateString = visitDate.toISOString().split('T')[0];

                        const serviceDetailIndex = hcmRecord.serviceDetails.findIndex(
                            (detail) =>
                                new Date(detail.dateOfService).toISOString().split('T')[0] ===
                                dateString
                        );

                        if (serviceDetailIndex !== -1) {
                            const serviceDetail =
                                hcmRecord.serviceDetails[serviceDetailIndex];
                            // Subtract units from the service detail
                            serviceDetail.workedUnits = Math.max(
                                0,
                                (serviceDetail.workedUnits || 0) - units
                            );
                            // If no units left, remove the service detail
                            if (serviceDetail.workedUnits <= 0) {
                                hcmRecord.serviceDetails.splice(serviceDetailIndex, 1);
                            } else {
                                hcmRecord.serviceDetails[serviceDetailIndex] = serviceDetail;
                            }
                        }
                    }

                    await serviceTracking.save();
                }
            }
        } catch (error) {
            console.error('Error updating related records:', error);
            // Continue with response even if cleanup fails
        }

        res.status(200).json({
            success: true,
            message: 'Visit deleted successfully',
            data: deletedVisit,
        });
    } catch (error) {
        console.error('Error deleting visit:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

export const visitsWaitingForApproval = async (req, res) => {
    const { companyId } = req.params;
    try {
        const visits = await Visits.find({ status: 'pending', companyId });
        res.status(200).json({
            success: true,
            message: 'Visits waiting for approval fetched successfully',
            response: {
                visits: visits,
                count: visits.length,
            },
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

export const getVisitsCompliance = async (req, res) => {
    const { companyId } = req.params;
    try {
        const visits = await Visits.find({ companyId })
            .populate({
                path: 'tenantId',
                select: '_id name email',
                model: 'causers',
            })
            .populate({
                path: 'hcmId',
                select: '_id name email',
                model: 'causers',
            });

        const visitCounts = {};
        const visitDetails = {
            'in-person': {},
            indirect: {},
            remote: {},
        };

        const monthNames = [
            'Jan',
            'Feb',
            'Mar',
            'Apr',
            'May',
            'Jun',
            'Jul',
            'Aug',
            'Sep',
            'Oct',
            'Nov',
            'Dec',
        ];

        visits.forEach((visit) => {
            const visitDate = new Date(visit.date);
            if (isNaN(visitDate)) {
                console.error(`Invalid date for visit ID: ${visit._id}`);
                return;
            }

            const year = visitDate.getFullYear();
            const month = monthNames[visitDate.getMonth()];

            if (!visitCounts[year]) {
                visitCounts[year] = {};
            }
            if (!visitCounts[year][month]) {
                visitCounts[year][month] = { 'in-person': 0, indirect: 0, remote: 0 };
            }

            if (!visitDetails['in-person'][year]) {
                visitDetails['in-person'][year] = {};
            }
            if (!visitDetails['indirect'][year]) {
                visitDetails['indirect'][year] = {};
            }
            if (!visitDetails['remote'][year]) {
                visitDetails['remote'][year] = {};
            }

            if (!visitDetails['in-person'][year][month]) {
                visitDetails['in-person'][year][month] = [];
            }
            if (!visitDetails['indirect'][year][month]) {
                visitDetails['indirect'][year][month] = [];
            }
            if (!visitDetails['remote'][year][month]) {
                visitDetails['remote'][year][month] = [];
            }

            const method = visit.methodOfContact || 'unknown';
            switch (method) {
                case 'in-person':
                    visitCounts[year][month]['in-person']++;
                    visitDetails['in-person'][year][month].push(createVisitDetail(visit));
                    break;
                case 'indirect':
                    visitCounts[year][month]['indirect']++;
                    visitDetails['indirect'][year][month].push(createVisitDetail(visit));
                    break;
                case 'remote':
                    visitCounts[year][month]['remote']++;
                    visitDetails['remote'][year][month].push(createVisitDetail(visit));
                    break;
                default:
                    console.warn(`Unknown methodOfContact for visit ID: ${visit._id}`);
                    break;
            }
        });

        res.status(200).json({
            success: true,
            message: 'Visit compliance fetched successfully',
            response: {
                visitCounts,
                visitDetails,
                totalVisits: visits.length,
            },
        });
    } catch (error) {
        console.error('Error fetching visit data:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while fetching visit compliance data.',
        });
    }
};

function createVisitDetail(visit) {
    return {
        visitId: visit._id,
        tenant: {
            tenantId: visit.tenantId ? visit.tenantId._id : '-',
            tenantName: visit.tenantId ? visit.tenantId.name : '-',
            tenantEmail: visit.tenantId ? visit.tenantId.email : '-',
        },
        hcm: {
            hcmId: visit.hcmId ? visit.hcmId._id : '-',
            hcmName: visit.hcmId ? visit.hcmId.name : '-',
            hcmEmail: visit.hcmId ? visit.hcmId.email : '-',
        },
        serviceType: visit.serviceType,
        dateOfService: visit.date.toISOString().split('T')[0],
        methodOfVisit: visit.methodOfContact || 'N/A',
    };
}

export const getVisitsComplianceReports = async (req, res) => {
    const { companyId } = req.params;
    try {
        // Fetch all visit records
        const visits = await Visits.find({ companyId })
            .populate({
                path: 'tenantId',
                select: '_id name email phoneNo',
                model: 'causers',
            })
            .populate({
                path: 'hcmId',
                select: '_id name email phoneNo',
                model: 'causers',
            });

        // Format the response
        const formattedReports = visits.map((visit) => {
            const durationInMinutes =
                (new Date(visit.endTime) - new Date(visit.startTime)) / 60000;
            const duration = `${durationInMinutes / 60}h ${durationInMinutes % 60}m`;

            return {
                tenantId: visit.tenantId ? visit.tenantId._id : '-',
                tenantName: visit.tenantId ? visit.tenantId.name : '-',
                hcmId: visit.hcmId ? visit.hcmId._id : '-',
                assignedHCM: visit.hcmId ? visit.hcmId.name : '-',
                serviceType: visit.serviceType,
                dateOfService: visit.date.toISOString().split('T')[0],
                duration: duration,
                visitType: visit.activity || '-',
                methodOfVisit: visit.methodOfContact || '-',
                mileage: visit.totalMiles || 0,
            };
        });

        res.status(200).json({
            success: true,
            message: 'Visits compliance reports fetched successfully',
            response: {
                totalVisits: visits.length,
                visits: formattedReports,
            },
        });
    } catch (error) {
        console.error('Error fetching visits compliance reports:', error);
        res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

export const filterVisits = async (req, res) => {
    try {
        const { companyId } = req.params;
        const filterCriteria = req.body;

        // Initialize base query with companyId
        const query = { companyId };

        // If filter criteria provided, add additional filters
        if (filterCriteria && Object.keys(filterCriteria).length > 0) {
            if (filterCriteria._id) query._id = filterCriteria._id;
            if (filterCriteria.tenantId) query.tenantId = filterCriteria.tenantId;
            if (filterCriteria.hcmId) query.hcmId = filterCriteria.hcmId;
            if (filterCriteria.creatorId) query.creatorId = filterCriteria.creatorId;
            if (filterCriteria.serviceType)
                query.serviceType = filterCriteria.serviceType;
            if (filterCriteria.title) query.title = filterCriteria.title;
            if (filterCriteria.date) query.date = new Date(filterCriteria.date);
            if (filterCriteria.startDate && filterCriteria.endDate) {
                const start = new Date(filterCriteria.startDate);
                const end = new Date(filterCriteria.endDate);
                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                    query.date = { $gte: start, $lte: end };
                }
            }
            if (filterCriteria.startTime) query.startTime = filterCriteria.startTime;
            if (filterCriteria.endTime) query.endTime = filterCriteria.endTime;
            if (filterCriteria.place) query.place = filterCriteria.place;
            if (filterCriteria.methodOfVisit)
                query.methodOfVisit = filterCriteria.methodOfVisit;
            if (filterCriteria.reasonForRemote)
                query.reasonForRemote = filterCriteria.reasonForRemote;
            if (filterCriteria.notes) query.notes = filterCriteria.notes;
            if (filterCriteria.travel) query.travel = filterCriteria.travel;
            if (filterCriteria.totalMiles !== undefined)
                query.totalMiles = filterCriteria.totalMiles;
            if (filterCriteria.travelWithTenant !== undefined)
                query.travelWithTenant = filterCriteria.travelWithTenant;
            if (filterCriteria.travelWithoutTenant !== undefined)
                query.travelWithoutTenant = filterCriteria.travelWithoutTenant;
            if (filterCriteria.signature) query.signature = filterCriteria.signature;
            if (filterCriteria.status) query.status = filterCriteria.status;
        }

        // Fetch visits
        const visits = await Visits.find(query)
            .populate({
                path: 'creatorId',
                select: 'name email role',
                model: 'causers',
            })
            .populate({
                path: 'hcmId',
                select: 'name email phoneNo',
                model: 'causers',
            })
            .populate({
                path: 'tenantId',
                select: 'name email phoneNo',
                model: 'causers',
            })
            .sort({ dateOfService: 1, startTime: 1 });

        if (visits.length === 0) {
            return res.status(200).json({
                success: false,
                message:
                    'No visits found for this company with the specified criteria.',
            });
        }

        // Fetch all services for the tenants in the visits
        const tenantIds = [...new Set(visits.map((visit) => visit.tenantId?._id))];

        const services = await ServiceTracking.find({
            tenantId: { $in: tenantIds },
        }).select('tenantId serviceType unitsRemaining');

        // Attach remaining units to each visit
        const visitsWithServices = visits.map((visit) => {
            const service = services.find(
                (s) =>
                    s.tenantId.toString() === visit.tenantId?._id.toString() &&
                    s.serviceType === visit.serviceType
            );

            return {
                ...visit.toObject(), // Convert Mongoose document to plain object
                // unitsRemaining: service ? service.unitsRemaining : null,
            };
        });

        return res.status(200).json({
            success: true,
            message: 'Visits fetched successfully',
            response: visitsWithServices,
        });
    } catch (error) {
        console.error('Error in filterVisits:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message,
        });
    }
};

//to get the visit count of a company
export const getVisitsCount = async (req, res) => {
    const { companyId } = req.params;

    try {
        const visits = await Visits.find({ companyId });

        const counts = {
            status: { pending: 0, approved: 0, rejected: 0 },
            signature: { done: 0, 'not done': 0 },
            methodOfContact: { 'in-person': 0, remote: 0 },
            totalVisits: visits.length,
        };

        visits.forEach((visit) => {
            if (visit.status && counts.status[visit.status] !== undefined) {
                counts.status[visit.status]++;
            }

            if (visit.signature && counts.signature[visit.signature] !== undefined) {
                counts.signature[visit.signature]++;
            }

            if (
                visit.methodOfContact &&
                counts.methodOfContact[visit.methodOfContact] !== undefined
            ) {
                counts.methodOfContact[visit.methodOfContact]++;
            }
        });

        res.status(200).json({
            success: true,
            message: 'Visits count fetched successfully',
            counts,
        });
    } catch (error) {
        console.error('Error fetching visits count:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while fetching visits count.',
        });
    }
};

const withdrawingMarkingVisitAsApproved = async (visitId) => {
    try {
        const visitDocumentId = new mongoose.Types.ObjectId(visitId);
        const visit = await Visits.findById(visitDocumentId);
        if (!visit) {
            return { success: false, message: 'Visit not found' };
        }

        const companyId = visit.companyId;

        // Calculate visit units for service tracking adjustment
        let visitUnits = 0;
        if (visit.startTime && visit.endTime) {
            const visitDuration =
                (new Date(visit.endTime) - new Date(visit.startTime)) / 60000;
            visitUnits = Math.ceil(visitDuration / 15);
        }

        // Update visit status
        visit.status = 'pending';
        visit.signature = 'not done';
        visit.timeOfApproval = null;
        visit.timeOfRejection = null;
        visit.reasonForRejection = null;
        visit.billId = null;

        const bill = await removeBill(visit.billId);

        const visitStartTime = new Date(visit.startTime);
        const visitEndTime = new Date(visit.endTime);
        const durationInMinutes = (visitEndTime - visitStartTime) / 60000;
        const serviceUnits = durationInMinutes / 15;
        const workedHours = durationInMinutes / 60;

        await hcmVisitHistory.create({
            hcmId: visit.hcmId,
            visitId: visit._id,
            tenantId: visit.tenantId,
            serviceType: visit.serviceType,
            serviceDate: visit.date,
            serviceUnits: serviceUnits,
            workedHours: workedHours,
            status: 'pending',
        });

        return { success: true, message: 'Visit approval withdrawn successfully' };
    } catch (error) {
        console.error(
            '[WITHDRAW APPROVAL] Error withdrawing visit approval:',
            error
        );
        return {
            success: false,
            message: 'Internal Server Error',
            response: error.message,
        };
    }
};

export const markVisitAsRejected = async (req, res) => {
    try {
        const { visitId, reasonForRejection } = req.body;

        const response = await withdrawingMarkingVisitAsApproved(visitId);
        if (!response.success) {
            return res.status(400).json({
                success: false,
                message: response.message,
            });
        }

        const visitDocumentId = new mongoose.Types.ObjectId(visitId);
        const visit = await Visits.findById(visitDocumentId);
        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found',
            });
        }

        visit.status = 'rejected';
        visit.signature = 'not done';
        visit.reasonForRejection = reasonForRejection;
        visit.timeOfRejection = new Date();
        visit.timeOfApproval = null;
        visit.response = null;
        visit.rejectedBy = req.user?.id || null;
        await visit.save();

        const visitStartTime = new Date(visit.startTime);
        const visitEndTime = new Date(visit.endTime);
        const durationInMinutes = (visitEndTime - visitStartTime) / 60000;
        const serviceUnits = durationInMinutes / 15;
        const workedHours = durationInMinutes / 60;

        await hcmVisitHistory.create({
            hcmId: visit.hcmId,
            visitId: visit._id,
            tenantId: visit.tenantId,
            serviceType: visit.serviceType,
            serviceDate: visit.date,
            serviceUnits: serviceUnits,
            workedHours: workedHours,
            status: 'rejected',
        });

        return res.status(200).json({
            success: true,
            message: 'Visit rejected successfully',
            visitId: visitId,
            reasonForRejection: reasonForRejection,
        });
    } catch (error) {
        console.error('[VISIT REJECTION] Error marking visit as rejected:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            response: error.message,
        });
    }
};

export const withdrawMarkedVisitAsApproved = async (req, res) => {
    try {
        const { visitId } = req.body;
        const response = await withdrawingMarkingVisitAsApproved(visitId);
        if (!response.success) {
            return res.status(200).json({
                success: false,
                message: response.message,
            });
        }

        const visit = await Visits.findById(visitId);

        const visitStartTime = new Date(visit.startTime);
        const visitEndTime = new Date(visit.endTime);
        const durationInMinutes = (visitEndTime - visitStartTime) / 60000;
        const serviceUnits = durationInMinutes / 15;
        const workedHours = durationInMinutes / 60;

        await hcmVisitHistory.create({
            hcmId: visit.hcmId,
            visitId: visit._id,
            tenantId: visit.tenantId,
            serviceType: visit.serviceType,
            serviceDate: visit.date,
            serviceUnits: serviceUnits,
            workedHours: workedHours,
            status: 'pending',
        });

        return res.status(200).json({
            success: true,
            message: 'Visit approval withdrawn successfully',
        });
    } catch (error) {
        console.error('Error withdrawing marking visit as approved:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            response: error.message,
        });
    }
};

export const withdrawMarkedVisitAsRejected = async (req, res) => {
    try {
        const { visitId } = req.body;
        const response = await withdrawingMarkingVisitAsApproved(visitId);
        if (!response.success) {
            return res.status(200).json({
                success: false,
                message: response.message,
            });
        }
        const visit = await Visits.findById(visitId);
        visit.status = 'pending';
        visit.signature = 'not done';
        visit.timeOfApproval = null;
        visit.timeOfRejection = null;
        visit.reasonForRejection = null;
        await visit.save();
        const visitStartTime = new Date(visit.startTime);
        const visitEndTime = new Date(visit.endTime);
        const durationInMinutes = (visitEndTime - visitStartTime) / 60000;
        const serviceUnits = durationInMinutes / 15;
        const workedHours = durationInMinutes / 60;

        await hcmVisitHistory.create({
            hcmId: visit.hcmId,
            visitId: visit._id,
            tenantId: visit.tenantId,
            serviceType: visit.serviceType,
            serviceDate: visit.date,
            serviceUnits: serviceUnits,
            workedHours: workedHours,
            status: 'pending',
        });

        return res.status(200).json({
            success: true,
            message: 'Visit withdrawn successfully',
        });
    } catch (error) {
        console.error('Error withdrawing marking visit as rejected:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            response: error.message,
        });
    }
};

export const getServiceTypes = async (req, res) => {
    try {
        const serviceTypes = getAllServiceTypes();

        res.status(200).json({
            success: true,
            message: 'Service types fetched successfully',
            response: serviceTypes,
        });
    } catch (error) {
        console.error('Error fetching service types:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

export const getServiceTypeMapping = async (req, res) => {
    try {
        const { serviceType, methodOfContact } = req.query;

        if (!serviceType) {
            return res.status(400).json({
                success: false,
                message: 'Service type is required',
            });
        }

        const mapping = getProcedureCodeAndModifier(serviceType, methodOfContact);

        res.status(200).json({
            success: true,
            message: 'Service type mapping fetched successfully',
            response: mapping,
        });
    } catch (error) {
        console.error('Error fetching service type mapping:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

export const getPredefinedActivities = async (req, res) => {
    try {
        const activities = [
            '1. Assessment and care planning',
            '2. Medication management and monitoring',
            '3. Health education and counseling',
            '4. Coordination with healthcare providers',
            '5. Emergency response and crisis intervention',
            '6. Personal care assistance',
            '7. Household management support',
            '8. Transportation assistance',
            '9. Social and recreational activities',
            '10. Documentation and reporting',
            '11. Family and caregiver support',
            '12. Community resource coordination',
        ];

        res.status(200).json({
            success: true,
            message: 'Predefined activities fetched successfully',
            response: activities,
        });
    } catch (error) {
        console.error('Error fetching predefined activities:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};

// Function to create claim-visit mapping
const createClaimVisitMapping = async (visitId, billId, visit, procedureCodeInfo) => {
    try {
        // Check if there's already a mapping for this visit date, tenant, and service type
        const existingMapping = await ClaimVisitMap.findOne({
            claimId: billId,
            serviceDate: {
                $eq: new Date(visit.date)
            },
            serviceType: visit.serviceType,
            'visitData.tenantId': visit.tenantId.toString()
        });

        // Calculate units and amount for this visit
        let unitsUsed = 0;
        let billAmount = 0;

        if (visit.serviceType === 'T2038' || visit.serviceType === 'T2024') {
            unitsUsed = 1;
        } else if (visit.startTime && visit.endTime) {
            const durationInMinutes = (new Date(visit.endTime) - new Date(visit.startTime)) / 60000;
            unitsUsed = Math.ceil(durationInMinutes / 15);
        }

        // Get service tracking to calculate bill amount
        const service = await ServiceTracking.findOne({
            tenantId: visit.tenantId,
            serviceType: getProcedureCodeFromServiceType(visit.serviceType)
        });

        if (service) {
            billAmount = unitsUsed * service.billRate;
        }

        if (existingMapping) {
            // Update existing mapping with additional visit data
            // Add this visit to the visits array if not already included
            const isNewVisit = !existingMapping.visitIds.includes(visitId.toString());
            if (isNewVisit) {
                existingMapping.visitIds.push(visitId.toString());
            }

            // Update visit data array
            if (!existingMapping.visitData) {
                existingMapping.visitData = [];
            }

            // Check if visit data already exists for this visit ID to prevent duplicates
            const existingVisitData = existingMapping.visitData.find(
                data => data.visitId === visitId.toString()
            );

            if (!existingVisitData) {
                // New visit - add to merged totals and visit data
                existingMapping.mergedUnits += unitsUsed;
                existingMapping.mergedAmount += billAmount;

                existingMapping.visitData.push({
                    visitId: visitId.toString(),
                    tenantId: visit.tenantId.toString(),
                    hcmId: visit.hcmId.toString(),
                    serviceType: visit.serviceType,
                    units: unitsUsed,
                    amount: billAmount,
                    startTime: visit.startTime,
                    endTime: visit.endTime
                });
            } else {
                // Existing visit - update merged totals by subtracting old values and adding new ones
                existingMapping.mergedUnits = existingMapping.mergedUnits - existingVisitData.units + unitsUsed;
                existingMapping.mergedAmount = existingMapping.mergedAmount - existingVisitData.amount + billAmount;

                // Update existing visit data
                existingVisitData.units = unitsUsed;
                existingVisitData.amount = billAmount;
                existingVisitData.startTime = visit.startTime;
                existingVisitData.endTime = visit.endTime;
            }

            existingMapping.updatedAt = new Date();

            await existingMapping.save();
            return {
                success: true,
                mappingId: existingMapping._id
            };
        } else {
            // Create new mapping
            const claimVisitMap = new ClaimVisitMap({
                claimId: billId,
                visitId: visitId,
                visitIds: [visitId.toString()],
                serviceDate: visit.date,
                mergedUnits: unitsUsed,
                mergedAmount: billAmount,
                serviceType: visit.serviceType,
                procedureCode: procedureCodeInfo.code,
                modifiers: procedureCodeInfo.modifiers || [],
                ref6r: `${visit.serviceType}_${visit.date.toISOString().split('T')[0]}`,
                createdAt: new Date(),
                updatedAt: new Date(),
                visitData: [{
                    visitId: visitId.toString(),
                    tenantId: visit.tenantId.toString(),
                    hcmId: visit.hcmId.toString(),
                    serviceType: visit.serviceType,
                    units: unitsUsed,
                    amount: billAmount,
                    startTime: visit.startTime,
                    endTime: visit.endTime
                }]
            });

            await claimVisitMap.save();
            return {
                success: true,
                mappingId: claimVisitMap._id
            };
        }
    } catch (error) {
        console.error('[BACKEND] Error creating claim-visit mapping:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// Utility function to get claim mappings for a visit
const getClaimMappingForVisit = async (visitId) => {
    try {
        const claimMapping = await ClaimVisitMap.findOne({ visitId }).populate('claimId');
        return claimMapping;
    } catch (error) {
        console.error('[BACKEND] Error getting claim mapping for visit:', error);
        return null;
    }
};

// Endpoint to get claim mappings for visits
export const getVisitClaimMappings = async (req, res) => {
    try {
        const { companyId } = req.params;
        const { visitId } = req.query;

        let query = {};

        if (visitId) {
            // Get mapping for specific visit
            query.visitId = visitId;
        }

        const claimMappings = await ClaimVisitMap.find(query)
            .populate({
                path: 'visitId',
                select: 'date startTime endTime serviceType tenantId hcmId companyId status',
                model: 'visits',
                match: companyId ? { companyId } : {}
            })
            .populate({
                path: 'claimId',
                select: 'claimId controlNumber billName serviceDate totalAmount'
            })
            .sort({ serviceDate: -1 });

        // Filter out mappings where visit doesn't match company (due to populate match)
        const filteredMappings = claimMappings.filter(mapping => mapping.visitId);

        res.status(200).json({
            success: true,
            message: 'Claim mappings retrieved successfully',
            mappings: filteredMappings,
            count: filteredMappings.length
        });
    } catch (error) {
        console.error('[BACKEND] Error getting visit claim mappings:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};