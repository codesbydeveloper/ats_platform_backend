const { Router } = require('express');
const {
  getLocations,
  getStates,
  getCities,
} = require('../controllers/locationsController');

const router = Router();

router.get('/', getLocations);
router.get('/states', getStates);
router.get('/cities', getCities);

module.exports = router;
