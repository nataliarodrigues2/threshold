import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { eventBus } from './EventBus.js';
import { GameState } from './GameState.js';
import { InputManager } from '../systems/InputManager.js';
import { AudioManager } from '../systems/AudioManager.js';
import { AudioManifest } from '../audio/AudioManifest.js';
import { NotificationSystem } from '../systems/NotificationSystem.js';
import { ObjectiveManager } from '../systems/ObjectiveManager.js';
import { ScoreManager } from '../systems/ScoreManager.js';
import { ApiGameRepository } from '../systems/GameRepository.js';
import { InteractionSystem } from '../interactions/InteractionSystem.js';
import { LevelManager } from '../world/LevelManager.js';
import { RealRoom } from '../world/RealRoom.js';
import { EntityManager } from '../entities/EntityManager.js';
import { Flashlight } from '../player/Flashlight.js';
import { Player } from '../player/Player.js';
import { HUD } from '../ui/HUD.js';
import { MainMenu } from '../ui/MainMenu.js';
import { EndScreen } from '../ui/EndScreen.js';
import { UIManager } from '../ui/UIManager.js';
import { RetroRenderer } from '../rendering/RetroRenderer.js';
import { clearRetroHandles } from '../rendering/RetroMaterial.js';
import { StaticEffect } from '../ui/StaticEffect.js';
import { ProximityStatic } from '../ui/ProximityStatic.js';
import { NokiaPhone } from '../ui/NokiaPhone.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const ITEM_ONLY_IDS = ['radar', 'phone', 'flashlight'];
const PICKUP_MESSAGES = {
    fuse: 'FUSÍVEL COLETADO',
    keycard: 'CARTÃO ENCONTRADO',
    partA: 'PECA A ENCONTRADA',
    partB: 'PECA B ENCONTRADA',
    fragment: 'FRAGMENTO COLETADO',
    radar: 'RADAR ENCONTRADO\nMAPA DISPONÍVEL',
    phone: 'CELULAR ENCONTRADO\nTRANSMISSÕES ATIVAS',
    flashlight: 'LANTERNA ENCONTRADA\nPRESSIONE [F]'
};
const PHONE_MESSAGES = [
    'SINAL FRACO...',
    'ANOMALIA PRÓXIMA.',
    'ELAS OBSERVAM PELAS SOMBRAS.',
    'NÃO CORRA SEM SABER PARA ONDE.',
    'O CHÃO SE REPETE. VOCÊ JÁ PASSOU AQUI.',
    'CONTINUE PELO PORTAL. ELE É A ÚNICA SAÍDA.'
];

export class Game {
    constructor(container) {
        this.container = container;
        this.gameState = new GameState();
        this.input = new InputManager();
        this.audio = new AudioManager();
        this.repository = new ApiGameRepository();
        this.difficulty = null;
        this.diffConfig = null;
        this.levelIndex = 0;
        this.entityManager = null;
        this.flashlight = null;
        this.flashlightOn = false;
        this.phoneTimer = 0;
        this.transitioning = false;
        this._lastPlayStart = 0;
        this.staticEffect = new StaticEffect();
        this.proximityStatic = new ProximityStatic();
        this.nokiaPhone = null;
        this.xrRig = null;
        this.vrButton = null;
        this.xrControllers = [];
    }

