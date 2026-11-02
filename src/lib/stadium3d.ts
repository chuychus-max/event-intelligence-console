// Maqueta 3D del estadio de la ilustración (public/estadio.webp): misma silueta —
// gradas en U abiertas hacia el escenario y la cubierta naranja continua— dibujada
// con volúmenes crema y contorno grafito, como un plano de arquitectura en 3D.
// No es un recinto real; todo el movimiento es sintético.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type MapStatus = "good" | "warning" | "serious" | "critical";

export const MAP_INK = "#3a3734";
export const MAP_PAPER = "#f9f1e6";
export const MAP_ORANGE = "#e8841f";
export const MAP_AMBER = "#efb25e";

export const STATUS_HEX: Record<MapStatus, string> = {
  good: MAP_INK,
  warning: MAP_AMBER,
  serious: MAP_ORANGE,
  critical: MAP_ORANGE,
};

export interface GateState {
  status: MapStatus;
  flow: number; // 0–1
}

export interface MarkerState {
  id: string;
  at: string; // ancla: gate:C, bar:4, spot:1, pista, escenario
  status: MapStatus;
}

export interface SceneState {
  gates: Record<string, GateState>;
  density: number;
  bars?: number[];
  spots?: boolean;
  markers?: MarkerState[];
  selected?: string;
}

export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

interface Options {
  mode: "hero" | "ops";
  lowPower: boolean;
  animated: boolean;
  onFrame?: (p: Record<string, Projected>, w: number, h: number) => void;
}

// ─── Planta (metros; z positivo = frente, hacia quien mira) ────────────────

const ZB = -56; // las gradas se abren al fondo, donde está el escenario
const GATES: Record<string, [number, number]> = {
  A: [-106, -6],
  B: [-102, -46],
  C: [-26, 56],
  D: [26, 56],
  E: [94, 44],
  F: [106, -6],
  G: [102, -46],
  H: [-94, 44],
};
const FLOW_PATHS: Record<string, [number, number][]> = {
  A: [[-190, -24], [-150, -12], [-106, -6]],
  B: [[-160, -120], [-128, -80], [-102, -46]],
  C: [[-26, 170], [-26, 110], [-26, 56]],
  D: [[26, 170], [26, 110], [26, 56]],
  E: [[175, 130], [135, 88], [94, 44]],
  F: [[190, -24], [150, -12], [106, -6]],
  G: [[160, -120], [128, -80], [102, -46]],
  H: [[-175, 130], [-135, 88], [-94, 44]],
};
const ROOF_Y = 19;
const ROOF_TOP = ROOF_Y + 2.3;
const BARS: [number, number][] = [
  [-84, 22],
  [-44, 41],
  [44, 41],
  [84, 22],
  [-87, -36],
  [87, -36],
];
const SPOTS: [number, number][] = [
  [0, 104],
  [-62, 84],
  [62, 84],
  [126, 30],
  [-126, 30],
];

export function anchorPos(at: string): THREE.Vector3 | null {
  const [kind, id] = at.split(":");
  if (kind === "gate" && GATES[id]) return new THREE.Vector3(GATES[id][0], 0.4, GATES[id][1]);
  if (kind === "bar") {
    const b = BARS[Number(id) - 1];
    return b ? new THREE.Vector3(b[0], ROOF_TOP, b[1]) : null;
  }
  if (kind === "spot") {
    const s = SPOTS[Number(id) - 1];
    return s ? new THREE.Vector3(s[0], 0.4, s[1]) : null;
  }
  if (kind === "pista") return new THREE.Vector3(0, 0.6, -34);
  if (kind === "escenario") return new THREE.Vector3(0, 6, -64);
  return null;
}

// Banda en U: contorno exterior e interior con esquinas frontales redondeadas,
// abierta en z = zb. Se dibuja en el plano (x, -z) y se extruye hacia arriba.
function uBand(wo: number, zfo: number, ro: number, wi: number, zfi: number, ri: number, zb: number) {
  const s = new THREE.Shape();
  const m = (x: number, z: number) => s.moveTo(x, -z);
  const l = (x: number, z: number) => s.lineTo(x, -z);
  const q = (cx: number, cz: number, x: number, z: number) => s.quadraticCurveTo(cx, -cz, x, -z);
  m(-wo, zb);
  l(-wo, zfo - ro);
  q(-wo, zfo, -wo + ro, zfo);
  l(wo - ro, zfo);
  q(wo, zfo, wo, zfo - ro);
  l(wo, zb);
  l(wi, zb);
  l(wi, zfi - ri);
  q(wi, zfi, wi - ri, zfi);
  l(-wi + ri, zfi);
  q(-wi, zfi, -wi, zfi - ri);
  l(-wi, zb);
  s.closePath();
  return s;
}

