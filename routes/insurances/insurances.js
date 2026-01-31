import {Router} from 'express'
import { createInsurance,fetchAllInsurances,updateInsurancesByAdmin,deleteInsuranceByAdmin,fetchAllInsurancesAdmin,addInsuranceClient,removeClientInsurance,fetchUserInsurances } from '../../controllers/insurances/insurances.js'
import { authenticateToken } from '../../middleware/auth.js';
import { superAdminMiddleware } from '../../middleware/superadminmiddleware.js';

export const router = Router()

router.post('/createinsurance',authenticateToken,superAdminMiddleware,createInsurance)//admin
router.get('/fetchallinsurancesAdmin',authenticateToken,superAdminMiddleware,fetchAllInsurancesAdmin)//admin
router.put('/updateinsurance',authenticateToken,superAdminMiddleware,updateInsurancesByAdmin)//admin
router.delete('/deleteinsurance',authenticateToken,superAdminMiddleware,deleteInsuranceByAdmin)//admin
router.get('/fetchallinsurances',authenticateToken,fetchAllInsurances)//client
router.post('/addinsurance',authenticateToken,addInsuranceClient)//client
router.delete('/removeinsurance',authenticateToken,removeClientInsurance)//client
router.get('/fetchuserinsurances',authenticateToken,fetchUserInsurances)//client

 

