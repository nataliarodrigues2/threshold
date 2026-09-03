const express = require('express');
const cors = require('cors');
require('dotenv').config();

const jogadoresRoutes = require('./routes/jogadores.routes');
const partidasRoutes = require('./routes/partidas.routes');
const partidasController = require('./controllers/partidas.controller');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Log simples de cada requisição (bom pra debug e pra documentação/testes)
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
    next();
});

app.get('/', (req, res) => {
    res.json({
        projeto: 'Threshold API',
        equipe: 'Arthur, Matheus, Natália',
        endpoints: [
            'GET  /jogadores',
            'GET  /jogadores/:id',
            'POST /jogadores',
            'GET  /partidas',
            'POST /partidas',
            'GET  /ranking?limit=10'
        ]
    });
});

app.use('/jogadores', jogadoresRoutes);
app.use('/partidas', partidasRoutes);
app.get('/ranking', partidasController.ranking);

// 404 padrão
app.use((req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada.' });
});

// Handler de erro genérico (evita vazar stack trace pro cliente)
app.use((err, req, res, next) => {
    console.error('[erro não tratado]', err);
    res.status(500).json({ erro: 'Erro interno do servidor.' });
});

app.listen(PORT, () => {
    console.log(`Threshold API rodando em http://localhost:${PORT}`);
});
