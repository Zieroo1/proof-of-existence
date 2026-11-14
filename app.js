(() => {
  'use strict';

  const D = window.POE;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s) => document.querySelector(s);

  /* =============================================================== shapes
     Every particle owns one position per shape; the GPU blends between them.
     World units: camera at z=6, ghost ≈ 2.6 tall. */
  const SHAPES = { ghost: 0, chaos: 1, block: 2, sphere: 3, dust: 4 };
  const N = innerWidth < 760 ? 5000 : 9000;

  const rnd = Math.random;
  const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const pick = (items, weights) => {
    let x = rnd() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) if ((x -= weights[i]) <= 0) return items[i];
    return items[items.length - 1];
  };
  const BODY = [['#8052ff', '#a68bff', '#ffffff', '#ffb829', '#2bc4a4', '#e146ff', '#4f8bff', '#ff5fae'].map(hex), [5, 3.2, 1, 3.6, 1.8, 2.2, 1.6, 0.8]];
  const EYE = [['#e146ff', '#ff5fae', '#a68bff'].map(hex), [7, 2, 1]];
  const FLOOR = [['#e146ff', '#8052ff', '#ffb829'].map(hex), [4, 3, 1]];

  const ghost = new Float32Array(N * 3), chaos = new Float32Array(N * 3), block = new Float32Array(N * 3), sphere = new Float32Array(N * 3);
  const color = new Float32Array(N * 3), seed = new Float32Array(N * 4), kind = new Float32Array(N);
  const nEye = Math.floor(N * 0.045), nFloor = Math.floor(N * 0.03);

  // Ghost: hemisphere head + scalloped cylinder body, two glowing eyes, neon floor ring.
  const R = 0.8, HEAD_Y = 0.35, EYE_Y = 0.3;
  const hemY = (a) => -0.85 - 0.17 * (0.5 + 0.5 * Math.cos(8 * a));
  for (let i = 0; i < N; i++) {
    let x, y, z, c;
    if (i < nEye) {
      const side = i % 2 ? 1 : -1;
      const t = rnd() * Math.PI * 2, d = Math.cbrt(rnd()), u = Math.acos(2 * rnd() - 1);
      x = side * 0.27 + Math.sin(u) * Math.cos(t) * 0.085 * d;
      y = EYE_Y + Math.cos(u) * 0.13 * d;
      z = Math.sqrt(R * R - 0.27 * 0.27) + Math.sin(u) * Math.sin(t) * 0.03 * d;
      kind[i] = 1; c = pick(...EYE);
    } else if (i < nEye + nFloor) {
      const t = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
      x = Math.cos(t) * d * 0.62; z = Math.sin(t) * d * 0.62; y = -1.38 + gauss() * 0.01;
      kind[i] = 2; c = pick(...FLOOR);
    } else {
      const a = rnd() * Math.PI * 2, r = R * (1 + gauss() * 0.014), roll = rnd();
      if (roll < 0.36) {
        const cp = rnd(), sp = Math.sqrt(1 - cp * cp);
        y = HEAD_Y + r * cp; x = Math.cos(a) * r * sp; z = Math.sin(a) * r * sp;
      } else if (roll < 0.94) {
        // a dense rim traces the scalloped hem
        y = roll < 0.9 ? hemY(a) + rnd() * (HEAD_Y - hemY(a)) : hemY(a);
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      } else {
        const d = Math.cbrt(rnd()) * 0.92;
        x = Math.cos(a) * R * d; z = Math.sin(a) * R * d; y = -0.8 + rnd() * 1.6;
      }
      c = pick(...BODY);
    }
    ghost.set([x, y, z], i * 3);
    color.set(c, i * 3);
  }

  // Chaos: a deep scattered field the camera sits inside; near particles grow huge and soft.
  for (let i = 0; i < N; i++) {
    chaos.set([(rnd() * 2 - 1) * 7.5, (rnd() * 2 - 1) * 4.6, -10 + 14.6 * rnd() ** 1.7], i * 3);
  }

  // Block: three cubes chained together, particles snapped to a lattice for a crystalline read.
  const cubes = [{ c: -1.85, s: 0.72, w: 0.17 }, { c: 0, s: 1.5, w: 0.62 }, { c: 1.85, s: 0.72, w: 0.17 }];
  for (let i = 0; i < N; i++) {
    let p;
    if (rnd() < 0.04) {
      const side = rnd() < 0.5 ? -1 : 1, t = rnd(), ang = t * Math.PI * 6;
      p = [side * (0.75 + t * 0.74), Math.cos(ang) * 0.05, Math.sin(ang) * 0.05];
    } else {
      const cube = pick(cubes, cubes.map((q) => q.w)), h = cube.s / 2, n = cube.s > 1 ? 13 : 7;
      const snap = (v) => (Math.round(((v + h) / cube.s) * n) / n) * cube.s - h;
      const axis = Math.floor(rnd() * 3);
      p = [snap((rnd() * 2 - 1) * h), snap((rnd() * 2 - 1) * h), snap((rnd() * 2 - 1) * h)];
      if (rnd() < 0.3) p[(axis + 1) % 3] = rnd() < 0.5 ? -h : h; // edges
      p[axis] = rnd() < 0.5 ? -h : h;
      p = p.map((v) => v + gauss() * 0.006);
      p[0] += cube.c;
    }
    block.set(p, i * 3);
  }

  // Sphere: one cluster per ghost in existence, on a fibonacci shell.
  const total = D.total, golden = Math.PI * (3 - Math.sqrt(5)), SR = 1.6;
  const centers = Array.from({ length: total }, (_, k) => {
    const y = 1 - (k / (total - 1)) * 2, r = Math.sqrt(1 - y * y), t = golden * k;
    return [Math.cos(t) * r * SR, y * SR, Math.sin(t) * r * SR];
  });
  for (let i = 0; i < N; i++) {
    let p;
    if (rnd() < 0.55) {
      const c = centers[i % total];
      p = [c[0] + gauss() * 0.055, c[1] + gauss() * 0.055, c[2] + gauss() * 0.055];
    } else {
      const y = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y), rr = SR * (1 + gauss() * 0.02);
      p = [Math.cos(t) * r * rr, y * rr, Math.sin(t) * r * rr];
    }
    sphere.set(p, i * 3);
  }

  // seed: world size, rotation phase, spin, stagger
  for (let i = 0; i < N; i++) {
    const big = rnd() < 0.025;
    seed.set([big ? 0.08 + rnd() * 0.05 : 0.02 + rnd() * 0.028, rnd() * 6.283, (rnd() - 0.5) * 1.2, rnd()], i * 4);
  }

  /* =============================================================== webgl */
  const canvas = $('#field');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  initPage();
  if (!gl) { document.body.classList.add('ready'); return; }

  const VS = `#version 300 es
  in vec3 aGhost, aChaos, aBlock, aSphere, aColor;
  in vec4 aSeed;
  in float aKind;
  uniform float uA, uB, uMix, uTime, uIntro, uBob, uBlink, uFocal, uDim, uScale;
  uniform mat3 uRot;
  uniform vec3 uOffset, uCam;
  uniform mat4 uProj;
  out vec3 vColor;
  out float vAlpha, vRot, vSize;

  vec3 shape(float s) {
    if (s < 0.5) {
      vec3 p = aGhost;
      if (aKind > 0.5 && aKind < 1.5) p.y = ${EYE_Y.toFixed(2)} + (p.y - ${EYE_Y.toFixed(2)}) * uBlink;
      if (aKind < 1.5) p.y += uBob;
      return p;
    }
    if (s < 1.5) return aChaos;
    if (s < 2.5) return aBlock;
    if (s < 3.5) return aSphere;
    return aChaos * vec3(1.25, 1.25, 1.0) - vec3(0.0, 0.0, 3.0);
  }

  void main() {
    float m = smoothstep(0.0, 1.0, clamp((uMix - aSeed.w * 0.55) / 0.45, 0.0, 1.0));
    vec3 p = mix(shape(uA), shape(uB), m);
    // particles swirl outward while travelling between shapes
    vec3 dir = normalize(vec3(sin(aSeed.y * 3.1), cos(aSeed.y * 2.3), sin(aSeed.y * 1.7 + 1.0)));
    p += dir * sin(m * 3.14159) * (0.35 + aSeed.w * 0.6) * step(0.5, abs(uB - uA));
    // glitter shimmer
    p += 0.012 * vec3(sin(uTime * 0.9 + aSeed.y * 7.0), cos(uTime * 0.8 + aSeed.w * 9.0), sin(uTime * 0.7 + aSeed.y * 5.0));

    vec3 world = uRot * (p * uScale) + uOffset;
    float intro = smoothstep(0.0, 1.0, clamp((uIntro - aSeed.w * 0.5) / 0.5, 0.0, 1.0));
    world = mix(aChaos * vec3(1.3, 1.3, 1.0), world, intro);

    vec3 view = world - uCam;
    gl_Position = uProj * vec4(view, 1.0);
    float depth = -view.z;
    float size = aSeed.x * uFocal / max(depth, 0.05);
    gl_PointSize = min(size, 190.0);
    vSize = gl_PointSize;

    float tw = 0.6 + 0.4 * sin(uTime * 1.7 + aSeed.w * 40.0);
    vAlpha = 0.5 * uDim * tw
      * smoothstep(0.25, 1.1, depth)          // vanish right at the lens
      * (1.0 - smoothstep(9.0, 17.0, depth))  // fade into the far void
      * mix(1.0, 0.45, smoothstep(40.0, 160.0, size));
    float ghostW = mix(step(uA, 0.5), step(uB, 0.5), m);
    if (aKind > 0.5 && aKind < 1.5) vAlpha *= 1.0 + ghostW * 0.35;
    if (aKind > 1.5) vAlpha *= 1.0 - ghostW * 0.35;
    vColor = aColor;
    vRot = aSeed.y + uTime * aSeed.z;
  }`;

  const FS = `#version 300 es
  precision highp float;
  in vec3 vColor;
  in float vAlpha, vRot, vSize;
  out vec4 o;
  float sdTri(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    p.y = -p.y;
    float c = cos(vRot), s = sin(vRot);
    p = mat2(c, -s, s, c) * p;
    float px = 2.0 / vSize;
    float blur = smoothstep(40.0, 170.0, vSize);
    float w = mix(1.25 * px, 0.07, blur);
    float d = abs(sdTri(p, 0.6));
    float a = 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.3 * px + blur * 0.18, d);
    a += (1.0 - smoothstep(0.0, 0.9, length(p))) * 0.06;  // faint inner glow
    if (vSize < 3.5) a = 1.0 - smoothstep(0.2, 1.0, length(p));
    a *= vAlpha;
    if (a < 0.003) discard;
    o = vec4(vColor * a, 1.0);
  }`;

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  gl.bindVertexArray(gl.createVertexArray());
  for (const [name, data, size] of [['aGhost', ghost, 3], ['aChaos', chaos, 3], ['aBlock', block, 3], ['aSphere', sphere, 3], ['aColor', color, 3], ['aSeed', seed, 4], ['aKind', kind, 1]]) {
    const loc = gl.getAttribLocation(prog, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  const U = Object.fromEntries(['uA', 'uB', 'uMix', 'uTime', 'uIntro', 'uBob', 'uBlink', 'uFocal', 'uDim', 'uScale', 'uRot', 'uOffset', 'uCam', 'uProj']
    .map((n) => [n, gl.getUniformLocation(prog, n)]));

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 1);

  /* =============================================================== scroll choreography */
  const FOV = (38 * Math.PI) / 180, CAM_Z = 6;
  let vw = 0, vh = 0, halfW = 0, halfH = 0, keys = [];

  function layout() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    vw = innerWidth; vh = innerHeight;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    halfH = Math.tan(FOV / 2) * CAM_Z; halfW = halfH * (vw / vh);
    const mobile = vw / vh < 0.9;
    const f = 1 / Math.tan(FOV / 2), a = vw / vh, n = 0.05, fa = 100;
    gl.uniformMatrix4fv(U.uProj, false, [f / a, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, (2 * fa * n) / (n - fa), 0]);
    gl.uniform1f(U.uFocal, canvas.height / 2 / Math.tan(FOV / 2));
    keys = [...document.querySelectorAll('[data-shape]')].map((el) => {
      const name = el.dataset.shape, top = el.offsetTop, h = el.offsetHeight;
      const scattered = name === 'chaos' || name === 'dust';
      return {
        el, name, top, h,
        shape: SHAPES[name],
        at: top + Math.max(0, h - vh) / 2,
        x: mobile ? 0 : Number(el.dataset.x || 0),
        y: mobile && !scattered ? 0.38 : 0,
        scale: Number(el.dataset.scale || 1) * (mobile && !scattered ? 0.72 : 1),
        dim: Number(el.dataset.dim || 1),
      };
    });
    keys[0].at = 0;
  }

  // Bounded per-shape orientation so blends between shapes never spin through extra turns.
  function pose(name, t) {
    switch (name) {
      case 'ghost': return [Math.sin(t * 0.45) * 0.38, 0.06 + Math.sin(t * 0.3) * 0.04];
      case 'block': return [0.62 + Math.sin(t * 0.22) * 0.55, 0.42];
      case 'sphere': return [Math.sin(t * 0.08) * 2.4, 0.32];
      default: return [Math.sin(t * 0.05) * 0.4, 0];
    }
  }

  // Rx(pitch) · Ry(yaw), column-major
  function rotation(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
  }

  const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
  const ease = (x) => x * x * (3 - 2 * x);
  const lerp = (a, b, t) => a + (b - a) * t;
  let smoothScroll = scrollY;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener('pointermove', (e) => { pointer.x = e.clientX / vw - 0.5; pointer.y = e.clientY / vh - 0.5; }, { passive: true });

  const start = performance.now();
  function frame(now) {
    const t = reduceMotion ? 0 : (now - start) / 1000;
    smoothScroll = reduceMotion ? scrollY : lerp(smoothScroll, scrollY, 0.075);
    const s = smoothScroll;

    let i = 0;
    while (i < keys.length - 2 && s >= keys[i + 1].at) i++;
    const A = keys[i], B = keys[i + 1];
    const mix = ease(clamp01((clamp01((s - A.at) / (B.at - A.at)) - 0.12) / 0.76));

    const [ya, pa] = pose(A.name, t), [yb, pb] = pose(B.name, t);
    const scattered = lerp(A.shape % 3 === 1 ? 1 : 0, B.shape % 3 === 1 ? 1 : 0, mix); // chaos (1) and dust (4)
    const yaw = lerp(ya, yb, mix) + scattered * (s / vh) * 0.35;
    pointer.sx = lerp(pointer.sx, pointer.x, 0.05); pointer.sy = lerp(pointer.sy, pointer.y, 0.05);
    const cyc = t % 5;

    gl.uniform1f(U.uA, A.shape);
    gl.uniform1f(U.uB, B.shape);
    gl.uniform1f(U.uMix, mix);
    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uIntro, reduceMotion ? 1 : clamp01((t - 0.2) / 2.6));
    gl.uniform1f(U.uBob, Math.sin(t * Math.PI * 0.5) * 0.06);
    gl.uniform1f(U.uBlink, cyc > 4.2 && cyc < 4.42 ? 0.12 + 0.88 * Math.abs(Math.cos(((cyc - 4.2) / 0.22) * Math.PI)) : 1);
    gl.uniform1f(U.uDim, lerp(A.dim, B.dim, mix));
    gl.uniform1f(U.uScale, lerp(A.scale, B.scale, mix));
    gl.uniform3f(U.uOffset, lerp(A.x, B.x, mix) * halfW, lerp(A.y, B.y, mix) * halfH, 0);
    gl.uniformMatrix3fv(U.uRot, false, rotation(yaw, lerp(pa, pb, mix)));
    gl.uniform3f(U.uCam, pointer.sx * 0.5, -pointer.sy * 0.35, CAM_Z);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, N);

    fadeCopy();
    requestAnimationFrame(frame);
  }

  // Copy fades in and out with its scene so text and particles move as one.
  const hint = $('.scroll-hint');
  function fadeCopy() {
    hint.style.opacity = String(1 - clamp01(scrollY / 160));
    for (const k of keys) {
      if (k.el.classList.contains('scene--witnessed')) continue;
      const p = (scrollY - k.top) / Math.max(k.h - vh, 1);
      const o = Math.min(ease(clamp01((p + 0.45) / 0.45)), 1 - ease(clamp01((p - 0.75) / 0.3)));
      const box = k.el.firstElementChild;
      box.style.opacity = o.toFixed(3);
      box.style.transform = `translateY(${((1 - o) * (p < 0.5 ? 40 : -40)).toFixed(1)}px)`;
    }
  }

  layout();
  addEventListener('resize', layout);
  new ResizeObserver(layout).observe(document.body);
  requestAnimationFrame(() => document.body.classList.add('ready'));
  requestAnimationFrame(frame);

  /* =============================================================== page */
  function initPage() {
    const c = D.combinations;
    $('#combos').textContent = c >= 1e6 ? `${(c / 1e6).toFixed(1)} million` : c.toLocaleString('en-US');
    const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
    $('#layers').textContent = words[D.layers] ?? String(D.layers);
    witnessed();
  }

  function witnessed() {
    const stage = $('#stage'), counter = $('#counter');
    const list = D.showcase;
    let index = 0;
    const pct = (x) => (x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`);

    function show(k) {
      index = (k + list.length) % list.length;
      const g = list[index];
      const img = Object.assign(document.createElement('img'), { src: `assets/ghosts/${g.id}.webp`, alt: `Zero Ghost #${g.id}`, width: 720, height: 720 });
      const video = Object.assign(document.createElement('video'), { src: `assets/anim/${g.id}.mp4`, muted: true, loop: true, playsInline: true, autoplay: !reduceMotion });
      video.addEventListener('playing', () => video.classList.add('on'));
      const media = document.createElement('div');
      media.className = 'stage-media stage-enter';
      media.append(img, video);

      const copy = document.createElement('div');
      copy.className = 'stage-copy stage-enter';
      copy.innerHTML = `<span class="role">Rank ${String(g.rank).padStart(2, '0')} · score ${g.score.toFixed(1)}</span>
        <span class="name"><small>Zero Ghost</small>#${g.id}</span>
        <ul>${g.traits.slice(0, 4).map((tr) => `<li><span>${tr.layer} · ${tr.name}</span><span>${pct(tr.share)}</span></li>`).join('')}</ul>`;

      stage.replaceChildren(media, copy);
      counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
      for (const n of [list[(index + 1) % list.length], list[(index - 1 + list.length) % list.length]]) new Image().src = `assets/ghosts/${n.id}.webp`;
    }

    $('#prev').addEventListener('click', () => show(index - 1));
    $('#next').addEventListener('click', () => show(index + 1));
    stage.addEventListener('click', () => show(index + 1));
    show(0);
  }
})();
