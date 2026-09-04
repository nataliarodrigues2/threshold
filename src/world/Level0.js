import * as THREE from 'three';
import { Level } from './Level.js';
import { Lighting } from './Lighting.js';
import { CONFIG } from '../core/Config.js';
import {
    createWallTexture,
    createCarpetTexture,
    createCeilingTexture,
    createCrateTexture
} from './Textures.js';
import { PickupItem } from '../interactions/PickupItem.js';
import { Door } from '../interactions/Door.js';
import { FuseBox } from '../interactions/FuseBox.js';
import { Portal } from '../interactions/Portal.js';
import { MAP, POINT_LIGHT_CELLS, FLICKER_INDICES, SUPPORT_ITEM_CELLS } from './MapData.js';
import { configureRetroMaterial } from '../rendering/RetroMaterial.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const CORNER_NW = 'nw';
const CORNER_NE = 'ne';
const CORNER_SW = 'sw';
const CORNER_SE = 'se';

const PILLAR_CORNERS = [
    { col: 3, row: 3, corner: CORNER_NW }, // fuse room NW
    { col: 6, row: 3, corner: CORNER_NE }, // fuse room NE
    { col: 3, row: 5, corner: CORNER_SW }, // fuse room SW
    { col: 6, row: 5, corner: CORNER_SE }, // fuse room SE
    { col: 12, row: 3, corner: CORNER_NW }, // panel room NW
    { col: 15, row: 3, corner: CORNER_NE }, // panel room NE
    { col: 12, row: 5, corner: CORNER_SW }, // panel room SW
    { col: 15, row: 5, corner: CORNER_SE }, // panel room SE
];

const CRATE_PLACEMENTS = [
    { col: 15, row: 1, align: 'north' },    // north wall of main corridor
    { col: 17, row: 3, align: 'east' },     // east wall near panel room
    { col: 2, row: 13, align: 'south' },    // south wall bottom corridor
    { col: 6, row: 11, align: 'west' },     // west wall lower area
];

