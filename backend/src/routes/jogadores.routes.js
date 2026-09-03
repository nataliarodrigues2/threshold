const express = require('express');
const router = express.Router();
const controller = require('../controllers/jogadores.controller');

router.get('/', controller.listar);
router.get('/:id', controller.obter);
router.post('/', controller.criar);

module.exports = router;
