import mongoose from 'mongoose';
import Company from '../../models/account/company.js';
import Users from '../../models/account/users.js';
import childAdminAccount from '../../models/account/childAdminAccount.js';
import settings from '../../models/account/settings.js';
import accountSetup from '../../models/account/accountSetup.js';
import bcrypt from 'bcrypt';
import Visits from '../../models/appointments-visits/visits.js';
import Appointments from '../../models/appointments-visits/appointments.js';

const getCompanyReports = async (req, res) => {
  try {
    // Fetch all companies, users, and child admin accounts in parallel
    const [companies, allUsers, allChildAdminAccounts] = await Promise.all([
      Company.find().lean(),
      Users.find().lean(),
      childAdminAccount.find().lean(),
    ]);

    if (companies.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: 'No companies found' });
    }

    // Create lookup maps for better performance
    const usersByCompany = {};
    const childAdminsByAdmin = {};

    // Group users by company
    allUsers.forEach((user) => {
      const companyId = user.companyId?.toString();
      if (!usersByCompany[companyId]) {
        usersByCompany[companyId] = [];
      }
      usersByCompany[companyId].push(user);
    });

    // Group child admins by admin ID
    allChildAdminAccounts.forEach((childAdmin) => {
      const adminId = childAdmin.adminId?.toString();
      if (!childAdminsByAdmin[adminId]) {
        childAdminsByAdmin[adminId] = [];
      }
      childAdminsByAdmin[adminId].push(childAdmin);
    });

    // Build company reports
    const companyReports = companies
      .map((company) => {
        const companyId = company._id.toString();
        const usersData = usersByCompany[companyId] || [];

        if (usersData.length === 0) {
          return null;
        }

        // Find admin, tenants, and HCMs in a single pass
        let admin = null;
        const tenants = [];
        const hcms = [];

        usersData.forEach((user) => {
          if (user.role === 2 && !admin) {
            admin = user;
          } else if (user.role === 0) {
            tenants.push({
              _id: user._id,
              name: user.name,
              email: user.email,
              phoneNo: user.phoneNo,
              dateCreated: user.dateCreated,
              companyId: user.companyId,
            });
          } else if (user.role === 1) {
            hcms.push({
              _id: user._id,
              name: user.name,
              email: user.email,
              phoneNo: user.phoneNo,
            });
          }
        });

        if (!admin) {
          return null;
        }

        const adminDetails = {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          phoneNo: admin.phoneNo,
          password: admin.password,
          createdAt: admin.createdAt,
          companyId: admin.companyId,
          subscription_status: admin.subscription_status || 'trial',
          trial_start_date: admin.trial_start_date,
          trial_end_date: admin.trial_end_date,
          subscription_start_date: admin.subscription_start_date,
          subscription_end_date: admin.subscription_end_date,
          is_active: admin.is_active !== undefined ? admin.is_active : true,
        };

        const childAdminAccounts = childAdminsByAdmin[admin._id.toString()] || [];

        return {
          company: {
            id: company._id,
            name: company.companyName,
          },
          admin: adminDetails,
          childAdminAccounts: childAdminAccounts,
          tenantsCount: tenants.length,
          hcmsCount: hcms.length,
          tenants,
          hcms,
        };
      })
      .filter((report) => report !== null);

    res.status(200).json({
      success: true,
      message: 'Company reports fetched successfully',
      response: companyReports,
    });
  } catch (error) {
    console.error('Error fetching company reports:', error);
    res
      .status(500)
      .json({ success: false, message: 'Server error', error: error.message });
  }
};

const isPasswordHashed = (password) => {
  // Assuming bcrypt hashes are 60 characters long
  return password && password.length === 60;
};

