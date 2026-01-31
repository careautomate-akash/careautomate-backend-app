import { validateEmail, toTitleCase } from '../../helpers/authHelpers.js';
import users from '../../models/account/users.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import EmailVerificationToken from '../../models/account/emailVerificationToken.js';
import { sendVerificationEmail } from '../../services/mailService.js';
import createHttpError from 'http-errors';
import AccountSetup from '../../models/account/accountSetup.js';
import settings from '../../models/account/settings.js';
import company from '../../models/account/company.js';
import childAdminAccount from '../../models/account/childAdminAccount.js';
import { generateChatToken } from '../../utils/generateChatToken.js';
import { initializeTrialPeriod, activateSubscription, checkSubscriptionStatus } from '../../services/subscriptionService.js';
export const loginController = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(303)
        .json({ success: false, error: 'Fields must not be empty' });
    }
    let user;
    let isMatch;
    user = await users.findOne({ email: email });
    if (!user) {
      return res
        .status(400)
        .json({ success: false, error: "User doesn't exist" });
    }
    isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, error: "Password didn't match" });
    }

    // BACKWARD COMPATIBILITY: Only check subscription if user has the fields
    // This allows existing users to login before migration is run
    if (user.subscription_status) {
      // Check if account is active (only if field exists)
      if (user.is_active === false) {
        return res.status(403).json({
          success: false,
          error: 'Account is deactivated',
          subscriptionStatus: user.subscription_status,
          reason: user.deactivation_reason,
        });
      }

      // Check subscription status
      const subscriptionCheck = await checkSubscriptionStatus(user._id);
      if (!subscriptionCheck.isValid) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          reason: subscriptionCheck.reason,
          subscriptionStatus: subscriptionCheck.status,
          expired: subscriptionCheck.expired || false,
        });
      }
    }

    const token = jwt.sign(
      { _id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
    );

    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      mobileNo: user.phoneNo,
      role: user.role,
    };
    const companyRecord = await company.findOne({ _id: user.companyId });
    if (user.role == 21) {
      const childAdminAccountDocument = await childAdminAccount.findOne({
        _id: user.info_id,
      });
      userResponse.permissions = childAdminAccountDocument.permissions;

      return res.status(200).json({
        success: true,
        message: 'Login successful',
        response: {
          token,
          user: userResponse,
          company: {
            id: user.companyId,
            name: companyRecord.companyName,
          },
        },
      });
    }
    if (user.role === 2) {
      userResponse.accountSetup = user.accountSetup;
    }

    // Add subscription info to response (only if subscription fields exist)
    if (user.subscription_status) {
      userResponse.subscriptionStatus = user.subscription_status;
      userResponse.isActive = user.is_active;

      // Only add trial days if we have subscription check
      const subscriptionCheck = await checkSubscriptionStatus(user._id);
      if (subscriptionCheck.daysRemaining) {
        userResponse.trialDaysRemaining = subscriptionCheck.daysRemaining;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      response: {
        token,
        user: userResponse,
        company: {
          id: user.companyId,
          name: companyRecord.companyName,
        },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const registerController = async (req, res) => {
  const { name, email, password, phoneNo, companyName, state, role, subscription_type } = req.body;

  try {
    let error = {};

    // Check for missing required fields and add to error object
    if (!name) {
      error.name = 'Field must not be empty';
    }
    if (!email) {
      error.email = 'Field must not be empty';
    }
    if (!password) {
      error.password = 'Field must not be empty';
    }
    if (role != 3 && !companyName) {
      error.companyName = 'Field must not be empty';
    }

    // If there are any errors, return them
    if (Object.keys(error).length > 0) {
      return res.status(303).json({ success: false, error });
    }

    // Validate email format
    if (!validateEmail(email)) {
      error = { ...error, email: 'Email is not valid' };
      return res.status(400).json({ success: false, error });
    }

    // Check password length
    if (password.length < 5) {
      error = { ...error, password: 'Password must be 8-255 characters' };
      return res.status(303).json({ success: false, error });
    }

    // Check if user already exists
    const existingUser = await users.findOne({ email: email });
    if (existingUser) {
      error = { ...error, email: 'Email already exists' };
      return res.status(303).json({ success: false, error });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new User record with info_id
    let newUser = new users({
      name: toTitleCase(name),
      email,
      password: hashedPassword,
      phoneNo,
      state,
      role,
    });
    await newUser.save();

    const settingsDocument = new settings({
      userId: newUser._id,
      personalDetails: newUser._id,
    });
    await settingsDocument.save();

    let companyRecord;
    if (role === 2 || role === 3) {
      companyRecord = new company({
        adminId: newUser._id,
        companyName: companyName,
        adminName: name,
        adminEmail: email,
      });
      await companyRecord.save();

      newUser.companyId = companyRecord._id;
      newUser.companyName = companyName;
      await newUser.save();
    }

    // Initialize subscription based on user selection
    // Valid values: 'trial', 'subscribed'
    // Default to 'trial' if not specified
    const subscriptionType = subscription_type || 'trial';

    if (subscriptionType === 'subscribed') {
      // If user selects subscribed during registration, activate subscription
      // You can adjust the default duration or get it from req.body.durationMonths
      const durationMonths = req.body.durationMonths || 12; // Default 12 months
      await activateSubscription(newUser._id, durationMonths);
    } else {
      // Default: Initialize trial period (14 days)
      await initializeTrialPeriod(newUser._id);
    }

    const chatToken = generateChatToken(newUser._id.toString());
    return res.status(200).json({
      success: true,
      message: 'Account created successfully. Please login',
      response: {
        user: newUser,
        company: companyRecord,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const testController = async (req, res) => {
  try {
    return res.status(200).send('Protected Routes');
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: 'Error in accessing protected route' });
  }
};

export const verifyEmailController = async (req, res) => {
  const { email, code } = req.body;

  if (storedCode === code) {
    // Mark the email as verified in the database
    // ...
    res.status(200).json({ message: 'Email verified successfully.' });
  } else {
    res.status(400).json({ message: 'Invalid verification code.' });
  }
};

export const adminSetupController = async (req, res) => {
  const { email } = req.body;
};
export const sendVerificationCode = async (req, res, next) => {
  const { email } = req.body;

  try {
    // Check if a token already exists for this email
    const existingToken = await EmailVerificationToken.findOne({ email });
    if (existingToken) {
      throw createHttpError(
        409,
        'A verification code has already been sent to this email.',
      );
    }

    // Generate a random verification code
    const verificationCode = crypto.randomInt(100000, 999999).toString();

    // Store the verification code in the database
    await EmailVerificationToken.create({ email, verificationCode });

    // Send the verification code via email
    await sendVerificationEmail(email, verificationCode);

    res.status(200).json({ message: 'Verification code sent successfully.' });
  } catch (error) {
    next(error);
  }
};

export const forgotPasswordController = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await users.findOne({ email });
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: 'User not found' });
    }
    const verificationCode = crypto.randomInt(100000, 999999).toString();
    await EmailVerificationToken.create({ email, verificationCode });
    await sendVerificationEmail(email, verificationCode);
    return res.status(200).json({
      success: true,
      message: 'Verification code sent successfully',
      response: { user: user },
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, error: 'Error in accessing protected route' });
  }
};

export const verifyOTPController = async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await users.findOne({ email });
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: 'User not found' });
    }
    const verificationCode = await EmailVerificationToken.findOne({
      email,
    }).sort({ createdAt: -1 });
    if (verificationCode.verificationCode !== code) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid verification code' });
    }
    return res.status(200).json({
      success: true,
      message: 'Verification code verified successfully',
      response: { user: user },
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, error: 'Error in accessing protected route' });
  }
};

