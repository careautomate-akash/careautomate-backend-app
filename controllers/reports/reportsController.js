import ServiceTracking from '../../models/bills/serviceTracking.js';
import users from '../../models/account/users.js';
import tenantInfo from '../../models/hcm-tenants/tenantInfo.js';
import Visits from '../../models/appointments-visits/visits.js';
import hcmInfo from '../../models/hcm-tenants/hcmInfo.js';

//tenant reports
const getTenantPersonalInfoReports = async (req, res) => {
  const { companyId } = req.params;

  try {
    // Find all users with role 0 (tenants)
    const tenants = await users
      .find({ role: 0, companyId })
      .select('_id info_id')
      .lean();

    // Initialize an array to hold the tenant details
    const tenantDetails = [];

    // Fetch tenant info for each tenant
    for (const tenant of tenants) {
      const info = await tenantInfo
        .findById(tenant.info_id)
        .select(
          'personalInfo.firstName personalInfo.lastName personalInfo.maPMINumber personalInfo.gender ' +
            'address.city address.state address.zipCode address.addressLine1 address.addressLine2 ' +
            'contactInfo.phoneNumber contactInfo.email ' +
            'designate ' +
            'admissionInfo.insurance admissionInfo.insuranceNumber admissionInfo.diagnosisCode' +
            'caseManager.firstName',
        )
        .lean();

      if (info) {
        tenantDetails.push({
          userId: tenant._id,
          firstName: info.personalInfo?.firstName || 'N/A',
          lastName: info.personalInfo?.lastName || 'N/A',
          pmi: info.personalInfo?.maPMINumber || 'N/A',
          gender: info.personalInfo?.gender || 'N/A',
          addressLine1: info.address?.addressLine1 || 'N/A',
          addressLine2: info.address?.addressLine2 || 'N/A',
          city: info.address?.city || 'N/A',
          state: info.address?.state || 'N/A',
          zipCode: info.address?.zipCode || 'N/A',
          phoneNumber: info.contactInfo?.phoneNumber || 'N/A',
          email: info.contactInfo?.email || 'N/A',
          insurance: info.admissionInfo?.insurance || 'N/A',
          insuranceNumber: info.admissionInfo?.insuranceNumber || 'N/A',
          diagnosisCode: info.admissionInfo?.diagnosisCode || 'N/A',
          caseManager: info.caseManager?.firstName || 'N/A',
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Tenant details fetched successfully',
      response: tenantDetails,
    });
  } catch (error) {
    console.error('Error fetching tenant details:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tenant details',
      error: error.message || error,
    });
  }
};

const getServiceTrackingPlanReports = async (req, res) => {
  const { companyId } = req.params;
  try {
    // Fetch all service tracking records
    const serviceTrackingReports = await ServiceTracking.find({ companyId })
      .populate({
        path: 'tenantId',
        select: '_id name',
        model: 'causers',
      })
      .populate({
        path: 'hcms.hcmId',
        select: '_id name',
        model: 'causers',
      });
    // Format the response
    const formattedReports = serviceTrackingReports.map((report) => ({
      tenantId: report.tenantId ? report.tenantId._id : '',
      tenantName: report.tenantId ? report.tenantId.name : '',
      assignedHCMs: (report.hcms || []).map((hcm) => ({
        hcmId: hcm.hcmId ? hcm.hcmId._id : '',
        hcmName: hcm.hcmId ? hcm.hcmId.name : '',
        workedHours: hcm.workedHours,
        workedUnits: hcm.workedUnits,
        serviceDetails: hcm.serviceDetails.map((detail) => ({
          dateOfService: detail.dateOfService,
          scheduledUnits: detail.scheduledUnits,
          workedUnits: detail.workedUnits,
          methodOfContact: detail.methodOfContact,
          placeOfService: detail.placeOfService,
        })),
      })),
      serviceType: report.serviceTypeName,
      dateRange: `${report.startDate.toISOString().split('T')[0]} to ${
        report.endDate.toISOString().split('T')[0]
      }`,
      scheduledUnits: report.scheduledUnits,
      workedUnits: report.workedUnits,
      remainingUnits: report.unitsRemaining,
    }));

    res.status(200).json({
      success: true,
      message: 'Service tracking reports fetched successfully',
      response: formattedReports,
    });
  } catch (error) {
    console.error('Error fetching service tracking reports:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getTenantVisitComplianceReports = async (req, res) => {
  const { companyId } = req.params;

  try {
    // ✅ Fetch ServiceTracking to get service plan date ranges
    const serviceTrackings = await ServiceTracking.find({ companyId })
      .select('tenantId serviceId startDate endDate')
      .lean();

    // Map: tenantId-serviceId -> { startDate, endDate }
    const planRangeMap = {};
    serviceTrackings.forEach((st) => {
      if (st.tenantId && st.serviceId) {
        const key = `${st.tenantId.toString()}-${st.serviceId.toString()}`;
        planRangeMap[key] = {
          startDate: st.startDate,
          endDate: st.endDate,
        };
      }
    });

    // ✅ Fetch visits
    const visits = await Visits.find({ companyId })
      .populate({
        path: 'tenantId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'hcmId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'serviceId',
        select: '_id service_name service_procedure_code',
        model: 'Service',
      })
      .lean();

    // Grouping visits by Tenant + HCM + Service
    const groupedReports = {};

    visits.forEach((visit) => {
      const tenantId = visit.tenantId?._id?.toString();
      const hcmId = visit.hcmId?._id?.toString();
      const serviceId = visit.serviceId?._id?.toString();

      const tenantName = visit.tenantId
        ? visit.tenantId.name
        : 'Unknown Tenant';
      const hcmName = visit.hcmId ? visit.hcmId.name : 'Unknown HCM';
      const serviceType = visit.serviceId?.service_name || 'Unknown Service';

      // ✅ Use IDs (safer)
      const key = `${tenantId}-${hcmId}-${serviceId}`;

      if (!groupedReports[key]) {
        // ✅ Fetch plan start/end from serviceTracking map
        const planKey = `${tenantId}-${serviceId}`;
        const planRange = planRangeMap[planKey];

        groupedReports[key] = {
          tenantName,
          assignedHCM: hcmName,
          serviceType,
          startDate: planRange?.startDate || null,
          endDate: planRange?.endDate || null,
          methodOfVisitCount: { 'in-person': 0, remote: 0, indirect: 0 },
          visitDurationMinutes: { 'in-person': 0, remote: 0, indirect: 0 },
          totalMileage: 0,
        };
      }

      let durationMinutes = 0;
      if (visit.startTime && visit.endTime) {
        const startTime = new Date(visit.startTime);
        const endTime = new Date(visit.endTime);
        durationMinutes = Math.max((endTime - startTime) / (1000 * 60), 0);
      }

      const methodOfContact = visit.methodOfContact
        ? visit.methodOfContact.toLowerCase().trim()
        : null;

      if (methodOfContact === 'in-person') {
        groupedReports[key].methodOfVisitCount['in-person']++;
        groupedReports[key].visitDurationMinutes['in-person'] +=
          durationMinutes;
      } else if (methodOfContact === 'remote') {
        groupedReports[key].methodOfVisitCount['remote']++;
        groupedReports[key].visitDurationMinutes['remote'] += durationMinutes;
      } else if (methodOfContact === 'indirect') {
        groupedReports[key].methodOfVisitCount['indirect']++;
        groupedReports[key].visitDurationMinutes['indirect'] += durationMinutes;
      }

      const mileage = Number(visit.totalMiles || 0);
      groupedReports[key].totalMileage += mileage;
    });

    const formattedReports = Object.values(groupedReports).map((report) => {
      const totalMethodCount = Object.values(report.methodOfVisitCount).reduce(
        (sum, count) => sum + count,
        0,
      );

      const visitUnits = Object.entries(report.visitDurationMinutes).reduce(
        (units, [method, minutes]) => {
          units[method] = Math.floor(minutes / 15);
          return units;
        },
        {},
      );

      const totalVisitUnits = Object.values(visitUnits).reduce(
        (sum, units) => sum + units,
        0,
      );

      return {
        tenantName: report.tenantName,
        assignedHCM: report.assignedHCM,
        serviceType: report.serviceType,
        dateOfService: {
          // ✅ Plan range instead of first/last visit
          start: report.startDate
            ? new Date(report.startDate).toISOString().split('T')[0]
            : null,
          end: report.endDate
            ? new Date(report.endDate).toISOString().split('T')[0]
            : null,
        },
        methodOfVisit: {
          methods: report.methodOfVisitCount,
          total: totalMethodCount,
        },
        totalVisits: totalMethodCount,
        mileage: report.totalMileage,
        visitUnits,
        totalVisitUnits,
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Grouped tenant visit compliance reports fetched successfully',
      response: formattedReports,
    });
  } catch (error) {
    console.error(
      'Error fetching grouped tenant visit compliance reports:',
      error,
    );
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching grouped reports.',
    });
  }
};

//hcm reports
const getHcmPersonalInfoReports = async (req, res) => {
  const { companyId } = req.params;
  try {
    // Find all users with role 1 (HCMs)
    const hcms = await users
      .find({ role: 1, companyId })
      .select('_id info_id')
      .lean();

    // Initialize an array to hold the HCM details
    const hcmDetails = [];

    // Fetch HCM info for each HCM
    for (const hcm of hcms) {
      const info = await hcmInfo
        .findById(hcm.info_id)
        .select(
          'personalInfo.firstName personalInfo.lastName contactInfo.email addressInfo.addressLine1 addressInfo.city addressInfo.state addressInfo.zipCode employmentInfo.hireDate loginInfo.username',
        )
        .lean();
      if (info) {
        hcmDetails.push({
          userId: hcm._id,
          firstName: info.personalInfo?.firstName || 'N/A',
          lastName: info.personalInfo?.lastName || 'N/A',
          address: info.addressInfo?.addressLine1 || 'N/A',
          city: info.addressInfo?.city || 'N/A',
          state: info.addressInfo?.state || 'N/A',
          zip: info.addressInfo?.zipCode || 'N/A',
          hireDate: info.employmentInfo?.hireDate || 'N/A',
          username: info.loginInfo?.username || 'N/A',
          email: info.contactInfo?.email || 'N/A',
        });
      } else {
        // Add entry even if info is null to show that HCM exists but has no detailed info
        hcmDetails.push({
          userId: hcm._id,
          firstName: 'N/A',
          lastName: 'N/A',
          address: 'N/A',
          city: 'N/A',
          state: 'N/A',
          zip: 'N/A',
          hireDate: 'N/A',
          username: 'N/A',
          email: 'N/A',
        });
      }
    }
    res.status(200).json({
      success: true,
      message: 'HCM personal info reports fetched successfully',
      response: hcmDetails,
    });
  } catch (error) {
    console.error('Error fetching HCM personal info reports:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching HCM personal info reports',
      error: error.message || error,
    });
  }
};

const numberOfTenantsHcms = async (req, res) => {
  try {
    const { companyId } = req.body;
    const tenants = await users.find({ companyId, role: 0 });
    const hcms = await users.find({ companyId, role: 1 });
    res.status(200).json({
      success: true,
      message: 'Number of tenants and HCMs fetched successfully',
      response: { tenants, hcms },
    });
  } catch (error) {
    console.error('Error fetching number of tenants and HCMs:', error);
    res
      .status(500)
      .json({ success: false, message: 'Server error', error: error.message });
  }
};

export {
  getTenantPersonalInfoReports,
  getServiceTrackingPlanReports,
  getTenantVisitComplianceReports,
  getHcmPersonalInfoReports,
  numberOfTenantsHcms,
};
