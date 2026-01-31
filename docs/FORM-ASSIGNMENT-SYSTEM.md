# Form Assignment System Documentation

## Overview
The Form Assignment System allows administrators to send forms to tenants and employees, track completion status, and manage form submissions. Users can view assigned forms in their dashboard and complete them directly.

## Features

### For Administrators
- **Assign Forms**: Send forms to specific tenants or employees
- **Track Progress**: Monitor form completion status and overdue assignments
- **Manage Assignments**: Update status, add notes, and delete assignments
- **View Statistics**: Get overview of assignment statistics and completion rates
- **User Management**: Get lists of available tenants and employees for assignment

### For Tenants & Employees
- **View Assigned Forms**: See all forms assigned to them
- **Complete Forms**: Fill out and submit assigned forms
- **Dashboard**: Overview of assignment status and recent activities
- **Notifications**: Receive email notifications for new assignments and reminders

## API Endpoints

### Admin Endpoints

#### Assign Form to Users
```
POST /api/forms/assignments
```
**Body:**
```json
{
  "formTemplateId": "form_id",
  "assignToType": "tenant|employee",
  "assignToIds": ["user_id_1", "user_id_2"],
  "dueDate": "2024-12-31",
  "priority": "low|medium|high|urgent",
  "assignmentNote": "Please complete by end of month",
  "reminderSettings": {
    "enabled": true,
    "reminderDays": [7, 3, 1]
  }
}
```

#### Get All Form Assignments
```
GET /api/forms/assignments?page=1&limit=10&status=pending&userType=tenant&search=john
```

#### Get Assignment Statistics
```
GET /api/forms/assignments/statistics?userType=tenant
```

#### Get Available Users
```
GET /api/forms/assignments/users?userType=tenant&search=john
```

#### Update Assignment Status
```
PATCH /api/forms/assignments/:assignmentId/status
```
**Body:**
```json
{
  "status": "pending|in-progress|completed|expired",
  "note": "Additional notes"
}
```

#### Delete Assignment
```
DELETE /api/forms/assignments/:assignmentId
```

### User Endpoints (Tenant & Employee)

#### Get My Assigned Forms
```
GET /api/forms/my-assignments?page=1&limit=10&status=pending
```

#### Get Specific Assignment Details
```
GET /api/forms/my-assignments/:assignmentId
```

#### Get Dashboard Data
```
GET /api/forms/dashboard
```

#### Submit Form (with Assignment)
```
POST /api/forms/submit
```
**Body:**
```json
{
  "formTemplateId": "form_id",
  "assignmentId": "assignment_id",
  "data": {
    "field1": "value1",
    "field2": "value2"
  },
  "metadata": {
    "additionalInfo": "value"
  }
}
```

### Public Endpoints

#### Get Public Form Template
```
GET /api/forms/public/:formId
```

## Database Models

### FormAssignment Model
```javascript
{
  formTemplateId: ObjectId,     // Reference to form template
  assignedTo: {
    userId: ObjectId,           // User being assigned
    userType: "tenant|employee",
    userName: String,
    userEmail: String
  },
  assignedBy: ObjectId,         // Admin who assigned
  companyId: ObjectId,          // Company context
  status: "pending|in-progress|completed|expired",
  priority: "low|medium|high|urgent",
  dueDate: Date,
  assignmentNote: String,
  reminderSettings: {
    enabled: Boolean,
    reminderDays: [Number]      // Days before due date
  },
  submissionId: ObjectId,       // Reference to completed submission
  startedAt: Date,              // When user first viewed
  completedAt: Date,            // When form was submitted
  viewedAt: Date,               // When user viewed assignment
  isActive: Boolean,
  notifications: [{
    type: "assigned|reminder|overdue|completed",
    sentAt: Date,
    status: "sent|failed|pending"
  }]
}
```

## Workflow

### Admin Workflow
1. **Create Form**: Create a form template using the form builder
2. **Assign Form**: Select users and assign the form with due date and settings
3. **Monitor Progress**: View assignment dashboard to track completion
4. **Review Submissions**: Access submitted form data and update status
5. **Manage Assignments**: Update, delete, or modify assignments as needed

### User Workflow
1. **Receive Notification**: Get email notification about new form assignment
2. **View Dashboard**: See assigned forms in user dashboard
3. **Open Form**: Click on assignment to view form details
4. **Complete Form**: Fill out and submit the form
5. **Track Status**: Monitor submission status and feedback

## Email Notifications

### Assignment Notification
Sent when a form is first assigned to a user.

### Reminder Notifications
Sent based on reminder settings (e.g., 7, 3, 1 days before due date).

### Overdue Notifications
Sent daily for overdue assignments.

## Permissions

### Admin Permissions
- Create and assign forms
- View all assignments and submissions
- Update assignment status
- Access user lists for assignments
- View statistics and reports

### User Permissions
- View own assigned forms
- Complete assigned forms
- View own dashboard and statistics
- Cannot assign forms to others

## Configuration

### Environment Variables
```env
# Email configuration for notifications
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
FROM_EMAIL=noreply@yourdomain.com
```

### Role Configuration
- **Role 0**: Tenant user
- **Role > 0**: Employee/Admin user

## Integration Points

### With Existing Systems
- **User Management**: Integrates with existing user and tenant models
- **Authentication**: Uses existing JWT authentication middleware
- **Company Context**: Respects company boundaries for multi-tenant setup
- **File Uploads**: Supports file attachments in forms
- **Notifications**: Integrates with existing notification systems

## Usage Examples

### Admin: Assign Intake Form to New Tenants
```javascript
// Assign intake form to multiple new tenants
const assignment = await fetch('/api/forms/assignments', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    formTemplateId: 'intake_form_id',
    assignToType: 'tenant',
    assignToIds: ['tenant1_id', 'tenant2_id'],
    dueDate: '2024-12-31',
    priority: 'high',
    assignmentNote: 'Please complete your intake form within 30 days',
    reminderSettings: {
      enabled: true,
      reminderDays: [7, 3, 1]
    }
  })
});
```

### User: Get My Pending Assignments
```javascript
// Get pending form assignments
const assignments = await fetch('/api/forms/my-assignments?status=pending', {
  headers: {
    'Authorization': 'Bearer ' + token
  }
});
```

### User: Submit Assigned Form
```javascript
// Submit completed form
const submission = await fetch('/api/forms/submit', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    formTemplateId: 'form_id',
    assignmentId: 'assignment_id',
    data: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com'
    }
  })
});
```

## Best Practices

### For Administrators
- Set appropriate due dates based on form complexity
- Use clear, descriptive assignment notes
- Enable reminders for important forms
- Regularly review assignment statistics
- Follow up on overdue assignments

### For Development
- Always validate user permissions before assignment operations
- Handle email notification failures gracefully
- Implement proper error handling for all endpoints
- Use pagination for large data sets
- Log assignment activities for audit purposes

### For Users
- Complete assignments promptly
- Contact administrators if forms are unclear
- Check dashboard regularly for new assignments
- Save progress if forms support drafts

## Troubleshooting

### Common Issues
1. **Email notifications not sending**: Check SMTP configuration
2. **Users not seeing assignments**: Verify user type and permissions
3. **Forms not submitting**: Check required field validation
4. **Assignment stats incorrect**: Verify database indexes and queries

### Debug Information
- Check server logs for assignment creation errors
- Verify user authentication and permissions
- Monitor email service status
- Check database connectivity and performance