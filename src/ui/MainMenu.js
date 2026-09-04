export class MainMenu {
    constructor(callbacks) {
        this.root = document.getElementById('main-menu');
        this.nameModal = document.getElementById('name-modal');
        this.instructionsModal = document.getElementById('instructions-modal');
        this.nameInput = document.getElementById('player-name-input');
        this.checkpointProgress = document.getElementById('checkpoint-progress-value');
        this.callbacks = callbacks;
        this.updateCheckpointProgress();

        document.getElementById('btn-start')?.addEventListener('click', () => {
            callbacks.onUiClick();
            this.showModal(this.nameModal);
        });

        document.getElementById('btn-instructions')?.addEventListener('click', () => {
            callbacks.onUiClick();
            this.showModal(this.instructionsModal);
        });

        document.getElementById('btn-close-instructions')?.addEventListener('click', () => {
            callbacks.onUiClick();
            this.hideModal(this.instructionsModal);
        });

        document.getElementById('btn-enter-game')?.addEventListener('click', () => {
            const name = this.nameInput.value.trim();
            if (!name) {
                this.nameInput.classList.add('input-error');
                setTimeout(() => this.nameInput.classList.remove('input-error'), 800);
                return;
            }
            callbacks.onUiClick();
            callbacks.onStart(name);
        });

        this.nameInput?.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') {
                document.getElementById('btn-enter-game').click();
            }
        });

        // Esc fecha o modal de instruções (padrão esperado de acessibilidade)
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Escape' && !this.instructionsModal.classList.contains('hidden')) {
                this.hideModal(this.instructionsModal);
            }
        });
    }

    showModal(modal) {
        modal.classList.remove('hidden');
    }

    hideModal(modal) {
        modal.classList.add('hidden');
    }

    hide() {
        this.root.classList.add('hidden');
        this.hideModal(this.nameModal);
        this.hideModal(this.instructionsModal);
    }

    show() {
        this.updateCheckpointProgress();
        this.root.classList.remove('hidden');
    }

    updateCheckpointProgress() {
        if (!this.checkpointProgress) return;
        let checkpoint = 0;
        try {
            const saved = parseInt(localStorage.getItem('threshold_checkpointLevel'), 10);
            if (Number.isFinite(saved)) checkpoint = Math.max(0, Math.min(2, saved));
        } catch {}
        this.checkpointProgress.textContent = `CHECKPOINT: ${checkpoint} DE 2`;
    }
}