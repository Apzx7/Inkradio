/**
 * 墨猫桌宠插件
 * 一只随音乐摆动的水墨猫
 * 挂载到 Home 页的 pet 槽位
 */

const CAT_SVG = [
  '<svg width="160" height="160" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">',
  '<!-- 身体 -->',
  '<ellipse cx="50" cy="62" rx="28" ry="20" fill="#1a1a1a" opacity="0.85"/>',
  '<ellipse cx="50" cy="62" rx="22" ry="16" fill="none" stroke="#2a2a2a" stroke-width="0.5" opacity="0.3"/>',
  '<!-- 头 -->',
  '<circle cx="50" cy="35" r="18" fill="#1a1a1a" opacity="0.9"/>',
  '<!-- 耳朵 -->',
  '<polygon points="35,22 30,4 42,18" fill="#1a1a1a" opacity="0.9"/>',
  '<polygon points="65,22 70,4 58,18" fill="#1a1a1a" opacity="0.9"/>',
  '<polygon points="36,20 33,8 41,17" fill="#2a2a2a" opacity="0.4"/>',
  '<polygon points="64,20 67,8 59,17" fill="#2a2a2a" opacity="0.4"/>',
  '<!-- 眼睛 -->',
  '<ellipse cx="42" cy="32" rx="3" ry="3.5" fill="#c23a2b" id="ink-cat-eye-l">',
  '  <animate attributeName="ry" values="3.5;0.5;3.5" dur="4s" repeatCount="indefinite" begin="2s"/>',
  '</ellipse>',
  '<ellipse cx="58" cy="32" rx="3" ry="3.5" fill="#c23a2b" id="ink-cat-eye-r">',
  '  <animate attributeName="ry" values="3.5;0.5;3.5" dur="4s" repeatCount="indefinite" begin="2s"/>',
  '</ellipse>',
  '<!-- 瞳孔 -->',
  '<circle cx="42" cy="32" r="1.5" fill="#000" id="ink-cat-pupil-l"/>',
  '<circle cx="58" cy="32" r="1.5" fill="#000" id="ink-cat-pupil-r"/>',
  '<!-- 鼻子 -->',
  '<ellipse cx="50" cy="38" rx="2" ry="1.5" fill="#c23a2b" opacity="0.7"/>',
  '<!-- 嘴 -->',
  '<path d="M45 41 Q50 44 55 41" stroke="#333" stroke-width="1" fill="none" id="ink-cat-mouth"/>',
  '<!-- 胡须 -->',
  '<line x1="20" y1="35" x2="35" y2="37" stroke="#333" stroke-width="0.5" opacity="0.4"/>',
  '<line x1="20" y1="40" x2="35" y2="39" stroke="#333" stroke-width="0.5" opacity="0.4"/>',
  '<line x1="80" y1="35" x2="65" y2="37" stroke="#333" stroke-width="0.5" opacity="0.4"/>',
  '<line x1="80" y1="40" x2="65" y2="39" stroke="#333" stroke-width="0.5" opacity="0.4"/>',
  '<!-- 尾巴 -->',
  '<path d="M78 62 Q90 45 82 30" stroke="#1a1a1a" stroke-width="3.5" fill="none" stroke-linecap="round" id="ink-cat-tail">',
  '  <animateTransform attributeName="transform" type="rotate" values="0 78 62;15 78 62;-10 78 62;0 78 62" dur="3s" repeatCount="indefinite"/>',
  '</path>',
  '<!-- 脚 -->',
  '<ellipse cx="32" cy="78" rx="5" ry="3.5" fill="#1a1a1a" opacity="0.8"/>',
  '<ellipse cx="68" cy="78" rx="5" ry="3.5" fill="#1a1a1a" opacity="0.8"/>',
  '<circle cx="30" cy="79" r="1.5" fill="#2a2a2a" opacity="0.3"/>',
  '<circle cx="34" cy="79" r="1.5" fill="#2a2a2a" opacity="0.3"/>',
  '<circle cx="66" cy="79" r="1.5" fill="#2a2a2a" opacity="0.3"/>',
  '<circle cx="70" cy="79" r="1.5" fill="#2a2a2a" opacity="0.3"/>',
  '</svg>'
].join('\n');

