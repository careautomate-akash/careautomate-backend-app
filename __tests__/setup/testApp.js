import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { setupTestDB } from './testSetup.js';

// Create a standalone test app without the server components
const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// We'll set up the database connection in the test files
// using setupTestDB() before tests run

export default app; 