export const changePasswordController = async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;
  const user = await users.findOne({ _id: userId });
  const isMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isMatch) {
    return res.status(400).json({
      success: false,
      message: 'Old password is incorrect',
      response: null,
    });
  }
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await users.findOneAndUpdate({ _id: userId }, { password: hashedPassword });
  return res.status(200).json({
    success: true,
    message: 'Password changed successfully',
    response: { user: user },
  });
};

export const addChildAccountController = async (req, res) => {
  try {
    const {
      adminId,
      firstName,
      address,
      contact,
      email,
      password,
      permissions,
    } = req.body;

    // Validate required fields
    if (!firstName || !email || !password || !permissions) {
      return res.status(400).json({
        success: false,
        message:
          'adminId, firstName, email, password, and permissions are required',
      });
    }

    // Find the account setup document using adminId
    const accountSetup = await AccountSetup.findOne({ adminId });
    if (!accountSetup) {
      return res
        .status(400)
        .json({ success: false, message: 'Account setup not found' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new child admin account
    const childAccount = {
      firstName,
      address,
      contact,
      username: email,
      password: hashedPassword,
      permissions,
    };

    // Add the new child account to the childAdminAccounts array
    accountSetup.childAdminAccounts.push(childAccount);

    // Save the updated account setup document
    await accountSetup.save();

    return res.status(200).json({
      success: true,
      message: 'Child admin account added successfully',
      response: childAccount,
    });
  } catch (error) {
    console.error('Error adding child admin account:', error);
    return res
      .status(500)
      .json({ success: false, error: 'Error in accessing protected route' });
  }
};

export const childAccountUpdateController = async (req, res) => {
  try {
    const { email, password, updates } = req.body; // Assume updates is an object containing fields to update

    // Find the account setup document containing the child admin account
    const accountSetup = await AccountSetup.findOne({
      'childAdminAccounts.emailAddress': email,
    });

    if (!accountSetup) {
      return res
        .status(400)
        .json({ success: false, message: 'Child admin account not found' });
    }

    // Find the specific child admin account to update
    const childAccount = accountSetup.childAdminAccounts.find(
      (account) => account.username === email,
    );

    if (!childAccount) {
      return res
        .status(400)
        .json({ success: false, message: 'Child admin account not found' });
    }

    // Update the fields in the child account
    if (password) {
      childAccount.password = password; // Update password if provided
    }

    // Apply other updates
    Object.keys(updates).forEach((key) => {
      if (childAccount[key] !== undefined) {
        childAccount[key] = updates[key];
      }
    });

    // Save the updated account setup document
    await accountSetup.save();

    res.status(200).json({
      success: true,
      message: 'Child admin account updated successfully',
      response: childAccount,
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, error: 'Error updating child admin account' });
  }
};

export const changeEmployeeOrMemberPasswordController = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    // Basic input validation
    if (!userId || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'User ID and new password are required.',
        response: null,
      });
    }

    const user = await users.findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
        response: null,
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await users.findOneAndUpdate(
      { _id: userId },
      { password: hashedPassword },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully.',
      response: null, // Don't return user info after password update
    });
  } catch (error) {
    console.error('Error changing password:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
      response: null,
    });
  }
};

export const checkEmailExists = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await users
      .findOne({ email: normalizedEmail })
      .select('_id');

    if (existingUser) {
      return res.status(200).json({
        success: true,
        exists: true,
        message: 'Email already exists',
      });
    }

    return res.status(200).json({
      success: true,
      exists: false,
      message: 'Email is available',
    });
  } catch (error) {
    console.error('Check email error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};
