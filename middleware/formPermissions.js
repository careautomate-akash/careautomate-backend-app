// Middleware to check if user has admin permissions for form assignments
export const checkFormAssignmentPermissions = (req, res, next) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Allow any user (tenant or employee) to view their own assignments
    if (req.method === 'GET' && req.query.userId) {
      // Allow if userId matches the requesting user's ID
      if (req.query.userId === user._id.toString()) {
        return next();
      }
      // If userId doesn't match, fall through to admin check
    }

    // For all other operations (POST, PATCH, DELETE) or viewing other users' data,
    // require admin permissions (role !== 0)
    if (user.role === 0) {
      return res.status(403).json({
        success: false,
        message: 'Admin permissions required to assign forms'
      });
    }

    // Allow admins to proceed
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error checking permissions',
      error: error.message
    });
  }
};