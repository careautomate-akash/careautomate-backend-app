import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers', // Using your existing user model
        required: true
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers',
        required: true
    },
    content: {
        type: String,
        required: true
    },
    read: {
        type: Boolean,
        default: false
    },
    attachments: [{
        fileKey: String,
        fileName: String,
        fileType: String,
        fileSize: Number
    }]
}, {
    timestamps: true
});

// Add indexes for querying efficiency
messageSchema.index({ sender: 1, recipient: 1 });
messageSchema.index({ createdAt: -1 });

export default mongoose.model('Message', messageSchema); 