import { Router } from 'express';
import { rolesController } from './roles.controller.js';

const router = Router();

// This route is for fetching a simple list of roles for UI elements.
router.get('/list', rolesController.getRoleList);

router.get('/', rolesController.getRoles);
router.post('/', rolesController.createRole);

export default router;