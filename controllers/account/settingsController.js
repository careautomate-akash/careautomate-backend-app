import Settings from '../../models/account/settings.js';
import Users from '../../models/account/users.js';
import accountSetup from '../../models/account/accountSetup.js';
import mongoose from 'mongoose';
export const fetchSettingsData = async (req, res) => {
    try {
        const { userId } = req.body;

        const settings = await Settings.findOne({ userId })
            .populate({
                path: 'personalDetails',
                model: 'causers'
            })
            .populate({
                path: 'accountDetails',
                model: 'accountSetup'
            }
            );

        if (!settings) {
            return res.status(400).json({ success: false, message: "Settings not found" });
        }

        res.status(200).json({ success: true, message: "Settings data fetched successfully", response: settings });
    } catch (error) {
        console.error('Error fetching settings data:', error);
        res.status(500).json({ success: false, message: "Error fetching settings data" });
    }
};

export const insertSettingsData = async (req, res) => {
    try {
        const { userId, email, securityDetails, preferences } = req.body;

        // Find account details by email
        const accountDetailsDoc = await accountSetup.findOne({ email });
        if (!accountDetailsDoc) {
            return res.status(404).json({ success: false, message: "Account details not found for the given email" });
        }

        const settings = await Settings.create({
            userId,
            personalDetails: userId, // Use userId for personalDetails
            accountDetails: accountDetailsDoc._id, // Use the found document's ID
            securityDetails,
            preferences
        });

        res.status(200).json({ success: true, message: "Settings data inserted successfully", response: settings });
    } catch (error) {
        console.error('Error inserting settings data:', error);
        res.status(500).json({ success: false, message: "Error inserting settings data" });
    }
};

export const fetchSecurityDetails = async (req, res) => {
    try {
        const { adminId } = req.query;
        const adminIdObject = new mongoose.Types.ObjectId(adminId);
        // Validate userId
        if (!adminIdObject) {
            return res.status(400).json({ success: false, message: "Admin ID is required", response: null });
        }

        // Find the settings document for the given userId
        const settingsData = await Settings.findOne({ userId: adminIdObject });
        if (!settingsData) {
            return res.status(400).json({ success: false, message: "Settings not found for the given user ID", response: null });
        }

        // Respond with the security details
        res.status(200).json({
            success: true, message: "Security details fetched successfully", response: {
                "security-data": settingsData.securityDetails,
            }
        });
    } catch (error) {
        console.error('Error fetching security details:', error);
        res.status(500).json({ success: false, message: "Error fetching security details" });
    }
};

// Update Security Details
export const updateSecurityDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const settings = await Settings.findOneAndUpdate(
            { id },
            { securityDetails: updateData },
            { new: true }
        );
        if (!settings) {
            return res.status(400).json({ success: false, message: "Security details not found", response: null });
        }
        res.status(200).json({ success: true, message: "Security details updated successfully", response: settings.securityDetails });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Error updating security details" });
    }
};

// Fetch Preferences
export const fetchPreferences = async (req, res) => {
    try {
        const { userId } = req.body;
        const settings = await Settings.findOne({ userId });
        if (!settings) {
            return res.status(400).json({ success: false, message: "Preferences not found" });
        }
        res.status(200).json({ success: true, message: "Preferences fetched successfully", response: settings.preferences });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Error fetching preferences" });
    }
};

// Update Preferences
export const updatePreferences = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const settings = await Settings.findOneAndUpdate(
            { id },
            { preferences: updateData },
            { new: true }
        );
        if (!settings) {
            return res.status(400).json({ success: false, message: "Preferences not found", response: null });
        }
        res.status(200).json({ success: true, message: "Preferences updated successfully", response: settings.preferences });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Error updating preferences" });
    }
};


