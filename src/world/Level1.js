import * as THREE from 'three';
import { Level } from './Level.js';
import { Lighting } from './Lighting.js';
import { CONFIG } from '../core/Config.js';
import {
    createWallTexture,
    createCarpetTexture,
    createCeilingTexture
} from './Textures.js';
import { PickupItem } from '../interactions/PickupItem.js';
import { Portal } from '../interactions/Portal.js';
import { Interactable } from '../interactions/Interactable.js';
import { configureRetroMaterial } from '../rendering/RetroMaterial.js';

const MAP = [
    '###################',
    '#S................#',
    '#........#........#',
    '#.#.#....#...#.#..#',
    '#.#A#....#...#B#..#',
    '#.#.#....#...#.#..#',
    '#........#........#',
    '#........#........#',
    '#........#........#',
    '#........#........#',
    '#........#....###.#',
    '#..............G..#',
    '#..#..#.......###.#',
    '#.O#..#...........#',
    '###################'
];

const POINT_LIGHT_CELLS = [
    [2, 2], [8, 7], [15, 2],
    [3, 7], [9, 7], [15, 7],
    [3, 11], [9, 11], [16, 11]
];

const FLICKER_INDICES = [1, 5, 8];

class Generator extends Interactable {
    constructor({ mesh, indicatorMaterial, gameState, events }) {
        super(mesh);
        this.gameState = gameState;
        this.events = events;
        this.indicatorMaterial = indicatorMaterial;
        this.activated = false;
    }

    canInteract() {
        return !this.activated && this.active;
    }

    getPrompt() {
        if (!(this.gameState.hasItem('partA') && this.gameState.hasItem('partB'))) {
            return 'GERADOR — faltam as peças A e B';
        }
        return '[E] Ativar gerador';
    }

    interact() {
        if (!(this.gameState.hasItem('partA') && this.gameState.hasItem('partB'))) {
            this.events.notify('FALTAM AS PEÇAS A E B', { warning: true });
            this.events.sfx('denied');
            return;
        }
        this.activated = true;
        this.active = false;
        this.events.notify('GERADOR ATIVADO');
        this.events.sfx('power');
        this.gameState.completeObjective('generator');
        this.gameState.addScore('generator', CONFIG.scoring.generator ?? 0);
    }

    update(delta, time) {
        if (this.activated) {
            const pulse = Math.sin(time * 5) * 0.5 + 0.5;
            this.indicatorMaterial.emissiveIntensity = 0.8 + pulse * 0.8;
        }
    }
}

export class Level1 extends Level {
    constructor(scene, { gameState, events, difficulty }) {
        super(scene);
        this.footstepSurface = 'concrete';
        this.gameState = gameState;
        this.events = events;
        this.difficulty = difficulty || 'normal';
        this.diffConfig = CONFIG.difficulty[this.difficulty];
        this.grid = MAP;
        this.rows = MAP.length;
        this.cols = MAP[0].length;
        this.portal = null;
        this.pickups = [];
        this.objectives = [
            { id: 'partA', title: 'Encontrar a PECA A' },
            { id: 'partB', title: 'Encontrar a PECA B' },
            { id: 'generator', title: 'Ativar o GERADOR' }
        ];

        // adicionar itens de suporte como objetivos quando exigidos pela dificuldade
        if (this.diffConfig.hasPhoneRequirement) {
            this.objectives.unshift({ id: 'phone', title: 'Encontrar o CELULAR' });
        }
        if (this.diffConfig.hasRadarRequirement) {
            this.objectives.unshift({ id: 'radar', title: 'Encontrar o RADAR' });
        }

        this.buildEnvironment();
        this.buildLights();
        this.buildPortalStructure();
        this.buildGameplay();

        const spawnCell = this.findCell('S');
        if (spawnCell) {
            this.spawnPoint.copy(this.cellToWorld(spawnCell.col, spawnCell.row));
            this.spawnPoint.y = CONFIG.player.height;
        }
    }

    findCell(char) {
        for (let row = 0; row < this.rows; row++) {
            const col = this.grid[row].indexOf(char);
            if (col !== -1) {
                return { col, row };
            }
        }
        return null;
    }

    buildEnvironment() {
        const size = this.cols * this.cellSize;
        const wallTexture = createWallTexture(1, 1);
        const floorTexture = createCarpetTexture(this.cols / 2, this.rows / 2);
        const ceilingTexture = createCeilingTexture(this.cols / 2, this.rows / 2);

        const floorMaterial = new THREE.MeshLambertMaterial({
            map: floorTexture,
            color: 0x8f8f8f
        });
        configureRetroMaterial(floorMaterial);
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(size, size, this.cols, this.rows),
            floorMaterial
        );
        floor.rotation.x = -Math.PI / 2;
        this.group.add(floor);

