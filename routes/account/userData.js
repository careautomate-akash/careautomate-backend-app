import mongoose from 'mongoose';
import User from '../../models/account/users.js'; // Adjust the path as necessary

const sampleUser = {
    _id: mongoose.Types.ObjectId("673a2407a8c797b7f3190bf4"),
    name: "Abdi Fadumo",
    email: "fadumo@gmail.com",
    password: "$2b$10$adrTs.WItI5i8NbFnAPJ8OQbwJAHMj.lzVZ/epTieS5aPEEbsrUe2",
    phoneNo: "(123) 432-3454",
    role: 1,
    __v: 0,
    movedOut: false,
    reason: "",
    movedOutDate: new Date("2024-08-15T03:30:00.000Z"),
    accountSetup: false,
    info_id: mongoose.Types.ObjectId("676cae29904b08ae763fb6d4"),
    passwordChangedAt: null
};

const insertSampleUser = async () => {
    try {
        await mongoose.connect('mongodb://localhost:27017/your_database_name', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        await User.deleteMany({}); // Clear existing data
        await User.create(sampleUser); // Insert sample user

        mongoose.connection.close();
    } catch (error) {
        console.error('Error inserting sample user data:', error);
    }
};

insertSampleUser(); 