# Threshold — Back-end

API REST (Node.js + Express + MySQL) responsável pela persistência dos
resultados de partida do jogo Threshold.

ADS Senac Joinville · Profª Claudia Werlich · Equipe: Arthur, Matheus, Natália

## Requisitos

- Node.js 18+
- MySQL 8 rodando localmente (ou ajustar `.env` para outro host)

## Instalação e execução

```bash
cd backend
npm install
cp .env.example .env
```

Edite o `.env` com o usuário/senha do seu MySQL. Depois crie o banco:

```bash
mysql -u root < database/schema.sql
```

Inicie a API:

```bash
npm start
```

A API sobe em `http://localhost:3001`. Teste rápido:

```bash
curl http://localhost:3001/
```

## Estrutura

```
backend/
├── src/
│   ├── server.js              # ponto de entrada (Express)
│   ├── db.js                  # pool de conexão MySQL
│   ├── controllers/
│   │   ├── jogadores.controller.js
│   │   └── partidas.controller.js
│   └── routes/
│       ├── jogadores.routes.js
│       └── partidas.routes.js
├── database/
│   └── schema.sql             # script completo do banco
├── docs/
│   ├── API.md                 # documentação de todos os endpoints
│   ├── der.png                # diagrama entidade-relacionamento
│   └── der.dot                # fonte do diagrama (Graphviz)
├── .env.example
└── package.json
```

## Banco de dados

Duas tabelas: `jogadores` (1) → `partidas` (N), ligadas por
`jogador_id` com `ON DELETE CASCADE`. Ver `docs/der.png` para o
diagrama completo e `database/schema.sql` para o script.

## Documentação da API

Ver [`docs/API.md`](docs/API.md) — todos os endpoints, parâmetros,
formatos de resposta e códigos HTTP utilizados.

## Integração com o front-end

O front-end (`ApiGameRepository` em `src/systems/GameRepository.js`)
chama esta API em `http://localhost:3001` ao final de cada partida
concluída. Se a API estiver fora do ar, o jogo continua funcionando
normalmente — o resultado fica salvo só localmente (`localStorage`)
como cópia de segurança.
