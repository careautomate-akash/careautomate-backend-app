import bcrypt from 'bcrypt';

export const hashPassword = async (password) => {
    try {
        const salt = 10;
        const hashedPassword = await bcrypt.hash(password, salt);
        return hashedPassword;
    } catch (err) {
        console.error(err);
    }
}

export const comparePassword = (password, hashedPassword) => {
    return bcrypt.compare(password, hashedPassword);
}
export const validateEmail = async (email) => {
    try {

        const domain = email.split('@')[1];

        return (domain === "gmail.com")
    }
    catch (err) {
        return false;
    }
}
export const toTitleCase = (name) => {
    try {
        const arr = name.split(" ")
        let titleCaseName = ""
        for (const word of arr) {
            titleCaseName += (word[0].toUpperCase() + word.substring(1).toLowerCase()) + " "
        }
        return titleCaseName
    }
    catch (err) {
        return "-1"
    }
}