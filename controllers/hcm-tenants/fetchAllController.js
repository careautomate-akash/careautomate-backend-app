import mongoose from 'mongoose';
import users from '../../models/account/users.js';
import hcmInfo from '../../models/hcm-tenants/hcmInfo.js';
import tenantInfo from '../../models/hcm-tenants/tenantInfo.js';
import ServiceTracking from '../../models/bills/serviceTracking.js';
import tenantAssignedtoHcm from '../../models/hcm-tenants/tenantAssignedtoHcm.js';
import hcmAssignedToTenant from '../../models/hcm-tenants/hcmAssignedToTenant.js';

export const getAllHCMsTenants = async (req, res) => {
  const companyId = req.query.companyId;
  try {
    // Convert companyId to ObjectId using 'new'
    const companyIdObject = new mongoose.Types.ObjectId(companyId);

    // Find users with the specified companyId
    const allData = await users.find({ companyId: companyIdObject });

    const formattedData = {
      hcm: [],
      tenants: [],
      tenantCities: new Set(),
      tenantInsurance: new Set(),
      hcmCities: new Set(),
    };

    for (const user of allData) {
      const { password, role, info_id, ...userData } = user._doc; // Exclude password and role

      let additionalData = null;

      if (role === 1) {
        // Fetch HCM details from the hcmInfo model using the `info_id`
        additionalData = await hcmInfo.findById(info_id).lean();

        // Collect HCM city info
        if (additionalData) {
          formattedData.hcmCities.add(additionalData.addressInfo?.city);
        }

        formattedData.hcm.push({
          ...userData,
          hcmData: additionalData,
        });
      } else if (role === 0) {
        // Fetch tenant details from the info model using the `info_id`
        additionalData = await tenantInfo.findById(info_id).lean();

        // Fetch service tracking data for the tenant
        const serviceTrackingData = await ServiceTracking.find({
          tenantId: user._id,
        }).lean();

        // Collect tenant city and insurance info
        if (additionalData) {
          formattedData.tenantCities.add(additionalData.address?.city);
          formattedData.tenantInsurance.add(
            additionalData.admissionInfo.insurance
          );
        }

        formattedData.tenants.push({
          ...userData,
          tenantData: additionalData,
          servicesInfo: {
            tags: serviceTrackingData.map((data) => data.serviceType), // Example of tags
            details: serviceTrackingData, // Detailed documents
          },
        });
      }
    }

    // Convert sets to arrays for the response
    formattedData.tenantCities = Array.from(formattedData.tenantCities);
    formattedData.tenantInsurance = Array.from(formattedData.tenantInsurance);
    formattedData.hcmCities = Array.from(formattedData.hcmCities);

    res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    console.error('Error fetching HCMs and tenants:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getUserContacts = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid userId is required',
      });
    }

    const user = await users.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    let response = {
      success: true,
      message: 'User contacts fetched successfully',
      admin: [],
      hcms: [],
      tenants: [],
    };

    if (user.role === 2) {
      response.hcms = await users
        .find({
          role: 1,
          companyId: user.companyId,
        })
        .select('_id name');

      response.tenants = await users
        .find({
          role: 0,
          companyId: user.companyId,
          movedOut: false,
        })
        .select('_id name');
    } else if (user.role === 1) {
      response.admin = await users
        .find({
          role: 2,
          companyId: user.companyId,
        })
        .select('_id name');

      const assignedTenantsDoc = await tenantAssignedtoHcm.findOne({
        hcmId: userId,
      });
      if (assignedTenantsDoc?.tenantIds?.length) {
        response.tenants = await users
          .find({
            _id: { $in: assignedTenantsDoc.tenantIds },
            movedOut: false,
          })
          .select('_id name');

        const mutualHcmIds = new Set();

        for (const tenantId of assignedTenantsDoc.tenantIds) {
          const tenantHcms = await hcmAssignedToTenant.findOne({ tenantId });
          tenantHcms?.hcmIds?.forEach((hcmId) => {
            if (hcmId.toString() !== userId.toString()) {
              mutualHcmIds.add(hcmId.toString());
            }
          });
        }

        if (mutualHcmIds.size > 0) {
          response.hcms = await users
            .find({
              _id: {
                $in: Array.from(mutualHcmIds).map(
                  (id) => new mongoose.Types.ObjectId(id)
                ),
              },
            })
            .select('_id name');
        }
      }
    } else if (user.role === 0) {
      response.admin = await users
        .find({
          role: 2,
          companyId: user.companyId,
        })
        .select('_id name');

      const assignedHcmsDoc = await hcmAssignedToTenant.findOne({
        tenantId: userId,
      });
      if (assignedHcmsDoc?.hcmIds?.length) {
        response.hcms = await users
          .find({
            _id: { $in: assignedHcmsDoc.hcmIds },
          })
          .select('_id name');

        const mutualTenantIds = new Set();

        for (const hcmId of assignedHcmsDoc.hcmIds) {
          const hcmTenants = await tenantAssignedtoHcm.findOne({ hcmId });
          hcmTenants?.tenantIds?.forEach((tenantId) => {
            if (tenantId.toString() !== userId.toString()) {
              mutualTenantIds.add(tenantId.toString());
            }
          });
        }

        if (mutualTenantIds.size > 0) {
          response.tenants = await users
            .find({
              _id: {
                $in: Array.from(mutualTenantIds).map(
                  (id) => new mongoose.Types.ObjectId(id)
                ),
              },
            })
            .select('_id name');
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported user role',
      });
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in getUserContacts:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving user contacts',
      error: error.message,
    });
  }
};
