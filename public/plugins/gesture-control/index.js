/**
 * 手势控制插件
 * MediaPipe Hands 手势识别 → 粒子参数映射
 *
 * 手势：张开手掌 / 握拳 / 捏合 / 指向 / 挥动 / 旋转
 * 映射：openness→spread, fist→contract, pinch→attract, swipe→flow, rotation→twist
 */

// ─── 手势映射表 ───────────────────────────────────────────
const GESTURE_MAP = {
  open:   { param: 'spread',   range: [0, 1],   label: '扩散' },
  fist:   { param: 'contract', range: [0, 1],   label: '收缩' },
  pinch:  { param: 'attract',  range: [0, 1],   label: '吸引' },
  point:  { param: 'flowDir',  range: [-1, 1],  label: '流向' },
  swipe:  { param: 'flowDir',  range: [-1, 1],  label: '挥动' },
  rotate: { param: 'twist',    range: [-1, 1],  label: '扭曲' },
  punch:  { param: 'burst',    range: [0, 1],   label: '爆发' }
}

// ─── 手势识别器（高精度 + 挥拳检测）────────────────────────
class GestureRecognizer {
  constructor () {
    this.lastPalmX = 0
    this.lastPalmY = 0
    this.lastPalmZ = 0
    this.velocityX = 0
    this.velocityY = 0
    this.velocityZ = 0
    this.smoothing = 0.15
    this.lastGesture = 'none'
    this.gestureHoldTime = 0
    this.lastTime = Date.now()
  }

  dist (a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + ((a.z || 0) - (b.z || 0)) ** 2)
  }

  dist2d (a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
  }

  process (landmarks) {
    if (!landmarks || landmarks.length < 21) {
      return this.reset()
    }

    const now = Date.now()
    const dt = Math.max(0.016, (now - this.lastTime) / 1000)
    this.lastTime = now

    const wrist = landmarks[0]
    const thumbTip = landmarks[4]
    const indexTip = landmarks[8]
    const middleTip = landmarks[12]
    const ringTip = landmarks[16]
    const pinkyTip = landmarks[20]
    const indexMcp = landmarks[5]
    const middleMcp = landmarks[9]
    const ringMcp = landmarks[13]
    const pinkyMcp = landmarks[17]

    // 手掌中心
    const palmX = (wrist.x + middleMcp.x) / 2
    const palmY = (wrist.y + middleMcp.y) / 2
    const palmZ = (wrist.z || 0 + middleMcp.z || 0) / 2

    // 速度（平滑）
    const rawVx = (palmX - this.lastPalmX) / dt
    const rawVy = (palmY - this.lastPalmY) / dt
    const rawVz = (palmZ - this.lastPalmZ) / dt
    this.velocityX = this.velocityX * 0.7 + rawVx * 0.3
    this.velocityY = this.velocityY * 0.7 + rawVy * 0.3
    this.velocityZ = this.velocityZ * 0.7 + rawVz * 0.3
    this.lastPalmX = palmX
    this.lastPalmY = palmY
    this.lastPalmZ = palmZ

    // 开合度
    const fingerSpan = this.dist2d(thumbTip, pinkyTip)
    const palmWidth = this.dist2d(indexMcp, pinkyMcp)
    const openness = palmWidth > 0 ? Math.min(fingerSpan / palmWidth, 1.5) / 1.5 : 0

    // 捏合度
    const pinchDist = this.dist2d(thumbTip, indexTip)
    const pinch = Math.min(pinchDist / 0.15, 1)

    // 旋转
    const rotation = Math.atan2(
      ringMcp.y - indexMcp.y,
      ringMcp.x - indexMcp.x
    )

    // 手势分类
    const gesture = this.classify(openness, pinch, rotation, landmarks)

    // 手势持续时间 + 挥拳冷却
    if (gesture === this.lastGesture) {
      this.gestureHoldTime += dt
    } else {
      // 挥拳冷却：上次挥拳后 0.5 秒内不再触发
      if (gesture === 'punch' && this.lastGesture === 'punch' && this.gestureHoldTime < 0.5) {
        return this.reset()
      }
      this.gestureHoldTime = 0
      this.lastGesture = gesture
    }

    return {
      detected: true,
      openness,
      pinch,
      palmX: (palmX - 0.5) * 2,
      palmY: (palmY - 0.5) * -2,
      palmZ: -palmZ,  // Z轴翻转（面向屏幕为正）
      velocityX: this.velocityX,
      velocityY: this.velocityY,
      velocityZ: this.velocityZ,
      rotation,
      gesture,
      gestureHoldTime: this.gestureHoldTime,
      timestamp: now
    }
  }

  classify (openness, pinch, rotation, landmarks) {
    const speed = Math.sqrt(this.velocityX ** 2 + this.velocityY ** 2)
    const isFist = openness < 0.45

    // 优先级：握拳 > 挥拳 > 挥动 > 捏合 > 张开 > 指向

    // 握拳/挥拳（openness 最低，优先判断）
    if (isFist) {
      if (this.velocityZ < -0.8) return 'punch'
      return 'fist'
    }

    // 挥动（速度快 + 手张开）
    if (speed > 2.0) return 'swipe'

    // 捏合（手半开 + 拇指食指靠近）
    if (pinch < 0.35 && openness < 0.6) return 'pinch'

    // 张开手掌
    if (openness > 0.65) return 'open'

    // 指向
    const indexUp = landmarks[8].y < landmarks[6].y
    const middleUp = landmarks[12].y < landmarks[10].y
    const ringUp = landmarks[16].y < landmarks[14].y
    const pinkyUp = landmarks[20].y < landmarks[18].y
    if (indexUp && !middleUp && !ringUp && !pinkyUp) return 'point'

    return 'none'
  }

  reset () {
    this.velocityX *= 0.9
    this.velocityY *= 0.9
    this.velocityZ *= 0.9
    this.lastGesture = 'none'
    this.gestureHoldTime = 0
    return {
      detected: false,
      openness: 0,
      pinch: 1,
      palmX: 0,
      palmY: 0,
      palmZ: 0,
      velocityX: this.velocityX,
      velocityY: this.velocityY,
      velocityZ: this.velocityZ,
      rotation: 0,
      gesture: 'none',
      gestureHoldTime: 0,
      timestamp: Date.now()
    }
  }
}

