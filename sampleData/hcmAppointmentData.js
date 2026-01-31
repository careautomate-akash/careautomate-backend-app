import mongoose from 'mongoose';
import hcmappointments from '../../models/hcmappointments.js';
const appointmentsData = [
    {
        date: new Date('2024-10-10'),
        tenantId: 'tenant1_id',
        startTime: new Date('2024-10-10T09:00:00'),
        endTime: new Date('2024-10-10T10:00:00'),
        reason: 'Routine Checkup',
        approved: true,
        hcm: 'Dr. Smith',
    },
    {
        date: new Date('2024-10-12'),
        tenantId: 'tenant2_id',
        startTime: new Date('2024-10-12T11:00:00'),
        endTime: new Date('2024-10-12T12:00:00'),
        reason: 'Follow-up Visit',
        approved: false,
        hcm: 'Dr. Brown',
    },
    {
        date: new Date('2024-11-01'),
        tenantId: 'tenant3_id',
        startTime: new Date('2024-11-01T14:00:00'),
        endTime: new Date('2024-11-01T15:00:00'),
        reason: 'Physical Therapy Review',
        approved: true,
        hcm: 'Dr. Green',
    },
];

const insertHCMAppointmentsData = async () => {
    try {
        await hcmappointments.insertMany(appointmentsData);
    } catch (error) {
        console.error("Error inserting tenants data:", error);
    }
};

export default insertHCMAppointmentsData;