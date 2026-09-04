import { eventBus } from './EventBus.js';

export class GameState {
    constructor() {
        this._CHECKPOINT_KEY = 'threshold_checkpointLevel';
        this.checkpointLevelIndex = this._loadCheckpoint();
        this.reset(true);
    }

    

    // resetando o estado do jogo. Se keepCheckpoint for true, preserva o
    // checkpoint de nível (máxima progressão) e define o nível atual para
    // esse checkpoint; caso contrário limpa tudo como antes.
    reset(keepCheckpoint = false) {
        const checkpoint = this.checkpointLevelIndex ?? 0;
        this.playerName = '';
        this.score = 0;
        this.objectives = {
            fuse: false,
            keycard: false,
            power: false
        };
        this.inventory = {
            fuse: false,
            keycard: false,
            radar: false,
            phone: false,
            flashlight: false
        };
        this.scoredActions = new Set();
        this.portalUnlocked = false;
        this.gameCompleted = false;
        this.elapsedSeconds = 0;
        this.state = 'MENU';
        this.currentLevelIndex = keepCheckpoint ? checkpoint : 0;
        this.levelObjectiveIds = [];
        if (!keepCheckpoint) {
            this.checkpointLevelIndex = 0;
            try { if (typeof localStorage !== 'undefined') localStorage.removeItem(this._CHECKPOINT_KEY); } catch {}
        }
    }

    _loadCheckpoint() {
        try {
            if (typeof localStorage === 'undefined') return 0;
            const raw = localStorage.getItem(this._CHECKPOINT_KEY);
            const v = parseInt(raw, 10);
            return Number.isFinite(v) ? v : 0;
        } catch {
            return 0;
        }
    }

    _saveCheckpoint() {
        try {
            if (typeof localStorage === 'undefined') return;
            localStorage.setItem(this._CHECKPOINT_KEY, String(this.checkpointLevelIndex ?? 0));
        } catch {}
    }

    setState(state) {
        this.state = state;
        eventBus.emit('game:stateChanged', state);
    }

    setPlayerName(name) {
        this.playerName = name;
    }

    addScore(actionId, points) {
        if (this.scoredActions.has(actionId)) {
            return false;
        }
        this.scoredActions.add(actionId);
        this.score += points;
        eventBus.emit('score:changed', this.score);
        return true;
    }

    collectItem(item) {
        if (this.inventory[item]) {
            return false;
        }
        this.inventory[item] = true;
        eventBus.emit('inventory:changed', item);
        return true;
    }

    hasItem(item) {
        return this.inventory[item];
    }

    completeObjective(id) {
        if (this.objectives[id]) {
            return false;
        }
        this.objectives[id] = true;
        eventBus.emit('objective:completed', id);
        if (this.levelObjectiveIds.includes(id)) {
            if (this.allObjectivesComplete()) {
                this.unlockPortal();
            }
        }
        return true;
    }

    setLevelObjectives(ids) {
        this.levelObjectiveIds = ids.slice();
    }

    allObjectivesComplete() {
        if (this.levelObjectiveIds.length === 0) {
            return Object.values(this.objectives).every(Boolean);
        }
        return this.levelObjectiveIds.every((id) => this.objectives[id]);
    }

    advanceLevel() {
        this.currentLevelIndex++;
        this.portalUnlocked = false;
        eventBus.emit('portal:locked');
        // atualiza checkpoint para o nível atual (permite reiniciar direto daqui)
        this.checkpointLevelIndex = this.currentLevelIndex;
        this._saveCheckpoint();
    }

    unlockPortal() {
        if (this.portalUnlocked) {
            return;
        }
        this.portalUnlocked = true;
        eventBus.emit('portal:unlocked');
    }

    completeGame() {
        if (this.gameCompleted) {
            return false;
        }
        this.gameCompleted = true;
        eventBus.emit('game:completed');
        return true;
    }
}