// ─── 插件主体 ─────────────────────────────────────────────
let hands = null
let camera = null
let videoEl = null
let previewEl = null
let recognizer = new GestureRecognizer()
let cleanupFns = []
let isActive = false
let lastGestureData = null

// 加载 MediaPipe CDN 脚本
function loadScript (src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) { resolve(); return }
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
}

// 初始化 MediaPipe Hands
async function initMediaPipe () {
  await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js')
  await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js')

  const Hands = window.Hands
  const Camera = window.Camera

  if (!Hands || !Camera) {
    throw new Error('MediaPipe failed to load')
  }

  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  })

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.8,
    minTrackingConfidence: 0.6
  })

  hands.onResults(onResults)

  // 创建隐藏的视频元素
  videoEl = document.createElement('video')
  videoEl.style.display = 'none'
  videoEl.playsInline = true
  videoEl.muted = true
  document.body.appendChild(videoEl)
}

// 处理 MediaPipe 结果
function onResults (results) {
  let gestureData

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    gestureData = recognizer.process(results.multiHandLandmarks[0])
    gestureData.handCount = results.multiHandLandmarks.length

    // 更新摄像头预览
    if (previewEl && previewEl.querySelector('canvas')) {
      drawPreview(results.multiHandLandmarks[0])
    }
  } else {
    gestureData = recognizer.reset()
  }

  lastGestureData = gestureData

  // 广播手势数据
  if (window.Radio) {
    window.Radio.events.emit('gesture:data', gestureData)
  }
}

// 绘制摄像头预览
function drawPreview (landmarks) {
  if (!previewEl) return
  const canvas = previewEl.querySelector('canvas')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height

  ctx.clearRect(0, 0, w, h)

  // 绘制关键点
  ctx.fillStyle = 'rgba(194, 58, 43, 0.8)'
  for (const lm of landmarks) {
    ctx.beginPath()
    ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  // 绘制连线
  const connections = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17]
  ]
  ctx.strokeStyle = 'rgba(194, 58, 43, 0.4)'
  ctx.lineWidth = 1
  for (const [a, b] of connections) {
    ctx.beginPath()
    ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h)
    ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h)
    ctx.stroke()
  }
}

// 启动摄像头
async function startCamera () {
  camera = new window.Camera(videoEl, {
    onFrame: async () => {
      if (hands && isActive) {
        await hands.send({ image: videoEl })
      }
    },
    facingMode: 'user',
    width: 320,
    height: 240
  })

  await hands.initialize()
  await camera.start()
}

