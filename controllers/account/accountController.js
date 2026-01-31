import accountSetup from '../../models/account/accountSetup.js';
import bcrypt from 'bcrypt';
import Users from '../../models/account/users.js';
import childAdminAccount from '../../models/account/childAdminAccount.js';
import settings from '../../models/account/settings.js';
import mongoose from 'mongoose';
import Bills from '../../models/bills/bills.js';
import { generateBatchEDI } from '../../tasks/generateBatchEDI.js';

export const getSuperAdminDetails = async (req, res) => {
  const { superAdminId } = req.body;
  try {
    const superAdmin = await Users.find({ _id: superAdminId });

    res.status(200).json({
      success: true,
      message: 'Super Admin Details fetched successfully',
      response: superAdmin,
    });
  } catch (error) {
    console.error('Error fetching tenant visit compliance reports:', error);
    res.status(500).json({
      success: false,
      message:
        'An error occurred while fetching tenant visit compliance reports.',
    });
  }
};

//OFFICE ADMIN ACCOUNT

//office admin account setup
export const officeAdminAccountSetupController = async (req, res) => {
  try {
    const { adminId, accountData, companyId } = req.body;

    // Fetch user details
    const user = await Users.findById(adminId);
    if (!user) {
      return res
        .status(302)
        .json({ success: false, message: 'User not found' });
    }

    if (user.accountSetup) {
      return res
        .status(302)
        .json({ success: false, message: 'Account already setup' });
    }

    if (accountData.childAdminAccounts.length > 0) {
      const childAdminAccountData = accountData.childAdminAccounts[0];

      // Create a new childAdminAccount document
      const newChildAdmin = new childAdminAccount({
        adminId,
        ...childAdminAccountData,
        companyId: user.companyId,
      });

      await newChildAdmin.save();

      // Store the ID in the parent account
      accountData.childAdminAccounts = [newChildAdmin._id];
    }

    // Create AccountSetup document
    const accSetup = new accountSetup({
      ...accountData,
      adminId: user._id,
      companyId: user.companyId,
    });

    await accSetup.save();

    // Convert adminId to ObjectId using 'new'
    const adminObjectId = new mongoose.Types.ObjectId(adminId);

    // Fetch or create settings document
    let settingsDocument = await settings.findOne({ userId: adminObjectId });

    if (!settingsDocument) {
      // If no document is found, create a new one
      settingsDocument = new settings({
        userId: adminObjectId,
        accountDetails: accSetup._id,
      });
    } else {
      // Update existing document
      settingsDocument.accountDetails = accSetup._id;
    }
    await settingsDocument.save();

    // Update user's accountSetup field
    user.accountSetup = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Account setup successfully',
      response: {
        accountSetup: accSetup,
        user: user,
        settings: settingsDocument,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'An error occurred',
      error: error.message,
    });
  }
};

// Fetch Account Details
export const fetchAccountDetails = async (req, res) => {
  const { adminId } = req.params;
  
  try {
    // Validate if adminId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid adminId format',
        response: null,
      });
    }

    const adminIdObject = new mongoose.Types.ObjectId(adminId);
    
    // Check if the user exists first
    const userExists = await Users.findOne({ _id: adminIdObject });
   
    const accountDetails = await accountSetup.findOne({
      adminId: adminIdObject,
    });

    if (!accountDetails) {
      return res.status(404).json({
        success: false,
        message: 'Account details not found. Please complete the account setup first.',
        response: null,
        debug: {
          userExists: !!userExists,
          adminId: adminId,
          suggestion: userExists 
            ? 'Account setup has not been completed for this user. Please complete the setup via /account/add-account-personal-details endpoint.' 
            : 'User does not exist in the system.'
        }
      });
    }
    
    // Respond with the account details
    res.status(200).json({
      success: true,
      message: 'Account details fetched successfully',
      response: accountDetails,
    });
  } catch (error) {
    console.error('Error fetching account details:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error fetching account details', error: error.message });
  }
};

