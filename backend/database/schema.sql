-- Threshold — Script do Banco de Dados (MySQL 8.0)
-- ADS Senac Joinville · Profª Claudia Werlich
-- Equipe: Arthur, Matheus, Natália

CREATE DATABASE IF NOT EXISTS threshold_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE threshold_db;

-- ---------------------------------------------------------------
-- Tabela: jogadores
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jogadores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(60) NOT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------
-- Tabela: partidas
-- Cada linha é o resultado de UMA partida jogada.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partidas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    jogador_id INT NOT NULL,
    pontuacao INT NOT NULL DEFAULT 0,
    tempo_segundos INT NOT NULL DEFAULT 0,
    nivel_alcancado VARCHAR(40) NOT NULL DEFAULT 'CHÃO 0',
    concluido TINYINT(1) NOT NULL DEFAULT 0,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_partidas_jogador
        FOREIGN KEY (jogador_id) REFERENCES jogadores(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_partidas_pontuacao ON partidas (pontuacao DESC);
CREATE INDEX idx_partidas_jogador ON partidas (jogador_id);

-- ---------------------------------------------------------------
-- Usuário de aplicação (ajustar senha em produção / .env)
-- ---------------------------------------------------------------
-- CREATE USER IF NOT EXISTS 'threshold_app'@'localhost' IDENTIFIED BY 'troque_esta_senha';
-- GRANT ALL PRIVILEGES ON threshold_db.* TO 'threshold_app'@'localhost';
-- FLUSH PRIVILEGES;
