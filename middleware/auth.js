import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import users from '../models/account/users.js';

dotenv.config();

export const authenticateToken = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                return res.status(403).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }

            // Get user from database to check account status
            const user = await users.findById(decoded._id);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            // BACKWARD COMPATIBILITY: Only block if is_active is explicitly false
            // (not undefined/null for existing users)
            if (user.is_active === false) {
                return res.status(403).json({
                    success: false,
                    message: 'Account is deactivated',
                    subscriptionStatus: user.subscription_status,
                    reason: user.deactivation_reason,
                });
            }

            req.user = decoded;
            next();
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({
            success: false,
            message: 'Authentication error'
        });
    }
};

export const auth = authenticateToken;

export default authenticateToken; 