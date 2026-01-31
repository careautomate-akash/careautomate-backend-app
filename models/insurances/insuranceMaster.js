import mongoose from "mongoose";

const insuranceSchema = new mongoose.Schema(
  {
    state: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    insurance_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    insurance_name: {
      type: String,
      required: true,
      trim: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
    },
    is_deleted:{
        type:Boolean,
        default:false
    }
  },
  {
    timestamps: true,
  }
);

insuranceSchema.index({ state: 1, insurance_name: 1 });

const Insurance = mongoose.model("insuranceMaster", insuranceSchema);
export default Insurance;