// Helper function to update bills and EDIs when account details change
const updateBillandEDI = async (visitId, adminDetails, companyId) => {
  try {
    // Verify adminDetails has required fields
    if (!adminDetails) {
      console.error('adminDetails is null or undefined');
      return false;
    }

    const bills = await Bills.find({ companyId });

    if (bills.length === 0) {
      return true;
    }

    let updatedCount = 0;

    for (const bill of bills) {
      let hasChanges = false;
      // Check if bill.company exists
      if (!bill.company) {
        bill.company = {
          name: adminDetails.companyName || 'Unknown Company',
          taxId:
            adminDetails.federalTaxId || adminDetails.idnpiUmpi || '000000000',
          address: {},
        };
        hasChanges = true;
      } else {
        // Update company information in the bill
        if (
          adminDetails.companyName &&
          bill.company.name !== adminDetails.companyName
        ) {
          bill.company.name = adminDetails.companyName;
          hasChanges = true;
        }

        // Update tax ID (prioritize federalTaxId over idnpiUmpi)
        if (
          adminDetails.federalTaxId &&
          bill.company.taxId !== adminDetails.federalTaxId
        ) {
          bill.company.taxId = adminDetails.federalTaxId;
          hasChanges = true;
        } else if (
          adminDetails.idnpiUmpi &&
          !adminDetails.federalTaxId &&
          bill.company.taxId !== adminDetails.idnpiUmpi
        ) {
          bill.company.taxId = adminDetails.idnpiUmpi;
          hasChanges = true;
        }

        // Update NPI/UMPI if present
        if (
          bill.companyNPI &&
          adminDetails.idnpiUmpi &&
          bill.companyNPI !== adminDetails.idnpiUmpi
        ) {
          bill.companyNPI = adminDetails.idnpiUmpi;
          hasChanges = true;
        }
      }

      // Only regenerate EDI and save if changes were made
      if (hasChanges) {
        try {
          // Regenerate EDI content with updated information
          try {
            const ediResult = await generateBatchEDI(bill);

            if (ediResult.ediContent) {
              bill.ediContent = ediResult.ediContent;
              bill.ediFileName = ediResult.ediFileName;
            } else {
              console.warn(`No EDI content generated for bill ${bill._id}`);
              if (ediResult.error) {
                console.error(`EDI generation error: ${ediResult.error}`);
              }
            }
          } catch (generateError) {
            console.error('Error in generateBatchEDI function:', generateError);
          }

          await bill.save();
          updatedCount++;
        } catch (ediError) {
          console.error(
            `Error regenerating EDI for bill ${bill._id}:`,
            ediError
          );
        }
      }
    }

    return true;
  } catch (error) {
    console.error('Error updating bill and EDI:', error);
    return false;
  }
};

