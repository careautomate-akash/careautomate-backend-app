import nodemailer from 'nodemailer';
import FormAssignment from '../models/forms/FormAssignment.js';

// Email transporter configuration (adjust according to your email service)
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST || 'localhost',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Send form assignment notification email
export const sendAssignmentNotification = async (assignment) => {
  try {
    if (!assignment.assignedTo.userEmail) {
      console.log('No email address provided for assignment notification');
      return false;
    }

    const transporter = createTransporter();
    
    const formTitle = assignment.formTemplateId?.title || 'Form';
    const assignedByName = assignment.assignedBy?.name || 'Administrator';
    const dueDate = assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date';
    
    const emailContent = `
      <h2>New Form Assignment</h2>
      <p>Hello ${assignment.assignedTo.userName},</p>
      
      <p>You have been assigned a new form to complete:</p>
      
      <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3>${formTitle}</h3>
        <p><strong>Assigned by:</strong> ${assignedByName}</p>
        <p><strong>Due date:</strong> ${dueDate}</p>
        <p><strong>Priority:</strong> ${assignment.priority}</p>
        ${assignment.assignmentNote ? `<p><strong>Note:</strong> ${assignment.assignmentNote}</p>` : ''}
      </div>
      
      <p>Please log in to your account to complete this form.</p>
      
      <div style="margin-top: 20px; padding: 20px; background-color: #e8f4f8; border-radius: 5px;">
        <p><strong>Form ID:</strong> ${assignment._id}</p>
        <p><em>You can use this ID to reference the form if you need assistance.</em></p>
      </div>
      
      <p>Thank you!</p>
    `;

    const mailOptions = {
      from: process.env.FROM_EMAIL || 'noreply@yourdomain.com',
      to: assignment.assignedTo.userEmail,
      subject: `New Form Assignment: ${formTitle}`,
      html: emailContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Assignment notification email sent:', info.messageId);
    
    // Update assignment with notification status
    assignment.notifications.push({
      type: 'assigned',
      sentAt: new Date(),
      status: 'sent'
    });
    await assignment.save();
    
    return true;
  } catch (error) {
    console.error('Error sending assignment notification email:', error);
    
    // Update assignment with notification failure
    if (assignment) {
      assignment.notifications.push({
        type: 'assigned',
        sentAt: new Date(),
        status: 'failed'
      });
      await assignment.save();
    }
    
    return false;
  }
};

// Send reminder notification
export const sendReminderNotification = async (assignment) => {
  try {
    if (!assignment.assignedTo.userEmail) {
      return false;
    }

    const transporter = createTransporter();
    
    const formTitle = assignment.formTemplateId?.title || 'Form';
    const dueDate = assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date';
    
    const emailContent = `
      <h2>Form Assignment Reminder</h2>
      <p>Hello ${assignment.assignedTo.userName},</p>
      
      <p>This is a reminder that you have a pending form assignment:</p>
      
      <div style="background-color: #fff3cd; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
        <h3>${formTitle}</h3>
        <p><strong>Due date:</strong> ${dueDate}</p>
        <p><strong>Status:</strong> ${assignment.status}</p>
      </div>
      
      <p>Please complete this form as soon as possible.</p>
      
      <p>Thank you!</p>
    `;

    const mailOptions = {
      from: process.env.FROM_EMAIL || 'noreply@yourdomain.com',
      to: assignment.assignedTo.userEmail,
      subject: `Reminder: ${formTitle}`,
      html: emailContent,
    };

    await transporter.sendMail(mailOptions);
    
    // Update assignment with notification status
    assignment.notifications.push({
      type: 'reminder',
      sentAt: new Date(),
      status: 'sent'
    });
    await assignment.save();
    
    return true;
  } catch (error) {
    console.error('Error sending reminder notification:', error);
    return false;
  }
};

// Send overdue notification
export const sendOverdueNotification = async (assignment) => {
  try {
    if (!assignment.assignedTo.userEmail) {
      return false;
    }

    const transporter = createTransporter();
    
    const formTitle = assignment.formTemplateId?.title || 'Form';
    const dueDate = new Date(assignment.dueDate).toLocaleDateString();
    
    const emailContent = `
      <h2>Overdue Form Assignment</h2>
      <p>Hello ${assignment.assignedTo.userName},</p>
      
      <p>The following form assignment is now overdue:</p>
      
      <div style="background-color: #f8d7da; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc3545;">
        <h3>${formTitle}</h3>
        <p><strong>Due date:</strong> ${dueDate}</p>
        <p><strong>Status:</strong> OVERDUE</p>
      </div>
      
      <p>Please complete this form immediately.</p>
      
      <p>Thank you!</p>
    `;

    const mailOptions = {
      from: process.env.FROM_EMAIL || 'noreply@yourdomain.com',
      to: assignment.assignedTo.userEmail,
      subject: `OVERDUE: ${formTitle}`,
      html: emailContent,
    };

    await transporter.sendMail(mailOptions);
    
    // Update assignment with notification status
    assignment.notifications.push({
      type: 'overdue',
      sentAt: new Date(),
      status: 'sent'
    });
    await assignment.save();
    
    return true;
  } catch (error) {
    console.error('Error sending overdue notification:', error);
    return false;
  }
};

// Check for assignments that need reminders
export const processScheduledReminders = async () => {
  try {
    const now = new Date();
    
    // Find assignments with reminders enabled and due dates approaching
    const assignments = await FormAssignment.find({
      isActive: true,
      status: { $in: ['pending', 'in-progress'] },
      dueDate: { $exists: true, $ne: null },
      'reminderSettings.enabled': true
    })
    .populate('formTemplateId assignedBy')
    .populate('assignedTo.userId');

    for (const assignment of assignments) {
      const dueDate = new Date(assignment.dueDate);
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      
      // Check if we should send a reminder
      if (assignment.reminderSettings.reminderDays.includes(daysUntilDue)) {
        // Check if we haven't already sent a reminder for this day
        const lastReminder = assignment.notifications
          .filter(n => n.type === 'reminder')
          .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))[0];
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (!lastReminder || new Date(lastReminder.sentAt) < today) {
          await sendReminderNotification(assignment);
        }
      }
      
      // Check if assignment is overdue
      if (daysUntilDue < 0 && assignment.status !== 'expired') {
        // Check if we haven't sent an overdue notification today
        const lastOverdue = assignment.notifications
          .filter(n => n.type === 'overdue')
          .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))[0];
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (!lastOverdue || new Date(lastOverdue.sentAt) < today) {
          await sendOverdueNotification(assignment);
        }
      }
    }
  } catch (error) {
    console.error('Error processing scheduled reminders:', error);
  }
};

// Schedule reminder processing (can be called by cron job or scheduler)
export const scheduleReminderProcessing = () => {
  // Run every hour
  setInterval(processScheduledReminders, 60 * 60 * 1000);
  console.log('Form assignment reminder processing scheduled');
};