export class Level0 extends Level {
    constructor(scene, { gameState, events, difficulty }) {
        super(scene);
        this.footstepSurface = 'carpet';
        this.gameState = gameState;
        this.events = events;
        this.difficulty = difficulty || 'normal';
        this.diffConfig = CONFIG.difficulty[this.difficulty];
        this.grid = MAP;
        this.rows = MAP.length;
        this.cols = MAP[0].length;
        this.portal = null;
        this.guideMarkers = [];
        this.ambientEventTimer = 0;
        // objetivos padrão do nível 0
        this.objectives = [
            { id: 'fuse', title: 'Encontrar o FUSÍVEL' },
            { id: 'keycard', title: 'Encontrar o CARTÃO' },
            { id: 'power', title: 'Restaurar a ENERGIA' }
        ];
        // adicionar itens de suporte como objetivos quando exigidos
        if (this.diffConfig.hasRadarRequirement) this.objectives.unshift({ id: 'radar', title: 'Encontrar o RADAR' });
        if (this.diffConfig.hasPhoneRequirement) this.objectives.unshift({ id: 'phone', title: 'Encontrar o CELULAR' });
        if (this.diffConfig.hasFlashlightRequirement) this.objectives.unshift({ id: 'flashlight', title: 'Encontrar a LANTERNA' });

        this.buildEnvironment();
        this.buildLights();
        this.buildProps();
        this.buildGameplay();
        const spawnCell = this.findCell('S');
        if (spawnCell) {
            this.spawnPoint.copy(this.cellToWorld(spawnCell.col, spawnCell.row));
            this.spawnPoint.y = CONFIG.player.height;
        }
        if (this.diffConfig.hasGuide) {
            this.buildGuideMarkers();
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
        const carpetTexture = createCarpetTexture(this.cols / 2, this.rows / 2);
        const ceilingTexture = createCeilingTexture(this.cols / 2, this.rows / 2);

        const floorMaterial = new THREE.MeshLambertMaterial({ map: carpetTexture });
        configureRetroMaterial(floorMaterial);
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(size, size, this.cols, this.rows),
            floorMaterial
        );
        floor.rotation.x = -Math.PI / 2;
        this.group.add(floor);

        const ceilingMaterial = new THREE.MeshLambertMaterial({ map: ceilingTexture });
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
        const wallMaterial = new THREE.MeshLambertMaterial({ map: wallTexture });
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
        // Luminárias: materiais auto-iluminados (MeshBasic) — flat, sem PBR,
        // sem glow HDR. O brilho vem da própria cor, não de emissive moderno.
        const fixtureMaterialOn = new THREE.MeshBasicMaterial({
            color: 0xfff2b0
        });
        const fixtureMaterialOff = new THREE.MeshBasicMaterial({
            color: 0x8a7f5f
        });
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
                target.push({ x: world.x, z: world.z, col, row, isLit });
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
            if (fixturesOn === list) this.fixtureData = list;
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

    buildProps() {
        this.buildPillars();
        this.buildCrates();
        this.buildPortalStructure();
        this.buildWallDetails();
    }

    buildPillars() {
        const pillarGeometry = new THREE.BoxGeometry(0.45, CONFIG.game.wallHeight, 0.45);
        const pillarMaterial = new THREE.MeshLambertMaterial({
            map: createWallTexture(1, 2),
            color: 0xbfb28a
        });
        configureRetroMaterial(pillarMaterial);

        const pillars = new THREE.InstancedMesh(pillarGeometry, pillarMaterial, PILLAR_CORNERS.length);
        const matrix = new THREE.Matrix4();
        const half = this.cellSize / 2;
        const inset = 0.225;

        PILLAR_CORNERS.forEach((p, index) => {
            const world = this.cellToWorld(p.col, p.row);
            let x = world.x;
            let z = world.z;
            switch (p.corner) {
                case CORNER_NW: x -= half - inset; z -= half - inset; break;
                case CORNER_NE: x += half - inset; z -= half - inset; break;
                case CORNER_SW: x -= half - inset; z += half - inset; break;
                case CORNER_SE: x += half - inset; z += half - inset; break;
            }
            matrix.makeTranslation(x, CONFIG.game.wallHeight / 2, z);
            pillars.setMatrixAt(index, matrix);
        });
        pillars.instanceMatrix.needsUpdate = true;
        this.group.add(pillars);
    }

    buildCrates() {
        const crateGeometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
        const crateTexture = createCrateTexture(1, 1);
        // Material iluminado: nunca fica preto puro mesmo longe de PointLight
        // graças ao emissive + base clara; fog preto ainda aplica fade correto.
        const crateMaterial = new THREE.MeshLambertMaterial({
            map: crateTexture,
            color: 0xffffff,
            emissive: 0x2a1f0a,
            emissiveIntensity: 0.35
        });
        configureRetroMaterial(crateMaterial);
        const crates = new THREE.InstancedMesh(crateGeometry, crateMaterial, CRATE_PLACEMENTS.length);
        const matrix = new THREE.Matrix4();
        const half = this.cellSize / 2;
        const inset = 0.45;

        CRATE_PLACEMENTS.forEach((p, index) => {
            const world = this.cellToWorld(p.col, p.row);
            let x = world.x;
            let z = world.z;
            switch (p.align) {
                case 'north': z -= half - inset; break;
                case 'south': z += half - inset; break;
                case 'east': x += half - inset; break;
                case 'west': x -= half - inset; break;
            }
            matrix.makeTranslation(x, 0.35, z);
            crates.setMatrixAt(index, matrix);
        });
        crates.instanceMatrix.needsUpdate = true;
        this.group.add(crates);
    }

    buildWallDetails() {
        const detailMaterial = new THREE.MeshLambertMaterial({
            color: 0x3a3528
        });

        const outletGeometry = new THREE.BoxGeometry(0.15, 0.1, 0.08);
        const outlets = [];

        for (let row = 1; row < this.rows - 1; row++) {
            for (let col = 1; col < this.cols - 1; col++) {
                if (this.grid[row][col] !== '#') continue;
                const north = this.grid[row - 1][col] !== '#';
                const south = this.grid[row + 1][col] !== '#';
                const east = this.grid[row][col + 1] !== '#';
                const west = this.grid[row][col - 1] !== '#';
                const openSides = [north, south, east, west].filter(Boolean).length;
                if (openSides === 1 && Math.random() < 0.15) {
                    const world = this.cellToWorld(col, row);
                    if (north) outlets.push({ x: world.x, z: world.z - half + 0.05, rot: Math.PI });
                    else if (south) outlets.push({ x: world.x, z: world.z + half - 0.05, rot: 0 });
                    else if (east) outlets.push({ x: world.x + half - 0.05, z: world.z, rot: -Math.PI / 2 });
                    else if (west) outlets.push({ x: world.x - half + 0.05, z: world.z, rot: Math.PI / 2 });
                }
            }
        }

        if (outlets.length > 0) {
            const outletsMesh = new THREE.InstancedMesh(outletGeometry, detailMaterial, outlets.length);
            const matrix = new THREE.Matrix4();
            outlets.forEach((o, i) => {
                matrix.makeRotationY(o.rot);
                matrix.setPosition(o.x, 0.4, o.z);
                outletsMesh.setMatrixAt(i, matrix);
            });
            outletsMesh.instanceMatrix.needsUpdate = true;
            this.group.add(outletsMesh);
        }

        const pipeGeometry = new THREE.CylinderGeometry(0.04, 0.04, CONFIG.game.wallHeight - 0.2, 6);
        const pipeMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2822 });
        configureRetroMaterial(pipeMaterial);
        const pipes = [];