export const updateAccountDetails = async (req, res) => {
  try {
    const { adminId, accountDetails } = req.body;

    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: 'Admin ID is required',
      });
    }

    if (!accountDetails) {
      return res.status(400).json({
        success: false,
        message: 'Account details are required',
      });
    }

    const adminIdObject = new mongoose.Types.ObjectId(adminId);

    const updateFields = {};

    if (accountDetails.email) updateFields.email = accountDetails.email;
    if (accountDetails.firstName)
      updateFields.firstName = accountDetails.firstName;
    if (accountDetails.lastName)
      updateFields.lastName = accountDetails.lastName;
    if (accountDetails.companyName)
      updateFields.companyName = accountDetails.companyName;
    if (accountDetails.federalTaxId)
      updateFields.federalTaxId = accountDetails.federalTaxId;
    if (accountDetails.idnpiUmpi)
      updateFields.idnpiUmpi = accountDetails.idnpiUmpi;
    if (accountDetails.taxonomy)
      updateFields.taxonomy = accountDetails.taxonomy;

    // Handle nested address fields
    if (accountDetails.address) {
      if (accountDetails.address.addressLine1)
        updateFields['address.addressLine1'] =
          accountDetails.address.addressLine1;
      if (accountDetails.address.addressLine2)
        updateFields['address.addressLine2'] =
          accountDetails.address.addressLine2;
      if (accountDetails.address.city)
        updateFields['address.city'] = accountDetails.address.city;
      if (accountDetails.address.state)
        updateFields['address.state'] = accountDetails.address.state;
      if (accountDetails.address.zipCode)
        updateFields['address.zipCode'] = accountDetails.address.zipCode;
    }

    // Handle nested contact fields
    if (accountDetails.contact) {
      if (accountDetails.contact.officePhoneNumber)
        updateFields['contact.officePhoneNumber'] =
          accountDetails.contact.officePhoneNumber;
      if (accountDetails.contact.cellPhoneNumber)
        updateFields['contact.cellPhoneNumber'] =
          accountDetails.contact.cellPhoneNumber;
      if (accountDetails.contact.primaryEmailAddress)
        updateFields['contact.primaryEmailAddress'] =
          accountDetails.contact.primaryEmailAddress;
      if (accountDetails.contact.alternateEmailAddress)
        updateFields['contact.alternateEmailAddress'] =
          accountDetails.contact.alternateEmailAddress;
    }

    const accountDetailsDocument = await accountSetup.findOneAndUpdate(
      { adminId: adminIdObject },
      { $set: updateFields },
      { new: true, runValidators: true }
    );
    if (!accountDetailsDocument) {
      return res.status(404).json({
        success: false,
        message: 'Account details not found. Please contact support.',
      });
    }

    const causers = mongoose.model('causers');
    const userUpdateFields = {};

    const firstName = accountDetails.firstName || '';
    const lastName = accountDetails.lastName || '';
    const fullName =
      firstName || lastName ? `${firstName} ${lastName}`.trim() : null;

    if (fullName) userUpdateFields.name = fullName;
    if (accountDetails.email) userUpdateFields.email = accountDetails.email;
    if (accountDetails.contact?.cellPhoneNumber)
      userUpdateFields.phoneNo = accountDetails.contact.cellPhoneNumber;

    const userDocument = await causers.findOneAndUpdate(
      { _id: adminIdObject },
      { $set: userUpdateFields },
      { new: true, runValidators: true }
    );

    if (userDocument) {
    }

    try {
      if (!userDocument) {
        console.warn(
          'User document not found, but account details were updated'
        );
        // Try to find the company ID from the account setup
        const companyId = accountDetailsDocument.companyId;

        if (companyId) {
          await updateBillandEDI(null, accountDetailsDocument, companyId);
        } else {
          console.error(
            'No companyId found in accountDetailsDocument, cannot update bills'
          );
        }
      } else {
        // Update bills and EDIs with new company information
        await updateBillandEDI(
          null,
          accountDetailsDocument,
          userDocument.companyId
        );
      }
    } catch (billUpdateError) {
      console.error('Error updating bills and EDIs:', billUpdateError);
      // Continue with the response even if bill update fails
    }

    res.status(200).json({
      success: true,
      message: 'Account details updated successfully',
      response: {
        'account-details': accountDetailsDocument,
        'updated-user': userDocument,
      },
    });
  } catch (error) {
    console.error('Error updating account details:', error);

    let errorMessage = 'An error occurred while updating account details';

    if (error.name === 'ValidationError') {
      errorMessage =
        'Validation error: ' +
        Object.values(error.errors)
          .map((e) => e.message)
          .join(', ');
    } else if (error.name === 'CastError') {
      errorMessage = 'Invalid ID format provided';
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

export const deleteAccountDetails = async (req, res) => {
  const { adminId } = req.query;
  const adminIdObject = new mongoose.Types.ObjectId(adminId);
  const accountDetailsDocument = await accountSetup.findOne({
    adminId: adminIdObject,
  });
  const settingsDocument = await settings.findOne({ userId: adminIdObject });
  await accountDetailsDocument.deleteOne();
  settingsDocument.accountDetails = null;
  const updatedSettingsDocument = await settingsDocument.save();
  const user = await Users.findOne({ info_id: adminIdObject });
  user.accountSetup = false;
  const updatedUser = await user.save();

  res.status(200).json({
    success: true,
    message: 'Account details deleted successfully',
    response: {
      'updated-settings': updatedSettingsDocument,
      'deleted-account-details': accountDetailsDocument,
      'updated-user': updatedUser,
    },
  });
};

//MNITS ACCOUNT
export const updateMnitsAccount = async (req, res) => {
  const { adminId } = req.params;
  const adminIdObject = new mongoose.Types.ObjectId(adminId);

  try {
    const account = await accountSetup.findOne({ adminId: adminIdObject });
    if (!account) {
      return res
        .status(400)
        .json({ success: false, message: 'Account not found' });
    }
    const { username, password } = req.body;

    if (username) {
      account.mnitsLogin.username = username;
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      account.mnitsLogin.password = hashedPassword;
    }

    const updatedAccount = await account.save();
    res.status(200).json({
      success: true,
      message: 'Account updated successfully',
      response: updatedAccount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'An error occurred',
      error: error.message,
    });
  }
};

//WAYSTAR ACCOUNT
export const updateWaystarAccount = async (req, res) => {
  const { adminId } = req.params;
  const adminIdObject = new mongoose.Types.ObjectId(adminId);
  try {
    const account = await accountSetup.findOne({ adminId: adminIdObject });
    if (!account) {
      return res
        .status(400)
        .json({ success: false, message: 'Account not found' });
    }
    const { username, password } = req.body;

    if (username) {
      account.waystarLogin.username = username;
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      account.waystarLogin.password = hashedPassword;
    }

    const updatedAccount = await account.save();
    res.status(200).json({
      success: true,
      message: 'Account updated successfully',
      response: updatedAccount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'An error occurred',
      error: error.message,
    });
  }
};

//BANKING INFO
export const updateBankingInfo = async (req, res) => {
  const { adminId } = req.params;
  const adminIdObject = new mongoose.Types.ObjectId(adminId);
  try {
    const { nameOnCard, cardNumber, expiryDate, billingAddress } = req.body;
    const account = await accountSetup.findOne({ adminId: adminIdObject });
    if (!account) {
      return res
        .status(400)
        .json({ success: false, message: 'Account not found' });
    }

    if (nameOnCard) {
      account.bankingInfo.nameOnCard = nameOnCard;
    }
    if (cardNumber) {
      account.bankingInfo.cardNumber = cardNumber;
    }
    if (expiryDate) {
      account.bankingInfo.expiryDate = expiryDate;
    }
    if (billingAddress) {
      account.bankingInfo.billingAddress = billingAddress;
    }

    const updatedAccount = await account.save();
    res.status(200).json({
      success: true,
      message: 'Account updated successfully',
      response: updatedAccount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'An error occurred',
      error: error.message,
    });
  }
};

//CHILD ADMIN ACCOUNT

//add child admin account
export const addChildAdminAccount = async (req, res) => {
  const { adminId, childAdminData, companyId } = req.body;
  const adminIdObject = new mongoose.Types.ObjectId(adminId);
  const companyIdObject = new mongoose.Types.ObjectId(companyId);
  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(childAdminData.password, 10);

    // Remove any existing _id from childAdminData to avoid duplicate key error
    // delete childAdminData._id;
    const users = await Users.find({ email: childAdminData.username });
    if (users.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists',
        response: null,
      });
    }
    // Create a new childAdminAccount instance
    const childadminaccount = new childAdminAccount({
      firstName: childAdminData.firstName,
      lastName: childAdminData.lastName,
      address: childAdminData.address,
      contact: childAdminData.contact,
      username: childAdminData.username,
      password: hashedPassword,
      permissions: childAdminData.permissions,
      adminId: adminIdObject,
      companyId: companyIdObject,
    });
    const savedChildAdminAccount = await childadminaccount.save();
    // Update accountSetup
    const accountSet = await accountSetup.findOne({ adminId: adminIdObject });
    if (!accountSet) {
      return res
        .status(400)
        .json({ success: false, message: 'Account Setup not found' });
    }
    accountSet.childAdminAccounts.push(savedChildAdminAccount._id);
    await accountSet.save();

    const isEmailExist = await Users.findOne({
      email: childAdminData.username,
    });

    if (isEmailExist) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists',
        response: null,
      });
    }
    // Create a new user
    const fullName =
      childAdminData.firstName +
      (childAdminData.lastName ? ' ' + childAdminData.lastName : '');
    const user = new Users({
      name: fullName,
      email: childAdminData.username,
      password: hashedPassword, // Use the hashed password
      companyId: companyIdObject,
      companyName: adminId.companyName,
      dateCreated: Date.now(),
      role: 21,
      accountSetup: true,
      info_id: savedChildAdminAccount._id,
    });
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Child Admin Account added successfully',
      response: {
        childadminaccount: savedChildAdminAccount,
        user: user,
        accountSetup: accountSet,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'An error occurred',
      error: error.message,
    });
  }
};

