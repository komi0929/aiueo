/**
 * フィードバック演出 — ゲーミフィケーション版
 */

const MONSTER_EMOJIS = ['👾', '👻', '🐙', '🦖', '😈'];
const HAPPY_EMOJIS = ['🎉', '✨', '💫', '🌟', '⭐'];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * ミス時
 */
export function showMissFeedback(overlayEl, contentEl) {
  contentEl.innerHTML = `
    <div class="fb-emoji fb-bounce">${randomFrom(MONSTER_EMOJIS)}</div>
    <div class="fb-text fb-miss">おしい！もういっかい！💪</div>
  `;
  overlayEl.classList.add('active');
  setTimeout(() => overlayEl.classList.remove('active'), 1400);
}

/**
 * 1文字クリア — コンボ数に応じてエスカレーション
 */
export function showClearFeedback(overlayEl, contentEl, combo = 0) {
  let comboHtml = '';
  if (combo >= 3) {
    const size = Math.min(2 + combo * 0.15, 3.5);
    comboHtml = `<div class="combo-badge" style="font-size:${size}rem">🔥 ${combo}コンボ！</div>`;
  }

  contentEl.innerHTML = `
    <div class="fb-circle-burst"><div class="fb-ring"></div><div class="fb-emoji fb-spin">${randomFrom(HAPPY_EMOJIS)}</div></div>
    <div class="fb-emoji fb-pop">${randomFrom(MONSTER_EMOJIS)}</div>
    ${comboHtml}
    <div class="fb-text">すごーい！🎉</div>
  `;
  overlayEl.classList.add('active');
  createParticles(contentEl, combo);

  return new Promise(resolve => {
    setTimeout(() => { overlayEl.classList.remove('active'); resolve(); }, combo >= 5 ? 2500 : 2000);
  });
}

/**
 * コンボ閾値到達時のフラッシュ演出
 */
export function showCombo(combo) {
  const el = document.createElement('div');
  el.className = 'combo-flash';
  const emoji = combo >= 10 ? '🌈' : combo >= 7 ? '⚡' : combo >= 5 ? '🔥' : '💫';
  el.innerHTML = `<span>${emoji} ${combo}コンボ！${emoji}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/**
 * レベルアップ演出
 */
export function showLevelUp(level, title) {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'levelup-overlay';
    el.innerHTML = `
      <div class="levelup-content">
        <div class="fb-emoji fb-mega-spin">🆙</div>
        <div class="levelup-title">レベルアップ！</div>
        <div class="levelup-level">Lv.${level}</div>
        <div class="levelup-name">${title}</div>
      </div>
    `;
    document.body.appendChild(el);
    createParticles(el.querySelector('.levelup-content'), 10);

    el.addEventListener('click', () => { el.remove(); resolve(); });
    setTimeout(() => { if (el.parentNode) el.remove(); resolve(); }, 3000);
  });
}

/**
 * パーティクル
 */
function createParticles(container, intensity = 0) {
  const colors = ['#8B5CF6', '#EF4444', '#3B82F6', '#F59E0B', '#10B981', '#EC4899'];
  const count = 18 + intensity * 3;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'fb-particle';
    el.textContent = ['✦', '●', '◆', '★', '♦'][i % 5];
    el.style.cssText = `
      left:${50 + (Math.random() - 0.5) * 60}%;
      top:${50 + (Math.random() - 0.5) * 40}%;
      color:${colors[i % colors.length]};
      font-size:${6 + Math.random() * 10}px;
      --tx:${(Math.random() - 0.5) * 200}px;
      --ty:${-40 - Math.random() * 120}px;
      animation-delay:${Math.random() * 0.3}s;
    `;
    container.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
}
