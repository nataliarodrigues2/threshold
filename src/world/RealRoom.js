import * as THREE from 'three';
import { Level } from './Level.js';
import { CONFIG } from '../core/Config.js';
import {
    createWallpaperTexture,
    createDarkWoodTexture,
    createCrateTexture,
    createCeilingTexture
} from './Textures.js';

// Dimensões do quarto (metros) — propositalmente pequeno e simples.
const HALF_W = 2.5;   // metade da largura (eixo X)
const HALF_D = 2.2;   // metade da profundidade (eixo Z)
const WALL_H = 2.8;
const WALL_T = 0.15;

// "Mundo real": cenário estático explorável do quarto onde o jogador
// termina a fuga dos Backrooms. POR ENQUANTO: só o cenário, andável,
// sem animação de acordar, sem transição, sem nada sobrenatural — só
// pra validar a construção/proporção antes de ligar o resto.
export class RealRoom extends Level {
    constructor(scene) {
        super(scene);

        // Não usamos o grid de labirinto da classe base — colisão aqui
        // é um retângulo simples (o quarto) + círculos pros móveis.
        this.propColliders = [];

        this.buildShell();
        this.buildWindow();
        this.buildWardrobes();
        this.buildBed();
        this.buildNightstand();
        this.buildDoor();
        this.buildFramedPicture();
        this.buildLights();

        // Spawn no centro-frente do quarto, longe de qualquer colisor.
        this.spawnPoint.set(0, CONFIG.player.height, 1.3);
    }

    // Colisão: retângulo do quarto + móveis (círculos). Sobrescreve o
    // isSolidAt da classe base, que espera um grid — aqui não tem.
    isSolidAt(x, z) {
        const innerW = HALF_W - WALL_T - 0.25;
        const innerD = HALF_D - WALL_T - 0.25;
        if (x < -innerW || x > innerW || z < -innerD || z > innerD) return true;
        for (const p of this.propColliders) {
            const dx = x - p.x;
            const dz = z - p.z;
            if (dx * dx + dz * dz < p.radius * p.radius) return true;
        }
        return false;
    }

    addPropCollider(x, z, radius) {
        this.propColliders.push({ x, z, radius });
    }

    // Sem o efeito retrô/tremor de vértice aqui de propósito — esse
    // quarto é o "mundo real seguro", o contraste com a instabilidade
    // visual dos Backrooms É parte do que comunica "você está a salvo
    // agora". Só o material básico, sem configureRetroMaterial.
    mat(map, color, extra = {}) {
        return new THREE.MeshLambertMaterial({ map, color, ...extra });
    }

    // -------------------------------------------------------------
    // Casco: piso, teto, 4 paredes (com vãos de janela e porta)
    // -------------------------------------------------------------
    buildShell() {
        const floorTex = createCrateTexture(2, 2);
        const wallTex = createWallpaperTexture(2, 1);
        const ceilingTex = createCeilingTexture(1.5, 1.5);

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2),
            this.mat(floorTex, 0xcdb98a)
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.group.add(floor);

        const ceiling = new THREE.Mesh(
            new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2),
            this.mat(ceilingTex, 0xe4ddc4)
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = WALL_H;
        this.group.add(ceiling);

        const wallMat = this.mat(wallTex, 0xffffff);

        // Parede esquerda e direita (sem vão)
        const sideWallGeo = new THREE.BoxGeometry(WALL_T, WALL_H, HALF_D * 2);
        const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
        leftWall.position.set(-HALF_W, WALL_H / 2, 0);
        leftWall.castShadow = leftWall.receiveShadow = true;
        this.group.add(leftWall);

        const rightWall = new THREE.Mesh(sideWallGeo, wallMat);
        rightWall.position.set(HALF_W, WALL_H / 2, 0);
        rightWall.castShadow = rightWall.receiveShadow = true;
        this.group.add(rightWall);

        // Parede de trás (janela ao centro) — construída em 4 segmentos
        // ao redor do vão, só pra efeito visual (colisão trata a parede
        // toda como sólida, já que a janela não é andável).
        const winX0 = -1.0, winX1 = 1.0, winY0 = 0.85, winY1 = 2.25;
        this.buildWallWithOpening('back', -HALF_D, HALF_W * 2, winX0, winX1, winY0, winY1, wallMat);

