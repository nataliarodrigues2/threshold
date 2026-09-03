const pool = require('../db');
const { encontrarOuCriarPorNome } = require('./jogadores.controller');

const NIVEIS_VALIDOS = ['CHÃO 0', 'CHÃO 1', 'CHÃO 2'];

// GET /partidas
async function listar(req, res) {
    try {
        const [rows] = await pool.query(
            `SELECT p.id, p.pontuacao, p.tempo_segundos, p.nivel_alcancado,
                    p.concluido, p.criado_em, j.id AS jogador_id, j.nome AS jogador_nome
             FROM partidas p
             JOIN jogadores j ON j.id = p.jogador_id
             ORDER BY p.criado_em DESC
             LIMIT 200`
        );
        res.status(200).json(rows);
    } catch (err) {
        console.error('[partidas.listar]', err);
        res.status(500).json({ erro: 'Falha ao listar partidas.' });
    }
}

// POST /partidas  { nome, pontuacao, tempo_segundos, nivel_alcancado, concluido }
async function criar(req, res) {
    const { nome, pontuacao, tempo_segundos, nivel_alcancado, concluido } = req.body;

    if (!nome || typeof nome !== 'string' || !nome.trim()) {
        return res.status(400).json({ erro: 'Campo "nome" é obrigatório.' });
    }
    if (typeof pontuacao !== 'number' || pontuacao < 0) {
        return res.status(400).json({ erro: 'Campo "pontuacao" deve ser um número >= 0.' });
    }
    if (nivel_alcancado && !NIVEIS_VALIDOS.includes(nivel_alcancado)) {
        return res.status(400).json({ erro: `Campo "nivel_alcancado" inválido. Use um de: ${NIVEIS_VALIDOS.join(', ')}` });
    }

    try {
        const jogadorId = await encontrarOuCriarPorNome(nome);
        const [result] = await pool.query(
            `INSERT INTO partidas (jogador_id, pontuacao, tempo_segundos, nivel_alcancado, concluido)
             VALUES (?, ?, ?, ?, ?)`,
            [
                jogadorId,
                pontuacao,
                Number.isFinite(tempo_segundos) ? tempo_segundos : 0,
                nivel_alcancado || NIVEIS_VALIDOS[0],
                concluido ? 1 : 0
            ]
        );
        res.status(201).json({
            id: result.insertId,
            jogador_id: jogadorId,
            nome: nome.trim(),
            pontuacao,
            tempo_segundos: tempo_segundos || 0,
            nivel_alcancado: nivel_alcancado || NIVEIS_VALIDOS[0],
            concluido: !!concluido
        });
    } catch (err) {
        console.error('[partidas.criar]', err);
        res.status(500).json({ erro: 'Falha ao registrar partida.' });
    }
}

// GET /ranking?limit=10
async function ranking(req, res) {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    try {
        const [rows] = await pool.query(
            `SELECT j.nome AS jogador_nome, p.pontuacao, p.tempo_segundos,
                    p.nivel_alcancado, p.criado_em
             FROM partidas p
             JOIN jogadores j ON j.id = p.jogador_id
             ORDER BY p.pontuacao DESC, p.tempo_segundos ASC
             LIMIT ?`,
            [limit]
        );
        res.status(200).json(rows);
    } catch (err) {
        console.error('[partidas.ranking]', err);
        res.status(500).json({ erro: 'Falha ao gerar ranking.' });
    }
}

module.exports = { listar, criar, ranking };
