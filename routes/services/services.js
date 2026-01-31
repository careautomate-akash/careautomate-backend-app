import express from 'express';
const router = express.Router();
import { authenticateToken } from '../../middleware/auth.js';
import {
  createService,
  getAllServices,
  getServiceById,
  updateService,
  deleteService,
  createServicesBulk,
  addSubActivity,
  getSubActivitiesByService,
  // createClientService,
  getClientServices,
  getAllServicesAdmin,
  // removeClientServices
} from '../../controllers/services/serviceController.js';
import { superAdminMiddleware } from '../../middleware/superadminmiddleware.js';

router.post('/bulk', authenticateToken,superAdminMiddleware,createServicesBulk);

router.post('/', authenticateToken,superAdminMiddleware, createService);

router.get('/client', authenticateToken, getAllServices);

router.get('/', authenticateToken,superAdminMiddleware, getAllServicesAdmin);

router.get('/:serviceId', authenticateToken, getServiceById);

router.put('/:serviceId', authenticateToken, updateService);

router.delete('/:serviceId', authenticateToken,superAdminMiddleware, deleteService);

router.post('/v1/sub-activities', authenticateToken, superAdminMiddleware,addSubActivity);

router.get(
  '/v1/sub-activities/:serviceId',
  authenticateToken,
  getSubActivitiesByService
);
// router.post('/v1/createservicetoclient',authenticateToken,createClientService)
router.get('/v1/getclientservices',authenticateToken,getClientServices)
// router.delete('/v1/removeclientservice',authenticateToken,removeClientServices)


export default router;
