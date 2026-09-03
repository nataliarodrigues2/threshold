export class MainMenu {
    constructor(callbacks) {
        this.root = document.getElementById('main-menu');
        this.nameModal = document.getElementById('name-modal');
        this.instructionsModal = document.getElementById('instructions-modal');
        this.nameInput = document.getElementById('player-name-input');
        this.callbacks = callbacks;

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
        this.root.classList.remove('hidden');
    }
}