        for (let row = 1; row < this.rows - 1; row++) {
            for (let col = 1; col < this.cols - 1; col++) {
                if (this.grid[row][col] !== '#') continue;
                const north = this.grid[row - 1][col] !== '#';
                const south = this.grid[row + 1][col] !== '#';
                if ((north || south) && Math.random() < 0.08) {
                    const world = this.cellToWorld(col, row);
                    const offsetX = (Math.random() - 0.5) * (this.cellSize * 0.6);
                    pipes.push({ x: world.x + offsetX, z: world.z });
                }
            }
        }

        if (pipes.length > 0) {
            const pipesMesh = new THREE.InstancedMesh(pipeGeometry, pipeMaterial, pipes.length);
            const matrix = new THREE.Matrix4();
            pipes.forEach((p, i) => {
                matrix.makeTranslation(p.x, (CONFIG.game.wallHeight - 0.2) / 2, p.z);
                pipesMesh.setMatrixAt(i, matrix);
            });
            pipesMesh.instanceMatrix.needsUpdate = true;
            this.group.add(pipesMesh);
        }
    }

    buildPortalStructure() {
        const portalCell = this.findCell('O');
        const world = this.cellToWorld(portalCell.col, portalCell.row);
        const half = this.cellSize / 2;
        const structureMaterial = new THREE.MeshLambertMaterial({
            color: 0x2a2720
        });

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
        this.pickups = [];
        const fuseCell = this.findCell('F');
        const fuseWorld = this.cellToWorld(fuseCell.col, fuseCell.row);
        const fuse = new PickupItem(this.createFuseMesh(), {
            id: 'fuse',
            prompt: '[E] Pegar fusível'
        });
        fuse.meshes[0].position.set(fuseWorld.x, 0.9, fuseWorld.z);
        fuse.baseY = 0.9;
        this.group.add(fuse.meshes[0]);
        this.addInteractable(fuse);
        this.pickups.push({ item: fuse, id: 'fuse' });

        const cardCell = this.findCell('K');
        const cardWorld = this.cellToWorld(cardCell.col, cardCell.row);
        const keycard = new PickupItem(this.createKeycardMesh(), {
            id: 'keycard',
            prompt: '[E] Pegar cartão'
        });
        keycard.meshes[0].position.set(cardWorld.x, 0.9, cardWorld.z);
        keycard.baseY = 0.9;
        this.group.add(keycard.meshes[0]);
        this.addInteractable(keycard);
        this.pickups.push({ item: keycard, id: 'keycard' });

        this.fusePickup = fuse;
        this.keycardPickup = keycard;

        this.buildSupportItems();
        this.buildFuseBox();
        this.buildDoor();
    }

    buildSupportItems() {
        const items = [];
        if (this.difficulty === 'hard') {
            items.push(
                { glyph: SUPPORT_ITEM_CELLS.flashlight, id: 'flashlight', prompt: '[E] Pegar lanterna', color: 0xffdd66 }
            );
        }

        for (const { glyph, id, prompt, color } of items) {
            const world = this.cellToWorld(glyph.col, glyph.row);
            const item = new PickupItem(this.createSupportItemMesh(id, color), { id, prompt });
            item.meshes[0].position.set(world.x, 0.9, world.z);
            item.baseY = 0.9;
            this.group.add(item.meshes[0]);
            this.addInteractable(item);
            this.pickups.push({ item, id });
        }
    }

    createSupportItemMesh(id, color) {
        const group = new THREE.Group();
        // Celular Nokia 3310 PSX — modelo FBX real quando id === 'phone'
        if (id === 'phone') {
            const placeholderMat = new THREE.MeshLambertMaterial({ color, emissive: color });
            configureRetroMaterial(placeholderMat);
            const placeholder = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.18), placeholderMat);
            placeholder.name = 'phone_placeholder';
            group.add(placeholder);

            const haloMat = new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.28,
                side: THREE.DoubleSide, depthTest: true, depthWrite: false
            });
            const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), haloMat);
            group.add(halo);

            // Carrega FBX de forma assíncrona e substitui placeholder
            const loader = new FBXLoader();
            loader.load('/models/nokia/Nokia.fbx', (fbx) => {
                // Remove placeholder
                const ph = group.getObjectByName('phone_placeholder');
                if (ph) {
                    group.remove(ph);
                    ph.geometry.dispose();
                    ph.material.dispose();
                }
                // Textura difusa
                const texLoader = new THREE.TextureLoader();
                texLoader.load('/models/nokia/nokia-3310.jpg', (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.magFilter = THREE.NearestFilter;
                    tex.minFilter = THREE.NearestFilter;
                    fbx.traverse((c) => {
                        if (c.isMesh) {
                            c.material.map = tex;
                            c.material.needsUpdate = true;
                            c.material.transparent = false;
                            configureRetroMaterial(c.material);
                        }
                    });
                }, undefined, () => {
                    fbx.traverse((c) => { if (c.isMesh) configureRetroMaterial(c.material); });
                });

                // Normaliza: FBX Nokia vem em escala grande, centraliza e reduz
                // Usa maior dimensão para não esticar; alvo ~0.22m (tamanho real celular)
                const box = new THREE.Box3().setFromObject(fbx);
                const size = new THREE.Vector3(); box.getSize(size);
                const center = new THREE.Vector3(); box.getCenter(center);
                const maxDim = Math.max(size.x, size.y, size.z);
                const targetSize = 0.20;
                const s = maxDim > 0.01 ? targetSize / maxDim : 0.008;
                fbx.scale.setScalar(s);
                // Corrige orientação: FBX Blender vem Z-up, precisa deitar com tela para cima
                // Anterior -PI/2 + PI/2 deixava de ponta cabeça e grande; agora PI/2 simples
                fbx.position.set(-center.x * s, -box.min.y * s + 0.015, -center.z * s);
                fbx.rotation.set(Math.PI / 2, 0, 0);
                // Se ficar invertido (tela para baixo), descomente a linha abaixo:
                // fbx.rotation.y = Math.PI;
                // Garante oclusão real
                fbx.traverse((c) => {
                    if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; }
                });
                group.add(fbx);
                group.userData.nokiaFbx = fbx;
            }, undefined, () => {
                // Falha: mantém placeholder
                console.warn('[Level0] falha ao carregar Nokia.fbx');
            });
            return group;
        }
        const mat = new THREE.MeshLambertMaterial({ color, emissive: color });
        configureRetroMaterial(mat);
        const core = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.2), mat);
        if (id === 'radar') core.rotation.x = Math.PI / 2;
        const haloMat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: true, depthWrite: false
        });
        const halo = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), haloMat);
        group.add(core, halo);
        return group;
    }

    createFuseMesh() {
        const group = new THREE.Group();

        const bodyGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.26, 10);
        const bodyMat = new THREE.MeshLambertMaterial({
            color: 0xdedede,
            emissive: 0x332200
        });
        configureRetroMaterial(bodyMat);
        const body = new THREE.Mesh(bodyGeo, bodyMat);

        const capGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 10);
        const capMat = new THREE.MeshBasicMaterial({
            color: 0x2a2a2a
        });
        const capTop = new THREE.Mesh(capGeo, capMat);
        capTop.position.y = 0.135;
        const capBottom = new THREE.Mesh(capGeo, capMat);
        capBottom.position.y = -0.135;
        capBottom.rotation.x = Math.PI;

        const glassGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.20, 8, 1, true);
        const glassMat = new THREE.MeshLambertMaterial({
            color: 0xffeedd,
            transparent: true,
            opacity: 0.8,
            emissive: 0x553322,
            side: THREE.DoubleSide
        });
        const glass = new THREE.Mesh(glassGeo, glassMat);

        const filamentGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 5);
        const filamentMat = new THREE.MeshBasicMaterial({
            color: 0xffee88,
            transparent: true,
            opacity: 1.0
        });
        const filament = new THREE.Mesh(filamentGeo, filamentMat);

        group.add(body, capTop, capBottom, glass, filament);
        group.userData.filament = filament;
        group.userData.glass = glass;

        return group;
    }

    createKeycardMesh() {
        const group = new THREE.Group();

        const cardGeo = new THREE.BoxGeometry(0.28, 0.035, 0.42);
        const cardMat = new THREE.MeshLambertMaterial({
            color: 0xffd23a,
            emissive: 0x553300
        });
        configureRetroMaterial(cardMat);
        const card = new THREE.Mesh(cardGeo, cardMat);

        const chipGeo = new THREE.BoxGeometry(0.035, 0.01, 0.035);
        const chipMat = new THREE.MeshBasicMaterial({
            color: 0x886622
        });
        const chip = new THREE.Mesh(chipGeo, chipMat);
        chip.position.set(-0.07, 0.018, 0.1);

        const stripGeo = new THREE.BoxGeometry(0.18, 0.008, 0.025);
        const stripMat = new THREE.MeshBasicMaterial({
            color: 0x1a1a1a
        });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(0, 0.017, -0.12);

        group.add(card, chip, strip);
        return group;
    }

    buildFuseBox() {
        const panelCell = this.findCell('P');
        const world = this.cellToWorld(panelCell.col, panelCell.row);
        const half = this.cellSize / 2;
        const wallZ = world.z - 1.5 * this.cellSize + 0.12;

        const indicatorMaterial = new THREE.MeshLambertMaterial({
            color: 0x881111,
            emissive: 0x550000,
            emissiveIntensity: 1.2
        });
        configureRetroMaterial(indicatorMaterial);

        const boxGroup = new THREE.Group();
        boxGroup.userData.excludeFromDarkness = true;

        const boxGeo = new THREE.BoxGeometry(1.3, 1.7, 0.28);
        const boxMat = new THREE.MeshLambertMaterial({
            color: 0x8a7f5e,
            emissive: 0x1a1508,
            emissiveIntensity: 0.55
        });
        configureRetroMaterial(boxMat);
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(world.x, 1.45, wallZ);
        box.userData.excludeFromDarkness = true;

        const coverGeo = new THREE.BoxGeometry(1.35, 0.9, 0.12);
        const coverMat = new THREE.MeshLambertMaterial({
            color: 0x9a9178,
            emissive: 0x1a1508,
            emissiveIntensity: 0.25
        });
        configureRetroMaterial(coverMat);
        const cover = new THREE.Mesh(coverGeo, coverMat);
        cover.position.set(world.x, 0.85, wallZ - 0.15);
        cover.userData.excludeFromDarkness = true;

        const indicator = new THREE.Mesh(
            new THREE.SphereGeometry(0.055, 8, 6),
            indicatorMaterial
        );
        indicator.position.set(world.x + 0.45, 1.95, wallZ - 0.18);
        indicator.userData.excludeFromDarkness = true;

        const fuseSlotGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 10);
        const fuseSlotMat = new THREE.MeshLambertMaterial({
            color: 0x3a3528,
            emissive: 0x1a1508,
            emissiveIntensity: 0.3
        });
        configureRetroMaterial(fuseSlotMat);
        const fuseSlot = new THREE.Mesh(fuseSlotGeo, fuseSlotMat);
        fuseSlot.position.set(world.x - 0.35, 1.2, wallZ - 0.17);
        fuseSlot.rotation.x = -Math.PI / 2;
        fuseSlot.userData.excludeFromDarkness = true;

        const switchGeo = new THREE.BoxGeometry(0.06, 0.12, 0.04);
        const switchMat = new THREE.MeshLambertMaterial({
            color: 0xdd4422,
            emissive: 0x331100,
            emissiveIntensity: 0.5
        });
        configureRetroMaterial(switchMat);
        const switchMesh = new THREE.Mesh(switchGeo, switchMat);
        switchMesh.position.set(world.x + 0.45, 0.95, wallZ - 0.17);
        switchMesh.userData.isSwitch = true;
        switchMesh.userData.excludeFromDarkness = true;

        boxGroup.add(box, cover, indicator, fuseSlot, switchMesh);
        this.group.add(boxGroup);

        // Luz dedicada ao quadro para não ficar preto no hard/fog denso
        const panelLight = new THREE.PointLight(0xffe9b0, 1.9, 11, 1.4);
        panelLight.position.set(world.x, 1.9, wallZ + 0.9);
        panelLight.userData.excludeFromDarkness = true;
        this.group.add(panelLight);
        this._panelLight = panelLight;

        this.fuseBox = new FuseBox({
            mesh: boxGroup,
            indicatorMaterial,
            switchMesh,
            gameState: this.gameState,
            events: this.events,
            onPowerRestored: () => this.events.onPowerRestored()
        });
        this.addInteractable(this.fuseBox);
    }

    buildDoor() {
        const doorCell = this.findCell('D');
        const world = this.cellToWorld(doorCell.col, doorCell.row);
        const half = this.cellSize / 2;

        const pivot = new THREE.Group();
        pivot.position.set(world.x, 0, world.z + half);

        const doorGroup = new THREE.Group();

        const panelGeo = new THREE.BoxGeometry(0.12, 2.65, this.cellSize * 0.95);
        const panelMat = new THREE.MeshLambertMaterial({
            color: 0x5a5245
        });
        configureRetroMaterial(panelMat);
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(0, 1.325, -half + half * 0.025);

        const frameGeo = new THREE.BoxGeometry(0.18, 2.8, this.cellSize + 0.1);
        const frameMat = new THREE.MeshLambertMaterial({
            color: 0x3a3528
        });
        configureRetroMaterial(frameMat);
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.set(0, 1.4, -half);

        const handleGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.18, 6);
        const handleMat = new THREE.MeshBasicMaterial({
            color: 0x8a7a5a
        });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.set(-0.09, 1.1, -half + 0.5);
        handle.rotation.z = Math.PI / 2;

        const lockGeo = new THREE.BoxGeometry(0.05, 0.07, 0.04);
        const lockMat = new THREE.MeshBasicMaterial({
            color: 0x2a2520
        });
        const lock = new THREE.Mesh(lockGeo, lockMat);
        lock.position.set(-0.085, 1.25, -half + 0.3);

        const readerGeo = new THREE.BoxGeometry(0.08, 0.1, 0.03);
        const readerMat = new THREE.MeshLambertMaterial({
            color: 0x1a1815,
            emissive: 0x880000
        });
        configureRetroMaterial(readerMat);
        const reader = new THREE.Mesh(readerGeo, readerMat);
        reader.position.set(-0.085, 1.25, -half + 0.12);
        reader.userData.isReader = true;
        reader.userData.lightMaterial = readerMat;

        doorGroup.add(frame, panel, handle, lock, reader);
        pivot.add(doorGroup);
        this.group.add(pivot);

        this.door = new Door({
            pivot,
            panelMesh: doorGroup,
            cell: { x: doorCell.col, z: doorCell.row },
            gameState: this.gameState,
            events: {
                ...this.events,
                onDoorOpened: () => this.events.onDoorOpened?.()
            },
            readerLight: readerMat
        });
        this.blockers.push(this.door);
        this.addInteractable(this.door);
    }

    buildGuideMarkers() {
        const markerGeo = new THREE.RingGeometry(0.35, 0.45, 8);
        const markerMat = new THREE.MeshBasicMaterial({
            color: 0x88cc44,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const objectives = [
            { id: 'fuse', pos: this.cellToWorld(4, 4) },
            { id: 'keycard', pos: this.cellToWorld(15, 9) },
            { id: 'power', pos: this.cellToWorld(13, 4) },
            { id: 'door', pos: this.cellToWorld(14, 13) },
            { id: 'portal', pos: this.cellToWorld(17, 13) }
        ];

        objectives.forEach((obj, i) => {
            if (obj.id === 'power' && this.gameState.objectives.power) return;
            if (obj.id === 'door' && !this.gameState.objectives.power) return;
            if (obj.id === 'portal' && !this.gameState.portalUnlocked) return;

            const marker = new THREE.Mesh(markerGeo, markerMat.clone());
            marker.position.set(obj.pos.x, 0.08, obj.pos.z);
            marker.rotation.x = -Math.PI / 2;
            marker.userData.guideId = obj.id;
            marker.userData.baseOpacity = markerMat.opacity;
            this.group.add(marker);
            this.guideMarkers.push({ marker, objectiveId: obj.id });
        });

        this.updatables.push({
            update: (delta, time) => {
                this.guideMarkers.forEach((g, i) => {
                    const pulse = Math.sin(time * this.diffConfig.guidePulseSpeed + i) * 0.5 + 0.5;
                    g.marker.material.opacity = g.marker.userData.baseOpacity * (0.4 + pulse * 0.6);
                    g.marker.scale.setScalar(0.9 + pulse * 0.2);
                });
            }
        });
    }

    refreshInteractionStates() {
        this.fuseBox.refreshState();
    }

    updateAmbientEvents(delta, time) {
        if (!this.diffConfig.hasEntities) return;
        this.ambientEventTimer += delta;
        const chance = this.diffConfig.ambientEventChance * delta;
        if (Math.random() < chance) {
            this.triggerAmbientEvent();
        }
    }

    triggerAmbientEvent() {
        const events = [
            () => this.flickerNearbyLights(),
            () => this.playDistantSound(),
            () => this.closeDistantDoor(),
            () => this.moveObjectSlightly()
        ];
        events[Math.floor(Math.random() * events.length)]();
    }

    flickerNearbyLights() {
        if (!this.playerPosition) return;
        const playerCell = this.worldToCell(this.playerPosition.x, this.playerPosition.z);
        const radius = 3;
        let didFlicker = false;
        for (let r = -radius; r <= radius; r++) {
            for (let c = -radius; c <= radius; c++) {
                const col = playerCell.x + c;
                const row = playerCell.z + r;
                if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) continue;
                if (this.grid[row][col] === '#') continue;
                if (Math.random() < 0.3) {
                    this.lighting?.triggerFlickerAt(col, row);
                    didFlicker = true;
                }
            }
        }
        if (didFlicker) this.events?.sfx('flicker');
    }

    playDistantSound() {
        // 40% posicional distante real
        if (Math.random() < 0.4 && this.events?.sfxPositional) {
            // escolhe célula distante válida
            const cols = this.cols, rows = this.rows;
            for (let tries=0; tries<8; tries++) {
                const c = Math.floor(Math.random()*cols);
                const r = Math.floor(Math.random()*rows);
                if (this.grid[r][c] === '#') continue;
                const w = this.cellToWorld(c, r);
                if (Math.hypot(w.x - this.playerPosition.x, w.z - this.playerPosition.z) < 9) continue;
                this.events.sfxPositional('distant', w);
                return;
            }
        }
        this.events?.sfx('distant');
    }

    closeDistantDoor() {
        // Future: could trigger a door slam sound far away
    }

    moveObjectSlightly() {
        // Future: subtle prop movement
    }
}

const half = 3.5 / 2;
