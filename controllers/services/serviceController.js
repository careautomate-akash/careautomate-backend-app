import Service from '../../models/services/services.js';
import SubActivity from '../../models/services/subactivities.js';
import Company from '../../models/account/company.js';
import { servicesClient } from '../../models/services/services-client.js';
import message from '../../models/communication-documents/message.js';
import users from '../../models/account/users.js';
import accountSetup from '../../models/account/accountSetup.js';

function toArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v)
    .split(/,| or /i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const createServicesBulk = async (req, res) => {
  const { user } = req;
  const company = await Company.findOne({
    adminId: user._id,
  });

  try {
    if (!Array.isArray(req.body) || req.body.length === 0) {
      return res
        .status(400)
        .json({ message: 'Body must be a non-empty array' });
    }

    const items = req.body.map((raw, idx) => {
      const payload = {
        service_name: raw.service_name,
        service_type: raw.service_type,
        service_duration: raw.service_duration,
        service_procedure_code: raw.service_procedure_code,
        service_modifiers: toArray(raw.service_modifiers),
        service_rate: raw.service_rate,
        default_units: raw.default_units,
        visit_frequency: toArray(raw.visit_frequency),
        covered_parent_activities: toArray(raw.covered_parent_activities),
        place_of_service: toArray(raw.place_of_service),
        state_of_service: raw.state_of_service,

        sub_activities: Array.isArray(raw.sub_activities)
          ? raw.sub_activities
          : [],
        company: company._id,
      };

      const required = [
        'service_name',
        'service_type',
        'service_duration',
        'service_procedure_code',
        'service_rate',
        'state_of_service',
      ];
      const errors = [];
      for (const field of required) {
        if (!payload[field] && payload[field] !== 0) {
          errors.push(`Field '${field}' is required`);
        }
      }
      if (!payload.visit_frequency.length) {
        errors.push('visit_frequency must have at least one value');
      }
      if (typeof payload.service_rate !== 'number') {
        errors.push('service_rate must be a number');
      }

      return { payload, idx, errors };
    });

    const invalid = items.filter((x) => x.errors.length > 0);
    if (invalid.length) {
      return res.status(400).json({
        message: 'Validation failed for some items',
        errors: invalid.map((x) => ({
          index: x.idx,
          errors: x.errors,
          item: req.body[x.idx],
        })),
      });
    }

    // Insert services first
    const serviceDocs = await Service.insertMany(
      items.map((x) => {
        const { sub_activities, ...serviceData } = x.payload;
        return serviceData;
      }),
      { ordered: false }
    );

    // Now create sub_activities linked to each inserted service
    for (let i = 0; i < serviceDocs.length; i++) {
      const insertedService = serviceDocs[i];
      const originalPayload = items[i].payload;
      if (originalPayload.sub_activities?.length) {
        for (const sub of originalPayload.sub_activities) {
          await SubActivity.create({
            parent_activity: sub.parent,
            sub_activities: sub.subs,
            service: insertedService._id,
            company: company._id,
          });
        }
      }
    }

    return res.status(201).json({
      message: 'Bulk insert complete',
      insertedCount: serviceDocs.length,
    });
  } catch (err) {
    console.error('createServicesBulk error:', err);
    return res.status(500).json({
      message: 'Internal server error',
      error: err.message,
    });
  }
};

export const createService = async (req, res) => {
  try {
    //   const company = await Company.findOne({
    //   adminId: req.user._id,
    // });

    const payload = {
      service_name: req.body.service_name,
      service_type: req.body.service_type,
      service_duration: req.body.service_duration,
      service_procedure_code: req.body.service_procedure_code,
      service_modifiers: toArray(req.body.service_modifiers),
      service_rate: req.body.service_rate,
      default_units: req.body.default_units,
      visit_frequency: toArray(req.body.visit_frequency),
      covered_parent_activities: toArray(req.body.covered_parent_activities),
      place_of_service: toArray(req.body.place_of_service),
      state_of_service: req.body.state_of_service,
      // company: company._id,
    };

    // Basic validations
    const required = [
      'service_name',
      'service_type',
      'service_duration',
      'service_procedure_code',
      'service_rate',
      'state_of_service',
    ];
    for (const field of required) {
      if (!payload[field] && payload[field] !== 0) {
        return res
          .status(400)
          .json({ message: `Field '${field}' is required` });
      }
    }
    if (!payload.visit_frequency.length) {
      return res
        .status(400)
        .json({ message: 'visit_frequency must have at least one value' });
    }
    // if (!payload.place_of_service.length) {
    //   return res
    //     .status(400)
    //     .json({ message: 'place_of_service must have at least one value' });
    // }

    // Create service
    const serviceDoc = await Service.create(payload);

    // If sub_activities array exists, save them in SubActivity collection
    if (
      Array.isArray(req.body.sub_activities) &&
      req.body.sub_activities.length > 0
    ) {
      for (const sa of req.body.sub_activities) {
        if (!sa.parent || !Array.isArray(sa.subs) || sa.subs.length === 0) {
          continue; // skip invalid entries
        }

        await SubActivity.findOneAndUpdate(
          {
            parent_activity: sa.parent,
            service: serviceDoc._id,
            // company: company._id,
          },
          { sub_activities: sa.subs },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
      }
    }

    return res.status(201).json({
      message: 'Service created successfully',
      data: serviceDoc,
    });
  } catch (err) {
    console.error('createService error:', err);
    return res
      .status(500)
      .json({ message: 'Internal server error', error: err.message });
  }
};

export const getAllServices = async (req, res) => {
  try {
    const user_id = req.user?._id;

    if (!user_id) {
      return res.status(401).json({ message: 'Unauthorized: Missing user ID' });
    }

    const userDetails = await users.findById(user_id);
    if (!userDetails) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userState = userDetails.state;
    if (!userState) {
      return res.status(400).json({ message: 'Unable to fetch user state' });
    }
    const list = await Service.find({ state_of_service: userState }).sort({
      createdAt: -1,
    });

    return res.status(200).json(list);
  } catch (err) {
    console.error('getAllServices error:', err);
    return res
      .status(500)
      .json({ message: 'Internal server error', error: err.message });
  }
};

export const getAllServicesAdmin = async (req, res) => {
  try {
    const list = await Service.find().sort({ createdAt: -1 });

    return res.status(200).json(list);
  } catch (err) {
    console.error('getAllServices error:', err);
    return res
      .status(500)
      .json({ message: 'Internal server error', error: err.message });
  }
};

export const getServiceById = async (req, res) => {
  try {
    const doc = await Service.findById(req.params.serviceId);
    if (!doc) return res.status(404).json({ message: 'Service not found' });
    return res.status(200).json(doc);
  } catch (err) {
    console.error('getServiceById error:', err);
    return res
      .status(500)
      .json({ message: 'Internal server error', error: err.message });
  }
};

export const updateService = async (req, res) => {
  try {
    const payload = { ...req.body };

    // Format array fields
    if (payload.service_modifiers !== undefined)
      payload.service_modifiers = toArray(payload.service_modifiers);
    if (payload.visit_frequency !== undefined)
      payload.visit_frequency = toArray(payload.visit_frequency);
    if (payload.covered_parent_activities !== undefined)
      payload.covered_parent_activities = toArray(
        payload.covered_parent_activities
      );
    if (payload.place_of_service !== undefined)
      payload.place_of_service = toArray(payload.place_of_service);

    // Extract sub_activities separately
    const subActivities = Array.isArray(payload.sub_activities)
      ? payload.sub_activities
      : [];
    delete payload.sub_activities; // avoid storing inside Service model

    // Update main service
    const updatedService = await Service.findByIdAndUpdate(
      req.params.serviceId,
      payload,
      { new: true }
    );

    if (!updatedService) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Handle sub_activities update
    if (subActivities.length) {
      for (const sa of subActivities) {
        if (!sa.parent) continue;

        if (Array.isArray(sa.subs) && sa.subs.length > 0) {
          // Update or insert sub-activities
          await SubActivity.findOneAndUpdate(
            {
              parent_activity: sa.parent,
              service: updatedService._id,
              company: updatedService.company,
            },
            { sub_activities: sa.subs },
            { new: true, upsert: true, setDefaultsOnInsert: true }
          );
        } else {
          // If subs array is empty, remove the record
          await SubActivity.findOneAndDelete({
            parent_activity: sa.parent,
            service: updatedService._id,
            company: updatedService.company,
          });
        }
      }
    }

    return res.status(200).json({
      message: 'Service and sub-activities updated successfully',
      data: updatedService,
    });
  } catch (err) {
    console.error('updateService error:', err);
    return res.status(500).json({
      message: 'Internal server error',
      error: err.message,
    });
  }
};

export const deleteService = async (req, res) => {
  try {
    const serviceId = req.params.serviceId;
    const service = await Service.findOne({ _id: serviceId });
    if (!service) {
      return res
        .status(404)
        .json({ message: 'Service not found or unauthorized' });
    }

    await Service.findByIdAndDelete(serviceId);

    return res.status(200).json({ message: 'Service deleted' });
  } catch (err) {
    console.error('deleteService error:', err);
    return res
      .status(500)
      .json({ message: 'Internal server error', error: err.message });
  }
};

export const addSubActivity = async (req, res) => {
  try {
    const { sub_activities, parent_activity, service, company } = req.body;

    if (!parent_activity || !service || !company) {
      return res.status(400).json({
        message: 'Parent activity, service, and company are required',
      });
    }
    if (!Array.isArray(sub_activities) || sub_activities.length === 0) {
      return res
        .status(400)
        .json({ message: 'Sub-activities must be a non-empty array' });
    }

    const companyData = await Company.findById(company);
    if (!companyData) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const serviceData = await Service.findById(service);
    if (!serviceData) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Update if exists, else create
    const updatedSubActivity = await SubActivity.findOneAndUpdate(
      { parent_activity, service, company },
      { sub_activities },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      message: 'Sub-activities updated successfully',
      data: updatedSubActivity,
    });
  } catch (err) {
    console.error('addSubActivity error:', err);
    return res
      .status(500)
      .json({ message: 'Internal server error', error: err.message });
  }
};

export const getSubActivitiesByService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const subActivities = await SubActivity.find({ service: serviceId });
    return res.status(200).json(subActivities);
  } catch (err) {
    console.error('getSubActivitiesByService error:', err);
    return res
      .status(500)
      .json({ message: 'Internal server error', error: err.message });
  }
};