    init() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.graphics.maxPixelRatio));
        this.container.appendChild(this.renderer.domElement);

        this.retroRenderer = new RetroRenderer(this.renderer);
        this.retroRenderer.applyPixelatedCSS();
        this.retroRenderer.setSize(window.innerWidth, window.innerHeight);

        this.scene = new THREE.Scene();
        // fog preto em todos os níveis
        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = new THREE.Fog(
            0x000000,
            CONFIG.retro.fogNear,
            CONFIG.retro.fogFar
        );
        this._baseFog = { near: CONFIG.retro.fogNear, far: CONFIG.retro.fogFar };

        this.camera = new THREE.PerspectiveCamera(
            CONFIG.graphics.fov,
            window.innerWidth / window.innerHeight,
            CONFIG.graphics.near,
            CONFIG.graphics.far
        );
        this.setupXR();

        this.clock = new THREE.Clock();

        this.levelManager = new LevelManager(this.scene);

        this.notificationSystem = new NotificationSystem('notifications');
        this.objectiveManager = new ObjectiveManager(this.gameState);
        this.scoreManager = new ScoreManager(this.gameState);

        // Registro central de pontuação: todo objetivo concluído pontua de
        // acordo com CONFIG.scoring. addScore é idempotente (Set), então não
        // soma em dobro mesmo quando o caminho de coleta também pontua.
        // Isso garante que gerador (Level1) e estabilizador (Level2), que usam
        // gameState.completeObjective diretamente, também recebam seus pontos.
        this.unsubscribeObjectiveScoring = eventBus.on('objective:completed', (id) => {
            this.scoreManager.award(id);
        });

        this.interactionSystem = new InteractionSystem(this.camera);
        this.interactionSystem.onPromptChange = (prompt) => this.hud.setPrompt(prompt);
        this.input.onInteract(() => {
            if (this.gameState.state !== 'PLAYING') return;
            if (this.nokiaPhone?.isOpen) return;
            this.interactionSystem.tryInteract();
        });
        this.input.onKeyPress('KeyF', () => this.toggleFlashlight());

        this.hud = new HUD();
        this.nokiaPhone = new NokiaPhone({ input: this.input, gameState: this.gameState, audio: this.audio, camera: this.camera, scene: this.scene });
        // Toggle celular na direita com Q; quando aberto consome WASD/Arrows para navegação sem mover player
        this.input.onKeyPress('KeyQ', () => this.togglePhone());
        this.input.onKeyPress('ArrowLeft', () => {
            if (!this.nokiaPhone?.isOpen) return false;
            this.nokiaPhone.navigate(-1);
            return true;
        });
        this.input.onKeyPress('ArrowRight', () => {
            if (!this.nokiaPhone?.isOpen) return false;
            this.nokiaPhone.navigate(1);
            return true;
        });
        this.input.onKeyPress('ArrowUp', () => {
            if (!this.nokiaPhone?.isOpen) return false;
            this.nokiaPhone.navigate(-1);
            return true;
        });
        this.input.onKeyPress('ArrowDown', () => {
            if (!this.nokiaPhone?.isOpen) return false;
            this.nokiaPhone.navigate(1);
            return true;
        });
        this.input.onXRAction('flashlight', () => this.toggleFlashlight());
        this.input.onXRAction('phone', () => this.togglePhone());
        this.input.onXRAction('turn', (direction) => {
            if (this.gameState.state === 'PLAYING' && !this.nokiaPhone?.isOpen) {
                this.player?.controller.turnBy(direction * (Math.PI / 6));
            }
        });

        // Debug hotkeys (F1-F4)
        this.input.onKeyPress('F1', () => {
            if (typeof window === 'undefined') return;
            window.DEBUG_SHOW_GENERATOR_MARKER = !window.DEBUG_SHOW_GENERATOR_MARKER;
            const marker = this.level?.generator?.meshes?.[0]?.getObjectByName?.('generatorDebugMarker');
            if (marker) marker.visible = !!window.DEBUG_SHOW_GENERATOR_MARKER;
            this.notificationSystem.show(`MARCADOR GERADOR ${window.DEBUG_SHOW_GENERATOR_MARKER ? 'ON' : 'OFF'}`);
        });
        this.input.onKeyPress('F2', () => {
            // dar celular
            this.handlePickup('phone');
            this.notificationSystem.show('DEBUG: CELULAR ADICIONADO');
        });
        this.input.onKeyPress('F3', () => {
            // dar radar
            this.handlePickup('radar');
            this.notificationSystem.show('DEBUG: RADAR ADICIONADO');
        });
        this.input.onKeyPress('F4', () => {
            // dar ambos
            this.handlePickup('phone');
            this.handlePickup('radar');
            this.notificationSystem.show('DEBUG: CELULAR + RADAR ADICIONADOS');
        });
        this.input.onKeyPress('F6', () => {
            // DEBUG: troca pro quarto "mundo real" em construção, sem
            // passar pelo fluxo normal de nível (só pra ver o cenário).
            if (this.level?.group) this.scene.remove(this.level.group);
            this.level = new RealRoom(this.scene);
            this.interactionSystem.interactables = [];
            this.interactionSystem.currentTarget = null;
            this.hud.setPrompt(null);
            if (this.entityManager) { this.entityManager.dispose(); this.entityManager = null; }
            this.player.movement.collisionWorld = this.level;
            this._wakeCameraTest = false;
            this.player.spawnAt(this.level.spawnPoint.x, this.level.spawnPoint.z);
            this.notificationSystem.show('DEBUG: QUARTO REAL (cenário em teste)');
        });
        this.input.onKeyPress('F7', () => {
            // DEBUG: ETAPA 2 — pose da câmera de despertar (deitado no
            // travesseiro). Garante que estamos no quarto primeiro, se
            // ainda não estiver. Alterna entre a pose fixa e o controle
            // normal de andar pela sala.
            if (!(this.level instanceof RealRoom)) {
                if (this.level?.group) this.scene.remove(this.level.group);
                this.level = new RealRoom(this.scene);
                this.interactionSystem.interactables = [];
                this.interactionSystem.currentTarget = null;
                this.hud.setPrompt(null);
                if (this.entityManager) { this.entityManager.dispose(); this.entityManager = null; }
                this.player.movement.collisionWorld = this.level;
            }
            this._wakeCameraTest = !this._wakeCameraTest;
            const pose = this.level.getWakeCameraPose();
            const inXR = this.renderer.xr.isPresenting;

            if (this._wakeCameraTest) {
                if (inXR) {
                    // VR: a rotação sempre vem do sensor do headset — só
                    // dá pra posicionar a ORIGEM (xrRig). Pra simular a
                    // altura de estar deitado mesmo com quem testa em
                    // pé, medimos a altura real atual (mundo) e aplicamos
                    // um deslocamento em Y no rig pra compensar — assim
                    // a altura final bate com a pose alvo seja qual for
                    // a altura de quem estiver com o headset.
                    const realWorldPos = new THREE.Vector3();
                    this.camera.getWorldPosition(realWorldPos);
                    const offsetY = pose.position.y - realWorldPos.y;
                    this.xrRig.position.set(pose.position.x, offsetY, pose.position.z);
                    this.notificationSystem.show('DEBUG: CÂMERA DE DESPERTAR — VR (F7 de novo pra sair)');
                } else {
                    this.camera.position.copy(pose.position);
                    this.camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
                    this.notificationSystem.show('DEBUG: CÂMERA DE DESPERTAR (F7 de novo pra sair)');
                }
            } else {
                if (inXR) {
                    this.xrRig.position.set(this.level.spawnPoint.x, 0, this.level.spawnPoint.z);
                }
                this.player.spawnAt(this.level.spawnPoint.x, this.level.spawnPoint.z);
                this.notificationSystem.show('DEBUG: controle normal');
            }
        });
        this.input.onKeyPress('F8', () => {
            // DEBUG: roda a sequência de despertar inteira (fade, hold,
            // respiração, clareamento) sem precisar terminar o jogo.
            this.notificationSystem.show('DEBUG: SEQUÊNCIA DE DESPERTAR (F8)');
            this.playWakeSequence();
        });
        document.getElementById('item-phone')?.addEventListener('click', () => this.togglePhone());
        this.ui = new UIManager({
            onUiClick: () => this.audio.sfx('ui'),
            onResume: () => this.resume(),
            onRestart: () => this.restart(),
            onBackToMenu: () => this.backToMenu()
        });
        this.endScreen = new EndScreen({ onRestart: () => this.restart() });
        this.mainMenu = new MainMenu({
            onStart: (name, difficulty) => this.start(name, difficulty),
            onUiClick: () => {
                this.audio.init();
                this.audio.resume();
                this.audio.sfx('ui');
            }
        });

        document.getElementById('btn-go-restart')?.addEventListener('click', () => this.restart());
        document.getElementById('btn-go-menu')?.addEventListener('click', () => this.backToMenu());

        const tryLock = () => {
            if (this.gameState.state === 'PLAYING' && document.pointerLockElement === null && !this.transitioning) {
                if (!this.renderer.xr.isPresenting) this.requestPointerLock();
            }
        };
        // Clique no canvas ou em qualquer lugar durante PLAYING tenta travar
        document.addEventListener('pointerdown', tryLock);
        document.addEventListener('click', tryLock);

        document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
        document.addEventListener('pointerlockerror', () => {
            console.warn('[Game] pointer lock falhou');
            // Fallback: avisa que pode arrastar com botão do mouse
            if (this.gameState.state === 'PLAYING') {
                this.notificationSystem.show('CLIQUE E ARRASTE PARA OLHAR\nOU CLIQUE NOVAMENTE PARA TRAVAR MOUSE', { warning: true });
            }
        });
        window.addEventListener('resize', () => this.onResize());

        this.animate = this.animate.bind(this);
        this.renderer.setAnimationLoop(this.animate);

        // pre-carrega assets de áudio (CC0 procedural) em background
        this.audio.loadSounds(AudioManifest).then(res => {
            console.log('[Audio] manifest carregado', res);
        });

        this.showLoadingDone();
    }

    setupXR() {
        this.renderer.xr.enabled = true;
        this.renderer.xr.cameraAutoUpdate = true;
        this.renderer.xr.setReferenceSpaceType('local-floor');

        // The rig is the locomotion origin. WebXR keeps the headset pose on the
        // camera while the game moves this group through the level.
        this.xrRig = new THREE.Group();
        this.xrRig.name = 'XRPlayerRig';
        this.scene.add(this.xrRig);
        this.xrRig.add(this.camera);

        this.vrButton = VRButton.createButton(this.renderer, {
            requiredFeatures: ['local-floor'],
            optionalFeatures: ['bounded-floor']
        });
        this.vrButton.setAttribute('aria-label', 'Entrar em realidade virtual');
        // Menu não é visível em headset: só mostra VR após iniciar jogo
        this.vrButton.style.display = 'none';
        document.body.appendChild(this.vrButton);
        // Overlay 3D simples para pausa/menu em VR (DOM não aparece no headset)
        this._vrMenuGroup = null;

        const controllerModelFactory = new XRControllerModelFactory();
        for (let index = 0; index < 2; index++) {
            const controller = this.renderer.xr.getController(index);
            this.input.registerXRController(controller);

            const rayGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, -1)
            ]);
            const ray = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({
                color: 0xd8c26a,
                transparent: true,
                opacity: 0.35
            }));
            ray.name = 'xr-target-ray';
            ray.scale.z = 4;
            controller.add(ray);
            this.scene.add(controller);

            const grip = this.renderer.xr.getControllerGrip(index);
            grip.add(controllerModelFactory.createControllerModel(grip));
            this.scene.add(grip);
            this.xrControllers.push({ controller, grip });
        }

        this.renderer.xr.addEventListener('sessionstart', () => this.onXRSessionChange(true));
        this.renderer.xr.addEventListener('sessionend', () => this.onXRSessionChange(false));
    }

    _ensureVRMenu() {
        if (this._vrMenuGroup) return this._vrMenuGroup;
        const group = new THREE.Group();
        group.name = 'VRMenu';
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
        const geo = new THREE.PlaneGeometry(1.6, 0.8);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'VRMenuPlane';
        group.add(mesh);
        group.visible = false;
        // head-locked: filho da câmera para sempre à frente do headset
        const anchor = this.camera || this.xrRig;
        anchor?.add(group);
        // à frente dos olhos, levemente abaixo
        group.position.set(0, -0.12, -1.65);
        // canvas helper
        group.userData.canvas = canvas;
        group.userData.ctx = ctx;
        group.userData.tex = tex;
        group.userData.mesh = mesh;
        this._vrMenuGroup = group;
        return group;
    }

    _updateVRMenu(text) {
        const g = this._ensureVRMenu();
        if (!g) return;
        const ctx = g.userData.ctx;
        const canvas = g.userData.canvas;
        const tex = g.userData.tex;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // fundo
        ctx.fillStyle = 'rgba(12,10,8,0.92)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#d8c26a';
        ctx.lineWidth = 6;
        ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
        ctx.fillStyle = '#d8c26a';
        ctx.font = 'bold 54px VT323, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('THRESHOLD', canvas.width / 2, 84);
        ctx.fillStyle = '#fff4d6';
        ctx.font = '28px VT323, monospace';
        const lines = (text || '').split('\n');
        let y = 148;
        for (const line of lines) {
            ctx.fillText(line, canvas.width / 2, y);
            y += 36;
        }
        ctx.fillStyle = 'rgba(216,194,106,0.95)';
        ctx.font = '22px VT323, monospace';
        ctx.fillText('Mova as mãos como caminhada • Rápido = correr • Stick esq. strafe • Stick dir. girar', canvas.width / 2, canvas.height - 38);
        tex.needsUpdate = true;
    }

    _setVRMenuVisible(visible, text) {
        const g = this._ensureVRMenu();
        if (!g) return;
        if (visible) this._updateVRMenu(text);
        g.visible = visible;
    }

    onXRSessionChange(active) {
        this.retroRenderer.setVRMode(active);
        if (active) {
            this.input.clearActions();
            try { document.exitPointerLock(); } catch {}
            this.player?.controller.setXRActive(true);
            // Sincroniza rig na posição real do jogador (spawn foi com isPresenting false → rig 0,0)
            if (this.player) {
                const p = this.player.getPosition();
                this.xrRig.position.set(p.x, 0, p.z);
            }
            if (this.gameState.state === 'MENU') {
                this._setVRMenuVisible(true, 'THRESHOLD — A LIMINAL ESCAPE\n\nVocê entrou em VR no MENU\n\nSAIA DO VR (botão superior)\nInicie no monitor: nome + dificuldade\nDepois entre em VR novamente');
            } else if (this.gameState.state === 'PAUSED') {
                this._setVRMenuVisible(true, 'PAUSADO\n\nGatilho = interagir [E]\nX = lanterna  A = celular\nMova mãos para andar');
            } else if (this.gameState.state === 'PLAYING') {
                this._setVRMenuVisible(false, '');
                // hint breve ao entrar
                setTimeout(() => this._setVRMenuVisible(false, ''), 50);
            }
            // reseta arm-swing
            if (this.input._armSwing) {
                this.input._armSwing.hasPrev = false;
                this.input._armSwing.avgSpeed = 0;
            }
            return;
        }
        this.input.clearActions();
        if (this.nokiaPhone?.isOpen) this.nokiaPhone.close();
        this._setVRMenuVisible(false, '');
        this.xrRig?.position.set(0, 0, 0);
        this.player?.controller.setXRActive(false);
        // volta a esconder botão se voltou ao menu
        if (this.gameState.state !== 'PLAYING') this.vrButton.style.display = 'none';
    }

    showLoadingDone() {
        const loading = document.getElementById('loading');
        setTimeout(() => loading.classList.add('hidden'), 600);
    }

    events() {
        return {
            notify: (msg, opts) => this.notificationSystem.show(msg, opts),
            sfx: (name) => this.audio.sfx(name),
            sfxPositional: (name, pos, opts) => {
                // Usa HRTF quando há um buffer posicional; sons procedurais
                // continuam com fallback global.
                try {
                    const played = pos ? this.audio.playPositional(name, pos, opts) : null;
                    if (!played) this.audio.sfx(name);
                    return played;
                } catch {
                    this.audio.sfx(name);
                    return null;
                }
            },
            onPowerRestored: () => {
                this.objectiveManager.complete('power');
                try { this.audio.sfx('power'); this.audio.setBusVolume('ambient', 0.3, 0.15); setTimeout(()=> this.audio.setBusVolume('ambient', 1, 1.2), 800); } catch {}
            },
            onDoorOpened: () => eventBus.emit('door:opened')
        };
    }

    start(playerName) {
        this.gameState.setPlayerName(playerName);
        this.gameState.setState('PLAYING');
        this._lastPlayStart = performance.now();
        this.mainMenu.hide();
        this.hud.show();
        // VR: menu DOM não aparece no headset, libera botão VR agora
        this.vrButton.style.display = '';
        this.loadLevel();
        this.proximityStatic.start();
        if (!this.renderer.xr.isPresenting) this.requestPointerLock();
        try { this.audio.setReverbForLevel(this.levelIndex); } catch {}
        this.audio.startAmbient(this.diffConfig.flickerIntensity > 1 ? 1.3 : 1.0, this.levelIndex);
        if (this.renderer.xr.isPresenting && this.player) {
            const p = this.player.getPosition();
            this.xrRig.position.set(p.x, 0, p.z);
        }

        // Abertura narrativa — objetivo claro logo de cara, independente
        // da dificuldade (que agora vem sozinha, por andar).
        this.notificationSystem.show(
            'Você escorregou da realidade. Não devia estar aqui. Encontre o caminho de volta.',
            { duration: 6000 }
        );
    }

    loadLevel(index = this.gameState.currentLevelIndex) {
        this.levelIndex = index;
        this.gameState.currentLevelIndex = index;

        // Dificuldade automática por andar — não é mais escolha do menu.
        this.difficulty = CONFIG.levels.difficultyByLevel[index] ?? 'normal';
        this.diffConfig = CONFIG.difficulty[this.difficulty];
        this.hud.setDifficulty(this.difficulty);

        this.level = this.levelManager.load(index, {
            gameState: this.gameState,
            events: this.events(),
            difficulty: this.difficulty
        });

        // compute required support items for this difficulty and show on HUD
        const required = [];
        if (this.diffConfig.hasPhoneRequirement) required.push('phone');
        if (this.diffConfig.hasRadarRequirement) required.push('radar');
        if (this.diffConfig.hasFlashlightRequirement) required.push('flashlight');
        try { this.hud.setRequiredItems(required, this.gameState); } catch {}

        this.player = new Player(this.camera, this.input, this.level, {
            xrRig: this.xrRig,
            isXRActive: () => this.renderer.xr.isPresenting
        });
        this.player.spawnAt(this.level.spawnPoint.x, this.level.spawnPoint.z);
        this.level.setPlayerPosition(this.player.getPosition());
        this.level.onPortalEnter = () => this.handlePortalEnter();

        const objectives = this.level.objectives?.length
            ? this.level.objectives
            : [
                { id: 'fuse', title: 'Encontrar fusível' },
                { id: 'keycard', title: 'Encontrar cartão' },
                { id: 'power', title: 'Restaurar energia' }
            ];
        this.objectiveManager.setObjectives(objectives);

        this.hud.setLevel(this.level, this.gameState);
        this.hud.setLevelName(CONFIG.levels.names[index] ?? `NÍVEL ${index}`);

        this.interactionSystem.setDistanceMultiplier(this.diffConfig.interactionDistanceMult);
        for (const interactable of this.level.interactables) {
            this.interactionSystem.register(interactable);
        }

        this.wirePickups();

        this.unsubscribePortal = eventBus.on('portal:unlocked', () => {
            this.level.portal?.unlock();
            this.level.lighting?.setPowerRestored(1.35);
            this.notificationSystem.show('ANOMALIA ESTABILIZADA\nPORTAL DISPONÍVEL');
            this.audio.sfx('portal');
            try {
                if (this.level.portal?.group) {
                    const p = this.level.portal.group.position;
                    this._portalHum = this.audio.playPositional('portalHum', new THREE.Vector3(p.x, 1, p.z), { volume: 0.16, loop: true, bus: 'world', refDistance: 2, maxDistance: 38, rolloff: 0.7 });
                    if (this._portalHum) this.audio.fadeGain(this._portalHum.gain.gain, 0.16, 1.2);
                }
            } catch {}
        });

        this.setupEntities();
        if (this.diffConfig.hasFlashlightRequirement) {
            this.setupFlashlight();
        }
        this.applyDarkness();
        this.updateItemUiFromState();
        if (this.gameState.state === 'PLAYING') this.proximityStatic.start();
    }

    wirePickups() {
        const register = (pickup, id) => {
            pickup.onPickup = () => this.handlePickup(id);
        };
        if (this.level.pickups) {
            for (const { item, id } of this.level.pickups) {
                register(item, id);
            }
        }
        if (this.level.fusePickup) {
            this.level.fusePickup.onPickup = () => this.handlePickup('fuse');
        }
        if (this.level.keycardPickup) {
            this.level.keycardPickup.onPickup = () => this.handlePickup('keycard');
        }
    }

    handlePickup(itemId) {
        if (!this.gameState.collectItem(itemId)) {
            return false;
        }
        this.level.refreshInteractionStates?.();
        if (ITEM_ONLY_IDS.includes(itemId)) {
            this.handleItemPickup(itemId);
            // se este item também for parte das objectives do nível, marque como completo
            try {
                if (this.level && Array.isArray(this.level.objectives) && this.level.objectives.some(o => o.id === itemId)) {
                    this.objectiveManager.complete(itemId);
                }
            } catch {}
        } else {
            this.objectiveManager.complete(itemId);
        }
        this.notificationSystem.show(PICKUP_MESSAGES[itemId] ?? 'ITEM COLETADO');
        this.audio.sfx('pickup');
        this.scoreManager.award(itemId);
        return true;
    }

    handleItemPickup(itemId) {
        if (itemId === 'radar') {
            this.hud.setRadarEnabled(true);
        } else if (itemId === 'phone') {
            this.hud.setPhoneEnabled(true);
            this.nokiaPhone?.setEnabled(true);
            this.nokiaPhone?.addMessage('SINAL VINCULADO.\nTRANSMISSÕES RECEBIDAS.');
            this.hud.showPhoneText('SINAL VINCULADO. \nTRANSMISSÕES RECEBIDAS.', 2800);
            this.notificationSystem.show('CELULAR [Q] PARA ABRIR', { warning: false });
        } else if (itemId === 'flashlight') {
            if (!this.flashlight) {
                this.setupFlashlight();
            }
            this.hud.setItemOn('flashlight', false);
        }
    }

    togglePhone() {
        if (this.gameState.state !== 'PLAYING') return;
        if (!this.gameState.hasItem('phone')) {
            this.notificationSystem.show('CELULAR NÃO ENCONTRADO', { warning: true });
            return;
        }
        const wasOpen = this.nokiaPhone?.isOpen;
        // alternância: se lanterna ligada, desliga ao abrir celular
        if (!wasOpen && this.flashlightOn && this.flashlight) {
            this.flashlightOn = this.flashlight.toggle() ? true : false;
            if (!this.flashlightOn) this.hud.setItemOn('flashlight', false);
        }
        if (this.nokiaPhone?.toggle()) {
            this.input.clearActions();
            document.exitPointerLock();
        } else if (wasOpen) {
            if (!this.renderer.xr.isPresenting) this.requestPointerLock();
        }
    }

    setupFlashlight() {
        if (this.flashlight) return;
        try {
            this.flashlight = new Flashlight(this.camera);
        } catch (err) {
            this.flashlight = null;
        }
    }

    toggleFlashlight() {
        if (this.nokiaPhone?.isOpen) {
            // alternância: fecha celular e liga lanterna
            this.nokiaPhone.close();
            if (!this.renderer.xr.isPresenting) this.requestPointerLock();
        }
        if (this.gameState.state !== 'PLAYING' || !this.flashlight) {
            return;
        }
        if (!this.gameState.hasItem('flashlight')) {
            this.notificationSystem.show('LANTERNA NÃO ENCONTRADA', { warning: true });
            return;
        }
        this.flashlightOn = this.flashlight.toggle();
        this.hud.setItemOn('flashlight', this.flashlightOn);
        this.audio.sfx('switch');
    }

    setupEntities() {
        if (this.entityManager) {
            this.entityManager.dispose();
            this.entityManager = null;
        }
        if (!this.diffConfig.hasEntities || !this.level) {
            return;
        }
        const playerPosRef = this.player?.getPosition() ?? new THREE.Vector3();
        this.entityManager = new EntityManager({
            level: this.level,
            enemyMode: this.diffConfig.enemyMode,
            count: 1,
            events: this.events(),
            playerPosRef
        });
    }

    applyDarkness() {
        // Fog preto em todos os níveis — quanto mais difícil, mais perto
        const fogCfg = CONFIG.retro.fogByDifficulty?.[this.difficulty] || { near: CONFIG.retro.fogNear, far: CONFIG.retro.fogFar };
        if (this.scene.fog) {
            this.scene.fog.color.set(0x000000);
            this.scene.background = new THREE.Color(0x000000);
            this.scene.fog.near = fogCfg.near;
            this.scene.fog.far = fogCfg.far;
            this._baseFog = { near: fogCfg.near, far: fogCfg.far };
        }
        // Mantém luzes pontuais normais (visibilidade vem do fog + lanterna dinâmica)
        // Não escurece ambient — lanterna faz o papel de estender visão
    }

    resetFog() {
        const fallback = CONFIG.retro.fogByDifficulty?.[this.difficulty] || { near: CONFIG.retro.fogNear, far: CONFIG.retro.fogFar };
        if (this.scene.fog) {
            this.scene.fog.color.set(0x000000);
            this.scene.fog.near = fallback.near;
            this.scene.fog.far = fallback.far;
        }
        if (this.scene.background) {
            this.scene.background.set(0x000000);
        }
        this._baseFog = { near: fallback.near, far: fallback.far };
        if (this.level?.lighting?.ambient) this.level.lighting.ambient.intensity = CONFIG.atmosphere.ambientIntensity;
        if (this.level?.lighting?.hemisphere) this.level.lighting.hemisphere.intensity = 0.85;
    }

    handlePortalEnter() {
        if (this.gameState.state !== 'PLAYING' || this.transitioning) {
            return;
        }
        const missing = this.getMissingRequiredItems();
        if (missing.length > 0) {
            this.notificationSystem.show(`EQUIPAMENTO NECESSÁRIO\n${missing.join(' + ')}`, { warning: true });
            this.audio.sfx('denied');
            return;
        }
        // Each level has its own portal crossing, so use a unique score key.
        this.gameState.addScore(`portal:${this.levelIndex}`, CONFIG.scoring.portal);
        this.transitioning = true;
        if (this.levelIndex >= CONFIG.levels.count - 1) {
            this.completePortalRun();
            return;
        }
        this.gameState.advanceLevel();
        this.input.clearActions();
        document.exitPointerLock();
        const nextName = CONFIG.levels.names[this.gameState.currentLevelIndex] ?? 'NÍVEL ?';
        const nextSubtitle = CONFIG.levels.subtitles?.[this.gameState.currentLevelIndex] ?? '';
        try { this.audio.stopAll(); } catch {}
        this.ui.fadeIn(700).then(async () => {
            this.unloadLevel();
            this.loadLevel();
            try { this.audio.setReverbForLevel(this.levelIndex); this.audio.startAmbient(this.diffConfig.flickerIntensity > 1 ? 1.3 : 1.0, this.levelIndex); } catch {}
            this.ui.fadeOut(500);
            await this.endScreen.showLevelIntro({ title: nextName, subtitle: nextSubtitle }, 2200);
            this.transitioning = false;
            if (!this.renderer.xr.isPresenting) this.requestPointerLock();
            this.updateItemUiFromState();
        });
    }

    sendPhoneMessage() {
        if (!this.gameState.hasItem('phone')) {
            return;
        }
        const text = PHONE_MESSAGES[Math.floor(Math.random() * PHONE_MESSAGES.length)];
        this.hud.showPhoneText(text, 3500);
        this.nokiaPhone?.addMessage(text);
        this.audio.sfx('whisper');
    }

    updateItemUiFromState() {
        this.hud.setRadarEnabled(this.difficulty === 'easy' || this.gameState.hasItem('radar'));
        this.hud.setPhoneEnabled(this.gameState.hasItem('phone'));
        this.hud.setItemOn('flashlight', this.flashlightOn && this.gameState.hasItem('flashlight'));
    }

    unloadLevel() {
        if (this._portalHum) {
            try {
                const h = this._portalHum;
                this.audio.fadeGain(h.gain.gain, 0, 0.6);
                setTimeout(()=>{ try{ h.stop(); }catch{} }, 650);
            } catch {}
            this._portalHum=null;
        }
        if (this.unsubscribePortal) {
            this.unsubscribePortal();
            this.unsubscribePortal = null;
        }
        if (this.entityManager) {
            this.entityManager.dispose();
            this.entityManager = null;
        }
        if (this.flashlight && this.flashlightOn) {
            this.flashlight.toggle();
        }
        if (this.player) {
            this.player.dispose?.();
        }
        this.interactionSystem.interactables = [];
        this.interactionSystem.currentTarget = null;
        this.hud.setPrompt(null);
        this.levelManager.unload();
        this.level = null;
        this.player = null;
        clearRetroHandles();
    }

    cleanupRun() {
        this.staticEffect.stop();
        this.proximityStatic.stop();
        try { this.nokiaPhone?.close(); } catch {}
        try { this.audio.stopAll(); } catch {}
        try { this.audio.setProximityIntensity(0); } catch {}
        this.unloadLevel();
        if (this.flashlight) {
            this.flashlight.dispose();
            this.flashlight = null;
        }
        this.flashlightOn = false;
        this.hud.setRadarEnabled(false);
        this.hud.setPhoneEnabled(false);
        this.resetFog();
    }

    // -------------------------------------------------------------
    // Fade-pra-preto compatível com VR de verdade. O overlay 2D normal
    // (this.ui.fadeIn/fadeOut) é um <div> de HTML — não aparece dentro
    // do headset. Esta é uma esfera preta presa na própria câmera (por
    // dentro da cena 3D), então ela renderiza corretamente nos dois
    // olhos em VR e também no modo desktop normal.
    // -------------------------------------------------------------
    ensureWakeFadeOverlay() {
        if (this._wakeFadeMesh) return this._wakeFadeMesh;
        const geo = new THREE.SphereGeometry(0.6, 12, 8);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
            fog: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 9999; // desenha por cima de tudo, sempre
        mesh.frustumCulled = false;
        mesh.visible = false;
        this.camera.add(mesh); // segue a câmera automaticamente (desktop e VR)
        this._wakeFadeMesh = mesh;
        return mesh;
    }

    vrFadeTo(targetOpacity, durationMs) {
        const mesh = this.ensureWakeFadeOverlay();
        mesh.visible = true;
        const startOpacity = mesh.material.opacity;
        return new Promise((resolve) => {
            const start = performance.now();
            const step = (now) => {
                const t = Math.min(1, (now - start) / durationMs);
                mesh.material.opacity = startOpacity + (targetOpacity - startOpacity) * t;
                if (t < 1) {
                    requestAnimationFrame(step);
                } else {
                    mesh.visible = mesh.material.opacity > 0.001;
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    }

    // Anima setWakeHaze(1 → 0) no nível atual ao longo de durationMs.
    animateWakeHazeClear(durationMs) {
        return new Promise((resolve) => {
            const start = performance.now();
            const step = (now) => {
                const t = Math.min(1, (now - start) / durationMs);
                const eased = 1 - Math.pow(1 - t, 3); // ease-out cúbico
                this.level?.setWakeHaze?.(1 - eased);
                if (t < 1) {
                    requestAnimationFrame(step);
                } else {
                    this.level?.clearWakeHaze?.();
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    }

    // -------------------------------------------------------------
    // Sequência de despertar (chamada ao concluir a última fase).
    // Passos 1-10 do pedido: preto → segura → respiração → clareia
    // gradual + turvo→nítido → cabeça livre (VR) → sem movimento do
    // corpo → libera controle no final.
    // -------------------------------------------------------------
    async playWakeSequence() {
        const HOLD_BLACK_MS = 1400;
        const CLEAR_DURATION_MS = 4200;

        // 1) fade suave pro preto (funciona em VR — ver ensureWakeFadeOverlay)
        await this.vrFadeTo(1, 900);

        // 2) segura preto por um instante
        await new Promise((resolve) => setTimeout(resolve, HOLD_BLACK_MS));

        // Troca de cena pro quarto — ainda no preto, jogador não vê a troca
        if (this.level?.group) this.scene.remove(this.level.group);
        this.level = new RealRoom(this.scene);
        this.interactionSystem.interactables = [];
        this.interactionSystem.currentTarget = null;
        this.hud.setPrompt(null);
        if (this.entityManager) { this.entityManager.dispose(); this.entityManager = null; }
        this.player.movement.collisionWorld = this.level;

        const pose = this.level.getWakeCameraPose();
        const inXR = this.renderer.xr.isPresenting;
        if (inXR) {
            // VR: rotação sempre vem do sensor real do headset — só
            // posicionamos a origem (xrRig), com deslocamento de altura
            // pra simular estar deitado seja qual for a altura real de
            // quem estiver testando.
            const realWorldPos = new THREE.Vector3();
            this.camera.getWorldPosition(realWorldPos);
            const offsetY = pose.position.y - realWorldPos.y;
            this.xrRig.position.set(pose.position.x, offsetY, pose.position.z);
        } else {
            this.camera.position.copy(pose.position);
            this.camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
        }

        // 9) bloqueia movimento corporal — a rotação da cabeça (VR) nunca
        // é tocada aqui, continua 100% livre o tempo todo.
        this._wakeSequenceActive = true;

        // 3) respiração sutil
        try { this.audio.playWakeBreath(); } catch {}

        // turvo máximo antes de clarear
        this.level.setWakeHaze(1);

        // 4-6) revela a imagem do preto E clareia a névoa/luz ao mesmo
        // tempo, em paralelo — "abrir os olhos" e "focar a visão" juntos.
        await Promise.all([
            this.vrFadeTo(0, CLEAR_DURATION_MS),
            this.animateWakeHazeClear(CLEAR_DURATION_MS)
        ]);

        // 10) libera o controle do jogador de volta
        this._wakeSequenceActive = false;
    }

    async completePortalRun() {
        if (this.gameState.state === 'GAMEOVER' || this.gameState.state === 'COMPLETED') {
            return;
        }
        this.gameState.setState('COMPLETED');
        this.transitioning = true;
        try { this.audio.stopAll(); } catch {}
        this.scoreManager.award('escape');
        this.input.clearActions();
        document.exitPointerLock();

        await this.playWakeSequence();

        this.hud.hide();
        this.ui.fadeOut(500);
        await this.endScreen.showLevelIntro(
            { title: 'VOCÊ ACORDA', subtitle: 'DE VOLTA À REALIDADE. QUANTO TEMPO REALMENTE SE PASSOU?' },
            3200
        );
        this.endScreen.show({
            playerName: this.gameState.playerName,
            score: this.gameState.score,
            durationSeconds: this.gameState.elapsedSeconds
        });
        this.ui.fadeOut();

        this.repository.saveResult({
            playerName: this.gameState.playerName,
            score: this.gameState.score,
            duration: Math.round(this.gameState.elapsedSeconds),
            completedAt: new Date().toISOString(),
            levelName: CONFIG.levels.names[this.gameState.currentLevelIndex] ?? 'CHÃO 0',
            completed: true
        });
    }

    async gameOver() {
        if (this.gameState.state !== 'PLAYING') {
            return;
        }
        this.gameState.setState('GAMEOVER');
        this.input.clearActions();
        document.exitPointerLock();

        try { this.audio.stopAll(); } catch {}
        this.audio.sfx('denied');
        // para ruído de proximidade e liga chuvisco total de game over
        this.proximityStatic.stop();
        this.staticEffect.start();
        await this.ui.fadeIn(700);
        this.hud.hide();
        document.getElementById('go-player').textContent = this.gameState.playerName;
        document.getElementById('go-score').textContent = String(this.gameState.score).padStart(3, '0');
        document.getElementById('game-over-screen').classList.remove('hidden');
        this.ui.fadeOut(300);

        this.repository.saveResult({
            playerName: this.gameState.playerName,
            score: this.gameState.score,
            duration: Math.round(this.gameState.elapsedSeconds),
            completedAt: new Date().toISOString(),
            levelName: CONFIG.levels.names[this.levelIndex] ?? 'CHÃO 0',
            completed: false
        });
    }

    requestPointerLock() {
        const el = this.renderer?.domElement;
        if (!el || typeof el.requestPointerLock !== 'function') return;
        // Garante foco antes de travar (alguns browsers exigem)
        try { el.focus?.(); } catch {}
        const result = el.requestPointerLock();
        if (result && typeof result.catch === 'function') {
            result.catch((err) => {
                console.warn('[Game] requestPointerLock falhou:', err?.message ?? err);
            });
        }
    }

    getMissingRequiredItems() {
        if (!this.diffConfig) return [];
        const required = [];
        if (this.diffConfig.hasRadarRequirement && !this.gameState.hasItem('radar')) required.push('RADAR');
        if (this.diffConfig.hasPhoneRequirement && !this.gameState.hasItem('phone')) required.push('CELULAR');
        if (this.diffConfig.hasFlashlightRequirement && !this.gameState.hasItem('flashlight')) required.push('LANTERNA');
        return required;
    }

    onPointerLockChange() {
        if (this.renderer?.xr?.isPresenting) {
            // em VR o pause 3D já foi tratado em pause()/resume()
            return;
        }
        // Se o lock foi adquirido, esconde pausa caso estivesse visível
        if (document.pointerLockElement !== null) {
            if (this.gameState.state === 'PAUSED') {
                if (this.ui.isPauseVisible()) {
                    this.ui.hidePause();
                    this.gameState.setState('PLAYING');
                    this._lastPlayStart = performance.now();
                }
            }
            return;
        }
        // Celular aberto libera o cursor intencionalmente — não pausar
        if (this.nokiaPhone?.isOpen) return;
        // Evita pausar imediatamente após entrar em PLAYING (lock ainda não concedido)
        // - sem isso a câmera/minimapa parecem congelados no primeiro segundo
        if (document.pointerLockElement === null && this.gameState.state === 'PLAYING' && !this.transitioning) {
            const elapsedSincePlay = performance.now() - this._lastPlayStart;
            if (elapsedSincePlay < 900) return;
            this.pause();
        }
    }

    pause() {
        this.gameState.setState('PAUSED');
        this.input.clearActions();
        if (this.renderer.xr.isPresenting) {
            this._setVRMenuVisible(true, 'PAUSADO\n\nGatilho = interagir [E]\nX = lanterna  A = celular\nMova mãos para andar');
        } else {
            this.ui.showPause();
        }
        try { this.audio.context?.suspend?.(); } catch {}
    }

    resume() {
        this.gameState.setState('PLAYING');
        this._lastPlayStart = performance.now();
        try { this.audio.context?.resume?.(); } catch {}
        if (this.renderer.xr.isPresenting) {
            this._setVRMenuVisible(false, '');
        } else {
            if (!this.renderer.xr.isPresenting) this.requestPointerLock();
        }
    }

    restart() {
        this.staticEffect.stop();
        this.proximityStatic.stop();
        this.cleanupRun();
        this.transitioning = false;
        this.endScreen.hide();
        document.getElementById('game-over-screen')?.classList.add('hidden');
        this.ui.hidePause();
        this.notificationSystem.clear();
        // preserve checkpoint so restart resumes at highest reached level
        this.gameState.reset(true);
        this.objectiveManager.reset();
        this.hud.reset();
        this.hud.setDifficulty(this.difficulty);

        // show checkpoint in HUD
        try { this.hud.setCheckpoint(this.gameState.checkpointLevelIndex ?? 0); } catch {}
        this.gameState.setState('PLAYING');
        this._lastPlayStart = performance.now();
        this.hud.show();
        this.loadLevel();
        if (!this.renderer.xr.isPresenting) this.requestPointerLock();
    }

    backToMenu() {
        this.staticEffect.stop();
        this.proximityStatic.stop();
        this.cleanupRun();
        this.transitioning = false;
        this.endScreen.hide();
        document.getElementById('game-over-screen')?.classList.add('hidden');
        this.ui.hidePause();
        this.notificationSystem.clear();
        // keep the highest reached floor when returning to the menu after death
        this.gameState.reset(true);
        this.objectiveManager.reset();
        this.hud.reset();
        this.hud.setDifficulty(null);
        this.hud.hide();
        this.resetFog();
        this.gameState.setState('MENU');
        this.mainMenu.show();
    }

    animate() {
        const delta = Math.min(this.clock.getDelta(), 0.05);
        const time = this.clock.elapsedTime;

        const playing = this.gameState.state === 'PLAYING';
        if (playing) {
            this.gameState.elapsedSeconds += delta;
            this.input.updateXR(delta);
            try {
                if (!this._wakeCameraTest && !this._wakeSequenceActive) {
                    this.player.update(delta, !this.nokiaPhone?.isOpen);
                    this.level.setPlayerPosition(this.player.getPosition());
                }
            } catch (err) {
                console.warn('[Game] player.update falhou', err);
            }
            try { this.interactionSystem.update(); } catch (err) { console.warn('[Game] interactionSystem.update falhou', err); }
            if (this.level.updateAmbientEvents) {
                try { this.level.updateAmbientEvents(delta, time); } catch (err) { console.warn('[Game] ambientEvents falhou', err); }
            }
            if (this.entityManager) {
                try { this.entityManager.update(delta, time, () => this.gameOver()); } catch (err) { console.warn('[Game] entityManager.update falhou', err); }
                try { this.updateProximityNoise(); } catch (err) { console.warn('[Game] proximity update falhou', err); }
            } else {
                try { this.proximityStatic.setIntensity(0); } catch {}
            }
            if (this.flashlight) {
                try { this.flashlight.update(delta, time); } catch (err) { console.warn('[Game] flashlight.update falhou', err); }
                try { this.updateDynamicFog(delta, time); } catch (err) { console.warn('[Game] dynamic fog falhou', err); }
            } else {
                try { this.updateDynamicFog(delta, time); } catch {}
            }
            if (this.nokiaPhone?.update) {
                try { this.nokiaPhone.update(delta, time); } catch {}
            }
            try { this.audio.updateListener(this.camera); } catch {}

            if (this.gameState.hasItem('phone')) {
                this.phoneTimer += delta;
                if (this.phoneTimer > 18) {
                    this.phoneTimer = 0;
                    try { this.sendPhoneMessage(); } catch {}
                }
            }
            try { this.hud.updateMinimap(this.player.getPosition(), this.player.controller.yaw); } catch (err) { console.warn('[Game] minimap update falhou', err); }
            // passos do jogador -> sfx footstep por superfície
            try {
                const moving = ['forward', 'backward', 'left', 'right']
                    .some((action) => this.input.isActionActive(action));
                const sprint = this.input.isActionActive('run') || this.input.isXRSprinting();
                const surface = this.level?.footstepSurface || 'carpet';
                if (moving && this.gameState.state === 'PLAYING') this.audio.playFootstep(sprint, surface);
            } catch {}
        }

        if (this.level) {
            try { this.level.update(delta, time); } catch (err) { console.warn('[Game] level.update falhou', err); }
        }

        try { this.retroRenderer.render(this.scene, this.camera, time); } catch (err) { console.warn('[Game] render falhou', err); }
    }

    updateDynamicFog(delta, time) {
        if (!this.scene?.fog || !this._baseFog) return;
        const isOn = this.flashlight?.isOn() && this.gameState?.hasItem('flashlight');
        // bônus de visão com lanterna: quanto mais difícil, maior o ganho
        const bonusByDiff = this.difficulty === 'hard' ? 16 : this.difficulty === 'normal' ? 10 : 6;
        const targetFar = this._baseFog.far + (isOn ? bonusByDiff + Math.sin(time * 2.1) * 1.2 : 0);
        const targetNear = this._baseFog.near + (isOn ? 2.5 + Math.sin(time * 1.3) * 0.6 : 0);
        // lerp suave
        const lerp = 1 - Math.pow(0.001, delta * 3); // ~0.15 a 60fps
        // fallback para delta grande
        const t = Math.min(1, delta * 4);
        const mix = lerp || t;
        this.scene.fog.far += (targetFar - this.scene.fog.far) * Math.min(1, delta * 5);
        this.scene.fog.near += (targetNear - this.scene.fog.near) * Math.min(1, delta * 5);
    }

    updateProximityNoise() {
        if (!this.entityManager || !this.proximityStatic) return;
        const entities = this.entityManager.entities;
        if (!entities || entities.length === 0) { this.proximityStatic.setIntensity(0); return; }
        const level = this.level;
        const playerPos = this.player?.getPosition() ?? this.playerPosRef;
        // distância pelo corredor (BFS) — não atravessa paredes
        const pathDistFor = (entity) => {
            try {
                if (!level || !level.worldToCell || !level.isSolidCell) return entity.distanceToPlayerXZ();
                const eCell = level.worldToCell(entity.group.position.x, entity.group.position.z);
                const pCell = level.worldToCell(playerPos.x, playerPos.z);
                if (eCell.x === pCell.x && eCell.z === pCell.z) return entity.distanceToPlayerXZ();
                // Se linha reta não bloqueada, usa euclidiana (mais barato e preciso)
                if (!entity.lineBlocked || !entity.lineBlocked(entity.group.position, playerPos)) {
                    return entity.distanceToPlayerXZ();
                }
                // BFS pelo grid para distância pelo corredor
                const cols = level.cols, rows = level.rows;
                const q = [{ x: eCell.x, z: eCell.z, d: 0 }];
                const visited = new Set([`${eCell.x},${eCell.z}`]);
                let head = 0;
                while (head < q.length) {
                    const cur = q[head++];
                    if (cur.x === pCell.x && cur.z === pCell.z) {
                        return cur.d * CONFIG.game.cellSize;
                    }
                    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                        const nx = cur.x + dx, nz = cur.z + dz;
                        const key = `${nx},${nz}`;
                        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
                        if (visited.has(key)) continue;
                        if (level.isSolidCell(nx, nz)) continue;
                        visited.add(key);
                        q.push({ x: nx, z: nz, d: cur.d + 1 });
                    }
                    if (q.length > 400) break;
                }
                // sem caminho: penaliza (parede grossa)
                return entity.distanceToPlayerXZ() * 2.2 + 12;
            } catch { return entity.distanceToPlayerXZ(); }
        };
        let minDist = Infinity;
        let maxObserve = 0;
        for (const e of entities) {
            const d = pathDistFor(e);
            if (d < minDist) minDist = d;
            if (e.observeRange > maxObserve) maxObserve = e.observeRange;
        }
        const maxDist = maxObserve || (9 * 3.5);
        const minClose = 2.0;
        let t = 0;
        if (minDist >= maxDist) t = 0;
        else if (minDist <= minClose) t = 1;
        else t = (maxDist - minDist) / (maxDist - minClose);
        t = Math.pow(Math.max(0, Math.min(1, t)), 1.35);
        let isHunt = false;
        let huntEntity = null;
        try {
            isHunt = entities.some(e => e.state === 'CHASING' || e.state === 'STALKING');
            huntEntity = entities.find(e => e.state === 'CHASING' || e.state === 'STALKING');
            if (isHunt) t = Math.min(1, t * 1.15 + 0.08);
        } catch {}
        if (entities.every(e => e.state === 'GONE' || e.state === 'IDLE_HIDDEN') && minDist > maxDist * 0.75) t *= 0.5;
        if (minDist > maxDist * 0.9) t *= 0.25;
        this.proximityStatic.setIntensity(t);
        try { this.audio.setProximityIntensity(t); } catch {}
        // chase layer: heartbeat + growl + ducking
        try {
            const wasHunt = this._wasHunt || false;
            if (isHunt && t > 0.28) {
                if (!wasHunt) {
                    const pos = huntEntity ? huntEntity.group.position : playerPos;
                    this.audio.playEntityGrowl(pos, t);
                    this.audio.startHeartbeat();
                    this.audio.duckBus('ambient', 0.62, 0.5);
                }
                this.audio.updateHeartbeatRate(t);
                if (huntEntity && Math.random() < 0.07) this.audio.playEntityBreathAsset(huntEntity.group.position, t);
            } else if (wasHunt && !isHunt) {
                this.audio.stopHeartbeat(1.4);
                this.audio.setBusVolume('ambient', 1, 1.2);
            }
            // vanish detect
            for (const e of entities) {
                const prev = e._prevStateForAudio || null;
                if (e.state === 'VANISHING' && prev !== 'VANISHING') {
                    this.audio.playEntityVanish(e.group.position);
                }
                e._prevStateForAudio = e.state;
            }
            this._wasHunt = isHunt;
        } catch {}
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.retroRenderer.setSize(window.innerWidth, window.innerHeight);
    }
}
