# Threshold API — Documentação

API REST responsável pela comunicação entre o front-end (jogo) e o
banco de dados MySQL. Base URL local: `http://localhost:3001`.

## Tecnologias

- Node.js + Express
- MySQL 8 (via `mysql2`)
- CORS habilitado (o front-end roda em outra porta durante o desenvolvimento)

## Como rodar

```bash
cd backend
npm install
cp .env.example .env   # ajuste usuário/senha do MySQL
mysql -u root < database/schema.sql
npm start
```

---

## Endpoints

### `GET /`
Endpoint raiz — retorna metadados da API e a lista de rotas disponíveis.

**Resposta `200 OK`**
```json
{
  "projeto": "Threshold API",
  "equipe": "Arthur, Matheus, Natália",
  "endpoints": ["GET /jogadores", "..."]
}
```

---

### `GET /jogadores`
Lista todos os jogadores cadastrados.

**Resposta `200 OK`**
```json
[
  { "id": 1, "nome": "Arthur", "criado_em": "2026-01-10T18:00:00.000Z" }
]
```

---

### `GET /jogadores/:id`
Busca um jogador específico pelo ID.

**Parâmetros de rota:** `id` (inteiro)

**Resposta `200 OK`** — mesmo formato do item acima.
**Resposta `404 Not Found`**
```json
{ "erro": "Jogador não encontrado." }
```

---

### `POST /jogadores`
Cria um jogador.

**Corpo da requisição**
```json
{ "nome": "Arthur" }
```

**Resposta `201 Created`**
```json
{ "id": 1, "nome": "Arthur" }
```

**Resposta `400 Bad Request`** (nome ausente ou vazio)
```json
{ "erro": "Campo \"nome\" é obrigatório." }
```

---

### `GET /partidas`
Lista as últimas 200 partidas registradas (mais recentes primeiro),
já com o nome do jogador.

**Resposta `200 OK`**
```json
[
  {
    "id": 1,
    "pontuacao": 350,
    "tempo_segundos": 210,
    "nivel_alcancado": "CHÃO 1",
    "concluido": 1,
    "criado_em": "2026-01-10T18:00:00.000Z",
    "jogador_id": 1,
    "jogador_nome": "Arthur"
  }
]
```

---

### `POST /partidas`
Registra o resultado de uma partida. Se o jogador ainda não existir
(pelo nome), ele é criado automaticamente — o front-end não precisa
fazer duas chamadas separadas.

**Corpo da requisição**
```json
{
  "nome": "Arthur",
  "pontuacao": 350,
  "tempo_segundos": 210,
  "nivel_alcancado": "CHÃO 1",
  "concluido": true
}
```

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `nome` | string | Sim | Nome do jogador |
| `pontuacao` | number | Sim | ≥ 0 |
| `tempo_segundos` | number | Não | Padrão: 0 |
| `nivel_alcancado` | string | Não | Um de: `CHÃO 0`, `CHÃO 1`, `CHÃO 2`. Padrão: `CHÃO 0` |
| `concluido` | boolean | Não | Padrão: `false` |

**Resposta `201 Created`**
```json
{
  "id": 1, "jogador_id": 1, "nome": "Arthur",
  "pontuacao": 350, "tempo_segundos": 210,
  "nivel_alcancado": "CHÃO 1", "concluido": true
}
```

**Resposta `400 Bad Request`** — nome ausente, pontuação inválida, ou
nível fora da lista permitida.

---

### `GET /ranking?limit=10`
Retorna o ranking geral, ordenado por pontuação (decrescente) e, em
caso de empate, por tempo (crescente — mais rápido primeiro).

**Parâmetros de query:** `limit` (opcional, padrão 10, máximo 100)

**Resposta `200 OK`**
```json
[
  {
    "jogador_nome": "Natália",
    "pontuacao": 500,
    "tempo_segundos": 180,
    "nivel_alcancado": "CHÃO 2",
    "criado_em": "2026-01-10T18:00:00.000Z"
  }
]
```

---

## Códigos HTTP utilizados

| Código | Quando |
|---|---|
| `200 OK` | Consulta (GET) bem-sucedida |
| `201 Created` | Criação (POST) bem-sucedida |
| `400 Bad Request` | Corpo da requisição inválido ou incompleto |
| `404 Not Found` | Recurso ou rota inexistente |
| `500 Internal Server Error` | Falha inesperada (ex.: banco fora do ar) |

## Testes realizados

Todos os endpoints acima foram testados manualmente com `curl` contra
um banco MySQL real durante o desenvolvimento: criação de jogador,
listagem, validação de campos obrigatórios (400), registro de
partidas, e ranking ordenado corretamente por pontuação/tempo.