export const getProcedureAndTypeFromServiceName = async (req, res) => {
  const { serviceName, companyId } = req.body;

  try {
    const service = await Service.findOne({
      service_name: serviceName,
      company: companyId, // 🔑 ensure scoped to company
    }).select('service_procedure_code service_type');

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found',
      });
    }

    res.status(200).json({
      success: true,
      response: {
        procedureCodeId: service.service_procedure_code,
        serviceTypeName: service.service_type,
      },
    });
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export const getProcedureCodeAndModifierFromDB = async (
  serviceId,
  methodOfContact = ''
) => {
  try {
    if (!serviceId) {
      throw new Error('serviceId is required');
    }

    // Fetch the service details from DB
    const service = await Service.findById(serviceId).select(
      'service_procedure_code service_modifiers service_name service_type'
    );

    if (!service) {
      console.warn(
        `Service not found for id: ${serviceId}, returning default fallback`
      );
      return {
        code: 'H2015',
        modifiers: ['U8'],
        formattedString: 'H2015 U8',
        displayName: 'Housing Transition',
        abbreviation: 'HT',
        procedureCodeId: 'H2015_U8',
      };
    }

    // Extract values
    const baseCode = service.service_procedure_code;
    let modifiers = [...(service.service_modifiers || [])];

    // Add U4 for remote services
    const isRemote =
      methodOfContact &&
      typeof methodOfContact === 'string' &&
      methodOfContact.toLowerCase().includes('remote');

    if (isRemote) {
      modifiers.push('U4');
    }

    const formattedString = `${baseCode} ${modifiers.join(' ')}`;

    return {
      code: baseCode,
      modifiers,
      formattedString,
      displayName: service.service_name,
      abbreviation: service.service_type, // assuming this is short like "HT"
      procedureCodeId: `${baseCode}_${modifiers.join('_')}`,
      isRemote,
    };
  } catch (error) {
    console.error('Error in getProcedureCodeAndModifierFromDB:', error);
    return {
      code: 'H2015',
      modifiers: ['U8'],
      formattedString: 'H2015 U8',
      displayName: 'Housing Transition',
      abbreviation: 'HT',
      procedureCodeId: 'H2015_U8',
    };
  }
};