        const ceilingMaterial = new THREE.MeshLambertMaterial({
            map: ceilingTexture,
            color: 0x8a8a8a
        });
        configureRetroMaterial(ceilingMaterial);
        const ceiling = new THREE.Mesh(
            new THREE.PlaneGeometry(size, size, this.cols, this.rows),
            ceilingMaterial
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = CONFIG.game.wallHeight;
        this.group.add(ceiling);

        const wallCells = [];
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (this.grid[row][col] === '#') {
                    wallCells.push({ col, row });
                }
            }
        }

        const wallGeometry = new THREE.BoxGeometry(
            this.cellSize,
            CONFIG.game.wallHeight,
            this.cellSize
        );
        const wallMaterial = new THREE.MeshLambertMaterial({
            map: wallTexture,
            color: 0x9a9a9a
        });
        configureRetroMaterial(wallMaterial);
        const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, wallCells.length);
        const matrix = new THREE.Matrix4();
        wallCells.forEach((cell, index) => {
            const world = this.cellToWorld(cell.col, cell.row);
            matrix.makeTranslation(world.x, CONFIG.game.wallHeight / 2, world.z);
            walls.setMatrixAt(index, matrix);
        });
        walls.instanceMatrix.needsUpdate = true;
        this.group.add(walls);

        this.buildFixtures();
    }

    buildFixtures() {
        const fixtureGeometry = new THREE.BoxGeometry(1.4, 0.06, 0.5);
        const fixtureMaterialOn = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
        const fixtureMaterialOff = new THREE.MeshBasicMaterial({ color: 0x9a9175 });
        const fixturesOn = [];
        const fixturesOff = [];

        for (let row = 1; row < this.rows - 1; row++) {
            for (let col = 1; col < this.cols - 1; col++) {
                if (this.grid[row][col] === '#') {
                    continue;
                }
                const isLit = (col * 7 + row * 5) % 4 !== 0 || this.isNearLight(col, row);
                const world = this.cellToWorld(col, row);
                const target = isLit ? fixturesOn : fixturesOff;
                target.push({ x: world.x, z: world.z });
            }
        }

        const addFixtures = (list, material) => {
            if (list.length === 0) return;
            const instanced = new THREE.InstancedMesh(fixtureGeometry, material, list.length);
            const matrix = new THREE.Matrix4();
            list.forEach((pos, index) => {
                matrix.makeTranslation(pos.x, CONFIG.game.wallHeight - 0.05, pos.z);
                instanced.setMatrixAt(index, matrix);
            });
            instanced.instanceMatrix.needsUpdate = true;
            this.group.add(instanced);
        };

        addFixtures(fixturesOn, fixtureMaterialOn);
        addFixtures(fixturesOff, fixtureMaterialOff);
    }

    isNearLight(col, row) {
        return POINT_LIGHT_CELLS.some(([cx, cz]) => Math.abs(cx - col) <= 1 && Math.abs(cz - row) <= 1);
    }

    buildLights() {
        this.lighting = new Lighting(this.scene);
        const lightData = POINT_LIGHT_CELLS.map(([col, row]) => ({
            col,
            row,
            position: this.cellToWorld(col, row)
        }));
        this.lighting.setup(lightData, FLICKER_INDICES, this.diffConfig.flickerIntensity);
        this.updatables.push({ update: (delta) => this.lighting.update(delta) });
    }

    buildPortalStructure() {
        const portalCell = this.findCell('O');
        const world = this.cellToWorld(portalCell.col, portalCell.row);
        const half = this.cellSize / 2;
        const structureMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2720 });
        configureRetroMaterial(structureMaterial);

        const cableGeometry = new THREE.CylinderGeometry(0.035, 0.035, CONFIG.game.wallHeight - 0.3, 6);
        const cableMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1815 });
        configureRetroMaterial(cableMaterial);
        for (const offset of [-1.3, -1.0, -0.6, 0.6, 1.0, 1.3]) {
            const cable = new THREE.Mesh(cableGeometry, cableMaterial);
            cable.position.set(world.x + half - 0.1, (CONFIG.game.wallHeight - 0.3) / 2, world.z + offset);
            this.group.add(cable);
        }

        const frameBase = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 0.12, this.cellSize * 0.9),
            structureMaterial
        );
        frameBase.position.set(world.x + half - 0.175, 0.06, world.z);
        this.group.add(frameBase);

        const frameSide = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, CONFIG.game.wallHeight * 0.9, 0.12),
            structureMaterial
        );
        frameSide.position.set(world.x + half - 0.175, CONFIG.game.wallHeight * 0.45, world.z);
        this.group.add(frameSide);

        this.portal = new Portal(
            new THREE.Vector3(world.x + half - 0.175, 0, world.z),
            -Math.PI / 2
        );
        this.group.add(this.portal.group);
        this.updatables.push({
            update: (delta, time) => {
                const entered = this.portal.update(delta, time, this.playerPosition ?? world);
                if (entered && this.onPortalEnter) {
                    this.onPortalEnter();
                }
            }
        });
    }

    setPlayerPosition(position) {
        this.playerPosition = position;
    }

    buildGameplay() {
        this.buildPart('A', 'partA', '[E] Pegar peça A');
        this.buildPart('B', 'partB', '[E] Pegar peça B');
        this.buildGenerator();

        // colocar celular no CHÃO 1 quando a dificuldade exigir
        if (this.diffConfig.hasPhoneRequirement) {
            // celular em uma célula aberta próxima ao spawn
            const phoneWorld = this.cellToWorld(3, 1);
            const phoneMesh = this.createPhoneMesh();
            const phone = new PickupItem(phoneMesh, { id: 'phone', prompt: '[E] Pegar celular' });
            phone.meshes[0].position.set(phoneWorld.x, 0.9, phoneWorld.z);
            phone.baseY = 0.9;
            this.group.add(phone.meshes[0]);
            this.addInteractable(phone);
            this.pickups.push({ item: phone, id: 'phone' });
        }
        if (this.diffConfig.hasRadarRequirement) {
            const radarWorld = this.cellToWorld(7, 1);
            const radar = new PickupItem(this.createRadarMesh(), { id: 'radar', prompt: '[E] Pegar radar' });
            radar.meshes[0].position.set(radarWorld.x, 0.9, radarWorld.z);
            radar.baseY = 0.9;
            this.group.add(radar.meshes[0]);
            this.addInteractable(radar);
            this.pickups.push({ item: radar, id: 'radar' });
        }
    }

    buildPart(glyph, id, prompt) {
        const cell = this.findCell(glyph);
        const world = this.cellToWorld(cell.col, cell.row);
        const part = new PickupItem(this.createPartMesh(glyph), { id, prompt });
        part.meshes[0].position.set(world.x, 0.9, world.z);
        part.baseY = 0.9;
        this.group.add(part.meshes[0]);
        this.addInteractable(part);
        this.pickups.push({ item: part, id });
    }

    createPartMesh(glyph) {
        const group = new THREE.Group();
        const color = glyph === 'A' ? 0xff5a3c : 0x3c8aff;
        const coreMat = new THREE.MeshLambertMaterial({
            color,
            emissive: color
        });
        configureRetroMaterial(coreMat);
        const core = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.18),
            coreMat
        );
        const haloMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide
        });
        const halo = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.3),
            haloMat
        );
        group.add(core, halo);
        return group;
    }

    createPhoneMesh() {
        const group = new THREE.Group();
        const color = 0x66ccff;
        const placeholderMat = new THREE.MeshLambertMaterial({ color, emissive: color });
        configureRetroMaterial(placeholderMat);
        const placeholder = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.18), placeholderMat);
        group.add(placeholder);
        const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthTest: true, depthWrite: false });
        const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), haloMat);
        group.add(halo);
        return group;
    }

    createRadarMesh() {
        const group = new THREE.Group();
        const color = 0x44ffaa;
        const material = new THREE.MeshLambertMaterial({ color, emissive: color });
        configureRetroMaterial(material);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 8), material);
        core.rotation.x = Math.PI / 2;
        const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.3, side: THREE.DoubleSide
        }));
        group.add(core, halo);
        return group;
    }

    buildGenerator() {
        const cell = this.findCell('G');
        const world = this.cellToWorld(cell.col, cell.row);

        const group = new THREE.Group();

        const baseGeo = new THREE.BoxGeometry(1.6, 0.5, 1);
        const baseMat = new THREE.MeshLambertMaterial({ color: 0x4a4638 });
        configureRetroMaterial(baseMat);
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 0.25;

        const drumGeo = new THREE.CylinderGeometry(0.4, 0.5, 0.7, 12);
        const drumMat = new THREE.MeshLambertMaterial({ color: 0x6a6248 });
        configureRetroMaterial(drumMat);
        const drum = new THREE.Mesh(drumGeo, drumMat);
        drum.position.y = 0.85;

        const indicatorMat = new THREE.MeshLambertMaterial({
            color: 0x881111,
            emissive: 0x550000
        });
        configureRetroMaterial(indicatorMat);
        const indicator = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 8, 6),
            indicatorMat
        );
        indicator.position.set(0.55, 1.25, 0.45);

        // marcador de debug para localizar o gerador em runtime
        const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), markerMat);
        marker.position.set(0, 1.8, 0);
        marker.name = 'generatorDebugMarker';
        marker.visible = (typeof window !== 'undefined') ? !!window.DEBUG_SHOW_GENERATOR_MARKER : false;
        group.add(marker);

        group.add(base, drum, indicator);
        // posiciona o grupo do gerador na célula do mapa
        group.position.set(world.x, 0, world.z);
        this.group.add(group);

        this.generator = new Generator({
            mesh: group,
            indicatorMaterial: indicatorMat,
            gameState: this.gameState,
            events: this.events
        });
        this.addInteractable(this.generator);
    }

    refreshInteractionStates() {}

    updateAmbientEvents(delta, time) {}
}
