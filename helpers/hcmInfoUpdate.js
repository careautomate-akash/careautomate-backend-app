import mongoose from "mongoose";
import HcmInfo from '../models/hcm-tenants/hcmInfo.js'; // Adjust the path as necessary

const updateDocuments = async () => {
    try {
        // Connect to the database
        await mongoose.connect(process.env.DB_URL, { useNewUrlParser: true, useUnifiedTopology: true });

        const pipeline = [
            {
                "$set": {
                    "personalInfo": {
                        "firstName": "$firstName",
                        "middleName": "$middleName",
                        "lastName": "$lastName",
                        "dob": "$dob",
                        "gender": "$gender"
                    },
                    "contactInfo": {
                        "phoneNumber": "$phoneNumber",
                        "email": "$email",
                        "homePhone": "$homePhone",
                        "cellPhone": "$cellPhone"
                    },
                    "addressInfo": {
                        "addressLine1": "$addressLine1",
                        "addressLine2": "$addressLine2",
                        "city": "$city",
                        "state": "$state",
                        "zipCode": "$zipCode",
                        "mailingAddress": "$mailingAddress"
                    },
                    "employmentInfo": {
                        "employmentTitle": "$employmentTitle",
                        "hireDate": "$hireDate",
                        "terminationDate": "$terminationDate",
                        "rateOfPay": "$rateOfPay",
                        "ssn": "$ssn"
                    }
                }
            },
            {
                "$unset": [
                    "firstName",
                    "middleName",
                    "lastName",
                    "dob",
                    "gender",
                    "phoneNumber",
                    "email",
                    "homePhone",
                    "cellPhone",
                    "addressLine1",
                    "addressLine2",
                    "city",
                    "state",
                    "zipCode",
                    "mailingAddress",
                    "employmentTitle",
                    "hireDate",
                    "terminationDate",
                    "rateOfPay",
                    "ssn"
                ]
            }
        ];

        const result = await HcmInfo.aggregate(pipeline);
    } catch (error) {
        console.error('Error updating documents:', error);
    } finally {
        mongoose.connection.close();
    }
};

export { updateDocuments };