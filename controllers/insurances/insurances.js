import users from '../../models/account/users.js';
import message from '../../models/communication-documents/message.js';
import Insurance from '../../models/insurances/insuranceMaster.js';
import { InsuranceClient } from '../../models/insurances/insurancesClientMapping.js';
import accountSetup from '../../models/account/accountSetup.js';

export const createInsurance = async (req, res) => {
  try {
    const { state, insurance_id, insurance_name, created_by } = req.body;
    if (!state || !insurance_id || !insurance_name || !created_by) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const existing = await Insurance.findOne({ insurance_id: insurance_id });
    if (existing) {
      return res.status(409).json({ message: 'Insurance ID already exists.' });
    }

    const insurance = await Insurance.create({
      state,
      insurance_id,
      insurance_name,
      created_by,
      updated_by: created_by,
    });

    return res.status(201).json({
      message: 'Insurance created successfully',
      data: insurance,
    });
  } catch (error) {
    console.error('Error creating insurance:', error);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const fetchAllInsurancesAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 1000, search = '' } = req.query;
    const filter = search
      ? {
          $or: [
            { insurance_name: { $regex: search, $options: 'i' } },
            { insurance_id: { $regex: search, $options: 'i' } },
            { state: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const skip = (Number(page) - 1) * Number(limit);

    const [data, total] = await Promise.all([
      Insurance.find(filter)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(Number(limit)),
      Insurance.countDocuments(filter),
    ]);

    res.status(200).json({
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
      data,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: 'Internal Server Error', error: error.message });
  }
};

export const updateInsurancesByAdmin = async (req, res) => {
  try {
    const { document_id, state, insurance_id, insurance_name, updated_by } =
      req.body;

    if (!document_id) {
      return res.status(400).json({ message: 'document_id is required' });
    }
    if (!updated_by) {
      return res.status(401).json({ message: 'updated_by is required' });
    }

    const checkIfRecordExists = await Insurance.findOne({
      _id: document_id,
    });
    if (!checkIfRecordExists) {
      res.status(400).json({ message: 'Record Not Found' });
    }
    const updateData = {};
    if (state) updateData.state = state;
    if (insurance_name) updateData.insurance_name = insurance_name;
    if (insurance_id) updateData.insurance_id = insurance_id;
    updateData.updated_by = updated_by;

    const updatedInsurance = await Insurance.findOneAndUpdate(
      { _id: document_id },
      { $set: updateData }
    );
    if (!updatedInsurance) {
      return res.status(404).json({ message: 'Insurance document not found' });
    }

    res.status(200).json({
      message: 'Insurance updated successfully',
      data: updatedInsurance,
    });
  } catch (error) {
    console.error('Error updating insurance:', error);
    res
      .status(500)
      .json({ message: 'Internal Server Error', error: error.message });
  }
};

export const deleteInsuranceByAdmin = async (req, res) => {
  try {
    const { insurance_id, user_id } = req.body;
    if (!insurance_id) {
      return res.status(400).json({ message: 'insurance_id is required' });
    }

    if (!user_id) {
      return res.status(400).json({ message: 'user_id is required' });
    }

    const insurance = await Insurance.findOne({ insurance_id });

    if (!insurance) {
      return res.status(404).json({ message: 'Insurance not found' });
    }

    const isCurrentlyDeleted = insurance.is_deleted;
    insurance.is_deleted = !isCurrentlyDeleted;
    insurance.updated_by = user_id;

    await insurance.save();

    res.status(200).json({
      message: isCurrentlyDeleted
        ? 'Insurance restored successfully'
        : 'Insurance soft deleted successfully',
      data: insurance,
    });
  } catch (error) {
    console.error('Error deleting insurance:', error.message);
    res
      .status(500)
      .json({ message: 'Internal Server Error', error: error.message });
  }
};

export const fetchAllInsurances = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const user = await users.findOne({ _id: req.user._id });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }
    const accountSetupData = await accountSetup.findOne({
      adminId: user._id,
    });

    if (!accountSetupData?.address?.state) {
      return res
        .status(400)
        .json({ message: 'State not found in account setup' });
    }

    const state = accountSetupData.address.state;

    let filter = {
      is_deleted: { $ne: true },
      state: { $regex: state, $options: 'i' },
    };
    if (search?.trim().length) {
      filter.$or = [
        { insurance_name: { $regex: search, $options: 'i' } },
        { insurance_id: { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      Insurance.find(filter).sort({ createdAt: 1 }).skip(skip).limit(limitNum),
      Insurance.countDocuments(filter),
    ]);
    res.status(200).json({
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      data,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: 'Internal Server Error', error: error.message });
  }
};

export const addInsuranceClient = async (req, res) => {
  try {
    const { user_id, insurance_id } = req.body;

    if (!user_id || !insurance_id) {
      return res.status(400).json({ message: 'Please check the request body' });
    }

    const insuranceExists = await Insurance.findOne({
      _id: insurance_id,
      is_deleted: false,
    });

    const checkIfUserHasAlreadyInsuranceExists = await InsuranceClient.findOne({
      user_id,
      insurance_id,
    });

    if (!insuranceExists || checkIfUserHasAlreadyInsuranceExists) {
      return res
        .status(400)
        .send({ message: 'Please check the Insurance you have selected' });
    }

    const newInsuranceClient = new InsuranceClient({
      user_id,
      insurance_id,
    });

    const savedInsurance = await newInsuranceClient.save();
    const populatedInsurance = await savedInsurance.populate('insurance_id');

    return res.status(201).json({
      message: 'Insurance added successfully',
      data: populatedInsurance.insurance_id,
    });
  } catch (error) {
    console.error('Error adding insurance client:', error);
    return res
      .status(500)
      .json({ message: 'Internal Server Error', error: error.message });
  }
};
export const removeClientInsurance = async (req, res) => {
  try {
    const { user_id, insurance_id } = req.body;

    if (!user_id || !insurance_id) {
      return res.status(400).json({ message: 'Please check the request body' });
    }

    const insuranceExistsWithSameUser = await InsuranceClient.findOne({
      user_id,
      insurance_id,
    }).populate('insurance_id');

    if (!insuranceExistsWithSameUser) {
      return res
        .status(404)
        .json({ message: 'No insurance record found for this user' });
    }

    await InsuranceClient.deleteOne({ user_id, insurance_id });

    return res.status(200).json({
      message: 'Insurance removed successfully',
      data: insuranceExistsWithSameUser.insurance_id,
    });
  } catch (error) {
    console.error('Error removing client insurance:', error);
    return res
      .status(500)
      .json({ message: 'Internal Server Error', error: error.message });
  }
};

export const fetchUserInsurances = async (req, res) => {
  try {
    const user_id = req.user._id;

    if (!user_id) {
      return res.status(400).json({ message: 'user_id is required' });
    }

    // const userInsurances = await InsuranceClient.find({ user_id, is_deleted: false })
    //   .populate('insurance_id')
    //   .lean();

    // if (!userInsurances || userInsurances.length === 0) {
    //   return res.status(404).json({ message: "No insurances found for this user" });
    // }

    // const finalResponse = userInsurances.map(doc => doc.insurance_id);

    const user_details = await users.findOne({ _id: user_id });
    const fetchInsurancesAvailableForUserState = await Insurance.find({
      state: user_details.state,
      is_deleted: false,
    });
    return res.status(200).json({
      message: 'User insurances fetched successfully',
      data: fetchInsurancesAvailableForUserState,
    });
  } catch (error) {
    console.error('Error fetching user insurances:', error);
    return res
      .status(500)
      .json({ message: 'Internal Server Error', error: error.message });
  }
};
