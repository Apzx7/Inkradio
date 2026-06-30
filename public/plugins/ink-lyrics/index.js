/**
 * 水墨歌词插件
 * 覆盖 Mineradio 的舞台歌词样式，改为水墨风格
 *
 * 动画语言：气韵生动，行云流水，墨汁渗入宣纸
 * 禁止 linear/ease-in/ease-out，全部 cubic-bezier
 */

// ─── Perlin Noise ──────────────────────────────────────────
const P = 256
const grad = new Float32Array(P * 2)
for (let i = 0; i < P * 2; i++) grad[i] = Math.random() * 2 - 1

function noise(x) {
  const xi = Math.floor(x) & (P - 1)
  const xf = x - Math.floor(x)
  const u = xf * xf * (3 - 2 * xf)
  return grad[xi] + (grad[xi + 1] - grad[xi]) * u
}

// ─── 状态 ─────────────────────────────────────────────────
let cleanupFns = []
let raf = 0
let beatPulse = 0

// ─── 注入水墨歌词 CSS（覆盖原版）──────────────────────────
function injectStyles() {
  const style = document.createElement('style')
  style.id = 'ink-lyrics-style'
  style.textContent = `
    /* ─── 水墨歌词：覆盖原版舞台歌词 ─── */

    /* 基础：去掉原版霓虹发光，改为墨色 */
    .stage-lyric-line {
      text-shadow: 0 2px 20px rgba(0, 0, 0, 0.4) !important;
      background: linear-gradient(180deg,
        rgba(232, 224, 212, 0.98) 0%,
        rgba(200, 190, 170, 0.95) 55%,
        rgba(180, 170, 155, 0.90) 100%
      ) !important;
      -webkit-background-clip: text !important;
      background-clip: text !important;
      -webkit-text-fill-color: transparent !important;
      filter: drop-shadow(0 2px 12px rgba(0, 0, 0, 0.25)) !important;
    }

    /* 入场：墨迹扩散（不是 3D 飞入） */
    @keyframes ink-lyr-in {
      0% {
        opacity: 0;
        transform: translate3d(0, 8px, 0) scale(0.92);
        filter: blur(16px) drop-shadow(0 2px 12px rgba(0, 0, 0, 0.25));
      }
      30% {
        opacity: 0.5;
        filter: blur(6px) drop-shadow(0 2px 12px rgba(0, 0, 0, 0.25));
      }
      100% {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
        filter: blur(0) drop-shadow(0 2px 12px rgba(0, 0, 0, 0.25));
      }
    }

    /* 离场：墨迹消散（不是 3D 飞出） */
    @keyframes ink-lyr-out {
      0% {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
        filter: blur(0) drop-shadow(0 2px 12px rgba(0, 0, 0, 0.25));
      }
      50% {
        opacity: 0.3;
        filter: blur(4px) drop-shadow(0 2px 12px rgba(0, 0, 0, 0.25));
      }
      100% {
        opacity: 0;
        transform: translate3d(0, -6px, 0) scale(1.04);
        filter: blur(12px) drop-shadow(0 2px 12px rgba(0, 0, 0, 0.25));
      }
    }

    /* 呼吸 + 漂浮（Perlin noise 通过 JS 驱动） */
    @keyframes ink-lyr-breathe {
      0%, 100% { transform: translateY(0) scale(1); }
      25% { transform: translateY(-2px) scale(1.015); }
      50% { transform: translateY(1px) scale(0.99); }
      75% { transform: translateY(-1px) scale(1.005); }
    }

    .stage-lyric-line.in {
      animation: ink-lyr-in 1.0s cubic-bezier(0.22, 1, 0.36, 1) forwards,
                 ink-lyr-breathe 6s cubic-bezier(0.37, 0, 0.63, 1) 1.0s infinite !important;
    }

    .stage-lyric-line.out {
      animation: ink-lyr-out 0.8s cubic-bezier(0.5, 0, 0.7, 1) forwards !important;
    }

    /* 节拍弹起（JS 添加 class） */
    .stage-lyric-line.beat-bounce {
      transition: transform 0.15s cubic-bezier(0.22, 1, 0.36, 1) !important;
    }
  `
  document.head.appendChild(style)
  return style
}

// ─── 节拍监听 ─────────────────────────────────────────────
function onBeat(data) {
  if (data.bass > 0.3) {
    beatPulse = Math.min(1, data.bass * 1.2)
    // 给当前歌词添加节拍弹起
    const currentLine = document.querySelector('.stage-lyric-line.in')
    if (currentLine) {
      currentLine.classList.add('beat-bounce')
      currentLine.style.transform = `translateY(${-beatPulse * 6}px)`
      setTimeout(() => {
        currentLine.style.transform = ''
        setTimeout(() => currentLine.classList.remove('beat-bounce'), 150)
      }, 100)
    }
  }
}

// ─── 歌词轮询（适配 Mineradio DOM 更新）────────────────────
let pollTimer = 0
let lastHash = ''

function pollLyrics() {
  const container = document.getElementById('stage-lyrics-lines')
  if (!container) return

  const hash = container.innerHTML.length + ':' + (container.children.length)
  if (hash !== lastHash) {
    lastHash = hash
    onLyricChange()
  }
}

function onLyricChange() {
  const lines = document.querySelectorAll('.stage-lyric-line')
  lines.forEach((el, i) => {
    // 确保每行有唯一的 Perlin 偏移
    if (!el._inkOffset) el._inkOffset = i * 1.7
  })
}

// ─── 插件导出 ──────────────────────────────────────────────
export default {
  manifest: {
    id: 'ink-lyrics',
    name: '水墨歌词',
    version: '1.0.0',
    type: 'ui-component',
    description: '中国水墨风格歌词动画——呼吸、漂浮、墨迹扩散、毛笔收笔、节奏同步'
  },

  activate(ctx) {
    // 注入覆盖样式
    injectStyles()

    // 自动切换到舞台模式（启用舞台歌词）
    try {
      // 点击 3D 歌单架的「舞台」按钮
      const stageBtn = document.querySelector('[data-shelf="stage"]')
      if (stageBtn && !stageBtn.classList.contains('active')) {
        stageBtn.click()
      }

      // 确保舞台歌词可见
      setTimeout(() => {
        const stageLyrics = document.getElementById('stage-lyrics')
        if (stageLyrics) stageLyrics.style.display = 'block'
      }, 500)
    } catch (e) {
      ctx.log('自动启用舞台歌词失败:', e.message)
    }

    // 监听节拍
    cleanupFns.push(ctx.audio.onBeat(onBeat))

    // 监听切歌
    cleanupFns.push(ctx.audio.onTrackChange(() => {
      lastHash = ''
    }))

    // 轮询歌词变化
    pollTimer = setInterval(pollLyrics, 200)

    ctx.log('Activated — 水墨歌词已启用（舞台模式）')
  },

  deactivate() {
    clearInterval(pollTimer)
    for (const fn of cleanupFns) fn()
    cleanupFns = []

    // 移除覆盖样式（恢复原版）
    const styleEl = document.getElementById('ink-lyrics-style')
    if (styleEl) styleEl.remove()

    // 清理歌词元素
    document.querySelectorAll('.stage-lyric-line').forEach(el => {
      el.classList.remove('beat-bounce')
      el.style.transform = ''
    })

    console.log('[InkLyrics] Deactivated — 原版歌词样式已恢复')
  }
}
