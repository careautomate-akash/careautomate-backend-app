import mongoose from 'mongoose';

const noteSchema = new mongoose.Schema({
    noteId: { type: Number, },
    content: { type: String },
    notedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'causers', required: true },
    title: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const tenantNotesSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'causers', required: true },
    notes: [noteSchema],
    noteCounter: { type: Number, default: 0 },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'company' }
});

export default mongoose.model('tenantNotes', tenantNotesSchema);