        // Parede da frente (porta perto do canto esquerdo)
        const doorX0 = -2.3, doorX1 = -1.3, doorY0 = 0, doorY1 = 2.15;
        this.buildWallWithOpening('front', HALF_D, HALF_W * 2, doorX0, doorX1, doorY0, doorY1, wallMat);
    }

    // Constrói uma parede em X (largura totalW, centrada em x=0) com um
    // vão retangular, usando segmentos de caixa (esquerda/direita/topo/baixo).
    buildWallWithOpening(axis, zPos, totalW, x0, x1, y0, y1, material) {
        const halfTotal = totalW / 2;

        const addSeg = (cx, cy, w, h) => {
            if (w <= 0.01 || h <= 0.01) return;
            const seg = new THREE.Mesh(new THREE.BoxGeometry(w, h, WALL_T), material);
            seg.position.set(cx, cy, zPos);
            seg.castShadow = seg.receiveShadow = true;
            this.group.add(seg);
        };

        // Segmento à esquerda do vão (de -halfTotal até x0)
        const leftW = x0 - (-halfTotal);
        addSeg(-halfTotal + leftW / 2, WALL_H / 2, leftW, WALL_H);

        // Segmento à direita do vão (de x1 até +halfTotal)
        const rightW = halfTotal - x1;
        addSeg(x1 + rightW / 2, WALL_H / 2, rightW, WALL_H);

        // Faixa abaixo do vão (do chão até y0)
        if (y0 > 0.02) {
            addSeg((x0 + x1) / 2, y0 / 2, x1 - x0, y0);
        }
        // Faixa acima do vão (de y1 até o teto)
        const topH = WALL_H - y1;
        if (topH > 0.02) {
            addSeg((x0 + x1) / 2, y1 + topH / 2, x1 - x0, topH);
        }
    }

    // -------------------------------------------------------------
    // Janela + cortinas
    // -------------------------------------------------------------
    buildWindow() {
        const frameMat = this.mat(null, 0x2c2016);
        const z = -HALF_D + WALL_T / 2;

        // Vidro com luz suave do lado de fora
        const glass = new THREE.Mesh(
            new THREE.PlaneGeometry(2.0, 1.4),
            new THREE.MeshBasicMaterial({ color: 0xdfe6d0 })
        );
        glass.position.set(0, 1.55, z + 0.01);
        this.group.add(glass);

        // Caixilho (cruz simples 2x2)
        const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.05), frameMat);
        mullionV.position.set(0, 1.55, z + 0.03);
        this.group.add(mullionV);
        const mullionH = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.05), frameMat);
        mullionH.position.set(0, 1.55, z + 0.03);
        this.group.add(mullionH);

        const outerFrame = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.55, 0.12), frameMat);
        outerFrame.position.set(0, 1.55, z);
        this.group.add(outerFrame);

        const glow = new THREE.PointLight(0xfff4d8, 1.1, 4.5);
        glow.position.set(0, 1.6, z + 0.6);
        this.group.add(glow);

        // Cortinas — algumas tiras verticais por lado, pra sugerir pano
        // franzido sem precisar de geometria complexa.
        const curtainMat = this.mat(null, 0xece4d0, { transparent: true, opacity: 0.92 });
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 8), frameMat);
        rod.rotation.z = Math.PI / 2;
        rod.position.set(0, 2.35, z + 0.15);
        this.group.add(rod);

        [-1, 1].forEach((side) => {
            for (let i = 0; i < 3; i++) {
                const w = 0.24 + Math.random() * 0.08;
                const panel = new THREE.Mesh(new THREE.BoxGeometry(w, 1.9, 0.04), curtainMat);
                const baseX = side * (1.15 + i * 0.22);
                panel.position.set(baseX, 1.35, z + 0.16 + (i % 2) * 0.03);
                panel.rotation.z = side * (0.03 + Math.random() * 0.05);
                this.group.add(panel);
            }
        });
    }

    // -------------------------------------------------------------
    // Guarda-roupas (2x, ladeando a janela)
    // -------------------------------------------------------------
    buildWardrobes() {
        const woodTex = createDarkWoodTexture(1, 2);
        const woodMat = this.mat(woodTex, 0x5a4530);
        const trimMat = this.mat(null, 0x2c2016);

        [-1.75, 1.75].forEach((x) => {
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.2, 0.58), woodMat);
            body.position.set(x, 1.1, -HALF_D + 0.35);
            body.castShadow = body.receiveShadow = true;
            this.group.add(body);

            const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 0.65), trimMat);
            top.position.set(x, 2.23, -HALF_D + 0.35);
            this.group.add(top);

            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.03), this.mat(null, 0x8a7a5a));
            handle.position.set(x + (x > 0 ? -0.32 : 0.32), 1.2, -HALF_D + 0.35 + 0.3);
            this.group.add(handle);

            this.addPropCollider(x, -HALF_D + 0.35, 0.42);
        });
    }

    // -------------------------------------------------------------
    // Cama — reaproveita o mesmo padrão visual já usado no resto do jogo
    // -------------------------------------------------------------
    buildBed() {
        const frameMat = this.mat(createDarkWoodTexture(1, 1), 0x4a3826);
        const mattressMat = this.mat(null, 0x27332a);
        const pillowMat = this.mat(null, 0xf0ece0);
        const sheetMat = this.mat(null, 0xe8e4d6);

        // Guardadas na instância — reaproveitadas pelo cálculo da pose
        // da câmera de despertar (getWakeCameraPose).
        this.bedX = 0;
        this.bedZ = -0.55;
        this.bedW = 1.6;
        this.bedL = 2.0;
        const { bedX, bedZ, bedW, bedL } = this;

        const frame = new THREE.Mesh(new THREE.BoxGeometry(bedW, 0.32, bedL), frameMat);
        frame.position.set(bedX, 0.16, bedZ);
        frame.castShadow = frame.receiveShadow = true;
        this.group.add(frame);

        const mattress = new THREE.Mesh(new THREE.BoxGeometry(bedW - 0.06, 0.22, bedL - 0.06), mattressMat);
        mattress.position.set(bedX, 0.43, bedZ);
        mattress.castShadow = true;
        this.group.add(mattress);

        // Lençol/cobertor branco dobrado na ponta dos pés
        const foldedSheet = new THREE.Mesh(new THREE.BoxGeometry(bedW - 0.1, 0.14, 0.5), sheetMat);
        foldedSheet.position.set(bedX, 0.58, bedZ + bedL / 2 - 0.4);
        this.group.add(foldedSheet);

        // Travesseiros — nos dois cantos, junto à parede de trás
        [-0.42, 0.42].forEach((ox) => {
            const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.38), pillowMat);
            pillow.position.set(bedX + ox, 0.58, bedZ - bedL / 2 + 0.3);
            pillow.rotation.y = ox * 0.12;
            pillow.castShadow = true;
            this.group.add(pillow);
        });

        this.addPropCollider(bedX, bedZ, Math.max(bedW, bedL) / 2 - 0.1);
    }

    // -------------------------------------------------------------
    // Criado-mudo
    // -------------------------------------------------------------
    buildNightstand() {
        const woodMat = this.mat(createDarkWoodTexture(1, 1), 0x4a3826);
        const x = -1.95, z = 0.35;

        const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.42), woodMat);
        body.position.set(x, 0.275, z);
        body.castShadow = body.receiveShadow = true;
        this.group.add(body);

        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.02), this.mat(null, 0x8a7a5a));
        handle.position.set(x, 0.32, z + 0.22);
        this.group.add(handle);

        this.addPropCollider(x, z, 0.32);
    }

    // -------------------------------------------------------------
    // Porta (estática/fechada por enquanto — sem interação ainda)
    // -------------------------------------------------------------
    buildDoor() {
        const doorTex = createDarkWoodTexture(1, 1);
        const doorMat = this.mat(doorTex, 0x2e2015);
        const frameMat = this.mat(null, 0xd9cfae);

        const z = HALF_D - WALL_T / 2;
        const doorCenterX = -1.8;

        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.2, 0.14), frameMat);
        frame.position.set(doorCenterX, 1.1, z);
        this.group.add(frame);

        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.05, 0.06), doorMat);
        panel.position.set(doorCenterX, 1.05, z - 0.02);
        panel.castShadow = true;
        this.group.add(panel);

        // Dois painéis em relevo (detalhe visual, baixo custo)
        [0.55, -0.45].forEach((oy) => {
            const inset = new THREE.Mesh(
                new THREE.BoxGeometry(0.62, 0.7, 0.02),
                this.mat(null, 0x241a10)
            );
            inset.position.set(doorCenterX, 1.05 + oy, z - 0.055);
            this.group.add(inset);
        });

        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), this.mat(null, 0x9a8a60));
        handle.rotation.z = Math.PI / 2;
        handle.position.set(doorCenterX + 0.35, 1.05, z - 0.08);
        this.group.add(handle);

        // Colisão: porta fechada bloqueia (não é andável ainda)
        this.addPropCollider(doorCenterX, z, 0.5);
    }

    // -------------------------------------------------------------
    // Quadro/espelho na parede direita
    // -------------------------------------------------------------
    buildFramedPicture() {
        const frameMat = this.mat(null, 0x3a2a1c);
        const glassMat = this.mat(null, 0xb9c4c2, { transparent: true, opacity: 0.85 });

        const x = HALF_W - WALL_T / 2 - 0.02;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.62), frameMat);
        frame.rotation.y = Math.PI / 2;
        frame.position.set(x, 1.55, 0);
        this.group.add(frame);

        const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.86), glassMat);
        glass.rotation.y = -Math.PI / 2;
        glass.position.set(x - 0.035, 1.55, 0);
        this.group.add(glass);
    }

    // -------------------------------------------------------------
    // Iluminação — calma e quente (contraste deliberado com os Backrooms)
    // -------------------------------------------------------------
    buildLights() {
        this.ambientLightRef = new THREE.AmbientLight(0xcfc4a8, 0.55);
        this.group.add(this.ambientLightRef);

        this.sunLightRef = new THREE.DirectionalLight(0xfff0d0, 0.9);
        this.sunLightRef.position.set(-1.5, 3, -3);
        this.sunLightRef.target.position.set(0, 0, 0);
        this.sunLightRef.castShadow = true;
        this.group.add(this.sunLightRef, this.sunLightRef.target);

        const lamp = new THREE.PointLight(0xffe2b0, 0.6, 3.5);
        lamp.position.set(-1.95, 0.7, 0.35); // sobre o criado-mudo
        this.group.add(lamp);

        // Intensidades originais guardadas — usadas como referência pelo
        // efeito de "visão turva ao acordar" (setWakeHaze), sem precisar
        // mexer nesses valores nenhuma outra vez.
        this._baseAmbientIntensity = this.ambientLightRef.intensity;
        this._baseSunIntensity = this.sunLightRef.intensity;
    }

    // -------------------------------------------------------------
    // ETAPA 3 — "visão turva ao acordar", feita com névoa + luz baixa
    // (funciona em VR de verdade, diferente de um desfoque de tela 2D,
    // que não apareceria dentro do headset). t=1 → totalmente turvo,
    // t=0 → totalmente nítido/normal.
    // -------------------------------------------------------------
    setWakeHaze(t) {
        t = Math.min(1, Math.max(0, t));
        const near = THREE.MathUtils.lerp(6, 0.12, t);
        const far = THREE.MathUtils.lerp(22, 1.8, t);
        if (!this.scene.fog) {
            this.scene.fog = new THREE.Fog(0x050403, near, far);
        }
        this.scene.fog.near = near;
        this.scene.fog.far = far;

        if (this.ambientLightRef) {
            this.ambientLightRef.intensity = THREE.MathUtils.lerp(this._baseAmbientIntensity, this._baseAmbientIntensity * 0.05, t);
        }
        if (this.sunLightRef) {
            this.sunLightRef.intensity = THREE.MathUtils.lerp(this._baseSunIntensity, this._baseSunIntensity * 0.03, t);
        }
    }

    // Remove a névoa e devolve a luz ao valor original — chamado quando
    // a sequência de despertar termina de clarear.
    clearWakeHaze() {
        this.scene.fog = null;
        if (this.ambientLightRef) this.ambientLightRef.intensity = this._baseAmbientIntensity;
        if (this.sunLightRef) this.sunLightRef.intensity = this._baseSunIntensity;
    }

    // -------------------------------------------------------------
    // ETAPA 2 — pose da câmera de despertar (só posição/orientação,
    // sem animação ainda). Cabeça apoiada no travesseiro esquerdo,
    // virada em diagonal pra enxergar cama + quarto + janela + móveis
    // ao mesmo tempo — não olhando reto pro teto nem reto pra porta.
    // Valores calibrados a partir da posição real da cama; ajustar os
    // números abaixo se o enquadramento não ficar como esperado.
    // -------------------------------------------------------------
    getWakeCameraPose() {
        const pillowZ = this.bedZ - this.bedL / 2 + 0.3; // mesmo cálculo do buildBed
        const pillowTopY = 0.58 + 0.08; // centro do travesseiro + metade da altura

        const position = new THREE.Vector3(
            -0.25,              // um pouco à esquerda do centro (travesseiro esquerdo)
            pillowTopY + 0.06,  // cabeça descansando logo acima do travesseiro
            pillowZ + 0.2       // puxado um pouco pra frente da parede/travesseiro
        );

        // Olhando na diagonal pro canto janela + guarda-roupa direito,
        // com a cama e o resto do quarto entrando pela lateral do campo
        // de visão. Levemente pra cima (quem acabou de acordar).
        const yaw = -1.13;   // ~ -65°
        const pitch = 0.18;  // ~ +10°, olhando um pouco pra cima

        return { position, yaw, pitch };
    }

    // Sem lógica de andamento de jogo ainda — nada pra atualizar por frame.
    updateAmbientEvents() {}
    refreshInteractionStates() {}
    setPlayerPosition() {}
}
