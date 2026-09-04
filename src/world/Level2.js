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
    '#.................#',
    '#........S....#...#',
    '#..#R....#....#...#',
    '#..#.....#..#.....#',
    '#..#.....#..#.....#',
    '#........#...#....#',
    '#..O#........#....#',
    '#...#....#...#....#',
    '#........#........#',
    '#........#........#',
    '#.....##.#....Y...#',
    '#......#.#........#',
    '#.................#',
    '###################'
];

const POINT_LIGHT_CELLS = [
    [9, 4], [4, 3], [14, 4],
    [3, 7], [9, 9], [14, 11],
    [6, 12], [16, 8]
];

const FLICKER_INDICES = [1, 3, 6];

class Stabilizer extends Interactable {
    constructor({ mesh, indicatorMaterial, gameState, events, onStabilized }) {
        super(mesh);
        this.gameState = gameState;
        this.events = events;
        this.indicatorMaterial = indicatorMaterial;
        this.onStabilized = onStabilized;
        this.stabilized = false;
        this.stabilizeProgress = 0;
    }

    canInteract() {
        return !this.stabilized && this.active;
    }

    getPrompt() {
        if (!this.gameState.hasItem('fragment')) {
            return 'DISPOSITIVO — precisa do fragmento';
        }
        return '[E] Estabilizar dispositivo';
    }

    interact() {
        if (!this.gameState.hasItem('fragment')) {
            this.events.notify('O DISPOSITIVO PRECISA DO FRAGMENTO', { warning: true });
            this.events.sfx('denied');
            return;
        }
        this.stabilized = true;
        this.active = false;
        this.events.notify('DISPOSITIVO ESTABILIZADO');
        this.events.sfx('power');
        this.gameState.completeObjective('stabilize');
        this.gameState.addScore('stabilize', CONFIG.scoring.stabilize ?? 0);
        this.onStabilized();
    }

    update(delta, time) {
        if (this.stabilized) {
            this.stabilizeProgress = Math.min(1, this.stabilizeProgress + delta * 0.8);
            const pulse = Math.sin(time * 6) * 0.5 + 0.5;
            this.indicatorMaterial.emissiveIntensity = 0.8 + pulse * 1.0;
        }
    }
}

export class Level2 extends Level {
    constructor(scene, { gameState, events, difficulty }) {
        super(scene);
        this.footstepSurface = 'metal';
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
            { id: 'fragment', title: 'Coletar o FRAGMENTO' },
            { id: 'stabilize', title: 'Estabilizar o DISPOSITIVO' }
        ];
        if (this.diffConfig.hasFlashlightRequirement) {
            this.objectives.unshift({ id: 'flashlight', title: 'Encontrar a LANTERNA' });
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
            color: 0x5a4a5a
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
            color: 0x6a5a6a
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
            color: 0x6a5a6a
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
        const fixtureMaterialOn = new THREE.MeshBasicMaterial({ color: 0xecd8ff });
        const fixtureMaterialOff = new THREE.MeshBasicMaterial({ color: 0x5a4a5a });
        const fixturesOn = [];
        const fixturesOff = [];

        for (let row = 1; row < this.rows - 1; row++) {
            for (let col = 1; col < this.cols - 1; col++) {
                if (this.grid[row][col] === '#') {
                    continue;
                }
                const isLit = (col * 7 + row * 5) % 5 !== 0 || this.isNearLight(col, row);
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
        this.buildFragment();
        this.buildStabilizer();
        if (this.diffConfig.hasFlashlightRequirement) {
            const flashlightWorld = this.cellToWorld(15, 1);
            const flashlight = new PickupItem(this.createFlashlightMesh(), {
                id: 'flashlight',
                prompt: '[E] Pegar lanterna'
            });
            flashlight.meshes[0].position.set(flashlightWorld.x, 0.9, flashlightWorld.z);
            flashlight.baseY = 0.9;
            this.group.add(flashlight.meshes[0]);
            this.addInteractable(flashlight);
            this.pickups.push({ item: flashlight, id: 'flashlight' });
        }
    }

    createFlashlightMesh() {
        const group = new THREE.Group();
        const color = 0xffdd66;
        const bodyMaterial = new THREE.MeshLambertMaterial({ color, emissive: color });
        configureRetroMaterial(bodyMaterial);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.42, 8), bodyMaterial);
        body.rotation.z = Math.PI / 2;
        const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.3, side: THREE.DoubleSide
        }));
        group.add(body, halo);
        return group;
    }

    buildFragment() {
        const cell = this.findCell('R');
        const world = this.cellToWorld(cell.col, cell.row);
        const fragment = new PickupItem(this.createFragmentMesh(), {
            id: 'fragment',
            prompt: '[E] Coletar fragmento'
        });
        fragment.meshes[0].position.set(world.x, 0.9, world.z);
        fragment.baseY = 0.9;
        this.group.add(fragment.meshes[0]);
        this.addInteractable(fragment);
        this.pickups.push({ item: fragment, id: 'fragment' });
    }

    createFragmentMesh() {
        const group = new THREE.Group();

        const shardMat = new THREE.MeshLambertMaterial({
            color: 0xd8a0ff,
            emissive: 0x4a1a66
        });
        configureRetroMaterial(shardMat);
        const shard = new THREE.Mesh(
            new THREE.TetrahedronGeometry(0.22),
            shardMat
        );

        const haloMat = new THREE.MeshBasicMaterial({
            color: 0xd8a0ff,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide
        });
        const halo = new THREE.Mesh(
            new THREE.TetrahedronGeometry(0.34),
            haloMat
        );

        group.add(shard, halo);
        return group;
    }

    buildStabilizer() {
        const cell = this.findCell('Y');
        const world = this.cellToWorld(cell.col, cell.row);

        const group = new THREE.Group();

        const baseGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.35, 12);
        const baseMat = new THREE.MeshLambertMaterial({ color: 0x3a3040 });
        configureRetroMaterial(baseMat);
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 0.175;

        const pillarGeo = new THREE.CylinderGeometry(0.12, 0.16, 1.4, 10);
        const pillarMat = new THREE.MeshLambertMaterial({ color: 0x6a5a7a });
        configureRetroMaterial(pillarMat);
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.y = 1.0;

        const gemGeo = new THREE.OctahedronGeometry(0.18);
        const gemMat = new THREE.MeshLambertMaterial({
            color: 0x8a5aff,
            emissive: 0x6a3aff
        });
        configureRetroMaterial(gemMat);
        const gem = new THREE.Mesh(gemGeo, gemMat);
        gem.position.y = 1.8;

        const indicatorMat = new THREE.MeshLambertMaterial({
            color: 0x5a2a5a,
            emissive: 0x3a1a3a
        });
        configureRetroMaterial(indicatorMat);
        const indicator = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 8, 6),
            indicatorMat
        );
        indicator.position.set(0, 0.45, 0.5);

        group.add(base, pillar, gem, indicator);
        this.group.add(group);

        this.stabilizer = new Stabilizer({
            mesh: group,
            indicatorMaterial: indicatorMat,
            gameState: this.gameState,
            events: this.events,
            onStabilized: () => {}
        });
        this.addInteractable(this.stabilizer);
    }

    refreshInteractionStates() {}

    updateAmbientEvents(delta, time) {}
}
