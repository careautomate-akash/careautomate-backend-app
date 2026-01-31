import ScheduleCall from '../../models/appointments-visits/scheduleCall.js';
import CallHistory from '../../models/appointments-visits/callHistory.js';
import cron from 'node-cron';
import users from '../../models/account/users.js';

export const scheduleCallController = async (req, res) => {
  try {
    const {
      companyId,
      scheduledDate,
      scheduledTime,
      duration,
      scheduledBy,
      scheduledTo,
      status,
    } = req.body;

    const scheduleCall = new ScheduleCall({
      companyId,
      scheduledDate,
      scheduledTime,
      duration,
      scheduledBy,
      scheduledTo,
      status,
    });
    await scheduleCall.save();

    // Fetch name of scheduledTo
    const user = await users.findById(scheduledTo, 'name'); // or 'fullName'

    res.status(200).json({
      message: 'Call scheduled successfully',
      call: {
        ...scheduleCall.toObject(),
        scheduledToName: user?.name || 'Unknown',
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const callHistoryController = async (req, res) => {
  try {
    const { personId } = req.params;
    const callHistory = await CallHistory.find({ scheduledTo: personId });
    res.status(200).json({
      success: true,
      message: 'Call history fetched successfully',
      response: callHistory,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const completedCallHistoryController = async (req, res) => {
  try {
    const { personId } = req.params;
    const callHistory = await CallHistory.find({
      scheduledTo: personId,
      status: 'completed',
    });
    res.status(200).json({
      success: true,
      message: 'Completed call history fetched successfully',
      response: callHistory,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const getUpcomingCallsController = async (req, res) => {
  const personId = req.params.personId;
  try {
    const callHistory = await ScheduleCall.find({ scheduledTo: personId });
    const callsWithNames = await Promise.all(
      callHistory.map(async (call) => {
        const user = await users.findById(call.scheduledTo, 'name'); // or 'fullName'
        return {
          ...call.toObject(),
          scheduledToName: user?.name || 'Unknown',
        };
      })
    );
    res.status(200).json({
      success: true,
      message: 'Upcoming calls fetched successfully',
      response: callsWithNames,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const getUpcomingCompanyCallsController = async (req, res) => {
  const companyId = req.params.companyId;
  try {
    const callHistory = await ScheduleCall.find({ companyId: companyId });
    const callsWithNames = await Promise.all(
      callHistory.map(async (call) => {
        const user = await users.findById(call.scheduledTo, 'name');
        return {
          ...call.toObject(),
          scheduledToName: user?.name || 'Unknown',
        };
      })
    );
    res.status(200).json({
      success: true,
      message: 'Upcoming company calls fetched successfully',
      data: callsWithNames,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const callHistoryInRangeController = async (req, res) => {
  try {
    const { personId, startDate, endDate } = req.params;
    const callHistory = await CallHistory.find({
      scheduledTo: personId,
      createdAt: { $gte: startDate, $lte: endDate },
    });
    res.status(200).json({
      success: true,
      message: 'Call history in range fetched successfully',
      data: callHistory,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const cancelScheduledCallController = async (req, res) => {
  try {
    const { callId } = req.params;
    await ScheduleCall.findByIdAndDelete(callId);
    res.status(200).json({
      success: true,
      message: 'Scheduled call cancelled successfully',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const rescheduleCallController = async (req, res) => {
  try {
    const { callId } = req.params;
    const { scheduledDate, scheduledTime } = req.body;
    await ScheduleCall.findByIdAndUpdate(callId, {
      scheduledDate,
      scheduledTime,
    });
    res.status(200).json({
      success: true,
      message: 'Scheduled call rescheduled successfully',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// cron job to check if the call is scheduled and if it is completed, then create a call history
cron.schedule('0 0 * * *', async () => {
  const scheduleCalls = await ScheduleCall.find({
    scheduledDate: { $lte: new Date() },
  });
  for (const scheduleCall of scheduleCalls) {
    const callHistory = new CallHistory({
      companyId: scheduleCall.companyId,
      completedDate: new Date(),
      scheduledDate: scheduleCall.scheduledDate,
      scheduledTime: scheduleCall.scheduledTime,
      duration: scheduleCall.duration,
      scheduledBy: scheduleCall.scheduledBy,
      scheduledTo: scheduleCall.scheduledTo,
      status: scheduleCall.status,
    });
    await callHistory.save();
    await ScheduleCall.findByIdAndDelete(scheduleCall._id);
  }
});

export const getSupportUsers = async (req, res) => {
  try {
    const supportUsers = await users.find({ role: 4 });

    if (!supportUsers || supportUsers.length === 0) {
      return res.status(404).json({
        status: false,
        message: 'No support supportUsers found',
      });
    }

    res.status(200).json({
      status: true,
      message: 'Support users retrieved successfully',
      data: supportUsers,
    });
  } catch (error) {
    console.error('Error fetching support users:', error);
    res.status(500).json({
      status: false,
      message: 'Internal server error',
    });
  }
};
