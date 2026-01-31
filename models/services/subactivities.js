import mongoose from 'mongoose';

const subActivitySchema = new mongoose.Schema(
  {
    sub_activities: { type: [String], required: true },
    parent_activity: { type: String, required: true },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },
    // company: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: 'company',
    //   required: true,
    // },
  },
  {
    timestamps: true,
  }
);

const SubActivity = mongoose.model('SubActivity', subActivitySchema);

export default SubActivity;