// 停止摄像头（强制释放所有资源）
function stopCamera () {
  isActive = false

  // 1. 先停视频轨道（最重要，释放摄像头硬件）
  if (videoEl && videoEl.srcObject) {
    try {
      videoEl.srcObject.getTracks().forEach(track => {
        track.stop()
      })
      videoEl.srcObject = null
    } catch (e) { console.warn('[GestureControl] track.stop error:', e) }
  }

  // 2. 停 MediaPipe camera
  if (camera) {
    try { camera.stop() } catch (e) { /* ignore */ }
    camera = null
  }

  // 3. 关 MediaPipe hands
  if (hands) {
    try { hands.close() } catch (e) { /* ignore */ }
    hands = null
  }

  // 4. 移除 video 元素
  if (videoEl) {
    try { videoEl.remove() } catch (e) { /* ignore */ }
    videoEl = null
  }
}

// 创建预览 UI
function createPreviewUI () {
  const wrapper = document.createElement('div')
  wrapper.id = 'gesture-preview'
  wrapper.style.cssText = `
    position: fixed;
    bottom: 100px;
    right: 24px;
    z-index: 200;
    width: 200px;
    border-radius: 12px;
    overflow: hidden;
    background: rgba(0,0,0,0.6);
    border: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(12px);
    font-family: inherit;
  `

  // 标题栏
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  `
  header.innerHTML = `
    <span style="font-size:11px;color:rgba(255,255,255,.6);font-weight:600;">手势控制</span>
    <span id="gesture-status" style="font-size:10px;color:rgba(194,58,43,.8);">● 就绪</span>
  `

  // 摄像头预览
  const canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 150
  canvas.style.cssText = 'display:block;width:100%;background:#111;'

  // 手势信息
  const info = document.createElement('div')
  info.id = 'gesture-info'
  info.style.cssText = 'padding:8px 12px;font-size:10px;color:rgba(255,255,255,.5);'
  info.textContent = '等待手部检测...'

  wrapper.appendChild(header)
  wrapper.appendChild(canvas)
  wrapper.appendChild(info)

  previewEl = wrapper
  return wrapper
}

// 更新手势信息显示
function updateGestureInfo (data) {
  const el = document.getElementById('gesture-info')
  const statusEl = document.getElementById('gesture-status')
  if (!el) return

  if (data.detected) {
    const gestureNames = {
      open: '✋ 张开手掌', fist: '✊ 握拳', pinch: '🤏 捏合',
      point: '👉 指向', swipe: '👋 挥动', rotate: '🔄 旋转',
      punch: '👊 挥拳', none: '—'
    }
    el.innerHTML = `
      <div style="margin-bottom:4px;">${gestureNames[data.gesture] || '—'}</div>
      <div style="color:rgba(255,255,255,.3);">开合:${data.openness.toFixed(2)} 捏合:${data.pinch.toFixed(2)}</div>
    `
    if (statusEl) statusEl.innerHTML = '<span style="color:rgba(74,222,128,.8);">● 检测中</span>'
  } else {
    el.textContent = '等待手部检测...'
    if (statusEl) statusEl.innerHTML = '<span style="color:rgba(194,58,43,.8);">● 就绪</span>'
  }
}

// ─── 插件导出 ─────────────────────────────────────────────
export default {
  manifest: {
    id: 'gesture-control',
    name: '手势控制',
    version: '1.0.0',
    type: 'gesture',
    description: '用手势与粒子互动——张开手掌扩散、握拳收缩、捏合吸引、挥动流向、旋转扭曲'
  },

  async activate (ctx) {
    ctx.log('Activating...')

    try {
      // 初始化 MediaPipe
      await initMediaPipe()

      // 创建预览 UI
      const preview = createPreviewUI()
      ctx.ui.mount('bottom-right', preview)

      // 监听手势数据并更新预览
      cleanupFns.push(
        ctx.events.on('gesture:data', (data) => {
          updateGestureInfo(data)
        })
      )

      // 启动摄像头
      await startCamera()
      isActive = true

      ctx.log('Activated — camera running at 30fps')
    } catch (err) {
      ctx.log('Failed to activate:', err.message)
      console.error('[GestureControl]', err)
    }
  },

  deactivate () {
    isActive = false

    // 清理事件监听
    for (const fn of cleanupFns) fn()
    cleanupFns = []

    // 停止摄像头（同步，强制释放）
    stopCamera()

    // 移除预览 UI
    if (previewEl && previewEl.parentNode) {
      previewEl.parentNode.removeChild(previewEl)
    }
    previewEl = null

    // 重置识别器
    recognizer = new GestureRecognizer()
    lastGestureData = null

    console.log('[GestureControl] Deactivated')
  }
}
