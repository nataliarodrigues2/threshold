const pool = require('../db');

// GET /jogadores
async function listar(req, res) {
    try {
        const [rows] = await pool.query(
            'SELECT id, nome, criado_em FROM jogadores ORDER BY criado_em DESC'
        );
        res.status(200).json(rows);
    } catch (err) {
        console.error('[jogadores.listar]', err);
        res.status(500).json({ erro: 'Falha ao listar jogadores.' });
    }
}

// GET /jogadores/:id
async function obter(req, res) {
    const { id } = req.params;
    try {
        const [rows] = await pool.query(
            'SELECT id, nome, criado_em FROM jogadores WHERE id = ?',
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Jogador não encontrado.' });
        }
        res.status(200).json(rows[0]);
    } catch (err) {
        console.error('[jogadores.obter]', err);
        res.status(500).json({ erro: 'Falha ao buscar jogador.' });
    }
}

// POST /jogadores  { nome }
async function criar(req, res) {
    const { nome } = req.body;
    if (!nome || typeof nome !== 'string' || !nome.trim()) {
        return res.status(400).json({ erro: 'Campo "nome" é obrigatório.' });
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO jogadores (nome) VALUES (?)',
            [nome.trim().slice(0, 60)]
        );
        res.status(201).json({ id: result.insertId, nome: nome.trim() });
    } catch (err) {
        console.error('[jogadores.criar]', err);
        res.status(500).json({ erro: 'Falha ao criar jogador.' });
    }
}

// Usado internamente por partidas.controller: acha ou cria o jogador pelo nome
async function encontrarOuCriarPorNome(nome) {
    const nomeLimpo = String(nome).trim().slice(0, 60);
    const [existentes] = await pool.query(
        'SELECT id FROM jogadores WHERE nome = ? ORDER BY criado_em DESC LIMIT 1',
        [nomeLimpo]
    );
    if (existentes.length > 0) return existentes[0].id;

    const [result] = await pool.query('INSERT INTO jogadores (nome) VALUES (?)', [nomeLimpo]);
    return result.insertId;
}

module.exports = { listar, obter, criar, encontrarOuCriarPorNome };
