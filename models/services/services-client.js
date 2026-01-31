import mongoose from "mongoose";

const servicesClientSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "causers",
    required: true,
  },
  service_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Service",
    required: true,
  }, 
  is_deleted:{
    type:Boolean,
    default:false
  }
});

export const servicesClient = mongoose.model("servicesClient", servicesClientSchema);
