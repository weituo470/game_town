import * as THREE from 'three';

/**
 * Faithful procedural extraction from the user's deepseek-park.html.
 * Source: <project-root>
 * SHA-256: 5069415aa261e862fe882d6b522bed0f63e42d828792019089ad81a8a17aba64
 * Original custom scene: lines 4323-5083; geometry and animation only.
 * The embedded r186 engine, standalone renderer/camera, sky/lights/fog,
 * DOM controls, RAF and unused recursive postprocessor are intentionally NOT imported.
 * This module uses the town's single installed Three r180 instance.
 */
export const DEEPSEEK_MODEL = Object.freeze({ radius: 70, groundY: .335, particleCount: 880, sourceRevision: 186 });

export function createDeepSeekPark({ seed = 0x4453504b, townContext = false, createCanvas = () => document.createElement('canvas') } = {}) {
  const group = new THREE.Group();
  group.name = 'deepseek-source-park';
  group.position.y = -DEEPSEEK_MODEL.groundY;
  let disposed = false, randomState = (seed >>> 0) || 0x4453504b;
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; };
  const geometryCache = new Map(), materialCache = new Map();
  const cachedGeometry = (key, create) => { if (!geometryCache.has(key)) geometryCache.set(key, create()); return geometryCache.get(key); };
  const standardMaterial = (color, roughness, metalness) => {
    const key = `standard:${color}:${roughness}:${metalness}`;
    if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    return materialCache.get(key);
  };
  const glowMaterial = (color, opacity, shared) => {
    const create = () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    if (!shared) return create();
    const key = `glow:${color}:${opacity}`;
    if (!materialCache.has(key)) materialCache.set(key, create());
    return materialCache.get(key);
  };
  var C = {
    brand: 0x4d8bff,
    ice: 0xdce9ff,
    stone: townContext ? 0xc1ad92 : 0xdfe9f7,
    stoneDark: townContext ? 0xa69b86 : 0x7f92ad,
    grass: townContext ? 0x748469 : 0x2d4a58,
    grass2: townContext ? 0x62765e : 0x24404d
  };

  function box(w, h, d, color, rough, metal) {
    var m = new THREE.Mesh(cachedGeometry('box:'+w+':'+h+':'+d, () => new THREE.BoxGeometry(w, h, d)),
      standardMaterial(color, rough === undefined ? 0.78 : rough, metal === undefined ? 0.05 : metal));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cyl(rt, rb, h, color, seg, rough, metal) {
    var m = new THREE.Mesh(cachedGeometry('cyl:'+rt+':'+rb+':'+h+':'+(seg||24), () => new THREE.CylinderGeometry(rt, rb, h, seg || 24)),
      standardMaterial(color, rough === undefined ? 0.62 : rough, metal === undefined ? 0.16 : metal));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function glowBall(r, color, opacity, shared = false) {
    return new THREE.Mesh(cachedGeometry('glow:'+r, () => new THREE.SphereGeometry(r, 16, 12)),
      glowMaterial(color, opacity === undefined ? 0.9 : opacity, shared));
  }
  function canvasTexture(w, h, draw) {
    var canvas = createCanvas();
    canvas.width = w; canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    var tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  var signTexture = canvasTexture(1024, 256, function (ctx, w, h) {
    ctx.fillStyle = '#0c1a30'; ctx.fillRect(0, 0, w, h);
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#4d8bff'); g.addColorStop(0.55, '#8dc0ff'); g.addColorStop(1, '#2f6bd8');
    ctx.strokeStyle = g; ctx.lineWidth = 8; ctx.strokeRect(24, 24, w - 48, h - 48);
    ctx.fillStyle = '#eaf3ff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 118px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
    ctx.fillText('DeepSeek', w / 2, h / 2 - 14);
    ctx.font = '34px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = '#8dc0ff';
    ctx.fillText('深 度 求 索', w / 2, h / 2 + 74);
  });

  var gridTexture = canvasTexture(512, 512, function (ctx, w, h) {
    ctx.fillStyle = 'rgba(20,44,86,0.30)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(141,192,255,0.55)'; ctx.lineWidth = 2;
    for (var i = 0; i <= 8; i++) {
      var p = (i / 8) * w;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
    }
  });

  // The standalone blue/black display plinth is not an island landscape.
  // In town, a warm seawall and a flush planted terrace share the town palette.
  var tiers = townContext ? [
    { r: 68, y: -1.6, h: 2.4, color: 0x9c9985 },
    { r: 68, y: -.55, h: .5, color: 0xc1ad92 },
    { r: 67.8, y: .215, h: .24, color: C.grass }
  ] : [
    { r: 68, y: -1.6, h: 2.4, color: 0x16283c },
    { r: 56, y: -0.55, h: 1.2, color: 0x1d3348 },
    { r: 44, y: 0.0, h: 0.5, color: C.stoneDark }
  ];
  for (var ti = 0; ti < tiers.length; ti++) {
    var base = townContext && ti === 2
      ? new THREE.Mesh(new THREE.RingGeometry(15.1, 67.8, 96), standardMaterial(C.grass, .95, .02))
      : cyl(tiers[ti].r, tiers[ti].r + 2, tiers[ti].h, tiers[ti].color, 96, 0.95);
    // A hole exposes the whale water; a small offset keeps paths above grass.
    if (townContext && ti === 2) { base.rotation.x = -Math.PI / 2; base.position.y = .32; base.receiveShadow = true; }
    else base.position.y = tiers[ti].y;
    base.name = `deepseek-ground-tier-${ti}`;
    base.castShadow = false;
    group.add(base);
  }

  // 广场：环形，中间留出鲸池
  var plaza = new THREE.Mesh(new THREE.RingGeometry(15.4, 30, 96),
    new THREE.MeshStandardMaterial({ color: townContext ? 0xb3a18a : 0x8f9db2, roughness: 0.88 }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.345;
  plaza.receiveShadow = true;
  group.add(plaza);

  var pathMat = new THREE.MeshStandardMaterial({ color: townContext ? 0xb8a58e : 0x9caabd, roughness: 0.9 });
  if (townContext) {
    for (const [name, inner, outer, color] of [
      ['waterfront-walk', 59, 63.2, 0xb3a18a],
      ['shore-curb', 66.8, 68, 0xc1ad92],
    ]) {
      const walk = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), standardMaterial(color, .92, .02));
      walk.name = `deepseek-${name}`; walk.rotation.x = -Math.PI / 2; walk.position.y = .35;
      walk.receiveShadow = true; group.add(walk);
    }
  }
  // The standalone source had no town bridge. Continue its entrance axis over
  // the low outer terrace at exactly the shared walk-plane height.
  const approach = new THREE.Mesh(new THREE.BoxGeometry(11.6, .24, 22), pathMat);
  approach.name = 'deepseek-bridge-approach'; approach.position.set(0, .215, 59);
  approach.receiveShadow = true; group.add(approach);
  for (var pi = 0; pi < 8; pi++) {
    var pa = (pi / 8) * Math.PI * 2;
    var pw = pi % 2 === 0 ? 7.5 : 4.2;
    var plen = pi % 2 === 0 ? 34 : 30;
    var strip = new THREE.Mesh(new THREE.PlaneGeometry(pw, plen), pathMat);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = -pa;
    strip.position.set(Math.sin(pa) * (14 + plen / 2), 0.335, Math.cos(pa) * (14 + plen / 2));
    strip.receiveShadow = true;
    group.add(strip);
  }

  var ringRoad = new THREE.Mesh(new THREE.RingGeometry(34, 38.4, 96), pathMat);
  ringRoad.rotation.x = -Math.PI / 2; ringRoad.position.y = 0.335; ringRoad.receiveShadow = true;
  group.add(ringRoad);

  var rimRing = new THREE.Mesh(new THREE.RingGeometry(29.1, 29.9, 96),
    new THREE.MeshBasicMaterial({ color: C.brand, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  rimRing.rotation.x = -Math.PI / 2; rimRing.position.y = 0.352;
  group.add(rimRing);

  // 鲸池
  var POOL_R = 15.5;
  var basin = cyl(POOL_R, POOL_R - 1.6, 3.4, 0x0d1f34, 64, 1);
  basin.position.y = -1.55; basin.castShadow = false;
  group.add(basin);

  var waterUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x08203d) },
    uShallow: { value: new THREE.Color(0x1f6fb8) },
    uGlow: { value: new THREE.Color(0x7fc0ff) }
  };
  var water = new THREE.Mesh(new THREE.CircleGeometry(POOL_R - 0.4, 96), new THREE.ShaderMaterial({
    transparent: true,
    uniforms: waterUniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uGlow;',
      'varying vec2 vUv;',
      'float wave(vec2 p, float t){ return sin(p.x * 21.0 + t * 1.4) * 0.5 + sin(p.y * 27.0 - t * 1.1) * 0.5; }',
      'void main(){',
      '  vec2 p = vUv * 2.0 - 1.0;',
      '  float d = length(p);',
      '  float w = wave(vUv * 3.0, uTime) * 0.5 + 0.5;',
      '  vec3 col = mix(uDeep, uShallow, smoothstep(0.15, 1.0, d) * 0.75 + w * 0.25);',
      '  col += uGlow * smoothstep(0.985, 1.0, 1.0 - d) * 0.55;',
      '  col += uGlow * pow(w, 6.0) * 0.42;',
      '  gl_FragColor = vec4(col, 0.94);',
      '}'
    ].join('\n')
  }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.16;
  group.add(water);

  var coping = new THREE.Mesh(new THREE.TorusGeometry(POOL_R, 0.55, 12, 96),
    new THREE.MeshStandardMaterial({ color: 0xdfe9f7, roughness: 0.6 }));
  coping.rotation.x = -Math.PI / 2; coping.position.y = 0.34;
  coping.castShadow = true; coping.receiveShadow = true;
  group.add(coping);

  // 蓝鲸
  var whale = new THREE.Group();
  (function () {
    var skin = new THREE.MeshStandardMaterial({ color: 0x2f6bd8, roughness: 0.3, metalness: 0.22 });
    var skinDark = new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.36, metalness: 0.2 });
    var bellyMat = new THREE.MeshStandardMaterial({ color: 0xd6e6ff, roughness: 0.44 });
    var darkMat = new THREE.MeshStandardMaterial({ color: 0x06101f, roughness: 0.16 });
    var SPH = new THREE.SphereGeometry(1, 28, 18);

    function part(mat, pos, scale, rot) {
      var mesh = new THREE.Mesh(SPH, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      whale.add(mesh);
    }

    part(skin, [0, 0.1, 0.8], [2.5, 2.7, 6.4]);
    part(skin, [0, 0.15, 5.4], [1.7, 1.85, 3.0]);
    part(skin, [0, 0.2, -5.2], [2.2, 2.3, 3.0]);
    part(skin, [0, -0.05, -7.5], [1.3, 1.1, 1.9]);
    part(bellyMat, [0, -1.85, 0.4], [2.05, 1.45, 5.2]);
    part(bellyMat, [0, -1.45, -5.2], [1.5, 1.0, 2.0]);
    for (var fi = 0; fi < 2; fi++) {
      var side = fi === 0 ? -1 : 1;
      part(skinDark, [side * 2.4, -0.55, -2.7], [2.9, 0.34, 1.1], [0.16, side * 0.52, side * 0.3]);
      part(skinDark, [side * 1.75, 0.35, 7.3], [2.45, 0.3, 1.35], [0, side * -0.58, side * 0.2]);
      part(darkMat, [side * 1.5, 0.6, -6.2], [0.24, 0.26, 0.22], [0, side * 0.35, 0]);
    }
    part(skinDark, [0, 1.6, 2.4], [0.34, 1.0, 1.5], [0.18, 0, 0]);
    part(new THREE.MeshStandardMaterial({ color: 0x0d2547, roughness: 0.45 }), [0, -1.15, -8.0], [1.15, 0.16, 0.95]);

    var shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: C.brand, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
    shell.scale.set(3.4, 3.6, 9.4);
    shell.position.set(0, 0.1, 1.2);
    whale.add(shell);
  })();

  var whaleInner = new THREE.Group();
  while (whale.children.length) whaleInner.add(whale.children[0]);
  whaleInner.rotation.x = 0.34;
  whale.add(whaleInner);
  whale.position.set(0, 10.6, 0);
  whale.scale.setScalar(1.72);
  group.add(whale);

  // 鲸的水花
  var SPOUT = 360;
  var spoutPos = new Float32Array(SPOUT * 3);
  var spoutSeed = new Float32Array(SPOUT);
  for (var qi = 0; qi < SPOUT; qi++) spoutSeed[qi] = random();
  var spoutGeo = new THREE.BufferGeometry();
  spoutGeo.setAttribute('position', new THREE.BufferAttribute(spoutPos, 3).setUsage(THREE.DynamicDrawUsage));
  spoutGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 15, 0), 12);
  group.add(new THREE.Points(spoutGeo, new THREE.PointsMaterial({
    color: 0xbfe0ff, size: 0.62, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending
  })));

  // 六座专家塔
  var TOWER_R = 30;
  var towers = [];
  var towerAngles = [30, 90, 150, 210, 270, 330];
  var towerHeights = [13, 17.5, 11.5, 19, 14.5, 16];
  for (var twi = 0; twi < towerAngles.length; twi++) {
    var ta = (towerAngles[twi] * Math.PI) / 180;
    var tx = Math.sin(ta) * TOWER_R;
    var tz = Math.cos(ta) * TOWER_R;
    var th = towerHeights[twi];

    var towerGroup = new THREE.Group();
    towerGroup.position.set(tx, 0, tz);

    var tbase = cyl(3.1, 3.6, 0.8, C.stone, 8, 0.85);
    tbase.position.y = 0.4;
    towerGroup.add(tbase);

    var shaft = cyl(1.5, 1.9, th, 0x31518a, 8, 0.45, 0.35);
    shaft.position.y = 0.8 + th / 2;
    towerGroup.add(shaft);

    for (var bi = 1; bi <= 3; bi++) {
      var belt = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.62, 0.16, 8),
        new THREE.MeshBasicMaterial({ color: 0x8dc0ff, transparent: true, opacity: 0.75 }));
      belt.position.y = 0.8 + (th * bi) / 4;
      towerGroup.add(belt);
    }

    var cap = cyl(1.05, 1.45, 0.9, 0x8fa6c4, 8, 0.5, 0.3);
    cap.position.y = 0.8 + th + 0.45;
    towerGroup.add(cap);

    var orb = glowBall(0.72, 0xa9d2ff, 0.8);
    orb.position.y = 0.8 + th + 1.35;
    towerGroup.add(orb);

    var from = new THREE.Vector3(0, 0.8 + th + 1.3, 0);
    var to = new THREE.Vector3(-tx, 9.6, -tz);
    var dir = to.clone().sub(from);
    var len = dir.length();
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, len, 6),
      new THREE.MeshBasicMaterial({ color: 0x8dc0ff, transparent: true, opacity: 0.085, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    towerGroup.add(beam);

    var spark = glowBall(0.26, 0xdcefff, 0.95);
    spark.position.y = 1;
    towerGroup.add(spark);

    towerGroup.userData = { h: th, orb: orb, spark: spark, phase: twi / 6 };
    group.add(towerGroup);
    towers.push(towerGroup);
  }

  // 层析塔
  var layerStack = new THREE.Group();
  layerStack.position.set(0, 0, -32);
  (function () {
    var plinth = cyl(11, 12.4, 1.1, C.stone, 8, 0.85);
    plinth.position.y = 0.55;
    layerStack.add(plinth);

    for (var li = 0; li < 5; li++) {
      var size = 17 - li * 1.1;
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ map: gridTexture, transparent: true, opacity: 0.4 + li * 0.06, side: THREE.DoubleSide, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = 1.4 + li * 1.5;
      plane.userData.baseY = plane.position.y;
      plane.userData.spin = (li % 2 === 0 ? 1 : -1) * (0.06 + li * 0.012);
      layerStack.add(plane);
    }

    var core = cyl(0.42, 0.42, 9.2, 0x8dc0ff, 12, 0.2, 0.6);
    core.position.y = 5.6;
    layerStack.add(core);

    var halo = glowBall(1.5, 0xbfe0ff, 0.5);
    halo.position.y = 9.6;
    layerStack.add(halo);
    layerStack.userData.halo = halo;
  })();
  group.add(layerStack);

  // 入口牌楼
  var gate = new THREE.Group();
  gate.position.set(0, 0, 42);
  (function () {
    for (var gi = 0; gi < 2; gi++) {
      var gside = gi === 0 ? -1 : 1;
      var pylon = box(3.0, 12, 3.0, 0x35528a);
      pylon.position.set(gside * 8.8, 6, 0);
      gate.add(pylon);
      var cap = box(3.8, 0.55, 3.8, C.stone);
      cap.position.set(gside * 8.8, 12.2, 0);
      gate.add(cap);
    }
    var lintel = box(22, 1.6, 2.4, 0x40629e);
    lintel.position.y = 13.6;
    gate.add(lintel);

    var sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.05),
      new THREE.MeshBasicMaterial({ map: signTexture, transparent: true }));
    sign.position.set(0, 13.6, 1.28);
    gate.add(sign);
    var signBack = sign.clone();
    signBack.position.z = -1.28; signBack.rotation.y = Math.PI;
    gate.add(signBack);
  })();
  group.add(gate);

  // 数据喷泉
  var fountain = new THREE.Group();
  fountain.position.set(0, 0, 27);
  (function () {
    var fbasin = cyl(4.6, 5.2, 0.9, 0xd6e2f2, 32, 0.7);
    fbasin.position.y = 0.45;
    fountain.add(fbasin);
    var inner = cyl(4.1, 4.1, 0.2, 0x2f6bd8, 32, 0.3, 0.4);
    inner.position.y = 0.82;
    fountain.add(inner);
    var pillar = cyl(0.5, 0.9, 3.4, 0x8fb6e8, 16, 0.4, 0.5);
    pillar.position.y = 2.2;
    fountain.add(pillar);
    var orb = glowBall(0.7, 0xcfe6ff, 0.9);
    orb.position.set(0, 4.2, 0);
    fountain.add(orb);
    fountain.userData.orb = orb;
  })();
  group.add(fountain);

  var JETS = 520;
  var jetPos = new Float32Array(JETS * 3);
  var jetSeed = new Float32Array(JETS);
  for (var ji = 0; ji < JETS; ji++) jetSeed[ji] = random();
  var jetGeo = new THREE.BufferGeometry();
  jetGeo.setAttribute('position', new THREE.BufferAttribute(jetPos, 3).setUsage(THREE.DynamicDrawUsage));
  jetGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 27), 8);
  group.add(new THREE.Points(jetGeo, new THREE.PointsMaterial({
    color: 0xa8d4ff, size: 0.34, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending
  })));

  // 树
  var TREE_COUNT = 64;
  var trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.42, 2.8, 7),
    new THREE.MeshStandardMaterial({ color: 0x4a565c, roughness: 0.95 }), TREE_COUNT);
  var crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.9, 4.8, 9),
    new THREE.MeshStandardMaterial({ color: 0x376a70, roughness: 0.9 }), TREE_COUNT);
  trunks.castShadow = crowns.castShadow = true;
  trunks.receiveShadow = crowns.receiveShadow = true;
  (function () {
    var dummy = new THREE.Object3D();
    var color = new THREE.Color();
    var placed = 0, guard = 0;
    while (placed < TREE_COUNT && guard++ < 4000) {
      var r = 41 + random() * 16;
      var a = random() * Math.PI * 2;
      var x = Math.sin(a) * r;
      var z = Math.cos(a) * r;
      if (Math.abs(x) < 12 && z > 26) continue;
      var s = 0.55 + random() * 0.35;
      dummy.rotation.set(0, random() * Math.PI, 0);
      dummy.scale.setScalar(s);
      dummy.position.set(x, 0.5 + 1.4 * s, z);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      dummy.position.y = 0.5 + 5.1 * s;
      dummy.updateMatrix();
      crowns.setMatrixAt(placed, dummy.matrix);
      color.setHSL((townContext ? .27 : .48) + random() * .06, .32 + random() * .16, (townContext ? .35 : .26) + random() * .1);
      crowns.setColorAt(placed, color);
      placed++;
    }
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  })();
  group.add(trunks);
  group.add(crowns);

  // 路灯
  var lampGroup = new THREE.Group();
  var lampSpots = [];
  for (var lsi = 1; lsi <= 5; lsi++) {
    lampSpots.push([6.2, 30 - lsi * 5.2]);
    lampSpots.push([-6.2, 30 - lsi * 5.2]);
  }
  for (var lri = 0; lri < 8; lri++) {
    var la = (lri / 8) * Math.PI * 2 + 0.3;
    lampSpots.push([Math.sin(la) * 36, Math.cos(la) * 36]);
  }
  for (var lpi = 0; lpi < lampSpots.length; lpi++) {
    var lx = lampSpots[lpi][0], lz = lampSpots[lpi][1];
    var post = cyl(0.13, 0.18, 4.4, 0x71849c, 8, 0.6, 0.35);
    post.position.set(lx, 2.5, lz);
    lampGroup.add(post);
    var bulb = glowBall(0.26, 0xffe2b0, 0.85, true);
    bulb.position.set(lx, 4.85, lz);
    lampGroup.add(bulb);
  }
  group.add(lampGroup);

  // 相机

  // Static lamp repetition is batched without changing any original silhouette.
  const lampBatches = new Map();
  for (const mesh of lampGroup.children) {
    const key = `${mesh.geometry.uuid}:${mesh.material.uuid}`;
    if (!lampBatches.has(key)) lampBatches.set(key, []);
    lampBatches.get(key).push(mesh);
  }
  for (const meshes of lampBatches.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0], batch = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
    batch.name = 'deepseek-lamp-batch'; batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
    meshes.forEach((mesh, index) => { mesh.updateMatrix(); batch.setMatrixAt(index, mesh.matrix); lampGroup.remove(mesh); });
    batch.instanceMatrix.needsUpdate = true; lampGroup.add(batch);
  }
  const markSpot = (object, id) => { object.name = `deepseek-${id}`; object.traverse(child => { child.userData.deepseekSpot = id; }); };
  markSpot(whale, 'whale'); markSpot(layerStack, 'layers'); markSpot(gate, 'gate'); markSpot(fountain, 'fountain');
  towers.forEach((tower, index) => { markSpot(tower, 'towers'); tower.name = `deepseek-expert-${index + 1}`; });
  group.userData.source = 'deepseek-park.html';
  const geometries = new Set(), materials = new Set(), textures = new Set(), instances = new Set();
  let meshCount = 0, triangleCount = 0, instanceCount = 0;
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (object.isMesh) { meshCount++; triangleCount += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1); }
    if (object.isInstancedMesh) { instanceCount += object.count; instances.add(object); }
  });
  const statistics = Object.freeze({ meshCount, triangleCount, instanceCount, geometryCount: geometries.size, materialCount: materials.size, textureCount: textures.size, particleCount: SPOUT + JETS });
  let lastTime = null;
  const update = (timeMs = 0, reducedMotion = false) => {
    if (disposed) return false;
    const t = reducedMotion || !Number.isFinite(timeMs) ? 0 : Math.max(0, timeMs) / 1000;
    if (t === lastTime) return false;
    lastTime = t;
    // The shared town clock can be an epoch timestamp. Both water frequencies
    // repeat over 20π seconds; wrap exactly to retain float32 shader precision.
    waterUniforms.uTime.value = t % (20 * Math.PI);

    var bob = Math.sin(t * 0.5);
    whale.position.y = 10.6 + bob * 1.1;
    whale.rotation.y = t * 0.12;
    whale.rotation.z = Math.sin(t * 0.36) * 0.045;

    var sarr = spoutGeo.attributes.position.array;
    for (var i = 0; i < SPOUT; i++) {
      var life = ((t * 0.42 + spoutSeed[i]) % 1);
      var ang = spoutSeed[i] * Math.PI * 2 + t * 0.16;
      var spread = life * 3.4;
      sarr[i * 3] = Math.cos(ang) * spread * 0.75;
      sarr[i * 3 + 1] = whale.position.y + 1.4 + Math.sin(life * Math.PI) * 5.6 - life * life * 2.2;
      sarr[i * 3 + 2] = Math.sin(ang) * spread * 0.75;
    }
    spoutGeo.attributes.position.needsUpdate = true;

    var jarr = jetGeo.attributes.position.array;
    for (var j = 0; j < JETS; j++) {
      var jlife = ((t * 0.55 + jetSeed[j]) % 1);
      var ring = jetSeed[j] * Math.PI * 2 + jlife * 1.6;
      var radius = 0.4 + jlife * 3.1;
      jarr[j * 3] = fountain.position.x + Math.cos(ring) * radius;
      jarr[j * 3 + 1] = 0.9 + Math.sin(jlife * Math.PI) * 4.6;
      jarr[j * 3 + 2] = fountain.position.z + Math.sin(ring) * radius;
    }
    jetGeo.attributes.position.needsUpdate = true;
    if (fountain.userData.orb) fountain.userData.orb.material.opacity = 0.6 + Math.sin(t * 2.2) * 0.35;

    for (var ti2 = 0; ti2 < towers.length; ti2++) {
      var tower = towers[ti2];
      var data = tower.userData;
      var beat = Math.sin(t * 1.5 + data.phase * Math.PI * 2) * 0.5 + 0.5;
      data.orb.material.opacity = 0.55 + beat * 0.45;
      data.orb.scale.setScalar(0.85 + beat * 0.42);
      data.spark.position.y = 1.1 + ((t * 0.35 + data.phase) % 1) * (data.h - 0.4);
    }

    for (var li2 = 0; li2 < layerStack.children.length; li2++) {
      var child = layerStack.children[li2];
      if (child.userData.spin) {
        child.rotation.z = child.userData.spin * t;
        child.position.y = child.userData.baseY + Math.sin(t * 0.9 + child.userData.baseY) * 0.22;
      }
    }
    if (layerStack.userData.halo) layerStack.userData.halo.material.opacity = 0.32 + Math.sin(t * 1.8) * 0.2;


    return true;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    group.parent?.remove(group);
    instances.forEach(mesh => mesh.dispose());
    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());
    group.clear(); geometryCache.clear(); materialCache.clear();
  };
  update(0, true);
  return { group, update, dispose, statistics, anchors: { whale, towers, layerStack, gate, fountain } };
}