// Update company data
const updateCompanyData = async (req, res) => {
  // This function updates the admin's data, company information, and subscription details

  const {
    adminId,
    // Admin basic info
    adminName,
    adminEmail,
    adminPhoneNo,
    adminPassword,
    firstName,
    lastName,
    state,
    city,
    timezone,
    // Company info
    companyName,
    // Subscription-related fields (accept both subscription_type and subscription_status)
    subscription_status,
    subscription_type,
    subscription_start_date,
    subscription_end_date,
    trial_start_date,
    trial_end_date,
    is_active,
    deactivation_reason,
    durationMonths,
    // Company address fields
    addressLine1,
    addressLine2,
    companyCity,
    zipCode,
    taxId,
    // Contact details (accept both formats)
    officePhoneNumber,
    cellPhoneNumber,
    primaryEmailAddress,
    primaryEmail,
    alternateEmailAddress,
    alternateEmail,
    // Additional setup fields
    federalTaxId,
    idnpiUmpi,
    npiUmpi,
    taxonomy,
    // MNITS Login (accept both formats)
    mnitsUsername,
    mnitsPassword,
    mnitsLogin,
    // Waystar Login (accept both formats)
    waystarUsername,
    waystarPassword,
    waystarLogin,
    // Banking Info - accept both nested and flat formats
    nameOnCard,
    cardNumber,
    expiryDate,
    cvv,
    billingAddressLine1,
    billingAddress,
    billingAddressLine2,
    billingCity,
    billingState,
    billingZipCode,
    bankDetails,
  } = req.body;

  try {
    const admin = await Users.findOne({ _id: adminId });

    if (!admin) {
      return res
        .status(400)
        .json({ success: false, message: 'Admin not found' });
    }

    console.log('=== UPDATE CLIENT DETAILS DEBUG ===');
    console.log('Current subscription_status:', admin.subscription_status);
    console.log('Received subscription_type:', subscription_type);
    console.log('Received subscription_status:', subscription_status);

    // Normalize field names (accept both formats from frontend)
    const subscriptionStatus = subscription_status || subscription_type;
    console.log('Final subscriptionStatus to use:', subscriptionStatus);

    const primaryEmailAddr = primaryEmailAddress || primaryEmail;
    const alternateEmailAddr = alternateEmailAddress || alternateEmail;
    const npiUmpiValue = idnpiUmpi || npiUmpi;

    // Handle nested login objects
    const mnitsUser = mnitsUsername || mnitsLogin?.username;
    const mnitsPass = mnitsPassword || mnitsLogin?.password;
    const waystarUser = waystarUsername || waystarLogin?.username;
    const waystarPass = waystarPassword || waystarLogin?.password;

    // Handle nested bank details object
    const bankName = nameOnCard || bankDetails?.nameOnCard;
    const bankCard = cardNumber || bankDetails?.cardNumber;
    const bankExpiry = expiryDate || bankDetails?.expiryDate;
    const bankCvv = cvv || bankDetails?.cvv;
    const bankBillingAddr = billingAddressLine1 || billingAddress || bankDetails?.billingAddress;
    const bankBillingCity = billingCity || bankDetails?.billingCity;
    const bankBillingState = billingState || bankDetails?.billingState;
    const bankBillingZip = billingZipCode || bankDetails?.billingZipCode;

    console.log('Bank details extracted:', { bankName, bankCard, bankExpiry });

    // Validate bank details if subscription status is being set to 'subscribed'
    if (subscriptionStatus === 'subscribed') {
      // Check existing accountSetup for bank details
      const existingAccountSetup = await accountSetup.findOne({ adminId });

      const missingBankFields = [];
      if (!bankName && !existingAccountSetup?.bankingInfo?.nameOnCard) {
        missingBankFields.push('nameOnCard');
      }
      if (!bankCard && !existingAccountSetup?.bankingInfo?.cardNumber) {
        missingBankFields.push('cardNumber');
      }
      if (!bankExpiry && !existingAccountSetup?.bankingInfo?.expiryDate) {
        missingBankFields.push('expiryDate');
      }

      if (missingBankFields.length > 0) {
        console.log('Missing bank fields:', missingBankFields);
        return res.status(400).json({
          success: false,
          message: 'Bank details are required for subscribed status',
          missingFields: missingBankFields,
        });
      }
      console.log('Bank validation passed!');
    }

    // Prepare updated user fields
    const updatedAdmin = {
      name: adminName || admin.name,
      email: adminEmail || admin.email,
      phoneNo: adminPhoneNo || cellPhoneNumber || admin.phoneNo,
    };

    // Update optional fields if provided
    if (state !== undefined) updatedAdmin.state = state;
    if (city !== undefined) updatedAdmin.city = city;
    if (timezone !== undefined) updatedAdmin.timezone = timezone;

    // Handle subscription status updates
    if (subscriptionStatus !== undefined) {
      console.log('Processing subscription status update...');
      const validStatuses = ['trial', 'subscribed', 'cancelled', 'expired'];
      if (!validStatuses.includes(subscriptionStatus)) {
        return res.status(400).json({
          success: false,
          message: `Invalid subscription status. Must be one of: ${validStatuses.join(', ')}`,
        });
      }
      updatedAdmin.subscription_status = subscriptionStatus;
      console.log('Set updatedAdmin.subscription_status to:', subscriptionStatus);

      // Set appropriate dates based on status
      if (subscriptionStatus === 'subscribed') {
        const startDate = subscription_start_date || admin.subscription_start_date || new Date();
        updatedAdmin.subscription_start_date = startDate;

        // Calculate end date based on duration or use provided end date
        if (subscription_end_date) {
          updatedAdmin.subscription_end_date = subscription_end_date;
        } else if (durationMonths) {
          const endDate = new Date(startDate);
          endDate.setMonth(endDate.getMonth() + parseInt(durationMonths));
          updatedAdmin.subscription_end_date = endDate;
        } else if (!admin.subscription_end_date) {
          // Default to 12 months if no end date exists
          const endDate = new Date(startDate);
          endDate.setFullYear(endDate.getFullYear() + 1);
          updatedAdmin.subscription_end_date = endDate;
        }

        // Activate the account when subscribed
        updatedAdmin.is_active = true;
        updatedAdmin.deactivation_date = null;
        updatedAdmin.deactivation_reason = null;
      }

      if (subscriptionStatus === 'cancelled') {
        updatedAdmin.is_active = false;
        updatedAdmin.deactivation_date = new Date();
        if (deactivation_reason) {
          updatedAdmin.deactivation_reason = deactivation_reason;
        }
      }

      if (subscriptionStatus === 'expired') {
        updatedAdmin.is_active = false;
      }

      if (subscriptionStatus === 'trial') {
        const trialStart = trial_start_date || admin.trial_start_date || new Date();
        updatedAdmin.trial_start_date = trialStart;

        if (trial_end_date) {
          updatedAdmin.trial_end_date = trial_end_date;
        } else if (!admin.trial_end_date) {
          // Default 14 days trial
          const trialEnd = new Date(trialStart);
          trialEnd.setDate(trialEnd.getDate() + 14);
          updatedAdmin.trial_end_date = trialEnd;
        }
      }
    }

    // Update subscription dates if explicitly provided
    if (subscription_start_date !== undefined) {
      updatedAdmin.subscription_start_date = subscription_start_date;
    }
    if (subscription_end_date !== undefined) {
      updatedAdmin.subscription_end_date = subscription_end_date;
    }
    if (trial_start_date !== undefined) {
      updatedAdmin.trial_start_date = trial_start_date;
    }
    if (trial_end_date !== undefined) {
      updatedAdmin.trial_end_date = trial_end_date;
    }

    // Update active status
    if (is_active !== undefined) {
      updatedAdmin.is_active = is_active;
      if (!is_active) {
        updatedAdmin.deactivation_date = new Date();
        if (deactivation_reason) {
          updatedAdmin.deactivation_reason = deactivation_reason;
        }
      } else {
        // Reactivating the account
        updatedAdmin.deactivation_date = null;
        updatedAdmin.deactivation_reason = null;
      }
    }

    // Update password only if provided
    if (adminPassword) {
      const isHashed = isPasswordHashed(adminPassword);
      updatedAdmin.password = isHashed
        ? adminPassword
        : await bcrypt.hash(adminPassword, 10);
    }

    // Update admin document
    console.log('Updating admin with data:', updatedAdmin);
    const updatedAdminDocument = await Users.findOneAndUpdate(
      { _id: adminId },
      updatedAdmin,
      { new: true }
    ).select('-password'); // Don't send password back in response

    console.log('Updated admin subscription_status:', updatedAdminDocument.subscription_status);
    console.log('Admin document updated successfully!');

    // Update company information if provided and admin has a company
    let updatedCompany = null;
    if (admin.companyId) {
      const companyUpdateData = {};

      if (companyName) companyUpdateData.companyName = companyName;
      if (adminName) companyUpdateData.adminName = adminName;
      if (adminEmail) companyUpdateData.adminEmail = adminEmail;
      if (taxId !== undefined || federalTaxId !== undefined) {
        companyUpdateData.taxId = taxId || federalTaxId;
      }

      // Update company address if any address field is provided
      const existingCompany = await Company.findById(admin.companyId);
      if (addressLine1 || addressLine2 || city || state || zipCode) {
        companyUpdateData.address = {
          ...(existingCompany?.address || {}),
          ...(addressLine1 !== undefined && { addressLine1 }),
          ...(addressLine2 !== undefined && { addressLine2 }),
          ...(city !== undefined && { city }),
          ...(state !== undefined && { state }),
          ...(zipCode !== undefined && { zipCode }),
        };
      }

      if (Object.keys(companyUpdateData).length > 0) {
        updatedCompany = await Company.findByIdAndUpdate(
          admin.companyId,
          companyUpdateData,
          { new: true }
        );
      }
    }

    // Update or create accountSetup document
    let updatedAccountSetup = null;
    const accountSetupUpdateData = {};

    // Basic info
    if (firstName !== undefined) accountSetupUpdateData.firstName = firstName;
    if (lastName !== undefined) accountSetupUpdateData.lastName = lastName;
    if (companyName !== undefined) accountSetupUpdateData.companyName = companyName;
    if (adminEmail !== undefined || primaryEmailAddr !== undefined) {
      accountSetupUpdateData.email = primaryEmailAddr || adminEmail;
    }

    // Address
    if (addressLine1 || addressLine2 || city || state || zipCode) {
      accountSetupUpdateData.address = {
        ...(addressLine1 !== undefined && { addressLine1 }),
        ...(addressLine2 !== undefined && { addressLine2 }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(zipCode !== undefined && { zipCode }),
      };
    }

    // Contact information
    if (officePhoneNumber || cellPhoneNumber || primaryEmailAddr || alternateEmailAddr) {
      accountSetupUpdateData.contact = {
        ...(officePhoneNumber !== undefined && { officePhoneNumber }),
        ...(cellPhoneNumber !== undefined && { cellPhoneNumber }),
        ...(primaryEmailAddr !== undefined && { primaryEmailAddress: primaryEmailAddr }),
        ...(alternateEmailAddr !== undefined && { alternateEmailAddress: alternateEmailAddr }),
      };
    }

    // Tax and IDs
    if (federalTaxId !== undefined) accountSetupUpdateData.federalTaxId = federalTaxId;
    if (npiUmpiValue !== undefined) accountSetupUpdateData.idnpiUmpi = npiUmpiValue;
    if (taxonomy !== undefined) accountSetupUpdateData.taxonomy = taxonomy;

    // Login information
    if (mnitsUser || mnitsPass) {
      accountSetupUpdateData.mnitsLogin = {
        ...(mnitsUser !== undefined && { username: mnitsUser }),
        ...(mnitsPass !== undefined && { password: mnitsPass }),
      };
    }

    if (waystarUser || waystarPass) {
      accountSetupUpdateData.waystarLogin = {
        ...(waystarUser !== undefined && { username: waystarUser }),
        ...(waystarPass !== undefined && { password: waystarPass }),
      };
    }

    // Banking information
    if (bankName || bankCard || bankExpiry || bankCvv || bankBillingAddr || billingAddressLine2 || bankBillingCity || bankBillingState || bankBillingZip) {
      accountSetupUpdateData.bankingInfo = {
        ...(bankName !== undefined && { nameOnCard: bankName }),
        ...(bankCard !== undefined && { cardNumber: bankCard }),
        ...(bankExpiry !== undefined && { expiryDate: bankExpiry }),
        ...(bankCvv !== undefined && { cvv: bankCvv }),
      };

      if (bankBillingAddr || billingAddressLine2 || bankBillingCity || bankBillingState || bankBillingZip) {
        accountSetupUpdateData.bankingInfo.billingAddress = {
          ...(bankBillingAddr !== undefined && { addressLine1: bankBillingAddr }),
          ...(billingAddressLine2 !== undefined && { addressLine2: billingAddressLine2 }),
          ...(bankBillingCity !== undefined && { city: bankBillingCity }),
          ...(bankBillingState !== undefined && { state: bankBillingState }),
          ...(bankBillingZip !== undefined && { zipCode: bankBillingZip }),
        };
      }
    }

    // Update or create accountSetup
    if (Object.keys(accountSetupUpdateData).length > 0) {
      const existingAccountSetup = await accountSetup.findOne({ adminId });

      if (existingAccountSetup) {
        // Merge with existing data
        updatedAccountSetup = await accountSetup.findOneAndUpdate(
          { adminId },
          { $set: accountSetupUpdateData },
          { new: true }
        );
      } else {
        // Create new accountSetup
        accountSetupUpdateData.adminId = adminId;
        updatedAccountSetup = await accountSetup.create(accountSetupUpdateData);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Client details updated successfully',
      response: {
        admin: updatedAdminDocument,
        company: updatedCompany,
        accountSetup: updatedAccountSetup,
        subscriptionStatus: updatedAdminDocument.subscription_status,
        isActive: updatedAdminDocument.is_active,
        trialEndDate: updatedAdminDocument.trial_end_date,
        subscriptionEndDate: updatedAdminDocument.subscription_end_date,
      },
    });
    console.log('=== UPDATE COMPLETE ===');
  } catch (error) {
    console.error('Error updating client details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export default updateCompanyData;

//delete company
const deleteCompany = async (req, res) => {
  const { companyId } = req.params;
  const companyObjectId = new mongoose.Types.ObjectId(companyId);
  try {
    await Company.findOneAndDelete({ _id: companyObjectId });
    await Users.deleteMany({ companyId: companyObjectId });
    await childAdminAccount.deleteMany({ companyId: companyObjectId });
    await settings.deleteMany({ companyId: companyObjectId });
    res
      .status(200)
      .json({ success: true, message: 'Company deleted successfully' });
  } catch (error) {
    console.error('Error deleting company:', error);
    res
      .status(500)
      .json({ success: false, message: 'Server error', error: error.message });
  }
};

//superadmin data
const getSuperAdminData = async (req, res) => {
  const { adminId } = req.params;
  try {
    const adminObjectId = new mongoose.Types.ObjectId(adminId);
    const superAdmin = await Users.findOne({ _id: adminObjectId });
    res.status(200).json({
      success: true,
      message: 'Superadmin data fetched successfully',
      response: superAdmin,
    });
  } catch (error) {
    console.error('Error fetching superadmin data:', error);
    res
      .status(500)
      .json({ success: false, message: 'Server error', error: error.message });
  }
};

const getAllVisitsCount = async (req, res) => {
  try {
    // Fetch all visits
    const visits = await Visits.find().populate(
      'companyId',
      'companyName adminName'
    );

    const companyCounts = {};

    visits.forEach((visit) => {
      const companyId = visit.companyId?._id?.toString();
      const companyName = visit.companyId?.companyName || 'Unknown';
      const adminName = visit.companyId?.adminName || 'Unknown';

      if (!companyCounts[companyId]) {
        companyCounts[companyId] = {
          companyId,
          companyName,
          adminName,
          status: { pending: 0, approved: 0, rejected: 0 },
          signature: { done: 0, 'not done': 0 },
          methodOfContact: { 'in-person': 0, remote: 0 },
          totalVisits: 0,
        };
      }

      companyCounts[companyId].totalVisits++;

      if (
        visit.status &&
        companyCounts[companyId].status[visit.status] !== undefined
      ) {
        companyCounts[companyId].status[visit.status]++;
      }

      if (
        visit.signature &&
        companyCounts[companyId].signature[visit.signature] !== undefined
      ) {
        companyCounts[companyId].signature[visit.signature]++;
      }

      if (
        visit.methodOfContact &&
        companyCounts[companyId].methodOfContact[visit.methodOfContact] !==
        undefined
      ) {
        companyCounts[companyId].methodOfContact[visit.methodOfContact]++;
      }
    });

    res.status(200).json({
      success: true,
      message: 'All companies visit count fetched successfully',
      data: Object.values(companyCounts),
    });
  } catch (error) {
    console.error('Error fetching visits count:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching visits count.',
    });
  }
};

const getAllAppointmentsCount = async (req, res) => {
  try {
    const appointments = await Appointments.find().populate(
      'companyId',
      'companyName adminName'
    );

    const companyCounts = {};

    appointments.forEach((appointment) => {
      const companyId = appointment.companyId?._id;
      const companyName = appointment.companyId?.companyName || 'Unknown';
      const adminName = appointment.companyId?.adminName || 'Unknown';

      if (!companyCounts[companyId]) {
        companyCounts[companyId] = {
          companyId,
          companyName,
          adminName,
          totalAppointments: 0,
          status: {
            pending: 0,
            completed: 0,
            cancelled: 0,
          },
          methodOfContact: {
            'in-person': 0,
            remote: 0,
          },
        };
      }

      companyCounts[companyId].totalAppointments++;

      if (
        appointment.status &&
        companyCounts[companyId].status[appointment.status] !== undefined
      ) {
        companyCounts[companyId].status[appointment.status]++;
      }

      if (
        appointment.methodOfContact &&
        companyCounts[companyId].methodOfContact[
        appointment.methodOfContact
        ] !== undefined
      ) {
        companyCounts[companyId].methodOfContact[appointment.methodOfContact]++;
      }
    });

    const result = Object.values(companyCounts);

    res.status(200).json({
      success: true,
      message: 'Appointments count fetched successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error fetching appointments count:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching appointment counts.',
    });
  }
};

const getAllTenantsCount = async (req, res) => {
  try {
    const tenantsCount = await Users.aggregate([
      {
        $match: { role: 0 }, // Only consider tenants
      },
      {
        $group: {
          _id: '$companyId', // Group by company
          companyName: { $first: '$companyName' }, // Get company name
          totalTenants: { $sum: 1 }, // Count total tenants
          movedOutTenants: { $sum: { $cond: ['$movedOut', 1, 0] } }, // Count moved-out tenants
          activeTenants: { $sum: { $cond: ['$movedOut', 0, 1] } }, // Count active tenants
        },
      },
      {
        $sort: { totalTenants: -1 }, // Sort by total tenants (optional)
      },
    ]);

    res.status(200).json({ success: true, data: tenantsCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export {
  getCompanyReports,
  updateCompanyData,
  deleteCompany,
  getSuperAdminData,
  getAllVisitsCount,
  getAllAppointmentsCount,
  getAllTenantsCount,
};