export const getChildAdminAccounts = async (req, res) => {
  const { adminId } = req.params;
  const adminIdObject = new mongoose.Types.ObjectId(adminId);
  try {
    const childAdminAcc = await childAdminAccount.find({
      adminId: adminIdObject,
    });
    res.status(200).json({
      success: true,
      message: 'Child Admin Account Details fetched successfully',
      response: childAdminAcc,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'An error occurred',
      error: error.message,
    });
  }
};

export const updateChildAdminAccount = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  const objectId = new mongoose.Types.ObjectId(id);
  try {
    // Fetch the existing childAdminAccount
    const existingChildAdminAccount = await childAdminAccount.findById(
      objectId
    );
    if (!existingChildAdminAccount) {
      return res
        .status(404)
        .json({ success: false, message: 'Child Admin Account not found' });
    }
    let hashedPassword = '';
    // Update the childAdminAccount
    const updatedChildAdminAccount = await childAdminAccount.findOneAndUpdate(
      { _id: objectId },
      updateData,
      { new: true }
    );

    // Update the corresponding user record
    const userUpdateData = {
      firstName: updateData.firstName || existingChildAdminAccount.firstName,
      lastName: updateData.lastName ? existingChildAdminAccount.lastName : '',
      email: updateData.username || existingChildAdminAccount.username,
      permissions: {
        billing:
          updateData.permissions?.billing ??
          existingChildAdminAccount.permissions.billing,
        tenant:
          updateData.permissions?.tenant ??
          existingChildAdminAccount.permissions.tenant,
        hcm:
          updateData.permissions?.hcm ??
          existingChildAdminAccount.permissions.hcm,
        appointments:
          updateData.permissions?.appointments ??
          existingChildAdminAccount.permissions.appointments,
        visit:
          updateData.permissions?.visit ??
          existingChildAdminAccount.permissions.visit,
        communication:
          updateData.permissions?.communication ??
          existingChildAdminAccount.permissions.communication,
      },
      address: {
        streetAddress:
          updateData.address?.streetAddress ??
          existingChildAdminAccount.address.streetAddress,
        city:
          updateData.address?.city ?? existingChildAdminAccount.address.city,
        state:
          updateData.address?.state ?? existingChildAdminAccount.address.state,
        zipCode:
          updateData.address?.zipCode ??
          existingChildAdminAccount.address.zipCode,
        country:
          updateData.address?.country ??
          existingChildAdminAccount.address.country,
      },
      contact: {
        officePhoneNumber:
          updateData.contact?.officePhoneNumber ??
          existingChildAdminAccount.contact.officePhoneNumber,
        cellPhoneNumber:
          updateData.contact?.cellPhoneNumber ??
          existingChildAdminAccount.contact.cellPhoneNumber,
        primaryEmailAddress:
          updateData.contact?.primaryEmailAddress ??
          existingChildAdminAccount.contact.primaryEmailAddress,
        alternateEmailAddress:
          updateData.contact?.alternateEmailAddress ??
          existingChildAdminAccount.contact.alternateEmailAddress,
      },
      dateUpdated: Date.now(),
    };
    if (updateData.password) {
      hashedPassword = await bcrypt.hash(updateData.password, 10);
      userUpdateData.password = hashedPassword;
    }

    await childAdminAccount.findOneAndUpdate(
      { _id: objectId },
      userUpdateData,
      { new: true }
    );

    // Find the existing user
    const existingUser = await Users.findOne({ info_id: objectId });
    let updatedUserData = {
      name:
        userUpdateData.firstName +
        ' ' +
        (userUpdateData.lastName ? userUpdateData.lastName : ''),
      email: userUpdateData.email || existingUser.email,
      password: userUpdateData.password || existingUser.password,
      dateUpdated: Date.now(),
    };
    // Update the user with merged data
    await Users.findOneAndUpdate({ info_id: objectId }, updatedUserData);

    res.status(200).json({
      success: true,
      message: 'Child Admin Account Details updated successfully',
      response: {
        'updated childadminaccount': updatedChildAdminAccount,
        'updated user': updatedUserData,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'An error occurred',
      error: error.message,
    });
  }
};

