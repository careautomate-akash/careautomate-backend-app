import mongoose from "mongoose";

const insuranceClientSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "causers",
    required: true,
  },
  insurance_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "insuranceMaster",
    required: true,
  },
  is_deleted:{
    type:Boolean,
    default:false
  }
});

export const InsuranceClient = mongoose.model("insuranceClient", insuranceClientSchema);
