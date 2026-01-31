import express from 'express';
import {
  assignFormToUser,
  getMyAssignedForms,
  getAssignedFormDetails,
  getAllFormAssignments,
  updateAssignmentStatus,
  deleteAssignment,
  getAssignmentStatistics,
  getAvailableUsers
} from '../../controllers/forms/formAssignmentController.js';
import { authenticateToken } from '../../middleware/auth.js';
import { checkFormAssignmentPermissions } from '../../middleware/formPermissions.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Admin routes for managing form assignments
// POST /api/forms/assignments - Assign form to users
router.post('/assignments', checkFormAssignmentPermissions, assignFormToUser);

// GET /api/forms/assignments - Get all form assignments (admin view)
router.get('/assignments', checkFormAssignmentPermissions, getAllFormAssignments);

// GET /api/forms/assignments/statistics - Get assignment statistics
router.get('/assignments/statistics', checkFormAssignmentPermissions, getAssignmentStatistics);

// GET /api/forms/assignments/users - Get available users for assignment
router.get('/assignments/users', checkFormAssignmentPermissions, getAvailableUsers);

// PATCH /api/forms/assignments/:assignmentId/status - Update assignment status
router.patch('/assignments/:assignmentId/status', checkFormAssignmentPermissions, updateAssignmentStatus);

// DELETE /api/forms/assignments/:assignmentId - Delete assignment
router.delete('/assignments/:assignmentId', checkFormAssignmentPermissions, deleteAssignment);

// User routes for viewing assigned forms
// GET /api/forms/my-assignments - Get forms assigned to current user
router.get('/my-assignments', getMyAssignedForms);

// GET /api/forms/my-assignments/:assignmentId - Get specific assigned form details
router.get('/my-assignments/:assignmentId', getAssignedFormDetails);

// GET /api/forms/dashboard - Get dashboard stats for current user
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const userType = userRole === 0 ? 'tenant' : 'employee';

    const FormAssignment = (await import('../../models/forms/FormAssignment.js')).default;

    // Get assignment counts by status
    const stats = await FormAssignment.aggregate([
      {
        $match: {
          'assignedTo.userId': userId,
          'assignedTo.userType': userType,
          isActive: true
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get overdue count
    const overdueCount = await FormAssignment.countDocuments({
      'assignedTo.userId': userId,
      'assignedTo.userType': userType,
      isActive: true,
      dueDate: { $lt: new Date() },
      status: { $in: ['pending', 'in-progress'] }
    });

    // Get recent assignments (last 5)
    const recentAssignments = await FormAssignment.find({
      'assignedTo.userId': userId,
      'assignedTo.userType': userType,
      isActive: true
    })
    .populate('formTemplateId', 'title description')
    .sort({ createdAt: -1 })
    .limit(5);

    const formattedStats = stats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {
      pending: 0,
      'in-progress': 0,
      completed: 0,
      expired: 0
    });

    res.json({
      success: true,
      data: {
        stats: formattedStats,
        overdueCount,
        totalAssignments: Object.values(formattedStats).reduce((sum, count) => sum + count, 0),
        recentAssignments: recentAssignments.map(assignment => ({
          id: assignment._id,
          formTitle: assignment.formTemplateId?.title,
          status: assignment.status,
          dueDate: assignment.dueDate,
          assignedAt: assignment.createdAt,
          isOverdue: assignment.dueDate && new Date() > assignment.dueDate && assignment.status !== 'completed'
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error.message
    });
  }
});

export default router;