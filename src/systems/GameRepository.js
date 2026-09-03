const STORAGE_KEY = 'threshold_results';

export class LocalGameRepository {
    saveResult(result) {
        try {
            const results = this.getResults();
            results.push(result);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
        } catch (e) {
            console.warn('Não foi possível salvar o resultado localmente.', e);
        }
    }

    getResults() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
        } catch (e) {
            return [];
        }
    }
}

// Salva na API (banco MySQL de verdade). Sempre grava também em
// localStorage como cópia de segurança — se a API estiver fora do ar
// (ex.: apresentação sem back-end rodando), o jogo continua
// funcionando normalmente, só sem persistência remota.
export class ApiGameRepository {
    constructor(baseUrl = 'http://localhost:3001') {
        this.baseUrl = baseUrl;
        this.local = new LocalGameRepository();
    }

    async saveResult(result) {
        this.local.saveResult(result);
        try {
            const response = await fetch(`${this.baseUrl}/partidas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nome: result.playerName,
                    pontuacao: result.score,
                    tempo_segundos: result.duration,
                    nivel_alcancado: result.levelName,
                    concluido: result.completed ?? true
                })
            });
            if (!response.ok) {
                console.warn('[ApiGameRepository] API respondeu com erro:', response.status);
            }
        } catch (err) {
            console.warn('[ApiGameRepository] API indisponível, resultado ficou só local.', err);
        }
    }

    async getResults() {
        try {
            const response = await fetch(`${this.baseUrl}/ranking?limit=20`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (err) {
            console.warn('[ApiGameRepository] Falha ao buscar ranking da API, usando local.', err);
            return this.local.getResults();
        }
    }
}