// export const createClientService = async (req, res) => {
//   try {
//     const { serviceId } = req.body;
//     const user_id = req.user._id;

//     if(!user_id){
//       res.status(400).json({message:"something went wrong!!"})
//     }

//     const existingClientService = await servicesClient.findOne({
//       service_id: serviceId,
//       user_id,
//     });

//     if (existingClientService) {
//       return res.status(400).json({ message: "User already has this service" });
//     }

//     const serviceExists = await Service.findById(serviceId);
//     if (!serviceExists) {
//       return res.status(404).json({ message: "Service not found" });
//     }

//     const user_details = await users.findOne({_id:user_id})

//     if(user_details.state!==serviceExists.state_of_service){
//       return res.status(400).json({
//         message:"Service and State Mismatch"
//       })
//     }

//     const newService = new servicesClient({
//       user_id,
//       service_id: serviceId,
//     });

//     await newService.save();
//     return res.status(201).json({ message: "Service added successfully", data: serviceExists });
//   } catch (err) {
//     console.error("createClientService error:", err);
//     return res.status(500).json({ message: "Internal server error", error: err.message });
//   }
// };

export const getClientServices = async (req, res) => {
  try {
    const user_id = req.user._id;

    // console.log('User details',user)

    // const userSubscribedServices = await servicesClient
    //   .find({ user_id })
    //   .populate('service_id');
    // const servicesAvailableForuserState = await Service.find

    const accountSetupData = await accountSetup.findOne({
      adminId: user_id,
    });

    // const user_details = await users.findOne({ _id: user_id });
    // if (!user_details) {
    //   return res.status(404).json({
    //     message: "User not found"
    //   });
    // }

    // console.log("user state",user_details.state)

    const servicesAvailableForuserState = await Service.find({
      state_of_service: accountSetupData.address.state,
    });
    // if (!userSubscribedServices || userSubscribedServices.length === 0) {
    //   return res.status(404).json({ message: "User has no subscribed services" });
    // }

    // const servicesData = userSubscribedServices.map((each)=>each.service_id)

    return res.status(200).json({
      message: 'Subscribed services retrieved successfully',
      data: servicesAvailableForuserState,
    });
  } catch (error) {
    console.error('getClientServices error:', error);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// export const removeClientServices = async (req, res) => {
//   try {
//     const user_id = req.user._id;
//     const service_id = req.body.data.serviceId;

//     if (!user_id || !service_id) {
//       return res.status(400).json({
//         success: false,
//         message: 'Missing user_id or service_id'
//       });
//     }

//     const userSubscribedService = await servicesClient.findOne({ user_id, service_id });

//     if (!userSubscribedService) {
//       return res.status(404).json({
//         success: false,
//         message: 'Service not found for user'
//       });
//     }

//     await servicesClient.deleteOne({ _id: userSubscribedService._id });

//     return res.status(200).json({
//       message: 'Service removed successfully',

//     });
//   } catch (error) {
//     console.error('removeClientServices error:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Internal server error'
//     });
//   }
// };
