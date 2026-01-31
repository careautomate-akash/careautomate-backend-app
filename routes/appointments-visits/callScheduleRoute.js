import express from 'express';
import {
  scheduleCallController,
  getUpcomingCallsController,
  callHistoryController,
  completedCallHistoryController,
  callHistoryInRangeController,
  getUpcomingCompanyCallsController,
  cancelScheduledCallController,
  rescheduleCallController,
  getSupportUsers,
} from '../../controllers/appointments-visits/scheduleCallController.js';

const router = express.Router();

router.post('/schedule-call', scheduleCallController);

router.get('/get-upcoming-calls/:personId', getUpcomingCallsController);

router.get(
  '/get-upcoming-company-calls/:companyId',
  getUpcomingCompanyCallsController
);

router.get('/call-history/:personId', callHistoryController);

router.get('/call-history/:personId', completedCallHistoryController);

router.get(
  '/call-history-in-range/:personId/:startDate/:endDate',
  callHistoryInRangeController
);

router.put('/reschedule-call/:callId', rescheduleCallController);

router.delete('/cancel-scheduled-call/:callId', cancelScheduledCallController);

router.get('/get-support-users', getSupportUsers);

export default router;
