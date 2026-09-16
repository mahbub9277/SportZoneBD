import { Router } from 'express';
import { advertisementsController } from './advertisements.controller.js';

const router = Router();

// Admin routes
router.get('/', advertisementsController.getAdvertisements);
router.post('/', advertisementsController.createAdvertisement);
router.patch('/:id', advertisementsController.updateAdvertisement);
router.delete('/:id', advertisementsController.deleteAdvertisement);

export default router;