/**
 * 墨Radio 千里江山图启动页
 * WebGL shader 青绿山水 + GSAP 动画 + 墨滴晕染转场
 */

(function () {
  'use strict';

  var VERT = [
    'attribute vec2 a_pos;',
    'varying vec2 v_uv;',
    'void main(){',
    '  v_uv = a_pos * 0.5 + 0.5;',
    '  gl_Position = vec4(a_pos, 0.0, 1.0);',
    '}'
  ].join('\n');

  // 千里江山图 shader — 青绿山水 + 山脊纹理 + 云雾 + 水面
  var FRAG = [
    'precision highp float;',
    'varying vec2 v_uv;',
    'uniform vec2 u_res;',
    'uniform float u_time;',
    'uniform float u_reveal;',
    'uniform float u_inkDrop;',
    'uniform vec2  u_inkCenter;',
    '',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'float noise(vec2 p){',
    '  vec2 i=floor(p), f=fract(p);',
    '  vec2 u=f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v=0.0, a=0.5;',
    '  for(int i=0;i<5;i++){v+=a*noise(p);p*=2.1;a*=0.49;}',
    '  return v;',
    '}',
    '',
    '// 山脊线：多层 sin + noise 产生陡峭山峰',
    'float ridge(float x, float seed, float freq, float amp){',
    '  float n = abs(sin(x*freq + seed*6.28)) * 0.40',
    '          + noise(vec2(x*freq*1.8+seed, seed*7.0)) * 0.35',
    '          + noise(vec2(x*freq*3.5+seed*2.0, seed*13.0)) * 0.25;',
    '  return n * amp;',
    '}',
    '',
    '// 山体纹理：石纹 + 草木',
    'float mountainTex(vec2 uv, float seed, float scale){',
    '  float stone = noise(uv * scale + seed) * 0.4;',
    '  float grass = noise(uv * scale * 2.5 + seed * 3.0) * 0.3;',
    '  float detail = noise(uv * scale * 6.0 + seed * 7.0) * 0.15;',
    '  return 0.7 + stone + grass + detail;',
    '}',
    '',
    'void main(){',
    '  vec2 uv = v_uv;',
    '  float t = u_time * 0.20;',
    '  float reveal = u_reveal;',
    '',
    '// 绢底色',
    'vec3 silk = vec3(0.96, 0.93, 0.84);',
    'vec3 skyTop = vec3(0.65, 0.80, 0.88);',
    'vec3 col = mix(silk, skyTop, smoothstep(0.2, 1.0, uv.y) * 0.55);',
    '',
    '// 展开动画',
    'float revealEdge = reveal * 1.5 - 0.25;',
    'float revealMask = smoothstep(revealEdge - 0.20, revealEdge, uv.x);',
    '',
    '// 青绿颜料',
    'vec3 az = vec3(0.28, 0.55, 0.72);',
    'vec3 ml = vec3(0.20, 0.60, 0.38);',
    'vec3 dg = vec3(0.12, 0.40, 0.25);',
    'vec3 oc = vec3(0.72, 0.50, 0.28);',
    'vec3 gd = vec3(0.88, 0.75, 0.32);',
    '',
    '// ─── Layer 0: 远山（石青，柔和轮廓）──────────',
    'float h0 = 0.76 + ridge(uv.x, 0.0, 2.5, 0.14);',
    'h0 += noise(vec2(uv.x*1.2+t*0.006, 0.0)) * 0.02;',
    'if(uv.y > h0){',
    '  float tex = mountainTex(uv, 0.0, 5.0);',
    '  vec3 mc = az * tex * 0.90;',
    '  float edge = smoothstep(h0, h0+0.05, uv.y);',
    '  mc = mix(silk*0.85, mc, edge);',
    '  col = mix(col, mc, 0.50 * revealMask);',
    '}',
    '',
    '// ─── Layer 1: 中远山 ──────────────────────',
    'float h1 = 0.64 + ridge(uv.x, 2.0, 3.0, 0.20);',
    'h1 += pow(max(0.0, sin(uv.x*6.0+2.0)), 3.0) * 0.08;',
    'if(uv.y > h1){',
    '  float tex = mountainTex(uv, 2.0, 7.0);',
    '  vec3 mc = mix(az, ml, 0.30) * tex * 0.88;',
    '  float foot = smoothstep(h1, h1-0.08, uv.y);',
    '  mc = mix(mc, oc, foot*0.22);',
    '  col = mix(col, mc, 0.62 * revealMask);',
    '}',
    '',
    '// ─── Layer 2: 主山（石绿，有山峰）──────────',
    'float h2 = 0.48 + ridge(uv.x, 4.0, 3.5, 0.28);',
    'h2 += pow(max(0.0, sin(uv.x*8.0+4.0)), 4.0) * 0.14;',
    'if(uv.y > h2){',
    '  float tex = mountainTex(uv, 4.0, 9.0);',
    '  vec3 mc = ml * tex * 0.85;',
    '  float topBlend = smoothstep(h2-0.04, h2+0.10, uv.y);',
    '  mc = mix(mc, az*0.85, topBlend*0.40);',
    '  float foot = smoothstep(h2, h2-0.12, uv.y);',
    '  mc = mix(mc, oc, foot*0.28);',
    '  float goldEdge = smoothstep(h2-0.01, h2+0.04, uv.y);',
    '  mc = mix(mc, gd, goldEdge*0.08);',
    '  col = mix(col, mc, 0.75 * revealMask);',
    '}',
    '',
    '// ─── Layer 3: 中近山 ─────────────────────',
    'float h3 = 0.34 + ridge(uv.x, 6.0, 4.0, 0.22);',
    'h3 += pow(max(0.0, sin(uv.x*10.0+6.0)), 3.5) * 0.10;',
    'if(uv.y > h3){',
    '  float tex = mountainTex(uv, 6.0, 11.0);',
    '  vec3 mc = mix(ml, dg, 0.45) * tex * 0.82;',
    '  float topBlend = smoothstep(h3-0.03, h3+0.08, uv.y);',
    '  mc = mix(mc, ml*0.7, topBlend*0.30);',
    '  float foot = smoothstep(h3, h3-0.10, uv.y);',
    '  mc = mix(mc, oc*0.85, foot*0.32);',
    '  col = mix(col, mc, 0.84 * revealMask);',
    '}',
    '',
    '// ─── Layer 4: 近景 ──────────────────────',
    'float h4 = 0.22 + ridge(uv.x, 8.0, 5.0, 0.15);',
    'h4 += pow(max(0.0, sin(uv.x*13.0+8.0)), 5.0) * 0.06;',
    'if(uv.y > h4){',
    '  float tex = mountainTex(uv, 8.0, 14.0);',
    '  vec3 mc = dg * 0.7 * tex * 0.78;',
    '  float foot = smoothstep(h4, h4-0.06, uv.y);',
    '  mc = mix(mc, oc*0.65, foot*0.38);',
    '  col = mix(col, mc, 0.92 * revealMask);',
    '}',
    '',
    '// ─── 云雾 ────────────────────────────────',
    'float m0 = noise(vec2(uv.x*1.5+t*0.006, uv.y*1.8));',
    'm0 *= smoothstep(0.40, 0.52, uv.y) * smoothstep(0.70, 0.52, uv.y);',
    'col = mix(col, silk, m0 * 0.50 * revealMask);',
    'float m1 = noise(vec2(uv.x*2.0+t*0.010+5.0, uv.y*1.8+3.0));',
    'm1 *= smoothstep(0.55, 0.65, uv.y) * smoothstep(0.80, 0.65, uv.y);',
    'col = mix(col, silk, m1 * 0.35 * revealMask);',
    '',
    '// ─── 水面 ────────────────────────────────',
    'if(uv.y < 0.20){',
    '  float wy = uv.y / 0.20;',
    '  vec3 wc = mix(silk, az*0.5, 0.30);',
    '  wc *= 0.85 + 0.15*noise(vec2(uv.x*10.0+t*0.2, uv.y*20.0));',
    '  float rip = sin(uv.x*35.0+t*1.0)*0.004 + sin(uv.x*20.0-t*0.5)*0.003;',
    '  col = mix(col, wc+rip, smoothstep(0.0, 0.35, wy)*0.55*revealMask);',
    '}',
    '',
    '// 绢本纹理',
    'col *= 0.97 + 0.03*noise(uv*12.0+50.0);',
    '',
    '// ─── 墨滴转场（青绿色，不是纯黑）──────────',
    'if(u_inkDrop > 0.001){',
    '  vec2 aspect = vec2(u_res.x/u_res.y, 1.0);',
    '  vec2 d = (uv - u_inkCenter) * aspect;',
    '  float dist = length(d);',
    '  float angle = atan(d.y, d.x);',
    '  float edgeNoise = noise(vec2(angle*4.0, u_inkDrop*6.0)) * 0.12',
    '                  + noise(vec2(angle*9.0, u_inkDrop*10.0)) * 0.06;',
    '  float radius = u_inkDrop * 1.8 + edgeNoise;',
    '  float inkMask = smoothstep(radius-0.06, radius+0.03, dist);',
    '  // 青绿墨色（石青+石绿混合，不是纯黑）',
    '  float inkDensity = 0.80 + 0.20*noise(vec2(dist*6.0, angle*3.0));',
    '  vec3 inkColor = mix(az, ml, 0.4+0.2*sin(angle*2.0)) * inkDensity * 0.25;',
    '  col = mix(inkColor, col, inkMask);',
    '}',
    '',
    'gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // ─── WebGL helpers ────────────────────────────────────────
  function compileShader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('Shader error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function createProgram(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('Program error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  // ─── Main ─────────────────────────────────────────────────
  window.initShanShuiSplash = function (canvas, onEnter) {
    var gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
    if (!gl) { onEnter(); return; }

    var vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { onEnter(); return; }

    var prog = createProgram(gl, vs, fs);
    if (!prog) { onEnter(); return; }

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

    var loc = {
      pos: gl.getAttribLocation(prog, 'a_pos'),
      res: gl.getUniformLocation(prog, 'u_res'),
      time: gl.getUniformLocation(prog, 'u_time'),
      reveal: gl.getUniformLocation(prog, 'u_reveal'),
      inkDrop: gl.getUniformLocation(prog, 'u_inkDrop'),
      inkCenter: gl.getUniformLocation(prog, 'u_inkCenter')
    };

    gl.disable(gl.DEPTH_TEST);

    var startTime = performance.now();
    var revealProgress = 0;
    var inkDropProgress = 0;
    var inkDropActive = false;
    var inkCenter = [0.5, 0.5];
    var entered = false;
    var raf = 0;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    function render() {
      if (entered) return;
      raf = requestAnimationFrame(render);
      var elapsed = (performance.now() - startTime) / 1000;

      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc.pos);
      gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(loc.res, canvas.width, canvas.height);
      gl.uniform1f(loc.time, elapsed);
      gl.uniform1f(loc.reveal, revealProgress);
      gl.uniform1f(loc.inkDrop, inkDropProgress);
      gl.uniform2f(loc.inkCenter, inkCenter[0], inkCenter[1]);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function startReveal() {
      if (typeof gsap === 'undefined') {
        revealProgress = 1;
        return;
      }
      gsap.to({ v: 0 }, {
        v: 1,
        duration: 3.5,
        ease: 'power2.inOut',
        onUpdate: function () { revealProgress = this.targets()[0].v; }
      });
    }

    function startInkDrop(cx, cy) {
      if (inkDropActive) return;
      inkDropActive = true;
      inkCenter = [cx, cy];

      if (typeof gsap === 'undefined') {
        inkDropProgress = 1;
        setTimeout(function () { entered = true; onEnter(); }, 600);
        return;
      }

      gsap.to({ v: 0 }, {
        v: 1,
        duration: 1.6,
        ease: 'power2.in',
        onUpdate: function () { inkDropProgress = this.targets()[0].v; },
        onComplete: function () {
          entered = true;
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', resize);
          onEnter();
        }
      });
    }

    canvas.addEventListener('click', function (e) {
      var rect = canvas.getBoundingClientRect();
      var cx = (e.clientX - rect.left) / rect.width;
      var cy = 1.0 - (e.clientY - rect.top) / rect.height;
      startInkDrop(cx, cy);
    });
    canvas.style.cursor = 'pointer';

    render();
    startReveal();

    return {
      destroy: function () {
        entered = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
      }
    };
  };
})();
