import express from 'express';
import {
  createAppointment,
  filterAppointments,
  updateAppointment,
  deleteAppointment,
  markAppointmentComplete,
  getAppointments,
  getAppointmentsFromVisit,
  getAppointment,
  appointmentsByDay,
  updateAppointmentStatus,
  clockInAppointment,
} from '../../controllers/appointments-visits/appointmentsController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Create an appointment
router.post('/create-appointment', authenticateToken, createAppointment);

router.get('/get-appointments/:companyId', authenticateToken, getAppointments);

router.get(
  '/get-appointments-from-visits/:companyId',
  authenticateToken,
  getAppointmentsFromVisit,
);

router.get('/get-appointment-by-id/:id', authenticateToken, getAppointment);

// // Filter appointments
router.post('/filter-appointments', authenticateToken, filterAppointments);

router.post('/get-appts-count', authenticateToken, appointmentsByDay);

// // Delete an appointment
router.delete('/delete-appointment/:id', authenticateToken, deleteAppointment);

// // Update an appointment
router.put('/update-appointment/:id', authenticateToken, updateAppointment);

router.put(
  '/mark-appointment-complete/:id',
  authenticateToken,
  markAppointmentComplete,
);

router.put(
  '/update-appointment-status/:id',
  authenticateToken,
  updateAppointmentStatus,
);

router.patch('/clock-in/:appointmentId', authenticateToken, clockInAppointment);

export default router;
