export const superAdminMiddleware = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: "Authentication required." });
    }
    if (req.user.role === 3) {
        return next();
    }

    if (req.user.role < 3) {
        return res.status(403).json({ message: "Insufficient privileges." });
    }

    return res.status(403).json({ message: "Access denied. Super Admins only." });
};
