import HcmVisitHistory from "../../models/appointments-visits/hcmVisitHistory.js";
import mongoose from "mongoose";

/**
 * Get HCM visit history with optional filters
 * This single endpoint replaces multiple specific endpoints by using query parameters
 * 
 * @route GET /api/hcm/hcm-visit-history/:hcmId
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {Object} - Response with visit history data
 * 
 * Example usage:
 * - All visits: /hcm-visit-history/123
 * - Approved visits: /hcm-visit-history/123?status=approved
 * - By tenant: /hcm-visit-history/123?tenantId=456
 * - By date: /hcm-visit-history/123?date=2023-01-15
 * - Combined filters: /hcm-visit-history/123?status=pending&tenantId=456
 * 
 * Query parameters:
 * - status (optional) - Filter by status (approved, rejected, pending)
 * - tenantId (optional) - Filter by tenant ID
 * - date (optional) - Filter by service date (YYYY-MM-DD)
 * - startDate (optional) - Filter by service date range start
 * - endDate (optional) - Filter by service date range end
 */
export const getHcmVisitHistory = async (req, res) => {
    try {
        const { hcmId } = req.params;
        const { status, tenantId, date, startDate, endDate } = req.body;

        if (!hcmId) {
            return res.status(400).json({
                success: false,
                message: "HCM ID is required"
            });
        }

        const filter = { hcmId };

        if (status) filter.status = status;
        if (tenantId) filter.tenantId = tenantId;

        // Date filtering
        if (date) {
            const targetDate = new Date(date);
            const nextDay = new Date(targetDate);
            nextDay.setDate(targetDate.getDate() + 1);

            filter.serviceDate = {
                $gte: targetDate,
                $lt: nextDay
            };
        } else if (startDate || endDate) {
            filter.serviceDate = {};

            if (startDate) {
                filter.serviceDate.$gte = new Date(startDate);
            }

            if (endDate) {
                const endDateObj = new Date(endDate);
                endDateObj.setDate(endDateObj.getDate() + 1);
                filter.serviceDate.$lt = endDateObj;
            }
        }

        const visitHistory = await HcmVisitHistory.find(filter)
            .sort({ serviceDate: -1 })
            .populate('tenantId', 'name')
            .populate('visitId', 'visitNumber');

        return res.status(200).json({
            success: true,
            count: visitHistory.length,
            data: visitHistory,
            message: "HCM visit history fetched successfully"
        });
    } catch (error) {
        console.error("Error fetching HCM visit history:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch HCM visit history",
            error: error.message
        });
    }
}

