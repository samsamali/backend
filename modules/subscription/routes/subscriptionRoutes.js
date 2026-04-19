const express = require('express');
const router = express.Router();
const { getAllSubscriptions, createSubscription, updateSubscription, deleteSubscription, purchaseSubscription} = require('../controllers/subscriptionController');
const { verifyToken } = require('../../auth/middlewares/authMiddleware');

router.post('/create', verifyToken, createSubscription);

router.put('/update/:id', verifyToken, updateSubscription);

router.delete('/delete/:id', verifyToken, deleteSubscription);

router.get('/', getAllSubscriptions);

router.post('/purchase', verifyToken, purchaseSubscription);


module.exports = router;
