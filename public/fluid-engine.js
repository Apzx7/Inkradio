/**
 * 水墨流体引擎
 * 基于 WebGL-Fluid-Simulation (MIT, Pavel Dobryakov)
 * 改造为音频驱动的水墨扩散效果
 */

(function (window) {
  'use strict';

  // ─── 配置（水墨质感：墨滴、慢扩散、少涡流）────────────────
  var config = {
    SIM_RESOLUTION: 256,            // 提高模拟分辨率（减少摩尔纹）
    DYE_RESOLUTION: 1024,           // 提高染料分辨率（更细腻的颜色）
    DENSITY_DISSIPATION: 0.975,     // 墨水消散（不会太快消失）
    VELOCITY_DISSIPATION: 0.988,    // 速度衰减
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 4,                        // 低涡流（水墨不会乱旋）
    SPLAT_RADIUS: 0.35,             // 小墨滴（墨滴不是雾团）
    SPLAT_FORCE: 1200,              // 适度的力
  };

  // ─── 状态 ──────────────────────────────────────────────────
  var canvas, gl;
  var velocity, dye, divergence, pressure, curl;
  var blit;
  var ext;

  // Shader programs
  var splatProgram, advectionProgram, divergenceProgram, pressureProgram,
    gradientSubtractProgram, curlProgram, vorticityProgram, clearProgram,
    displayProgram;

  var texelSizeX, texelSizeY;
  var initialized = false;

  // ─── 顶点着色器（所有 pass 共用）──────────────────────────
  var baseVertexShader = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  // ─── 片段着色器 ───────────────────────────────────────────
  // 不规则墨滴 shader（噪声扭曲边缘 + 墨晕 + 浓淡层次）
  var splatShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;
    uniform float uTime;

    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }
    // 分形噪声（多层叠加，模拟纸纤维墨晕）
    float fbm(vec2 p){
      float v=0.0, a=0.5;
      v+=a*noise(p); p*=2.1; a*=0.49;
      v+=a*noise(p); p*=2.1; a*=0.49;
      v+=a*noise(p); p*=2.1; a*=0.49;
      return v;
    }

    void main () {
      vec2 p = vUv - point.xy;
      p.x *= aspectRatio;
      float dist = length(p);
      float angle = atan(p.y, p.x);

      // ─── 多层噪声扭曲（不规则墨滴形状）──────────
      // 大尺度：整体形状扭曲
      float n1 = noise(vec2(angle * 2.5 + uTime * 0.3, dist * 5.0)) * 0.35;
      // 中尺度：边缘锯齿
      float n2 = noise(vec2(angle * 6.0 - uTime * 0.2, dist * 10.0)) * 0.20;
      // 小尺度：墨晕纤维
      float n3 = noise(vec2(angle * 12.0 + uTime * 0.1, dist * 20.0)) * 0.10;
      // 方向性扭曲（墨滴不是圆形，有流向）
      float dirBias = noise(vec2(angle * 1.5, uTime * 0.4)) * 0.15;

      float distortedDist = dist + (n1 + n2 + n3 + dirBias) * radius * 0.5;

      // ─── 墨滴浓度（中心浓、边缘淡、晕染）────────
      float core = exp(-distortedDist * distortedDist / (radius * 0.6));
      float bleed = exp(-distortedDist * distortedDist / (radius * 2.0));
      float inkDrop = core * 0.7 + bleed * 0.3;

      // 边缘柔化（墨在宣纸上扩散感）
      float edge = smoothstep(1.0, 0.2, distortedDist / sqrt(radius));
      inkDrop *= edge;

      // ─── 宣纸纤维穿透（墨滴内部有纸纹理）────────
      float fiber = fbm(vUv * 15.0 + uTime * 0.1) * 0.15;
      inkDrop *= (1.0 - fiber);

      // ─── 浓淡变化（每个墨滴内部不均匀）────────────
      float density = 0.8 + 0.2 * noise(vec2(angle * 3.0, dist * 6.0 + uTime));
      inkDrop *= density;

      vec3 splat = inkDrop * color;
      vec3 base = texture2D(uTarget, vUv).xyz;
      gl_FragColor = vec4(base + splat, 1.0);
    }
  `;

  var advectionShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;

    // 手动双线性过滤（防止像素撕裂）
    vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize) {
      vec2 st = uv / tsize - 0.5;
      vec2 iuv = floor(st);
      vec2 fuv = fract(st);
      vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
      vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
      vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
      vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
      return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
      vec2 vel = texture2D(uVelocity, vUv).xy;
      vec2 coord = vUv - dt * vel * texelSize;
      // 限制回溯距离（防止撕裂）
      coord = clamp(coord, vec2(0.001), vec2(0.999));
      vec4 result = bilerp(uSource, coord, texelSize);
      float decay = 1.0 + dissipation * dt;
      gl_FragColor = result / decay;
    }
  `;

  var divergenceShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) L = -C.x;
      if (vR.x > 1.0) R = -C.x;
      if (vT.y > 1.0) T = -C.y;
      if (vB.y < 0.0) B = -C.y;
      float div = 0.5 * (R - L + T - B);
      gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
  `;

  var curlShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      float vorticity = R - L - T + B;
      gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
  `;

  var vorticityShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;
    void main () {
      float L = texture2D(uCurl, vL).x;
      float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x;
      float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C;
      force.y *= -1.0;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity += force * dt;
      velocity = min(max(velocity, -1000.0), 1000.0);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  var pressureShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float divergence = texture2D(uDivergence, vUv).x;
      float pressure = (L + R + B + T - divergence) * 0.25;
      gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
  `;

  var gradientSubtractShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity.xy -= vec2(R - L, T - B);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
  `;

  var clearShader = `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;
    void main () {
      gl_FragColor = value * texture2D(uTexture, vUv);
    }
  `;

  // 中国画水墨风格显示着色器
  // ─── 水墨显示着色器（含封面混合 + 淡出）─────────────
  var displayShader = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform vec2 texelSize;
    uniform float uInkOpacity;
    uniform float uTime;

    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }
    float fbm(vec2 p){
      float v=0.0, a=0.5;
      for(int i=0;i<4;i++){v+=a*noise(p);p*=2.0;a*=0.5;}
      return v;
    }

    void main(){
      vec3 c = texture2D(uTexture, vUv).rgb;
      float raw = max(c.r, max(c.g, c.b));

      // ─── 宣纸底色 ──────────────────────────────────
      vec2 paperUV = vUv * vec2(8.0, 5.0);
      float fiber = fbm(paperUV * 2.0 + 42.0);
      float grain = noise(paperUV * 4.0);
      vec3 paper = vec3(0.055, 0.05, 0.042);
      paper += (fiber * 0.006 + grain * 0.003);

      // ─── 浓度映射 ──────────────────────────────────
      float density;
      if(raw > 0.15) {
        density = 0.70 + smoothstep(0.15, 0.35, raw) * 0.30;
      } else if(raw > 0.06) {
        density = 0.35 + smoothstep(0.06, 0.15, raw) * 0.35;
      } else if(raw > 0.02) {
        density = 0.10 + smoothstep(0.02, 0.06, raw) * 0.25;
      } else {
        density = smoothstep(0.0, 0.02, raw) * 0.10;
      }

      // ─── 矿石颜料色 ───────────────────────────────
      vec3 pigment = c / max(raw, 0.001);
      pigment.r *= 1.04; pigment.g *= 1.00; pigment.b *= 0.94;
      vec3 inkColor = pigment * density;

      // ─── 墨晕 ─────────────────────────────────────
      float rL = max(texture2D(uTexture, vL).r, max(texture2D(uTexture, vL).g, texture2D(uTexture, vL).b));
      float rR = max(texture2D(uTexture, vR).r, max(texture2D(uTexture, vR).g, texture2D(uTexture, vR).b));
      float rT = max(texture2D(uTexture, vT).r, max(texture2D(uTexture, vT).g, texture2D(uTexture, vT).b));
      float rB = max(texture2D(uTexture, vB).r, max(texture2D(uTexture, vB).g, texture2D(uTexture, vB).b));
      float grad = abs(raw-rL) + abs(raw-rR) + abs(raw-rT) + abs(raw-rB);
      float edgeBleed = smoothstep(0.0, 0.15, grad);
      inkColor *= mix(1.0, 0.4, edgeBleed * 0.6);
      inkColor *= (0.92 + 0.08 * fiber);

      // ─── 最终合成 ─────────────────────────────────
      vec3 final = mix(paper, inkColor, density * uInkOpacity);

      // 留白区域极淡色彩痕迹
      float whiteSpace = 1.0 - smoothstep(0.0, 0.04, raw);
      final += c * 0.04 * whiteSpace;

      gl_FragColor = vec4(final, 1.0);
    }
  `;

  // ─── WebGL 工具函数 ────────────────────────────────────────
  function compileShader(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(vertexSource, fragmentSource) {
    var program = gl.createProgram();
    var vs = compileShader(gl.VERTEX_SHADER, vertexSource);
    var fs = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vs || !fs) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return null;
    }
    var uniforms = {};
    var uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < uniformCount; i++) {
      var info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return { program: program, uniforms: uniforms };
  }

  function createFBO(w, h, internalFormat, format, type, filter) {
    gl.activeTexture(gl.TEXTURE0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    var texelSizeX = 1.0 / w;
    var texelSizeY = 1.0 / h;
    return {
      texture: texture,
      fbo: fbo,
      width: w,
      height: h,
      texelSizeX: texelSizeX,
      texelSizeY: texelSizeY,
      attach: function (id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      }
    };
  }

  function createDoubleFBO(w, h, internalFormat, format, type, filter) {
    var fbo1 = createFBO(w, h, internalFormat, format, type, filter);
    var fbo2 = createFBO(w, h, internalFormat, format, type, filter);
    return {
      width: w,
      height: h,
      texelSizeX: fbo1.texelSizeX,
      texelSizeY: fbo1.texelSizeY,
      get read() { return fbo1; },
      set read(value) { fbo1 = value; },
      get write() { return fbo2; },
      set write(value) { fbo2 = value; },
      swap: function () {
        var temp = fbo1;
        fbo1 = fbo2;
        fbo2 = temp;
      }
    };
  }

  function initGL() {
    var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    gl = canvas.getContext('webgl2', params);
    if (!gl) {
      gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
    }
    if (!gl) {
      console.error('WebGL not supported');
      return false;
    }

    // 检查扩展
    if (gl instanceof WebGL2RenderingContext) {
      ext = {
        halfFloat: gl.getExtension('EXT_color_buffer_half_float'),
        supportLinearFiltering: gl.getExtension('OES_texture_half_float_linear')
      };
      gl.getExtension('EXT_color_buffer_float');
    } else {
      ext = {
        halfFloat: gl.getExtension('OES_texture_half_float'),
        supportLinearFiltering: gl.getExtension('OES_texture_half_float_linear')
      };
    }

    if (!ext.halfFloat) {
      console.warn('Half float not supported, falling back to float');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    var halfFloat = ext.halfFloat && gl instanceof WebGL2RenderingContext ? gl.HALF_FLOAT : (ext.halfFloat ? ext.halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE);
    var internalFormatRGBA = gl instanceof WebGL2RenderingContext ? gl.RGBA16F : gl.RGBA;
    var internalFormatRG = gl instanceof WebGL2RenderingContext ? gl.RG16F : gl.RGBA;
    var internalFormatR = gl instanceof WebGL2RenderingContext ? gl.R16F : gl.RGBA;
    var formatRG = gl instanceof WebGL2RenderingContext ? gl.RG : gl.RGBA;
    var formatR = gl instanceof WebGL2RenderingContext ? gl.RED : gl.RGBA;
    var filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    // 创建 FBO
    var simRes = getResolution(config.SIM_RESOLUTION);
    var dyeRes = getResolution(config.DYE_RESOLUTION);

    velocity = createDoubleFBO(simRes.width, simHeight(simRes.height), internalFormatRG, formatRG, halfFloat, filtering);
    dye = createDoubleFBO(dyeRes.width, dyeRes.height, internalFormatRGBA, gl.RGBA, halfFloat, filtering);
    divergence = createFBO(simRes.width, simHeight(simRes.height), internalFormatR, formatR, halfFloat, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simHeight(simRes.height), internalFormatR, formatR, halfFloat, gl.NEAREST);
    curl = createFBO(simRes.width, simHeight(simRes.height), internalFormatR, formatR, halfFloat, gl.NEAREST);

    return true;
  }

  function getResolution(resolution) {
    var aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
    var min = Math.round(resolution);
    var max = Math.round(resolution * aspectRatio);
    if (gl.drawingBufferWidth > gl.drawingBufferHeight)
      return { width: max, height: min };
    else
      return { width: min, height: max };
  }

  function simHeight(h) {
    return h;
  }

  function compileShaders() {
    var prog;

    prog = createProgram(baseVertexShader, splatShader);
    if (!prog) return false;
    splatProgram = { program: prog.program, uniforms: prog.uniforms, bind: function () { gl.useProgram(this.program); } };

    prog = createProgram(baseVertexShader, advectionShader);
    if (!prog) return false;
    advectionProgram = { program: prog.program, uniforms: prog.uniforms, bind: function () { gl.useProgram(this.program); } };

    prog = createProgram(baseVertexShader, divergenceShader);
    if (!prog) return false;
    divergenceProgram = { program: prog.program, uniforms: prog.uniforms, bind: function () { gl.useProgram(this.program); } };

    prog = createProgram(baseVertexShader, curlShader);
    if (!prog) return false;
    curlProgram = { program: prog.program, uniforms: prog.uniforms, bind: function () { gl.useProgram(this.program); } };

    prog = createProgram(baseVertexShader, vorticityShader);
    if (!prog) return false;
    vorticityProgram = { program: prog.program, uniforms: prog.uniforms, bind: function () { gl.useProgram(this.program); } };

    prog = createProgram(baseVertexShader, pressureShader);
    if (!prog) return false;
    pressureProgram = { program: prog.program, uniforms: prog.uniforms, bind: function () { gl.useProgram(this.program); } };

    prog = createProgram(baseVertexShader, gradientSubtractShader);
    if (!prog) return false;
    gradientSubtractProgram = { program: prog.program, uniforms: prog.uniforms, bind: function () { gl.useProgram(this.program); } };

    prog = createProgram(baseVertexShader, clearShader);
    if (!prog) return false;
    clearProgram = { program: prog.program, uniforms: prog.uniforms, bind: function () { gl.useProgram(this.program); } };

    prog = createProgram(baseVertexShader, displayShader);
    if (!prog) return false;
    displayProgram = { program: prog.program, uniforms: prog.uniforms, bind: function () { gl.useProgram(this.program); } };

    return true;
  }

  function initBlit() {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    blit = function (target) {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
  }

  // ─── 流体模拟步骤 ──────────────────────────────────────────
  function step(dt) {
    gl.disable(gl.BLEND);

    // Curl
    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    // Vorticity
    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    // Divergence
    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    // Clear pressure
    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressure.write);
    pressure.swap();

    // Pressure solve
    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (var i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    // Gradient subtract
    gradientSubtractProgram.bind();
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    // Advect velocity
    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    var velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    // Advect dye
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
  }

  // ─── 添加墨滴（不规则形状）─────────────────────────────────
  var _splatTime = 0
  function splat(x, y, dx, dy, color) {
    _splatTime += 0.016
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
    if (splatProgram.uniforms.uTime !== null) gl.uniform1f(splatProgram.uniforms.uTime, _splatTime);
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  }

  // 添加漩涡力场（圆形旋转力，柔和）
  function splatVortex(cx, cy, radius, strength, color) {
    var steps = 6;
    for (var i = 0; i < steps; i++) {
      var angle = (i / steps) * Math.PI * 2;
      var x = cx + Math.cos(angle) * radius;
      var y = cy + Math.sin(angle) * radius;
      var dx = -Math.sin(angle) * strength;
      var dy = Math.cos(angle) * strength;
      var c = { r: color.r * 0.3, g: color.g * 0.3, b: color.b * 0.3 };
      splat(x, y, dx, dy, c);
    }
  }

  function correctRadius(radius) {
    var aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) radius *= aspectRatio;
    return radius;
  }

  var _time = 0;

  var _fadeOpacity = 1     // 1=可见, 0=不可见

  // ─── 渲染到屏幕 ──────────────────────────────────────────
  function render() {
    _time += 1 / 60;
    displayProgram.bind();
    gl.uniform2f(displayProgram.uniforms.texelSize, 1.0 / canvas.width, 1.0 / canvas.height);
    gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
    gl.uniform1f(displayProgram.uniforms.uInkOpacity, _fadeOpacity);
    if (displayProgram.uniforms.uTime !== null) gl.uniform1f(displayProgram.uniforms.uTime, _time);
    blit(null);
  }

  // ─── 公共 API ─────────────────────────────────────────────
  window.FluidEngine = {
    /**
     * 初始化流体引擎
     * @param {HTMLCanvasElement} targetCanvas - 目标 canvas 元素
     * @returns {boolean} 是否成功
     */
    init: function (targetCanvas) {
      if (initialized) return true;
      canvas = targetCanvas;
      if (!initGL()) return false;
      if (!compileShaders()) return false;
      initBlit();
      initialized = true;

      // 初始添加几滴墨水（柔和）
      this.multipleSplats(3);
      return true;
    },

    // 暂停状态
    _paused: false,
    _fadeOpacity: 1,

    // 鼠标墨迹笔触状态
    _mouseActive: false,
    _lastMouseX: 0,
    _lastMouseY: 0,
    _mouseSplatCooldown: 0,

    /**
     * 暂停（淡出）
     */
    pause: function () {
      this._paused = true
    },

    /**
     * 恢复（淡入）
     */
    resume: function () {
      this._paused = false
    },

    /**
     * 启用鼠标墨迹笔触（绑定到指定元素或 document）
     */
    enableMouseInk: function (target) {
      var el = target || document
      var self = this

      el.addEventListener('mousedown', function (e) {
        self._mouseActive = true
        self._lastMouseX = e.clientX / window.innerWidth
        self._lastMouseY = e.clientY / window.innerHeight
        self._mouseSplat(self._lastMouseX, self._lastMouseY, 0, 0)
      })

      el.addEventListener('mousemove', function (e) {
        if (!self._mouseActive) return
        var x = e.clientX / window.innerWidth
        var y = e.clientY / window.innerHeight
        var dx = (x - self._lastMouseX) * window.innerWidth
        var dy = (y - self._lastMouseY) * window.innerHeight

        self._mouseSplatCooldown -= 1
        if (self._mouseSplatCooldown <= 0) {
          self._mouseSplat(x, y, dx, dy)
          self._mouseSplatCooldown = 2
        }

        self._lastMouseX = x
        self._lastMouseY = y
      })

      el.addEventListener('mouseup', function () {
        self._mouseActive = false
      })

      // 触摸支持
      el.addEventListener('touchstart', function (e) {
        if (e.target.closest('input, button, [role="button"]')) return
        self._mouseActive = true
        var touch = e.touches[0]
        self._lastMouseX = touch.clientX / window.innerWidth
        self._lastMouseY = touch.clientY / window.innerHeight
        self._mouseSplat(self._lastMouseX, self._lastMouseY, 0, 0)
      })

      el.addEventListener('touchmove', function (e) {
        if (!self._mouseActive) return
        var touch = e.touches[0]
        var x = touch.clientX / window.innerWidth
        var y = touch.clientY / window.innerHeight
        var dx = (x - self._lastMouseX) * window.innerWidth
        var dy = (y - self._lastMouseY) * window.innerHeight

        self._mouseSplatCooldown -= 1
        if (self._mouseSplatCooldown <= 0) {
          self._mouseSplat(x, y, dx, dy)
          self._mouseSplatCooldown = 2
        }

        self._lastMouseX = x
        self._lastMouseY = y
      })

      el.addEventListener('touchend', function () {
        self._mouseActive = false
      })
    },

    /**
     * 产生一滴墨迹（速度越快墨滴越小，模拟笔触粗细）
     */
    _mouseSplat: function (x, y, dx, dy) {
      var color = this._fluidColor(3.0)
      var speed = Math.sqrt(dx * dx + dy * dy)

      // 笔触粗细：快划=细线，慢拖=浓墨
      var origRadius = config.SPLAT_RADIUS
      if (speed > 200) {
        config.SPLAT_RADIUS = origRadius * 0.4  // 快速：细线
      } else if (speed > 50) {
        config.SPLAT_RADIUS = origRadius * 0.7  // 中速
      }
      // 慢速/静止：原始大小（浓墨）

      var force = speed * 0.5
      force = Math.min(force, 800)
      if (force < 10) {
        // 静止点击：轻微扩散
        dx = (Math.random() - 0.5) * 100
        dy = (Math.random() - 0.5) * 100
      }
      splat(x, y, dx, dy, color)

      // 恢复原始半径
      config.SPLAT_RADIUS = origRadius
    },

    /**
     * 每帧更新
     */
    update: function () {
      if (!initialized) return;
      var dt = 1 / 60

      // 流体始终流动
      step(dt)

      if (this._paused) {
        _fadeOpacity = Math.max(0, _fadeOpacity - 0.015)
      } else {
        _fadeOpacity = Math.min(1, _fadeOpacity + 0.03)
      }

      render()
    },

    /**
     * 添加墨滴
     * @param {number} x - 归一化 X (0~1)
     * @param {number} y - 归一化 Y (0~1)
     * @param {number} dx - X 方向力
     * @param {number} dy - Y 方向力
     * @param {object} color - { r, g, b }
     */
    addSplat: function (x, y, dx, dy, color) {
      if (!initialized) return;
      splat(x, y, dx, dy, color);
    },

    /**
     * 添加多个随机墨滴
     */
    multipleSplats: function (amount) {
      if (!initialized) return;
      for (var i = 0; i < (amount || 3); i++) {
        var color = this._fluidColor(5.0);
        var x = Math.random();
        var y = Math.random();
        var dx = 600 * (Math.random() - 0.5);
        var dy = 600 * (Math.random() - 0.5);
        splat(x, y, dx, dy, color);
      }
    },

    // 封面颜色列表（按占比排序，最多 5 个）
    _coverColors: [{ r: 0.3, g: 0.25, b: 0.2, weight: 1.0 }],
    _lastBeatTime: 0,
    _ambientTimer: 0,

    /**
     * 设置封面颜色列表（按占比排序）
     * @param {Array} colors - [{ r, g, b, weight }] weight=占比 0~1
     */
    setCoverColors: function (colors) {
      if (colors && colors.length > 0) {
        this._coverColors = colors;
      }
    },

    // 兼容旧接口
    setCoverColor: function (r, g, b) {
      this._coverColors = [{ r: r, g: g, b: b, weight: 1.0 }];
    },

    /**
     * 按权重随机选一个封面色
     */
    _pickCoverColor: function () {
      var colors = this._coverColors;
      var total = 0;
      for (var i = 0; i < colors.length; i++) total += colors[i].weight;
      var roll = Math.random() * total;
      var acc = 0;
      for (var i = 0; i < colors.length; i++) {
        acc += colors[i].weight;
        if (roll <= acc) return colors[i];
      }
      return colors[colors.length - 1];
    },

    /**
     * 从封面颜色生成流体颜色（矿石颜料质感）
     * 国画颜料特性：鲜艳不透明、矿石质感、有墨韵
     */
    _fluidColor: function (intensity) {
      var c = this._pickCoverColor();
      var lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;

      // 矿石颜料：去饱和 20%（保留大部分颜色）
      var desatR = c.r * 0.8 + lum * 0.2;
      var desatG = c.g * 0.8 + lum * 0.2;
      var desatB = c.b * 0.8 + lum * 0.2;

      // 微暖（赭石感）
      var warmR = desatR * 1.04;
      var warmG = desatG * 1.00;
      var warmB = desatB * 0.94;

      // 混合少量墨色（15% 墨 + 85% 颜料）
      var inkGray = lum * 0.6;
      var finalR = warmR * 0.85 + inkGray * 0.15;
      var finalG = warmG * 0.85 + inkGray * 0.15;
      var finalB = warmB * 0.85 + inkGray * 0.15;

      // 确保最低亮度（暗色封面也有颜色）
      var fLum = finalR * 0.299 + finalG * 0.587 + finalB * 0.114;
      if (fLum < 0.10) {
        var boost = 0.10 / Math.max(0.01, fLum);
        finalR = Math.min(0.4, finalR * boost);
        finalG = Math.min(0.4, finalG * boost);
        finalB = Math.min(0.4, finalB * boost);
      }

      return {
        r: finalR * intensity,
        g: finalG * intensity,
        b: finalB * intensity
      };
    },

    _beatPhase: 0,
    _flowAngle: 0,

    /**
     * 音频驱动的墨滴（多种运动模式，有层次感）
     * @param {object} audioData - { bass, mid, treble, volume, beat }
     */
    audioSplat: function (audioData) {
      if (!initialized) return;
      var now = performance.now();

      // ─── 模式 1：低音节拍 — 放射爆发 + 漩涡 ───────────
      if (audioData.beat && audioData.bass > 0.35 && now - this._lastBeatTime > 350) {
        this._lastBeatTime = now;
        this._beatPhase++;
        var cx = 0.35 + Math.random() * 0.3;
        var cy = 0.35 + Math.random() * 0.3;

        // 放射状爆发
        var rays = 3 + Math.floor(Math.random() * 3);
        for (var ri = 0; ri < rays; ri++) {
          var angle = (ri / rays) * Math.PI * 2 + Math.random() * 0.5;
          var force = 500 + audioData.bass * 800;
          var color = this._fluidColor(4.0 + audioData.bass * 6.0);
          splat(cx, cy, Math.cos(angle) * force, Math.sin(angle) * force, color);
        }

        // 每 3 次节拍加一个漩涡（交替方向）
        if (this._beatPhase % 3 === 0) {
          var vortexColor = this._fluidColor(2.0 + audioData.bass * 3.0);
          var vortexDir = (this._beatPhase % 6 === 0) ? 1 : -1;
          splatVortex(cx, cy, 0.12, 350 * vortexDir, vortexColor);
        }
      }

      // ─── 模式 2：中音 — 流动的溪流/河流 ──────────────
      this._ambientTimer += 1;
      this._flowAngle += 0.008 + audioData.mid * 0.015; // 缓慢旋转的流向
      if (audioData.mid > 0.12 && this._ambientTimer % 6 === 0) {
        var flowColor = this._fluidColor(2.5 + audioData.mid * 3.5);
        // 沿着旋转方向流动
        var fx = 0.5 + Math.cos(this._flowAngle) * 0.35;
        var fy = 0.5 + Math.sin(this._flowAngle) * 0.35;
        var fdx = Math.cos(this._flowAngle + Math.PI * 0.5) * (200 + audioData.mid * 300);
        var fdy = Math.sin(this._flowAngle + Math.PI * 0.5) * (200 + audioData.mid * 300);
        splat(fx, fy, fdx, fdy, flowColor);
      }

      // ─── 模式 3：高音 — 细碎的涟漪扩散 ──────────────
      if (audioData.treble > 0.25 && this._ambientTimer % 12 === 0) {
        var fineColor = this._fluidColor(1.5 + audioData.treble * 2.5);
        // 随机位置的小涟漪
        var tx = 0.15 + Math.random() * 0.7;
        var ty = 0.15 + Math.random() * 0.7;
        var ta = Math.random() * Math.PI * 2;
        splat(tx, ty, Math.cos(ta) * 200, Math.sin(ta) * 200, fineColor);
      }

      // ─── 模式 4：音量持续 — 背景缓慢晕染 ──────────────
      if (audioData.volume > 0.1 && this._ambientTimer % 20 === 0) {
        var ambientColor = this._fluidColor(1.0 + audioData.volume * 2.0);
        // 从边缘缓慢向中心流动
        var side = Math.floor(Math.random() * 4);
        var ax, ay, adx, ady;
        if (side === 0) { ax = 0; ay = Math.random(); adx = 150; ady = 0; }
        else if (side === 1) { ax = 1; ay = Math.random(); adx = -150; ady = 0; }
        else if (side === 2) { ax = Math.random(); ay = 0; adx = 0; ady = 150; }
        else { ax = Math.random(); ay = 1; adx = 0; ady = -150; }
        splat(ax, ay, adx, ady, ambientColor);
      }
    },

    /**
     * 调整 canvas 大小
     */
    resize: function () {
      if (!initialized || !canvas) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    },

    /**
     * 销毁
     */
    destroy: function () {
      initialized = false;
      canvas = null;
      gl = null;
    }
  };

})(window);
