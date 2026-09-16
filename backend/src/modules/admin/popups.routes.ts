import { Router } from 'express';
import { popupsController } from './popups.controller.js';

const router = Router();

router.get('/', popupsController.getPopups);
router.post('/', popupsController.createPopup);
router.patch('/:id', popupsController.updatePopup);
router.delete('/:id', popupsController.deletePopup);

export default router;