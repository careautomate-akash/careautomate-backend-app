// // allowCors.js

// // List of allowed origins (you can update it dynamically)
// const allowedOrigins = ['http://example.com', 'http://anotherdomain.com'];

// module.exports = function allowCors(req, res, next) {
//     const origin = req.header('Origin');

//     // Dynamically allow specific origins
//     if (allowedOrigins.includes(origin)) {
//         res.header('Access-Control-Allow-Origin', origin);
//     } else {
//         res.header('Access-Control-Allow-Origin', 'null'); // If not allowed, set to null
//     }

//     // Allow credentials to be passed (e.g., cookies, authorization headers)
//     res.header('Access-Control-Allow-Credentials', 'true');

//     // Allowed methods for CORS
//     res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

//     // Allowed headers for CORS
//     res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers');

//     // Maximum age of the preflight request cache (in seconds)
//     res.header('Access-Control-Max-Age', '86400'); // Cache the preflight response for 1 day

//     // Handle preflight requests (OPTIONS)
//     if (req.method === 'OPTIONS') {
//         return res.status(204).end();
//     }

//     // Proceed to the next middleware or route handler
//     next();
// };