function extrudeFlat(shape: THREE.Shape, depth: number, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 28,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

function discTexture(inner: string, outer: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = MAP_PAPER;
  g.font = "italic 700 96px Georgia, 'Times New Roman', serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const BEAM_VS = /* glsl */ `
  varying float vY;
  void main() {
    vY = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BEAM_FS = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying float vY;
  void main() {
    float a = pow(1.0 - vY, 1.6) * uOpacity;
    a *= 0.7 + 0.3 * sin(uTime * 5.0 - vY * 16.0);
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

interface Marker {
  id: string;
  at: string;
  pos: THREE.Vector3;
  group: THREE.Group;
  beam: THREE.ShaderMaterial;
  ripples: THREE.Mesh[];
  glow: THREE.Mesh;
  born: number;
  dying: number | null;
  height: number;
}

interface Flow {
  curve: THREE.CatmullRomCurve3;
  line: THREE.Line;
  zone: THREE.Mesh;
  ring: THREE.Mesh;
  pole: THREE.Mesh;
  cap: THREE.Mesh;
  pulse: THREE.Mesh;
}

const PER_GATE = 16;

export class Stadium3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 5, 2400);
  private clock = new THREE.Clock();
  private raf = 0;
  private running = false;
  private disposed = false;
  private t = 0;
  private size = { w: 1, h: 1 };
  private state: SceneState = { gates: {}, density: 0.5 };

  private ink = new THREE.LineBasicMaterial({ color: MAP_INK, transparent: true, opacity: 0.9 });
  private inkSoft = new THREE.LineBasicMaterial({ color: MAP_INK, transparent: true, opacity: 0.35 });
  private flows: Record<string, Flow> = {};
  private walkers!: THREE.InstancedMesh;
  private walkerT: number[] = [];
  private crowd!: THREE.Points;
  private crowdBase: Float32Array = new Float32Array();
  private heat!: THREE.Mesh;
  private bars: { col: THREE.Mesh; mat: THREE.MeshLambertMaterial }[] = [];
  private spotRings: THREE.Mesh[] = [];
  private spotGroup = new THREE.Group();
  private markers = new Map<string, Marker>();
  private stageBeams: THREE.Mesh[] = [];
  private textures: THREE.Texture[] = [];

  private az = 0;
  private drag = 0;
  private tilt = 0;
  private dragging: { x: number; y: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: Options,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.lowPower ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(MAP_PAPER);
    this.scene.fog = new THREE.Fog(MAP_PAPER, 420, 820);

    this.build();
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  // ─── Construcción ───────────────────────────────────────────────────────

  private outline(mesh: THREE.Mesh, mat = this.ink, angle = 24) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), mat);
    e.position.copy(mesh.position);
    e.rotation.copy(mesh.rotation);
    e.scale.copy(mesh.scale);
    this.scene.add(e);
    return e;
  }

  private build() {
    const s = this.scene;
    const lowPower = this.opts.lowPower;

    s.add(new THREE.HemisphereLight("#fffaf1", "#d8ccb6", 2.1));
    const sun = new THREE.DirectionalLight("#fff4e4", 1.9);
    sun.position.set(-140, 260, 170);
    sun.castShadow = true;
    sun.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -230;
    sc.right = 230;
    sc.top = 230;
    sc.bottom = -230;
    sc.near = 50;
    sc.far = 700;
    sun.shadow.bias = -0.0006;
    sun.shadow.radius = 4;
    s.add(sun);

    // Suelo y retícula de plano
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ color: "#f3eadb" }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    const grid = new THREE.GridHelper(700, 70, MAP_INK, MAP_INK);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.07;
    grid.position.y = 0.05;
    s.add(grid);

    // Explanada alrededor del estadio
    const plazaShape = new THREE.Shape();
    {
      const [w, z0, z1, r] = [124, -84, 72, 46];
      plazaShape.moveTo(-w + r, -z1);
      plazaShape.lineTo(w - r, -z1);
      plazaShape.quadraticCurveTo(w, -z1, w, -z1 + r);
      plazaShape.lineTo(w, -z0 - r);
      plazaShape.quadraticCurveTo(w, -z0, w - r, -z0);
      plazaShape.lineTo(-w + r, -z0);
      plazaShape.quadraticCurveTo(-w, -z0, -w, -z0 - r);
      plazaShape.lineTo(-w, -z1 + r);
      plazaShape.quadraticCurveTo(-w, -z1, -w + r, -z1);
    }
    const plaza = new THREE.Mesh(extrudeFlat(plazaShape, 0.5), new THREE.MeshLambertMaterial({ color: "#faf4ea" }));
    plaza.receiveShadow = true;
    s.add(plaza);
    this.outline(plaza, this.inkSoft);

    // Gradas en tres niveles (la silueta en U)
    const cream = new THREE.MeshLambertMaterial({ color: "#efe5d3" });
    const tiers: [number, number, number, number][] = [
      [60, 16, 18, 5],
      [69, 25, 22, 10],
      [79, 34, 26, 15.5],
    ];
    for (const [wi, zfi, ri, h] of tiers) {
      const m = new THREE.Mesh(extrudeFlat(uBand(97, 49, 30, wi, zfi, ri, ZB), h), cream);
      m.castShadow = m.receiveShadow = true;
      s.add(m);
      this.outline(m);
    }
    // Cubierta naranja continua
    const roofGeo = extrudeFlat(uBand(101, 53, 33, 74, 29, 24, ZB - 3), 1.4, 0.9);
    const roof = new THREE.Mesh(roofGeo, [new THREE.MeshLambertMaterial({ color: MAP_ORANGE, emissive: "#5a2a00", emissiveIntensity: 0.18 }), new THREE.MeshLambertMaterial({ color: "#c76a14" })]);
    roof.position.y = ROOF_Y;
    roof.castShadow = true;
    s.add(roof);
    this.outline(roof, this.ink, 30);

    // Costillas de la cubierta
    const rib: number[] = [];
    const y = ROOF_TOP + 0.05;
    const seg = (x1: number, z1: number, x2: number, z2: number) => rib.push(x1, y, z1, x2, y, z2);
    for (let z = ZB; z <= 4; z += 7) {
      seg(-74, z, -101, z);
      seg(74, z, 101, z);
    }
    for (let x = -48; x <= 48; x += 8) seg(x, 29, x, 53);
    for (let a = 0; a <= Math.PI / 2 + 0.01; a += Math.PI / 12) {
      const ci = [50, 5];
      const co = [68, 20];
      for (const sx of [-1, 1]) {
        seg(sx * (ci[0] + 24 * Math.cos(a)), ci[1] + 24 * Math.sin(a), sx * (co[0] + 33 * Math.cos(a)), co[1] + 33 * Math.sin(a));
      }
    }
    const ribGeo = new THREE.BufferGeometry();
    ribGeo.setAttribute("position", new THREE.Float32BufferAttribute(rib, 3));
    s.add(new THREE.LineSegments(ribGeo, new THREE.LineBasicMaterial({ color: "#9b4f0c", transparent: true, opacity: 0.55 })));

    // Lema sobre el frente de la cubierta, como en la ilustración
    const tex = textTexture("Vivir es increíble");
    this.textures.push(tex);
    const slogan = new THREE.Mesh(new THREE.PlaneGeometry(78, 9.75), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    slogan.rotation.x = -Math.PI / 2;
    slogan.position.set(0, ROOF_TOP + 0.12, 41.5);
    s.add(slogan);

    // Columnas
    const cols: THREE.BufferGeometry[] = [];
    const colGeo = new THREE.CylinderGeometry(0.55, 0.55, ROOF_Y, 6);
    const put = (x: number, z: number) => cols.push(colGeo.clone().translate(x, ROOF_Y / 2, z));
    for (let z = ZB + 2; z <= 16; z += 12) {
      put(-99.5, z);
      put(99.5, z);
    }
    for (let x = -60; x <= 60; x += 20) put(x, 51.5);
    const colMesh = new THREE.Mesh(mergeGeometries(cols), new THREE.MeshLambertMaterial({ color: "#d9cdb8" }));
    colMesh.castShadow = true;
    s.add(colMesh);

    // Campo con público
    const field = new THREE.Mesh(new THREE.PlaneGeometry(120, 74), new THREE.MeshLambertMaterial({ color: "#e6dccb" }));
    field.rotation.x = -Math.PI / 2;
    field.position.set(0, 0.3, -19);
    field.receiveShadow = true;
    s.add(field);
    const n = lowPower ? 1600 : 3200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const zz = -54 + Math.pow(Math.random(), 1.5) * 68; // más gente cerca del escenario
      pos[i * 3] = (Math.random() * 2 - 1) * (56 - Math.max(0, zz - 4) * 0.5);
      pos[i * 3 + 1] = 0.9;
      pos[i * 3 + 2] = zz;
    }
    this.crowdBase = pos.slice();
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    cg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const dot = discTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)");
    this.textures.push(dot);
    this.crowd = new THREE.Points(cg, new THREE.PointsMaterial({ size: 3.4, vertexColors: true, map: dot, alphaTest: 0.35, transparent: true }));
    s.add(this.crowd);

    const heatTex = discTexture("rgba(232,132,31,0.95)", "rgba(232,132,31,0)");
    this.textures.push(heatTex);
    this.heat = new THREE.Mesh(new THREE.PlaneGeometry(110, 52), new THREE.MeshBasicMaterial({ map: heatTex, transparent: true, depthWrite: false }));
    this.heat.rotation.x = -Math.PI / 2;
    this.heat.position.set(0, 1.2, -36);
    s.add(this.heat);

    // Escenario
    const stageMat = new THREE.MeshLambertMaterial({ color: "#efe5d3" });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(58, 4, 12), stageMat);
    deck.position.set(0, 2, -62);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(70, 24, 4), stageMat);
    wall.position.set(0, 12, -71);
    const roofStage = new THREE.Mesh(new THREE.BoxGeometry(62, 1.6, 16), stageMat);
    roofStage.position.set(0, 22, -64);
    for (const m of [deck, wall, roofStage]) {
      m.castShadow = m.receiveShadow = true;
      s.add(m);
      this.outline(m);
    }
    const screenMat = new THREE.MeshBasicMaterial({ color: "#2f2c29" });
    for (const [x, w] of [
      [-25, 11],
      [0, 20],
      [25, 11],
    ]) {
      const sc2 = new THREE.Mesh(new THREE.PlaneGeometry(w, 9), screenMat);
      sc2.position.set(x, 13, -68.9);
      s.add(sc2);
    }
    const coneMat = new THREE.MeshBasicMaterial({ color: MAP_ORANGE, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide });
    for (const x of [-22, 0, 22]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 42, 24, 1, true), coneMat);
      cone.geometry.translate(0, -21, 0);
      cone.position.set(x, 21, -60);
      this.stageBeams.push(cone);
      s.add(cone);
    }

    // Puentes de acceso de las puertas C y D
    for (const x of [-26, 26]) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(11, 1.4, 70), new THREE.MeshLambertMaterial({ color: "#f6efe3" }));
      br.position.set(x, 2.4, 92);
      br.castShadow = br.receiveShadow = true;
      s.add(br);
      this.outline(br);
    }

    // Contexto urbano: bloques y árboles alrededor
    const rnd = mulberry(7);
    const blocks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < (lowPower ? 50 : 90); i++) {
      const a = rnd() * Math.PI * 2;
      const r = 175 + rnd() * 170;
      const x = Math.cos(a) * r * 1.25;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < 50 && z > 60) continue;
      const w = 10 + rnd() * 20;
      const d = 10 + rnd() * 18;
      const h = 3 + rnd() * 13;
      blocks.push(new THREE.BoxGeometry(w, h, d).rotateY(Math.round(rnd() * 3) * 0.12).translate(x, h / 2, z));
    }
    const city = new THREE.Mesh(mergeGeometries(blocks), new THREE.MeshLambertMaterial({ color: "#f1e8d8" }));
    city.castShadow = city.receiveShadow = true;
    s.add(city);
    this.outline(city, this.inkSoft, 40);
    const trees = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3, 0), new THREE.MeshLambertMaterial({ color: "#d5cbb7", flatShading: true }), lowPower ? 120 : 260);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < trees.count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 132 + rnd() * 120;
      const x = Math.cos(a) * r * 1.2;
      const z = Math.sin(a) * r;
      const sc3 = 0.7 + rnd() * 0.8;
      mtx.compose(new THREE.Vector3(x, 2.4 * sc3, Math.abs(x) < 45 && z > 60 ? z + 200 : z), new THREE.Quaternion(), new THREE.Vector3(sc3, sc3, sc3));
      trees.setMatrixAt(i, mtx);
    }
    trees.castShadow = true;
    s.add(trees);

    // Puertas, rutas de llegada y personas caminando
    for (const id of Object.keys(GATES)) {
      const [gx, gz] = GATES[id];
      const curve = new THREE.CatmullRomCurve3(FLOW_PATHS[id].map(([x, z]) => new THREE.Vector3(x, 1.2, z)));
      if (id === "C" || id === "D") curve.points.forEach((p) => (p.y = p.z > 58 ? 3.6 : 1.2));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
        new THREE.LineDashedMaterial({ color: MAP_INK, dashSize: 2, gapSize: 3, transparent: true, opacity: 0.4 }),
      );
      line.computeLineDistances();
      s.add(line);
      const zone = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: MAP_ORANGE, transparent: true, opacity: 0, depthWrite: false }));
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(gx, 0.7, gz);
      s.add(zone);
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.6, 40), new THREE.MeshBasicMaterial({ color: MAP_INK }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(gx, 0.8, gz);
      s.add(ring);
      const pulse = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.4, 40), new THREE.MeshBasicMaterial({ color: MAP_ORANGE, transparent: true, opacity: 0, depthWrite: false }));
      pulse.rotation.x = -Math.PI / 2;
      pulse.position.set(gx, 0.85, gz);
      s.add(pulse);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 10, 8), new THREE.MeshLambertMaterial({ color: MAP_INK }));
      pole.position.set(gx, 5, gz);
      pole.castShadow = true;
      s.add(pole);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), new THREE.MeshLambertMaterial({ color: MAP_PAPER }));
      cap.position.set(gx, 10.5, gz);
      s.add(cap);
      this.flows[id] = { curve, line, zone, ring, pole, cap, pulse };
    }
    const nW = Object.keys(GATES).length * PER_GATE;
    this.walkers = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffffff" }), nW);
    for (let i = 0; i < nW; i++) {
      this.walkerT.push(Math.random());
      this.walkers.setColorAt(i, new THREE.Color(MAP_INK));
    }
    s.add(this.walkers);

    // Barras sobre la cubierta: la altura de la columna es la fila en minutos
    for (const [bx, bz] of BARS) {
      const kiosk = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 5), new THREE.MeshLambertMaterial({ color: MAP_PAPER }));
      kiosk.position.set(bx, ROOF_TOP + 1.2, bz);
      kiosk.castShadow = true;
      s.add(kiosk);
      this.outline(kiosk);
      const mat = new THREE.MeshLambertMaterial({ color: MAP_INK, transparent: true, opacity: 0.9 });
      const colm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 2.2), mat);
      colm.position.set(bx, ROOF_TOP + 2.4, bz);
      colm.castShadow = true;
      s.add(colm);
      this.bars.push({ col: colm, mat });
    }

    // Spots comerciales en la explanada
    for (const [sx, sz] of SPOTS) {
      const hex = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 2.6, 6), new THREE.MeshLambertMaterial({ color: MAP_PAPER }));
      hex.position.set(sx, 1.3, sz);
      hex.castShadow = true;
      this.spotGroup.add(hex);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(hex.geometry), this.ink);
      e.position.copy(hex.position);
      this.spotGroup.add(e);
      const ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 6.3, 6), new THREE.MeshBasicMaterial({ color: MAP_ORANGE, transparent: true, opacity: 0.6, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = Math.PI / 6;
      ring.position.set(sx, 0.7, sz);
      ring.userData.offset = Math.random();
      this.spotRings.push(ring);
      this.spotGroup.add(ring);
    }
    s.add(this.spotGroup);
  }

  // ─── Estado ────────────────────────────────────────────────────────────

  setState(next: SceneState) {
    this.state = next;
    const ink = new THREE.Color(MAP_INK);
    const paper = new THREE.Color(MAP_PAPER);
    for (const [id, f] of Object.entries(this.flows)) {
      const g = next.gates[id] ?? { status: "good", flow: 0.3 };
      const c = new THREE.Color(STATUS_HEX[g.status]);
      const hot = g.status !== "good";
      (f.line.material as THREE.LineDashedMaterial).color.copy(hot ? c : ink);
      (f.line.material as THREE.LineDashedMaterial).opacity = hot ? 0.9 : 0.4;
      (f.ring.material as THREE.MeshBasicMaterial).color.copy(hot ? c : ink);
      (f.pole.material as THREE.MeshLambertMaterial).color.copy(hot ? c : ink);
      (f.cap.material as THREE.MeshLambertMaterial).color.copy(hot ? c : paper);
      f.zone.userData.target = hot ? 6 + g.flow * 10 : 0;
      f.pole.scale.y = next.selected === id ? 1.5 : 1;
      f.pole.position.y = next.selected === id ? 7.5 : 5;
      f.cap.position.y = next.selected === id ? 15.5 : 10.5;
    }
    next.bars?.forEach((q, i) => {
      const b = this.bars[i];
      if (!b) return;
      b.col.userData.target = Math.max(0.6, q * 1.6);
      b.mat.color.set(q > 8 ? MAP_ORANGE : MAP_INK);
    });
    this.spotGroup.visible = next.spots !== false;

    // Público: el naranja aparece frente al escenario cuando sube la densidad
    const col = this.crowd.geometry.getAttribute("color") as THREE.BufferAttribute;
    const orange = new THREE.Color(MAP_ORANGE);
    for (let i = 0; i < col.count; i++) {
      const z = this.crowdBase[i * 3 + 2];
      const near = Math.max(0, 1 - (z + 54) / 40);
      const hot = Math.random() < near * next.density * 0.9;
      const c = hot ? orange : ink;
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    (this.heat.material as THREE.MeshBasicMaterial).opacity = 0.1 + next.density * 0.8;

    // Marcadores de eventos: haz de luz + ondas en el punto exacto
    const want = new Map((next.markers ?? []).map((m) => [m.id, m]));
    for (const [id, m] of this.markers) if (!want.has(id) && m.dying === null) m.dying = this.t;
    for (const m of want.values()) {
      const pos = anchorPos(m.at);
      if (!pos) continue;
      const ex = this.markers.get(m.id);
      if (ex) {
        ex.beam.uniforms.uColor.value.set(STATUS_HEX[m.status]);
        continue;
      }
      this.markers.set(m.id, this.makeMarker(m, pos));
    }
    if (!this.running) this.renderFrame();
  }

  private makeMarker(m: MarkerState, pos: THREE.Vector3): Marker {
    const color = new THREE.Color(m.status === "good" ? "#5d5a55" : STATUS_HEX[m.status]);
    const group = new THREE.Group();
    group.position.copy(pos);
    const height = m.at.startsWith("bar") ? 14 : 22;
    const beam = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uOpacity: { value: 0.75 }, uTime: { value: 0 } },
      vertexShader: BEAM_VS,
      fragmentShader: BEAM_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beamMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, height, 24, 1, true), beam);
    beamMesh.geometry.translate(0, height / 2, 0);
    group.add(beamMesh);
    const glowTex = discTexture(`rgba(${(color.r * 255) | 0},${(color.g * 255) | 0},${(color.b * 255) | 0},0.85)`, "rgba(0,0,0,0)");
    this.textures.push(glowTex);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.4;
    group.add(glow);
    const ripples: THREE.Mesh[] = [];
    for (let k = 0; k < 3; k++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(1, 1.35, 48), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      r.position.y = 0.5 + k * 0.01;
      r.userData.offset = k / 3;
      ripples.push(r);
      group.add(r);
    }
    this.scene.add(group);
    return { id: m.id, at: m.at, pos, group, beam, ripples, glow, born: this.t, dying: null, height };
  }

  // ─── Ciclo de vida ─────────────────────────────────────────────────────

  setRunning(on: boolean) {
    if (on === this.running || this.disposed) return;
    this.running = on;
    if (on) {
      this.clock.getDelta();
      this.loop();
    } else cancelAnimationFrame(this.raf);
  }

  resize(w: number, h: number) {
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.place();
    this.renderFrame();
  }

  renderStill() {
    for (let i = 0; i < 60; i++) this.step(1 / 30);
    this.renderFrame();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.textures.forEach((t) => t.dispose());
    this.renderer.dispose();
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = { x: e.clientX, y: e.clientY };
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragging.x;
    const dy = e.clientY - this.dragging.y;
    this.dragging = { x: e.clientX, y: e.clientY };
    this.drag = Math.max(-1.2, Math.min(1.2, this.drag - dx * 0.005));
    this.tilt = Math.max(-0.25, Math.min(0.3, this.tilt + dy * 0.003));
    if (!this.running) {
      this.place();
      this.renderFrame();
    }
  };
  private onUp = () => {
    this.dragging = null;
  };

  private loop = () => {
    if (!this.running || this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.step(dt);
    this.renderFrame();
    this.raf = requestAnimationFrame(this.loop);
  };

  private place() {
    const hero = this.opts.mode === "hero";
    const t = this.t;
    const aspect = this.size.w / Math.max(1, this.size.h);
    const sway = this.opts.animated ? (hero ? 0.38 * Math.sin(t * 0.11) : 0.1 * Math.sin(t * 0.09)) : 0;
    this.az += (sway + this.drag - this.az) * (this.dragging ? 0.35 : 0.06);
    const el = 0.62 + this.tilt + (this.opts.animated && hero ? 0.05 * Math.sin(t * 0.07) : 0);
    // Distancia para que quepa el ancho del estadio con cualquier proporción.
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    let r = Math.max(hero ? 370 : 300, (hero ? 150 : 128) / (tanV * aspect));
    if (hero && this.opts.animated) r *= 1 - 0.05 * Math.sin(t * 0.09);
    const target = new THREE.Vector3(0, 0, 8);
    this.camera.position.set(target.x + r * Math.cos(el) * Math.sin(this.az), r * Math.sin(el), target.z + r * Math.cos(el) * Math.cos(this.az));
    this.camera.lookAt(target);
  }

  private step(dt: number) {
    this.t += dt;
    const t = this.t;

    // Personas caminando hacia cada puerta; más lentas si la puerta se satura
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const ink = new THREE.Color(MAP_INK);
    Object.keys(GATES).forEach((id, gi) => {
      const g = this.state.gates[id] ?? { status: "good" as MapStatus, flow: 0.3 };
      const active = Math.round(3 + g.flow * (PER_GATE - 3));
      const speed = g.status === "good" ? 0.14 : g.status === "warning" ? 0.09 : 0.055;
      const color = g.status === "good" ? ink : new THREE.Color(STATUS_HEX[g.status]);
      const f = this.flows[id];
      for (let k = 0; k < PER_GATE; k++) {
        const i = gi * PER_GATE + k;
        this.walkerT[i] = (this.walkerT[i] + dt * speed * (0.8 + (k % 5) * 0.08)) % 1;
        // en una puerta saturada se apilan al final: la fila se ve
        const tt = g.status === "good" ? this.walkerT[i] : 1 - Math.pow(1 - this.walkerT[i], 2.2);
        f.curve.getPoint(tt, p);
        p.x += Math.sin(i * 12.9) * 1.6;
        p.z += Math.cos(i * 7.3) * 1.6;
        const on = k < active ? 1.15 : 0;
        s.set(on, on, on);
        m.compose(p, q, s);
        this.walkers.setMatrixAt(i, m);
        this.walkers.setColorAt(i, color);
      }
      // zona de fila y pulso en la puerta
      const z = f.zone;
      const target = (z.userData.target as number) ?? 0;
      const cur = z.scale.x + (Math.max(0.001, target) - z.scale.x) * Math.min(1, dt * 2);
      z.scale.setScalar(cur);
      (z.material as THREE.MeshBasicMaterial).opacity = target > 0 ? 0.22 + 0.06 * Math.sin(t * 3) : 0;
      const k = (t * 0.7 + gi * 0.13) % 1;
      f.pulse.scale.setScalar(1 + k * 2.6);
      (f.pulse.material as THREE.MeshBasicMaterial).opacity = g.status === "good" ? 0 : 0.8 * (1 - k);
      if (this.state.selected === id) f.cap.scale.setScalar(1 + 0.15 * Math.sin(t * 4));
      else f.cap.scale.setScalar(1);
    });
    this.walkers.instanceMatrix.needsUpdate = true;
    if (this.walkers.instanceColor) this.walkers.instanceColor.needsUpdate = true;

    // Público que se mueve
    const cp = this.crowd.geometry.getAttribute("position") as THREE.BufferAttribute;
    const step = this.opts.lowPower ? 3 : 2;
    for (let i = (Math.floor(t * 30) % step); i < cp.count; i += step) {
      cp.setY(i, 0.9 + Math.max(0, Math.sin(t * 6 + i * 0.37)) * 0.5 * this.state.density);
    }
    cp.needsUpdate = true;
    (this.heat.material as THREE.MeshBasicMaterial).opacity = (0.1 + this.state.density * 0.75) * (0.85 + 0.15 * Math.sin(t * 2.2));
    this.stageBeams.forEach((c, i) => {
      c.rotation.z = Math.sin(t * 0.7 + i * 1.7) * 0.45;
      c.rotation.x = 0.35 + Math.sin(t * 0.5 + i) * 0.15;
    });

    this.bars.forEach((b) => {
      const target = (b.col.userData.target as number) ?? 1;
      const h = b.col.scale.y + (target - b.col.scale.y) * Math.min(1, dt * 2.5);
      b.col.scale.y = h;
      b.col.position.y = ROOF_TOP + 2.4 + h / 2;
    });
    this.spotRings.forEach((r) => {
      const k = (t * 0.35 + (r.userData.offset as number)) % 1;
      r.scale.setScalar(1 + k * 1.8);
      (r.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
    });

    // Eventos
    for (const [id, mk] of this.markers) {
      const life = Math.min(1, (t - mk.born) / 0.7);
      const fade = mk.dying === null ? 1 : Math.max(0, 1 - (t - mk.dying) / 0.6);
      if (fade <= 0) {
        this.scene.remove(mk.group);
        mk.group.traverse((o) => {
          const mm = o as THREE.Mesh;
          mm.geometry?.dispose();
          (mm.material as THREE.Material | undefined)?.dispose();
        });
        this.markers.delete(id);
        continue;
      }
      const grow = 1 - Math.pow(1 - life, 3);
      mk.group.children[0].scale.y = Math.max(0.001, grow);
      mk.beam.uniforms.uTime.value = t;
      mk.beam.uniforms.uOpacity.value = 0.8 * fade;
      (mk.glow.material as THREE.MeshBasicMaterial).opacity = (0.55 + 0.25 * Math.sin(t * 3)) * fade;
      mk.ripples.forEach((r) => {
        const k = (t * 0.6 + (r.userData.offset as number)) % 1;
        r.scale.setScalar(2 + k * 14);
        (r.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k) * fade;
      });
    }

    this.place();
  }

  private renderFrame() {
    this.renderer.render(this.scene, this.camera);
    const cb = this.opts.onFrame;
    if (!cb) return;
    const out: Record<string, Projected> = {};
    const v = new THREE.Vector3();
    const proj = (key: string, p: THREE.Vector3) => {
      v.copy(p).project(this.camera);
      out[key] = { x: (v.x * 0.5 + 0.5) * this.size.w, y: (-v.y * 0.5 + 0.5) * this.size.h, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
    };
    for (const [id, [x, z]] of Object.entries(GATES)) proj(`gate:${id}`, new THREE.Vector3(x, this.state.selected === id ? 18 : 13, z));
    BARS.forEach(([x, z], i) => {
      const h = this.bars[i]?.col.scale.y ?? 1;
      proj(`bar:${i + 1}`, new THREE.Vector3(x, ROOF_TOP + 3.4 + h, z));
    });
    SPOTS.forEach(([x, z], i) => proj(`spot:${i + 1}`, new THREE.Vector3(x, 4, z)));
    for (const mk of this.markers.values()) {
      if (mk.dying !== null) continue;
      proj(`mk:${mk.id}`, mk.pos.clone().setY(mk.pos.y + mk.height));
    }
    cb(out, this.size.w, this.size.h);
  }
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