export const deleteChildAdminAccount = async (req, res) => {
  const { id } = req.params;
  const { adminId } = req.body;
  // Validate ID format
  if (
    !mongoose.Types.ObjectId.isValid(id) ||
    !mongoose.Types.ObjectId.isValid(adminId)
  ) {
    return res
      .status(400)
      .json({ success: false, message: 'Invalid ID format' });
  }

  const idObject = new mongoose.Types.ObjectId(id);
  const adminIdObject = new mongoose.Types.ObjectId(adminId);

  try {
    // Delete the child admin account
    const childAdminAcc = await childAdminAccount.findByIdAndDelete({
      _id: idObject,
    });
    if (!childAdminAcc) {
    }

    // Delete the associated user record
    const user = await Users.findOneAndDelete({ info_id: idObject });
    if (!user) {
    }

    // Find the account setup document
    const accountSet = await accountSetup.findOne({ adminId: adminIdObject });
    if (accountSet) {
      // Remove the childAdminAccount ID from the childAdminAccounts array
      accountSet.childAdminAccounts.pull(idObject);
      // Save the updated document to persist changes
      await accountSet.save();
    }

    res.status(200).json({
      success: true,
      message: 'Child Admin Account Details deleted successfully',
      response: {
        childAdminAccount: childAdminAcc,
        accountSetup: accountSet,
        user: user,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the Child Admin Account',
      error: error.message,
    });
  }
};

export const setTimeZoneForaUser = async (req, res) => {
  const { userId, timezone } = req.body;
  try {
    if (!userId || !timezone) {
      return res.status(400).json({
        success: false,
        message: 'User ID and timezone are required',
      });
    }

    const user = await Users.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.timezone = timezone;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Timezone updated successfully',
      response: user,
    });
  } catch (error) {
    console.error('Error updating timezone:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating the timezone',
      error: error.message,
    });
  }
};
