import appointments from '../../models/appointments-visits/appointments.js';
import mongoose from 'mongoose';
import ServiceTracking from '../../models/bills/serviceTracking.js';
import Visits from '../../models/appointments-visits/visits.js';
import { response } from 'express';
import appsDirectlyFromVisits from '../../models/appointments-visits/appsDirectlyFromVisits.js';
import { createNotification } from '../communication-documents/notificationController.js';
import {
  sendAppointmentNotification,
  createAppointmentReminders,
  removePendingAppointmentReminders,
} from '../../utils/pushnotifications.js';
import users from '../../models/account/users.js';
import { formatDateAndTimeForNotificationWithTimezone } from '../../utils/notificationDateTimeFormat.js';
import Service from '../../models/services/services.js';
import { calculateScheduledUnits } from '../../utils/calculateScheduledUnits.js';

export const filterAppointments = async (req, res) => {
  try {
    const { hcmId, tenantId, status, approved, startDate, endDate, companyId } =
      req.body;

    const query = { companyId };

    if (hcmId) {
      if (!mongoose.Types.ObjectId.isValid(hcmId)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid HCM ID format',
        });
      }
      query.hcmId = hcmId;
    }

    if (tenantId) {
      if (!mongoose.Types.ObjectId.isValid(tenantId)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid Tenant ID format',
        });
      }
      query.tenantId = tenantId;
    }

    if (status) {
      const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid status value',
        });
      }
      query.status = status;
    }

    if (approved !== undefined) {
      query.approved = approved;
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(200).json({
          success: false,
          message: 'Invalid date format',
        });
      }
      query.date = { $gte: start, $lte: end };
    }

    const filteredAppointments = await appointments
      .find(query)
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
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      })
      .sort({ date: 1, startTime: 1 });

    if (filteredAppointments.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No appointments found with the specified criteria.',
        appointments: {
          completed: {},
          upcoming: {},
          cancelled: {},
        },
      });
    }

    const groupedAppointments = {
      completed: {},
      upcoming: {},
      cancelled: {},
    };

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const months = [
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

    filteredAppointments.forEach((appointment) => {
      const appDate = new Date(appointment.date);
      appDate.setHours(0, 0, 0, 0);
      const year = appDate.getFullYear().toString();
      const month = months[appDate.getMonth()];
      const date = appDate.getDate().toString().padStart(2, '0');

      // Map to old structure
      const a = {
        ...appointment.toObject(),
        hcmDetails: appointment.hcmId,
        tenantDetails: appointment.tenantId,
        serviceType: appointment.serviceId?.service_procedure_code || null,
        serviceTypeName: appointment.serviceId?.service_name || null,
      };

      // Status grouping
      let statusGroup;
      if (appointment.status === 'completed') {
        statusGroup = 'completed';
      } else if (appointment.status === 'cancelled') {
        statusGroup = 'cancelled';
      } else {
        statusGroup = appDate >= currentDate ? 'upcoming' : 'completed';
      }

      if (!groupedAppointments[statusGroup][year]) {
        groupedAppointments[statusGroup][year] = {};
      }
      if (!groupedAppointments[statusGroup][year][month]) {
        groupedAppointments[statusGroup][year][month] = {};
      }
      if (!groupedAppointments[statusGroup][year][month][date]) {
        groupedAppointments[statusGroup][year][month][date] = [];
      }

      groupedAppointments[statusGroup][year][month][date].push(a);
    });

    // Sort years, months, dates
    for (const status in groupedAppointments) {
      const sortedYears = {};
      Object.keys(groupedAppointments[status])
        .sort((a, b) => b - a)
        .forEach((year) => {
          sortedYears[year] = {};
          const monthsInYear = groupedAppointments[status][year];

          months.forEach((month) => {
            if (monthsInYear[month]) {
              sortedYears[year][month] = {};
              const datesInMonth = monthsInYear[month];
              Object.keys(datesInMonth)
                .sort((a, b) => a - b)
                .forEach((date) => {
                  sortedYears[year][month][date] = datesInMonth[date];
                });
            }
          });
        });
      groupedAppointments[status] = sortedYears;
    }

    res.status(200).json({
      success: true,
      message: 'Appointments fetched and grouped successfully',
      appointments: groupedAppointments,
    });
  } catch (error) {
    console.error('Error in filterAppointments:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
};

export const getAppointments = async (req, res) => {
  try {
    const { companyId } = req.params;

    // Convert companyId to ObjectId
    const companyIdObject = new mongoose.Types.ObjectId(companyId);

    const appointmentsRecords = await appointments
      .find({ companyId: companyIdObject })
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
      .populate({
        path: 'serviceId',
        select: 'service_procedure_code service_name',
        model: 'Service',
      })
      .sort({ date: 1, startTime: 1 });

    const formattedAppointments = appointmentsRecords.map((app) => ({
      ...app.toObject(),
      hcmDetails: app.hcmId,
      tenantDetails: app.tenantId,
      serviceType: app.serviceId?.service_procedure_code || null,
      serviceTypeName: app.serviceId?.service_name || null,
    }));

    res.status(200).json({
      success: true,
      message: 'Appointments fetched successfully',
      response: {
        appointments: formattedAppointments,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
};

export const fetchAppointments = async (req, res) => {
  try {
    const { companyId } = req.params;

    const appointmentsRecords = await appointments
      .find({ companyId })
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
      .populate({
        path: 'serviceId',
        select: 'service_procedure_code service_name',
        model: 'services',
      })
      .sort({ date: 1, startTime: 1 });

    if (appointmentsRecords.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No appointments found.',
        appointments: {
          completed: [],
          pending: [],
          other: [],
        },
      });
    }

    // Group appointments by status
    const groupedAppointments = {
      completed: [],
      pending: [],
      other: [],
    };

    appointmentsRecords.forEach((appointment) => {
      const formattedAppointment = {
        ...appointment.toObject(),
        hcmDetails: appointment.hcmId,
        tenantDetails: appointment.tenantId,
        serviceType: appointment.serviceId?.service_procedure_code || null,
        serviceTypeName: appointment.serviceId?.service_name || null,
      };

      // Determine status group
      if (appointment.status === 'completed') {
        groupedAppointments.completed.push(formattedAppointment);
      } else if (appointment.status === 'pending') {
        groupedAppointments.pending.push(formattedAppointment);
      } else {
        groupedAppointments.other.push(formattedAppointment);
      }
    });

    res.status(200).json({
      success: true,
      message: 'Appointments fetched and grouped successfully',
      response: groupedAppointments,
    });
  } catch (error) {
    console.error('Error in fetchAppointments:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
};

export const updateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    // Get update data directly from req.body instead of expecting a nested structure
    const updatedAppointmentData = req.body;
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid appointment ID format',
      });
    }

    const appointmentId = new mongoose.Types.ObjectId(id);

    // Find the appointment
    const appointment = await appointments.findById(appointmentId);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }
    // Process date and time if provided
    let appointmentDate = appointment.date;
    let appointmentStartTime = appointment.startTime;
    let appointmentEndTime = appointment.endTime;

    // If date is being updated, process it properly
    if (updatedAppointmentData.date || updatedAppointmentData.dateOfService) {
      const inputDate =
        updatedAppointmentData.date || updatedAppointmentData.dateOfService;
      // Parse the date - we expect an ISO string from the frontend
      appointmentDate = new Date(inputDate);
    }

    // If time is being updated, process it properly
    if (updatedAppointmentData.startTime && updatedAppointmentData.endTime) {
      // Parse times - we expect ISO strings from the frontend
      appointmentStartTime = new Date(updatedAppointmentData.startTime);
      appointmentEndTime = new Date(updatedAppointmentData.endTime);

      // 🔍 OVERLAP CHECK: prevent overlapping for same tenant OR same HCM
      if (appointmentStartTime && appointmentEndTime) {
        const overlapQuery = {
          _id: { $ne: appointmentId },
          status: { $nin: ['cancelled', 'rejected'] },

          $or: [
            {
              tenantId:
                updatedAppointmentData?.tenantId || appointment.tenantId,
            },
            { hcmId: updatedAppointmentData?.hcmId || appointment.hcmId },
          ],
          startTime: { $lt: appointmentEndTime }, // existing.start < newEnd
          endTime: { $gt: appointmentStartTime }, // existing.end > newStart
        };

        const overlappingAppointments = await appointments
          .find(overlapQuery)
          .lean();

        if (overlappingAppointments.length > 0) {
          return res.status(400).json({
            success: false,
            message:
              'An overlapping appointment already exists for this tenant or HCM in the selected timeslot.',
          });
        }
      }
    }
    const serviceDoc = await Service.findOne({
      _id: updatedAppointmentData.serviceId,
    });
    // Create updated appointment data with proper null/undefined handling
    const updatedAppointment = {
      tenantId: updatedAppointmentData?.tenantId || appointment.tenantId,
      hcmId: updatedAppointmentData?.hcmId || appointment.hcmId,
      date: appointmentDate,
      startTime: appointmentStartTime,
      endTime: appointmentEndTime,
      serviceId: serviceDoc?._id || appointment.serviceId,
      methodOfContact:
        updatedAppointmentData?.methodOfContact || appointment.methodOfContact,
      reasonForRemote:
        updatedAppointmentData?.reasonForRemote || appointment.reasonForRemote,
      placeOfService:
        updatedAppointmentData?.placeOfService || appointment.placeOfService,
      travel: updatedAppointmentData?.travel || appointment.travel,
      totalMiles:
        updatedAppointmentData?.totalMiles !== undefined
          ? updatedAppointmentData.totalMiles
          : appointment.totalMiles,
      travelWithTenant:
        updatedAppointmentData?.travelWithTenant !== undefined
          ? updatedAppointmentData.travelWithTenant
          : appointment.travelWithTenant,
      travelWithoutTenant:
        updatedAppointmentData?.travelWithoutTenant !== undefined
          ? updatedAppointmentData.travelWithoutTenant
          : appointment.travelWithoutTenant,
      status: updatedAppointmentData?.status || appointment.status,
      activity:
        updatedAppointmentData?.activity ||
        updatedAppointmentData?.title ||
        appointment.activity,
      description:
        updatedAppointmentData?.description || appointment.description,
      response: updatedAppointmentData?.response || appointment.response,
      notes: updatedAppointmentData?.notes || appointment.notes,
      procedureCode:
        updatedAppointmentData?.procedureCode || appointment.procedureCode,
      identifier: updatedAppointmentData?.identifier || appointment.identifier,
      companyId: updatedAppointmentData?.companyId || appointment.companyId,
    };
    // Update the appointment
    const updatedAppointmentRecord = await appointments.findByIdAndUpdate(
      appointmentId,
      updatedAppointment,
      { new: true },
    );
    // send notification to HCM
    // Your appointment with Tenant_Name scheduled on June 26, 2025 at 11:00 AM has been updated to June 27, 2025 at 03:30 PM.
    const hcmDetails = await users.findById(updatedAppointmentRecord.hcmId);
    const timezone = hcmDetails?.timezone || 'UTC';

    const previousDateAndTime = formatDateAndTimeForNotificationWithTimezone(
      appointment.date,
      appointment.startTime,
      timezone,
    );

    const updatedDateAndTime = formatDateAndTimeForNotificationWithTimezone(
      updatedAppointmentRecord.date,
      updatedAppointmentRecord.startTime,
      timezone,
    );

    const tenantDetails = await users.findById(
      updatedAppointmentRecord.tenantId,
    );

    await sendAppointmentNotification(
      updatedAppointmentRecord.hcmId,
      'Appointment Updated',
      `Your appointment with ${tenantDetails.name} scheduled on ${previousDateAndTime} has been updated to ${updatedDateAndTime}.`,
      {
        appointmentId: updatedAppointmentRecord._id.toString(),
        type: 'appointment',
      },
    );

    await removePendingAppointmentReminders(updatedAppointmentRecord._id);
    await createAppointmentReminders(
      updatedAppointmentRecord,
      hcmDetails,
      tenantDetails.name,
    );

    // Handle service tracking if needed
    if (updatedAppointmentRecord) {
      try {
        // ---------------- HELPERS ----------------
        const getStartEndOfDayUTC = (dateObj) => {
          const d = new Date(dateObj);
          const start = new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
          );
          const end = new Date(start);
          end.setUTCDate(end.getUTCDate() + 1);
          return { start, end };
        };

        const findOrCreateHcmEntry = (serviceTrackingDoc, hcmId) => {
          let hcmEntry = serviceTrackingDoc.hcms.find(
            (h) => h.hcmId.toString() === hcmId.toString(),
          );

          if (!hcmEntry) {
            hcmEntry = {
              hcmId,
              scheduledUnits: 0,
              workedUnits: 0,
              billAmount: 0,
              scheduledDetails: [],
              serviceDetails: [],
            };
            serviceTrackingDoc.hcms.push(hcmEntry);
          }

          return hcmEntry;
        };

        const removeDailyDetail = (hcmEntry, dateObj) => {
          const dateStr = new Date(dateObj).toISOString().split('T')[0];
          hcmEntry.scheduledDetails = hcmEntry.scheduledDetails.filter(
            (d) =>
              new Date(d.dateOfService).toISOString().split('T')[0] !== dateStr,
          );
        };

        const addDailyDetail = (hcmEntry, dateObj) => {
          const dateStr = new Date(dateObj).toISOString().split('T')[0];

          // prevent duplicate detail same date
          const exists = hcmEntry.scheduledDetails.some(
            (d) =>
              new Date(d.dateOfService).toISOString().split('T')[0] === dateStr,
          );

          if (!exists) {
            hcmEntry.scheduledDetails.push({
              dateOfService: dateObj,
              scheduledUnits: 1,
            });
          }
        };

        const recalcUnitsRemaining = (serviceTrackingDoc) => {
          serviceTrackingDoc.unitsRemaining =
            serviceTrackingDoc.totalUnits -
            serviceTrackingDoc.workedUnits -
            serviceTrackingDoc.scheduledUnits;

          if (serviceTrackingDoc.unitsRemaining < 0)
            serviceTrackingDoc.unitsRemaining = 0;
        };

        // ---------------- INPUTS ----------------
        const oldServiceId = appointment.serviceId;
        const newServiceId = updatedAppointmentRecord.serviceId;

        const oldHcmId = appointment.hcmId;
        const newHcmId = updatedAppointmentRecord.hcmId;

        const oldDateStr = appointment.date.toISOString().split('T')[0];
        const newDateStr = updatedAppointmentRecord.date
          .toISOString()
          .split('T')[0];

        // Fetch service docs
        const oldServiceDoc = await Service.findById(oldServiceId);
        const newServiceDoc = await Service.findById(newServiceId);

        if (!oldServiceDoc || !newServiceDoc)
          throw new Error('Service doc not found');

        const oldServiceDuration = oldServiceDoc.service_duration;
        const newServiceDuration = newServiceDoc.service_duration;

        // Tracking docs (might be same doc or different doc)
        const oldTracking = await ServiceTracking.findOne({
          tenantId: appointment.tenantId,
          serviceId: oldServiceId,
        });

        const newTracking = await ServiceTracking.findOne({
          tenantId: updatedAppointmentRecord.tenantId,
          serviceId: newServiceId,
        });

        if (!oldTracking || !newTracking)
          throw new Error('Service tracking not found');

        const serviceChanged =
          oldServiceId.toString() !== newServiceId.toString();
        const hcmChanged = oldHcmId.toString() !== newHcmId.toString();
        const dateChanged = oldDateStr !== newDateStr;

        // ---------------- DAILY SERVICE LOGIC ----------------
        // DAILY means: 1 unit per DAY per tenant+service if at least one appt exists that day
        if (newServiceDuration === 'Daily') {
          // If nothing meaningful changed (date/service/hcm), skip
          if (!dateChanged && !serviceChanged && !hcmChanged) {
            // do nothing
          } else {
            // OLD day check (should remove unit if after update old day has 0 appts)
            const { start: oldStart, end: oldEnd } = getStartEndOfDayUTC(
              appointment.date,
            );

            // Count appointments on OLD day for OLD service (AFTER update, appointment moved away already)
            const oldDayCountAfter = await appointments.countDocuments({
              tenantId: appointment.tenantId,
              serviceId: oldServiceId,
              date: { $gte: oldStart, $lt: oldEnd },
              status: { $nin: ['cancelled', 'rejected'] },
            });

            // NEW day check (should add unit if after update new day has 1 appt => this one is first)
            const { start: newStart, end: newEnd } = getStartEndOfDayUTC(
              updatedAppointmentRecord.date,
            );

            const newDayCountAfter = await appointments.countDocuments({
              tenantId: updatedAppointmentRecord.tenantId,
              serviceId: newServiceId,
              date: { $gte: newStart, $lt: newEnd },
              status: { $nin: ['cancelled', 'rejected'] },
            });

            const shouldRemoveOldUnit =
              dateChanged || serviceChanged || hcmChanged;
            const shouldAddNewUnit =
              dateChanged || serviceChanged || hcmChanged;

            // ✅ REMOVE FROM OLD TRACKING/HCM only if old day became empty
            if (shouldRemoveOldUnit && oldDayCountAfter === 0) {
              const oldHcmEntry = findOrCreateHcmEntry(oldTracking, oldHcmId);

              oldTracking.scheduledUnits -= 1;
              if (oldTracking.scheduledUnits < 0)
                oldTracking.scheduledUnits = 0;

              oldHcmEntry.scheduledUnits -= 1;
              if (oldHcmEntry.scheduledUnits < 0)
                oldHcmEntry.scheduledUnits = 0;

              removeDailyDetail(oldHcmEntry, appointment.date);
              recalcUnitsRemaining(oldTracking);

              await oldTracking.save();
            }

            // ✅ ADD TO NEW TRACKING/HCM only if new day has exactly 1 appointment (first on that day)
            if (shouldAddNewUnit && newDayCountAfter === 1) {
              const newHcmEntry = findOrCreateHcmEntry(newTracking, newHcmId);

              newTracking.scheduledUnits += 1;
              newHcmEntry.scheduledUnits += 1;

              addDailyDetail(newHcmEntry, updatedAppointmentRecord.date);

              recalcUnitsRemaining(newTracking);
              await newTracking.save();
            }
          }
        }

        // ---------------- 15-MIN SERVICE LOGIC ----------------
        else {
          // Calculate old and new units
          const oldDuration =
            (new Date(appointment.endTime) - new Date(appointment.startTime)) /
            60000;

          const newDuration =
            (new Date(updatedAppointmentRecord.endTime) -
              new Date(updatedAppointmentRecord.startTime)) /
            60000;

          const oldUnits = Math.ceil(oldDuration / 15);
          const newUnits = Math.ceil(newDuration / 15);

          // If service or hcm changes, treat it as remove oldUnits from old entry + add newUnits to new entry
          if (serviceChanged || hcmChanged) {
            // ✅ REMOVE FROM OLD
            {
              const oldHcmEntry = findOrCreateHcmEntry(oldTracking, oldHcmId);

              oldTracking.scheduledUnits -= oldUnits;
              if (oldTracking.scheduledUnits < 0)
                oldTracking.scheduledUnits = 0;

              oldHcmEntry.scheduledUnits -= oldUnits;
              if (oldHcmEntry.scheduledUnits < 0)
                oldHcmEntry.scheduledUnits = 0;

              recalcUnitsRemaining(oldTracking);
              await oldTracking.save();
            }

            // ✅ ADD TO NEW (check availability only if newUnits consumes more units)
            {
              // if moving to a new tracking doc, availability must be checked
              if (newTracking.unitsRemaining < newUnits) {
                return res.status(400).json({
                  success: false,
                  message: 'Not enough remaining units',
                });
              }

              const newHcmEntry = findOrCreateHcmEntry(newTracking, newHcmId);

              newTracking.scheduledUnits += newUnits;
              newHcmEntry.scheduledUnits += newUnits;

              recalcUnitsRemaining(newTracking);
              await newTracking.save();
            }
          } else {
            // Same serviceTracking + same HCM → just apply diff
            const diff = newUnits - oldUnits;

            if (diff !== 0) {
              if (diff > 0 && newTracking.unitsRemaining < diff) {
                return res.status(400).json({
                  success: false,
                  message: 'Not enough remaining units',
                });
              }

              const sameHcmEntry = findOrCreateHcmEntry(newTracking, newHcmId);

              newTracking.scheduledUnits += diff;
              if (newTracking.scheduledUnits < 0)
                newTracking.scheduledUnits = 0;

              sameHcmEntry.scheduledUnits += diff;
              if (sameHcmEntry.scheduledUnits < 0)
                sameHcmEntry.scheduledUnits = 0;

              recalcUnitsRemaining(newTracking);
              await newTracking.save();
            }
          }
        }
      } catch (err) {
        console.error('Error updating units:', err);
      }
    }

    // Send notification to HCM about the appointment update
    try {
      const hcmDetails = await users.findById(updatedAppointment.hcmId);
      const timezone = hcmDetails?.timezone || 'UTC';

      const tenantDetails = await users.findById(updatedAppointment.tenantId);

      // Check if date or time was changed to send appropriate notification
      const dateChanged =
        updatedAppointment.date &&
        new Date(appointment.date).toISOString().split('T')[0] !==
        new Date(updatedAppointment.date).toISOString().split('T')[0];

      const timeChanged =
        (updatedAppointment.startTime &&
          updatedAppointment.startTime !== appointment.startTime) ||
        (updatedAppointment.endTime &&
          updatedAppointment.endTime !== appointment.endTime);

      if (dateChanged || timeChanged) {
        // Send update notification with previous and new times
        const previousDateAndTime =
          formatDateAndTimeForNotificationWithTimezone(
            appointment.date,
            appointment.startTime,
            timezone,
          );

        const updatedDateAndTime = formatDateAndTimeForNotificationWithTimezone(
          updatedAppointment.date,
          updatedAppointment.startTime,
          timezone,
        );

        // Remove old reminders and create new ones
        await removePendingAppointmentReminders(updatedAppointment._id);
        await createAppointmentReminders(
          updatedAppointment,
          hcmDetails,
          tenantDetails.name,
        );

        // Send notifications to tenant and HCM via web/mobile notifications
        if (updatedAppointment.tenantId) {
          try {
            await createNotification({
              recipient: updatedAppointment.tenantId,
              type: 'appointment',
              title: 'Appointment Updated',
              message: `Your appointment has been rescheduled for ${updatedDateAndTime}`,
              data: {
                appointmentId: updatedAppointment._id,
                date: updatedAppointment.date,
              },
              forMobile: true,
              forWeb: false,
            });
          } catch (notificationError) {
            console.error(
              'Error sending tenant notification:',
              notificationError,
            );
          }
        }

        if (updatedAppointment.hcmId) {
          try {
            await createNotification({
              recipient: updatedAppointment.hcmId,
              type: 'appointment',
              title: 'Appointment Updated',
              message: `Your appointment has been rescheduled for ${updatedDateAndTime}`,
              data: {
                appointmentId: updatedAppointment._id,
                date: updatedAppointment.date,
              },
              forMobile: true,
              forWeb: false,
            });
          } catch (notificationError) {
            console.error('Error sending HCM notification:', notificationError);
          }
        }
      }
    } catch (notificationError) {
      console.error(
        'Error sending appointment update notifications:',
        notificationError,
      );
      // Don't fail the appointment update if notification fails
    }

    res.status(200).json({
      success: true,
      message: 'Appointment updated successfully',
      appointment: updatedAppointment,
    });
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export const deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    // Get the appointment to be deleted
    const appointmentToDelete = await appointments.findById(id);

    if (!appointmentToDelete) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    // Calculate units for the appointment to be deleted
    let unitsToRemove = 0;

    if (appointmentToDelete.startTime && appointmentToDelete.endTime) {
      const durationInMinutes =
        (new Date(appointmentToDelete.endTime) -
          new Date(appointmentToDelete.startTime)) /
        (1000 * 60);
      unitsToRemove = Math.ceil(durationInMinutes / 15); // 15 minutes = 1 unit
      // Update service tracking before deleting the appointment
      try {
        const serviceTrackingRecord = await ServiceTracking.findOne({
          tenantId: appointmentToDelete.tenantId,
          serviceId: appointmentToDelete.serviceId,
        });

        if (serviceTrackingRecord) {
          // Update the scheduledUnits in the service tracking record
          serviceTrackingRecord.scheduledUnits = Math.max(
            0,
            (serviceTrackingRecord.scheduledUnits || 0) - unitsToRemove,
          );

          // Find and update HCM record
          const hcmRecord = updatedServiceTracking.hcms.find(
            (hcm) =>
              hcm.hcmId &&
              hcm.hcmId.toString() === updatedAppointment.hcmId.toString(),
          );

          if (hcmRecord) {
            // Safe update of scheduled units
            if (
              typeof hcmRecord.scheduledUnits === 'number' &&
              !isNaN(hcmRecord.scheduledUnits)
            ) {
              const newHcmScheduledUnits =
                hcmRecord.scheduledUnits + scheduledUnitsAdjustment;

              if (!isNaN(newHcmScheduledUnits)) {
                hcmRecord.scheduledUnits = newHcmScheduledUnits;
              } else {
                console.error('Invalid HCM scheduled units calculation', {
                  current: hcmRecord.scheduledUnits,
                  adjustment: scheduledUnitsAdjustment,
                });
              }
            } else {
              console.error(
                'HCM record has invalid scheduledUnits',
                hcmRecord.scheduledUnits,
              );
              hcmRecord.scheduledUnits =
                scheduledUnitsAdjustment > 0 ? scheduledUnitsAdjustment : 0;
            }

            // Find or create service detail
            if (Array.isArray(hcmRecord.serviceDetails)) {
              let serviceDetail = hcmRecord.serviceDetails.find(
                (service) =>
                  service &&
                  service.dateOfService &&
                  new Date(service.dateOfService)
                    .toISOString()
                    .split('T')[0] ===
                  new Date(updatedAppointment.date)
                    .toISOString()
                    .split('T')[0],
              );

              if (scheduledDetail) {
                const oldDetailUnits = scheduledDetail.scheduledUnits;
                // Update existing scheduled detail
                scheduledDetail.scheduledUnits = Math.max(
                  0,
                  scheduledDetail.scheduledUnits - unitsToRemove,
                );

                // Remove the detail if units become zero
                if (scheduledDetail.scheduledUnits === 0) {
                  hcmEntry.scheduledDetails = hcmEntry.scheduledDetails.filter(
                    (detail) =>
                      detail.dateOfService &&
                      detail.dateOfService.toISOString().split('T')[0] !==
                      dateString

                  );
                }
              }
            }
          }

          // Recalculate remaining units
          serviceTrackingRecord.unitsRemaining = Math.max(
            0,
            serviceTrackingRecord.totalUnits -
            serviceTrackingRecord.workedUnits -
            serviceTrackingRecord.scheduledUnits,
          );

          await serviceTrackingRecord.save();
        }
      } catch (error) {
        console.error('Error updating scheduled units on deletion:', error);
        // Don't fail the appointment deletion if updating scheduled units fails
      }
    }

    // Delete the appointment
    const deletedAppointment = await appointments.findByIdAndDelete(id);

    if (!deletedAppointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    // Send notification to HCM about the appointment cancellation
    try {
      const hcmDetails = await users.findById(deletedAppointment.hcmId);
      const timezone = hcmDetails?.timezone || 'UTC';

      const dateAndTime = formatDateAndTimeForNotificationWithTimezone(
        deletedAppointment.date,
        deletedAppointment.startTime,
        timezone,
      );

      const tenantDetails = await users.findById(deletedAppointment.tenantId);

      await sendAppointmentNotification(
        deletedAppointment.hcmId,
        'Appointment Cancelled',
        `Your appointment with ${tenantDetails.name} scheduled on ${dateAndTime} has been cancelled.`,
        {
          appointmentId: deletedAppointment._id.toString(),
          type: 'appointment',
        },
      );

      // Remove any pending reminders for this appointment
      await removePendingAppointmentReminders(deletedAppointment._id);
    } catch (notificationError) {
      console.error(
        'Error sending appointment deletion notifications:',
        notificationError,
      );
      // Don't fail the appointment deletion if notification fails
    }

    res.status(200).json({
      success: true,
      message: 'Appointment updated successfully',
      response: { updatedAppointment: updatedAppointmentRecord },
    });
  } catch (error) {
    console.error('Error in updateAppointment:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export const createAppointment = async (req, res) => {
  try {
    const {
      tenantId,
      hcmId,
      title,
      description,
      startTime,
      endTime,
      dos,
      date,
      placeOfService,
      typeMethod,
      methodOfContact,
      status,
      serviceId,
      serviceType,
      activity,
      companyId,
      reasonForRemote,
    } = req.body;

    const inputDate = dos || date;

    if (!tenantId || !hcmId || !inputDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'tenantId, hcmId, date, startTime and endTime are required',
      });
    }

    /* ---------------- DATE PARSING ---------------- */
    // Parse date without timezone conversion to preserve the user's local date
    const [y, m, d] = inputDate.split('T')[0].split('-').map(Number);
    const appointmentDate = new Date(y, m - 1, d);

    const appointmentStartTime = new Date(startTime);
    const appointmentEndTime = new Date(endTime);

    if (appointmentStartTime >= appointmentEndTime) {
      return res.status(400).json({
        success: false,
        message: 'End time must be after start time',
      });
    }

    /* ---------------- OVERLAP CHECK ---------------- */
    const overlapping = await appointments.findOne({
      $or: [{ tenantId }, { hcmId }],
      startTime: { $lt: appointmentEndTime },
      endTime: { $gt: appointmentStartTime },
    });

    if (overlapping) {
      return res.status(400).json({
        success: false,
        message: 'Overlapping appointment exists',
      });
    }

    /* ---------------- SERVICE & UNIT CALC ---------------- */
    const serviceDoc = await Service.findById(serviceId);
    if (!serviceDoc) {
      return res.status(400).json({
        success: false,
        message: 'Service not found',
      });
    }

    let unitsToAdd = 0;

    if (serviceDoc.service_duration === 'Daily') {
      unitsToAdd = 1;
    } else {
      const durationMinutes =
        (appointmentEndTime - appointmentStartTime) / 60000;
      unitsToAdd = Math.ceil(durationMinutes / 15);
    }

    const serviceTracking = await ServiceTracking.findOne({
      tenantId,
      serviceId,
    });

    if (!serviceTracking) {
      return res.status(400).json({
        success: false,
        message: 'Service tracking not found',
      });
    }

    /* -------- DAILY DUPLICATE CHECK -------- */
    if (serviceDoc.service_duration === 'Daily') {
      const startOfDay = new Date(y, m - 1, d);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(y, m - 1, d);
      endOfDay.setHours(23, 59, 59, 999);

      const alreadyScheduled = await appointments.findOne({
        tenantId,
        serviceId,
        date: { $gte: startOfDay, $lt: endOfDay },
      });

      if (alreadyScheduled) {
        unitsToAdd = 0;
      }
    }

    /* -------- UNIT AVAILABILITY CHECK (FIX) -------- */
    if (unitsToAdd > serviceTracking.unitsRemaining) {
      return res.status(400).json({
        success: false,
        message: `Insufficient units remaining. Available: ${serviceTracking.unitsRemaining}, Required: ${unitsToAdd}`,
      });
    }

    /* ---------------- SAVE APPOINTMENT ---------------- */
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const appointment = await appointments.create(
        [
          {
            tenantId,
            hcmId,
            title: title || '',
            description: description || '',
            startTime: appointmentStartTime,
            endTime: appointmentEndTime,
            date: appointmentDate,
            dateOfService: appointmentDate,
            placeOfService: placeOfService || '',
            typeMethod: typeMethod || methodOfContact || 'in-person',
            methodOfContact: methodOfContact || 'in-person',
            reasonForRemote: reasonForRemote || '',
            status: status || 'pending',
            serviceId,
            activity: activity || '',
            companyId,
          },
        ],
        { session },
      );

      /* ---------------- UPDATE UNITS ---------------- */
      if (unitsToAdd > 0) {
        serviceTracking.scheduledUnits += unitsToAdd;
        serviceTracking.unitsRemaining -= unitsToAdd;

        let hcmEntry = serviceTracking.hcms.find(
          (h) => h.hcmId.toString() === hcmId,
        );

        if (!hcmEntry) {
          serviceTracking.hcms.push({
            hcmId,
            scheduledUnits: unitsToAdd,
            workedUnits: 0,
            billAmount: 0,
            scheduledDetails: [
              {
                dateOfService: appointmentDate,
                scheduledUnits: unitsToAdd,
              },
            ],
            serviceDetails: [],
          });
        } else {
          hcmEntry.scheduledUnits += unitsToAdd;
          hcmEntry.scheduledDetails.push({
            dateOfService: appointmentDate,
            scheduledUnits: unitsToAdd,
          });
        }

        await serviceTracking.save({ session });
      }

      await session.commitTransaction();
      session.endSession();

      const savedAppointment = appointment[0];

      try {
        const [hcmUser, tenantUser] = await Promise.all([
          users.findById(savedAppointment.hcmId).lean(),
          users.findById(savedAppointment.tenantId).lean(),
        ]);

        if (hcmUser && tenantUser) {
          const timezone = hcmUser.timezone || 'UTC';

          const dateAndTime = formatDateAndTimeForNotificationWithTimezone(
            savedAppointment.date,
            savedAppointment.startTime,
            timezone,
          );

          await sendAppointmentNotification(
            savedAppointment.hcmId,
            'Appointment Created',
            `An appointment with ${tenantUser.name} has been created for ${dateAndTime}.`,
            {
              appointmentId: savedAppointment._id.toString(),
              type: 'appointment',
            },
          );

          await createAppointmentReminders(
            savedAppointment,
            hcmUser,
            tenantUser.name,
          );
        }
      } catch (err) {
        console.error('[NOTIFICATION ERROR]', err);
      }

      return res.status(201).json({
        success: true,
        message: 'Appointment created successfully',
        appointment: appointment[0],
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  } catch (error) {
    console.error('Error creating appointment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

export const updateCompletedAppointments = async (req, res) => {
  try {
    const now = new Date();
    const completedAppointments = await appointments.find({
      status: 'completed',
      date: { $lte: now },
    });

    for (const appointment of completedAppointments) {
      const exists = await CompletedAppointments.findOne({
        appointmentId: appointment._id,
      });
      if (!exists) {
        await CompletedAppointments.create({ appointmentId: appointment._id });

        // Calculate units used
        const durationInMinutes =
          (new Date(appointment.endTime) - new Date(appointment.startTime)) /
          60000;
        const unitsUsed = Math.ceil(durationInMinutes / 15); // 15 minutes = 1 unit

        // Update service tracking
        const serviceTracking = await ServiceTracking.findOne({
          hcmId: appointment.hcmId,
          serviceId: appointment.serviceId,
        });
        if (serviceTracking) {
          serviceTracking.unitsRemaining = Math.max(
            0,
            serviceTracking.unitsRemaining - unitsUsed,
          );
          await serviceTracking.save();
        } else {
          await ServiceTracking.create({
            hcmId: appointment.hcmId,
            serviceId: appointment.serviceId,
            unitsRemaining: Math.max(0, 150 - unitsUsed),
          });
        }

        // Create a visit entry
        const response = await Visits.create({
          tenantId: appointment.tenantId,
          hcmId: appointment.hcmId,
          serviceId: appointment.serviceId,
          activity: appointment.activity || '',
          date: appointment.date,
          startTime: appointment.startTime || '',
          endTime: appointment.endTime || '',
          place: appointment.place || '',
          methodOfVisit: appointment.methodOfVisit || 'in-person',
          reasonForRemote: appointment.reasonForRemote || '',
          notes: appointment.notes || '',
          travel: appointment.travel || 'no',
          totalMiles: appointment.totalMiles || 0,
          travelWithTenant: appointment.travelWithTenant || 0,
          travelWithoutTenant: appointment.travelWithoutTenant || 0,
          signature: 'not done',
          status: 'completed',
          response: '',
        });
      }
    }
    res.status(200).send({
      success: true,
      message: 'Completed appointments updated successfully.',
      response,
    });
  } catch (error) {
    console.error('Error updating completed appointments:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const markAppointmentComplete = async (req, res) => {
  const { id } = req.params;
  try {
    const appointmentId = new mongoose.Types.ObjectId(id);

    const appointment = await appointments.findById(appointmentId);

    if (!appointment) {
      return res
        .status(200)
        .json({ success: false, message: 'Appointment not found' });
    }

    // Update the status to 'completed'
    appointment.status = 'completed';
    const updatedAppointment = await appointment.save();

    // Create a visit entry
    const visitEntry = new Visits({
      creatorId: new mongoose.Types.ObjectId(appointment.hcmId) ?? '',
      tenantId: new mongoose.Types.ObjectId(appointment.tenantId) ?? '',
      hcmId: new mongoose.Types.ObjectId(appointment.hcmId) ?? '',
      serviceId: new mongoose.Types.ObjectId(appointment.serviceId),

      activity: appointment.activity ?? '',
      date: appointment.date ?? new Date(),
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      place: appointment.placeOfService ?? '',
      methodOfContact: appointment.methodOfContact ?? '',
      reasonForRemote: appointment.reasonForRemote ?? '',
      notes: appointment.notes ?? '',
      travel: appointment.travel ?? 'no',
      totalMiles: appointment.totalMiles ?? 0,
      travelWithTenant: appointment.travelWithTenant ?? 0,
      travelWithoutTenant: appointment.travelWithoutTenant ?? 0,
      signature: 'not done',
      status: 'pending',
      response: '',
      companyId: new mongoose.Types.ObjectId(appointment.companyId),
    });

    const savedVisitEntry = await visitEntry.save(); // Save the visit entry to the collection

    const serviceTracking = await ServiceTracking.findOne({
      tenantId: appointment.tenantId,
      serviceId: appointment.serviceId,
    });
    let updatedServiceTracking;
    if (serviceTracking) {
      const durationInMinutes =
        (new Date(appointment.endTime) - new Date(appointment.startTime)) /
        60000;
      const unitsUsed = Math.ceil(durationInMinutes / 15); // 15 minutes = 1 unit

      serviceTracking.workedUnits += unitsUsed;
      serviceTracking.scheduledUnits -= unitsUsed;
      serviceTracking.unitsRemaining -= unitsUsed;
      updatedServiceTracking = await serviceTracking.save();

      const hcmEntry = serviceTracking.hcms.find(
        (hcm) => hcm.hcmId && hcm.hcmId.toString() === appointment.hcmId,
      );

      if (hcmEntry) {
        // Find the service detail for the specific date
        const serviceDetail = hcmEntry.serviceDetails.find(
          (service) =>
            service.dateOfService.toISOString() ===
            appointment.date.toISOString(),
        );

        if (serviceDetail) {
          // Update workedUnits and scheduledUnits
          serviceDetail.workedUnits += unitsUsed;
          serviceDetail.scheduledUnits -= unitsUsed;
        } else {
          // If no service detail exists for the date, create a new one
          hcmEntry.serviceDetails.push({
            dateOfService: appointment.date,
            scheduledUnits: 0,
            workedUnits: unitsUsed,
            methodOfContact: appointment.methodOfContact,
            placeOfService: appointment.placeOfService,
          });
        }
        // Save the updated service tracking
        updatedServiceTracking = await serviceTracking.save();
      }
    }

    res.status(200).json({
      success: true,
      message: 'Appointment marked as completed successfully.',
      response: {
        updatedAppointment,
        visitEntry,
        updatedServiceTracking,
      },
    });
  } catch (error) {
    console.error('Error marking appointment as completed:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      response: error.message,
    });
  }
};

export const getUnitsLeft = async (req, res) => {
  try {
    const { tenantId, serviceType, companyId } = req.body;
    const serviceDoc = await Service.findOne({
      service_name: serviceType, // or however you're mapping serviceType → service
      company: companyId,
    });
    const serviceTracking = await ServiceTracking.findOne({
      tenantId,
      serviceId: serviceDoc._id,
      companyId,
    });
    if (serviceTracking) {
      return res.status(200).json({
        success: true,
        message: 'Units left fetched successfully',
        unitsLeft: serviceTracking.unitsRemaining,
      });
    } else {
      return res.status(200).json({
        success: true,
        message: 'No service tracking found',
        unitsLeft: 0,
      });
    }
  } catch (error) {
    console.error('Error in getUnitsLeft:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      response: error.message,
    });
  }
};

export const getAppointmentsFromVisit = async (req, res) => {
  const { companyId } = req.params;

  try {
    const appointmentsData = await appsDirectlyFromVisits
      .find({ companyId })
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
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      })
      .sort({ date: 1, startTime: 1 });

    // Ensure we always have an array to map over, even if empty
    const formattedAppointments =
      appointmentsData && appointmentsData.length
        ? appointmentsData.map((app) => ({
          ...app.toObject(),
          hcmDetails: app.hcmId,
          tenantDetails: app.tenantId,
          serviceType: app.serviceId?.service_procedure_code || null,
          serviceTypeName: app.serviceId?.service_name || null,
        }))
        : [];

    res.status(200).json({
      success: true,
      message: appointmentsData.length
        ? 'Appointments fetched successfully'
        : 'No appointments found',
      response: {
        appointments: formattedAppointments,
      },
    });
  } catch (error) {
    console.error('Error fetching appointments from visits:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
};

export const getAppointment = async (req, res) => {
  const { id } = req.params;

  try {
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid appointment ID',
      });
    }

    const appointment = await appointments
      .findById(id)
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
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    const formattedAppointment = {
      ...appointment.toObject(),
      hcmDetails: appointment.hcmId,
      tenantDetails: appointment.tenantId,
      serviceType: appointment.serviceId?.service_procedure_code || null,
      serviceTypeName: appointment.serviceId?.service_name || null,
    };

    res.status(200).json({
      success: true,
      message: 'Appointment fetched successfully',
      response: {
        appointment: formattedAppointment,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
};

export const appointmentsByDay = async (req, res) => {
  try {
    const { companyId, startDate, endDate } = req.body;

    if (!companyId || !startDate || !endDate) {
      return res.status(200).json({
        success: false,
        message: 'companyId, startDate and endDate are required',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(200).json({
        success: false,
        message: 'Invalid date format',
      });
    }

    const filteredAppointments = await appointments
      .find({
        companyId,
        date: { $gte: start, $lte: end },
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
      .sort({ date: 1, startTime: 1 });

    if (filteredAppointments.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No appointments found for given range.',
        data: {},
      });
    }

    // Prepare day-wise counts
    const dailyCounts = {};

    filteredAppointments.forEach((appointment) => {
      const appDate = new Date(appointment.date);
      const dateKey = appDate.toISOString().split('T')[0]; // YYYY-MM-DD

      if (!dailyCounts[dateKey]) {
        dailyCounts[dateKey] = {
          pending: 0,
          completed: 0,
          cancelled: 0,
          total: 0,
        };
      }

      // Count by status
      if (appointment.status === 'completed') {
        dailyCounts[dateKey].completed++;
      } else if (appointment.status === 'cancelled') {
        dailyCounts[dateKey].cancelled++;
      } else {
        dailyCounts[dateKey].pending++;
      }

      dailyCounts[dateKey].total++;
    });

    res.status(200).json({
      success: true,
      message: 'Appointments counted successfully',
      data: dailyCounts,
    });
  } catch (error) {
    console.error('Error in appointmentsByDay:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
};

export const updateAppointmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status: newStatus } = req.body; // 'completed' or 'cancelled'

    if (!['completed', 'cancelled'].includes(newStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either completed or cancelled',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid appointment ID format',
      });
    }

    const appointment = await appointments.findById(id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    const oldStatus = appointment.status;

    // Calculate units for this appointment (based on duration)
    let appointmentUnits = 0;
    if (appointment.startTime && appointment.endTime) {
      const durationMinutes =
        (new Date(appointment.endTime) - new Date(appointment.startTime)) /
        60000;
      if (durationMinutes <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid appointment time range',
        });
      }
      appointmentUnits = Math.ceil(durationMinutes / 15);
    }

    // Load service tracking
    const serviceTracking = await ServiceTracking.findOne({
      tenantId: appointment.tenantId,
      serviceId: appointment.serviceId,
    });

    if (!serviceTracking) {
      return res.status(404).json({
        success: false,
        message: 'Service tracking not found for this appointment',
      });
    }

    // --- UNIT LOGIC ---
    // Only adjust units when moving OUT of a scheduled-like status
    const leavingScheduled =
      oldStatus === 'scheduled' || oldStatus === 'pending';

    if (leavingScheduled && appointmentUnits > 0) {
      const scheduled = serviceTracking.scheduledUnits || 0;
      let remaining = serviceTracking.unitsRemaining ?? 0;

      // Release scheduled units back to available
      serviceTracking.scheduledUnits = Math.max(
        0,
        scheduled - appointmentUnits,
      );
      remaining += appointmentUnits;

      // Optional safety: don't exceed totalUnits
      const total = serviceTracking.totalUnits || 0;
      if (total > 0) {
        remaining = Math.min(remaining, total);
      }

      serviceTracking.unitsRemaining = remaining;

      await serviceTracking.save();
    }

    // Update appointment status
    appointment.status = newStatus;
    await appointment.save();

    return res.status(200).json({
      success: true,
      message: 'Appointment status updated successfully',
      appointment,
    });
  } catch (error) {
    console.error('Error updating appointment status:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export const clockInAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { clockInAt } = req.body;

    const appointment = await appointments.findById(appointmentId);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    // ✅ if already clocked-in for THIS appointment
    if (appointment.clockInTime) {
      return res.status(400).json({
        success: false,
        message: 'Already clocked in for this appointment',
      });
    }

    // ✅ Extract the HCM who is clocking in
    const hcmId = appointment?.hcmId;

    if (!hcmId) {
      return res.status(400).json({
        success: false,
        message: 'HCM not found for this appointment',
      });
    }

    // ✅ Check if same HCM already has an active clock-in in any other appointment
    const activeClockIn = await appointments.findOne({
      hcmId: hcmId,
      clockInTime: { $ne: null }, // clocked in
      clockOutTime: null, // not clocked out yet
      _id: { $ne: appointmentId }, // exclude current appointment
    });

    if (activeClockIn) {
      return res.status(400).json({
        success: false,
        message:
          'This HCM already has an active clock-in on another appointment',
        activeAppointmentId: activeClockIn._id,
        activeClockInTime: activeClockIn.clockInTime,
      });
    }

    const now = new Date();
    appointment.clockInTime = now;

    // ✅ UTC-safe date only (no timezone shifting)
    appointment.date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    appointment.clockInAt = clockInAt?.trim() || '';

    await appointment.save();

    return res.status(200).json({
      success: true,
      message: 'Clock-in successful',
      data: appointment,
    });
  } catch (error) {
    console.error('Clock-in error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while clocking in',
      error: error.message,
    });
  }
};