let catElement = null;
let bubbleElement = null;
let cleanupFns = [];
let mood = 'idle';

function createCatElement() {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;cursor:pointer;user-select:none;transition:transform 0.3s;';
  wrapper.innerHTML = CAT_SVG + '<div class="pet-bubble" id="ink-cat-bubble">喵~</div>';
  catElement = wrapper;
  bubbleElement = wrapper.querySelector('#ink-cat-bubble');

  wrapper.addEventListener('click', (e) => {
    e.stopPropagation();
    wrapper.style.transform = 'scale(1.15) rotate(-8deg)';
    setTimeout(() => { wrapper.style.transform = ''; }, 300);
    const bubbles = ['喵~', '♫', '♪', '(=^·^=)', '摸摸~', '呼噜~', '🎵'];
    showBubble(bubbles[Math.floor(Math.random() * bubbles.length)], 2500);
  });

  document.addEventListener('mousemove', (e) => {
    const rect = wrapper.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / (rect.width / 2)));
    const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / (rect.height / 2)));

    const pL = wrapper.querySelector('#ink-cat-pupil-l');
    const pR = wrapper.querySelector('#ink-cat-pupil-r');
    if (pL) { pL.setAttribute('cx', 42 + dx * 1.5); pL.setAttribute('cy', 32 + dy * 1); }
    if (pR) { pR.setAttribute('cx', 58 + dx * 1.5); pR.setAttribute('cy', 32 + dy * 1); }
  });

  return wrapper;
}

function showBubble(text, duration) {
  if (!bubbleElement) return;
  bubbleElement.textContent = text;
  bubbleElement.classList.add('visible');
  clearTimeout(bubbleElement._timer);
  bubbleElement._timer = setTimeout(() => {
    bubbleElement.classList.remove('visible');
  }, duration || 2000);
}

export default {
  manifest: {
    id: 'ink-cat-pet',
    name: '墨猫桌宠',
    version: '1.0.0',
    type: 'ui-component',
    description: '一只随音乐摆动的水墨猫，挂载到 Home 页桌宠区域'
  },

  activate(ctx) {
    const el = createCatElement();
    ctx.ui.mount('pet', el);

    cleanupFns.push(ctx.audio.onData((data) => {
      if (!catElement) return;
      if (data.volume > 0.05) {
        const sway = Math.sin(Date.now() / 800) * 3 * data.volume;
        const tilt = Math.sin(Date.now() / 1200) * 2 * data.volume;
        catElement.style.transform = `translateY(${sway}px) rotate(${tilt}deg)`;
      } else if (mood !== 'sleeping') {
        catElement.style.transform = '';
      }
      if (data.beat && data.bass > 0.3) {
        catElement.style.transform = 'scale(1.08)';
        setTimeout(() => { if (catElement) catElement.style.transform = ''; }, 120);
        showBubble('♫', 800);
      }
    }));

    cleanupFns.push(ctx.audio.onPlay(() => {
      mood = 'active';
      if (catElement) catElement.style.filter = 'brightness(1.1)';
      showBubble('♫ 开播了~', 2000);
    }));

    cleanupFns.push(ctx.audio.onPause(() => {
      mood = 'sleeping';
      if (catElement) {
        catElement.style.filter = 'brightness(0.6) saturate(0.5)';
        catElement.style.transform = '';
      }
      showBubble('💤', 3000);
    }));

    ctx.log('Activated — mounted to pet slot');
  },

  deactivate() {
    for (const fn of cleanupFns) fn();
    cleanupFns = [];
    if (catElement && catElement.parentNode) catElement.parentNode.removeChild(catElement);
    catElement = null;
    console.log('[InkCat] Deactivated');
  }
};
