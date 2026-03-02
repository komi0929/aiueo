/**
 * メインアプリケーション
 * ゲーミフィケーション版 — コンボ・XP・レベル・モンスター育成
 */
import './style.css';
import { HIRAGANA_ROWS, getAllChars, HIRAGANA_STROKES } from './hiragana-data.js';
import { StrokeEngine } from './stroke-engine.js';
import { GuideRenderer } from './guide-renderer.js';
import { showMissFeedback, showClearFeedback, showCombo, showLevelUp } from './feedback.js';

// ===== ゲーミフィケーション定数 =====
const MONSTER_STAGES = [
  { emoji: '🥚', name: 'たまご', xpNeeded: 0 },
  { emoji: '🐣', name: 'ひよこ', xpNeeded: 10 },
  { emoji: '🐥', name: 'こども', xpNeeded: 30 },
  { emoji: '👾', name: 'もんすたー', xpNeeded: 60 },
  { emoji: '🐉', name: 'りゅう', xpNeeded: 100 },
  { emoji: '⭐', name: 'でんせつ', xpNeeded: 200 },
];

const LEVEL_TITLES = ['はじめて', 'かけだし', 'がんばりや', 'じょうず', 'めいじん', 'てんさい', 'でんせつ'];
const XP_PER_CHAR = 3;       // 1文字クリアで獲得
const XP_PER_LEVEL = 15;     // レベルアップに必要なXP
const COMBO_THRESHOLDS = [3, 5, 7, 10]; // コンボ演出の閾値

// ===== 永続データ =====
const STORAGE_KEY = 'mamimume_data';

function loadGameData() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return d || { xp: 0, level: 1, totalCleared: 0, streak: 0, bestStreak: 0, mastered: {} };
  } catch { return { xp: 0, level: 1, totalCleared: 0, streak: 0, bestStreak: 0, mastered: {} }; }
}

function saveGameData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(gameData));
}

let gameData = loadGameData();

function getMonsterStage() {
  let stage = MONSTER_STAGES[0];
  for (const s of MONSTER_STAGES) {
    if (gameData.totalCleared >= s.xpNeeded) stage = s;
  }
  return stage;
}

function getLevelTitle() {
  const idx = Math.min(gameData.level - 1, LEVEL_TITLES.length - 1);
  return LEVEL_TITLES[idx];
}

// ===== State =====
let currentMode = 'row';
let currentLevel = 'beginner';
let currentRow = null;
let currentChars = [];
let currentCharIndex = 0;
let strokeEngine = null;
let guideRenderer = null;
let comboCount = 0;      // 今回のセッション中の連続正解
let busy = false;        // 処理中ロック（二重呼び出し防止）

// クイズ
let quizScore = 0;
const QUIZ_TOTAL = 10;

// ===== DOM Elements =====
const screens = {
  menu: document.getElementById('screen-menu'),
  rowSelect: document.getElementById('screen-row-select'),
  practice: document.getElementById('screen-practice'),
  status: document.getElementById('screen-status')
};

const els = {
  drawCanvas: document.getElementById('draw-canvas'),
  guideCanvas: document.getElementById('guide-canvas'),
  canvasArea: document.getElementById('canvas-area'),
  progressContainer: document.getElementById('progress-container'),
  currentCharLabel: document.getElementById('current-char-label'),
  feedbackOverlay: document.getElementById('feedback-overlay'),
  feedbackContent: document.getElementById('feedback-content'),
  rowGrid: document.getElementById('row-grid'),
  // ゲーミフィケーションUI
  monsterEmoji: document.getElementById('monster-emoji'),
  monsterName: document.getElementById('monster-name'),
  xpBar: document.getElementById('xp-bar'),
  xpText: document.getElementById('xp-text'),
  levelBadge: document.getElementById('level-badge'),
  streakDisplay: document.getElementById('streak-display'),
  // ステータス画面
  statusGrid: document.getElementById('status-grid'),
  statusMonster: document.getElementById('status-monster'),
  statusLevel: document.getElementById('status-level'),
  statusTotal: document.getElementById('status-total'),
  statusBestStreak: document.getElementById('status-best-streak'),
};

// ===== Screen Navigation =====
function showScreen(name) {
  Object.values(screens).forEach(s => s?.classList.remove('active'));
  screens[name]?.classList.add('active');
}

// ===== Menu Setup =====
function setupMenu() {
  updateMenuDisplay();

  document.getElementById('btn-mode-row').addEventListener('click', () => {
    currentMode = 'row';
    showScreen('rowSelect');
    renderRowGrid();
  });

  document.getElementById('btn-mode-random').addEventListener('click', () => {
    currentMode = 'random';
    startRandomPractice();
  });

  const quizBtn = document.getElementById('btn-mode-quiz');
  if (quizBtn) {
    quizBtn.addEventListener('click', () => {
      currentMode = 'quiz';
      startQuizMode();
    });
  }

  document.querySelectorAll('.btn-level').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-level').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLevel = btn.dataset.level;
    });
  });

  // ステータスボタン
  document.getElementById('btn-status').addEventListener('click', () => {
    showScreen('status');
    renderStatusScreen();
  });

  // 戻るボタン
  document.getElementById('btn-back-menu').addEventListener('click', () => showScreen('menu'));
  document.getElementById('btn-back-menu2').addEventListener('click', () => { updateMenuDisplay(); showScreen('menu'); });
  document.getElementById('btn-back-select').addEventListener('click', () => {
    if (currentMode === 'row') {
      showScreen('rowSelect');
    } else {
      updateMenuDisplay();
      showScreen('menu');
    }
  });

  document.getElementById('btn-clear-canvas').addEventListener('click', () => {
    if (strokeEngine) {
      strokeEngine.reset();
      updateGuide();
    }
  });
}

// ===== メニュー表示更新 =====
function updateMenuDisplay() {
  const stage = getMonsterStage();

  if (els.monsterEmoji) els.monsterEmoji.textContent = stage.emoji;
  if (els.monsterName) els.monsterName.textContent = stage.name;

  // XPバー (次のステージまでの進捗)
  const nextStage = MONSTER_STAGES.find(s => s.xpNeeded > gameData.totalCleared);
  const prevThreshold = getMonsterStage().xpNeeded;
  const nextThreshold = nextStage ? nextStage.xpNeeded : prevThreshold + 50;
  const progress = ((gameData.totalCleared - prevThreshold) / (nextThreshold - prevThreshold)) * 100;

  if (els.xpBar) els.xpBar.style.width = Math.min(100, Math.max(0, progress)) + '%';
  if (els.xpText) els.xpText.textContent = `${gameData.totalCleared} / ${nextThreshold}`;

  // レベル
  if (els.levelBadge) els.levelBadge.textContent = `Lv.${gameData.level} ${getLevelTitle()}`;

  // ストリーク
  if (els.streakDisplay) {
    if (gameData.bestStreak > 0) {
      els.streakDisplay.textContent = `🔥 さいこう ${gameData.bestStreak}れんぞく！`;
    } else {
      els.streakDisplay.textContent = '';
    }
  }
}

// ===== Row Selection Grid =====
function renderRowGrid() {
  els.rowGrid.innerHTML = '';
  HIRAGANA_ROWS.forEach((row, idx) => {
    const btn = document.createElement('button');
    btn.className = `btn btn-row row-color-${idx}`;

    // マスタリー状態チェック
    const masteredCount = row.chars.filter(c => gameData.mastered[c]).length;
    const allMastered = masteredCount === row.chars.length;

    if (allMastered) btn.classList.add('completed');

    const stars = allMastered ? '⭐' : masteredCount > 0 ? `${masteredCount}/${row.chars.length}` : '';
    btn.innerHTML = `${row.label}<small>${row.chars.join(' ')}</small>${stars ? `<span class="row-progress">${stars}</span>` : ''}`;

    btn.addEventListener('click', () => {
      currentRow = row;
      startRowPractice(row);
    });
    els.rowGrid.appendChild(btn);
  });
}

// ===== Start Practice =====
function startRowPractice(row) {
  currentChars = [...row.chars];
  currentCharIndex = 0;
  comboCount = 0;
  busy = false;
  showScreen('practice');
  initPractice();
}

function startRandomPractice() {
  const allChars = getAllChars().filter(c => HIRAGANA_STROKES[c]);
  const shuffled = [...allChars].sort(() => Math.random() - 0.5);
  currentChars = shuffled.slice(0, 5);
  currentCharIndex = 0;
  currentRow = null;
  comboCount = 0;
  busy = false;
  showScreen('practice');
  initPractice();
}

function startQuizMode() {
  const allChars = getAllChars().filter(c => HIRAGANA_STROKES[c]);
  const shuffled = [...allChars].sort(() => Math.random() - 0.5);
  currentChars = shuffled.slice(0, QUIZ_TOTAL);
  currentCharIndex = 0;
  currentRow = null;
  quizScore = 0;
  comboCount = 0;
  busy = false;
  currentLevel = 'beginner';
  showScreen('practice');
  initPractice();
}

function initPractice() {
  setupCanvasSize();

  if (!strokeEngine) {
    strokeEngine = new StrokeEngine(els.drawCanvas, {
      onMiss: handleMiss,
      onStrokeComplete: handleStrokeComplete,
      onCharComplete: handleCharComplete
    }, currentLevel);
  } else {
    strokeEngine.level = currentLevel;
  }

  if (!guideRenderer) {
    guideRenderer = new GuideRenderer(els.guideCanvas);
  }

  setupSwipe();
  renderProgress();
  loadChar(currentChars[currentCharIndex]);
  window.addEventListener('resize', handleResize);
}

// ===== スワイプ =====
let swipeStartX = 0, swipeStartY = 0, swiping = false;

function setupSwipe() {
  const area = els.canvasArea;
  if (area._swipeSetup) return;
  area._swipeSetup = true;

  area.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) { swipeStartX = e.touches[0].clientX; swipeStartY = e.touches[0].clientY; swiping = false; }
  }, { passive: true });

  area.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) swiping = true;
  }, { passive: true });

  area.addEventListener('touchend', (e) => {
    if (!swiping) return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    if (dx < -50) skipToNextChar();
    else if (dx > 50) skipToPrevChar();
    swiping = false;
  }, { passive: true });
}

function skipToNextChar() {
  if (busy || strokeEngine?.locked || strokeEngine?.isDrawing) return;
  if (currentCharIndex < currentChars.length - 1) { currentCharIndex++; loadChar(currentChars[currentCharIndex]); }
}
function skipToPrevChar() {
  if (busy || strokeEngine?.locked || strokeEngine?.isDrawing) return;
  if (currentCharIndex > 0) { currentCharIndex--; loadChar(currentChars[currentCharIndex]); }
}

function setupCanvasSize() {
  const rect = els.canvasArea.getBoundingClientRect();
  if (strokeEngine) strokeEngine.resize(rect.width, rect.height);
  if (guideRenderer) guideRenderer.resize(rect.width, rect.height);
}

function handleResize() { setupCanvasSize(); if (strokeEngine?.currentChar) strokeEngine.clearCanvas(); updateGuide(); }

function loadChar(char) {
  els.currentCharLabel.textContent = char;
  strokeEngine.setChar(char);
  setupCanvasSize();
  updateGuide();
  renderProgress();
}

function updateGuide() {
  if (guideRenderer && strokeEngine?.currentChar) {
    guideRenderer.render(strokeEngine.currentChar, currentLevel, strokeEngine.currentStrokeIndex);
  }
}

// ===== Progress =====
function renderProgress() {
  els.progressContainer.innerHTML = '';
  if (currentMode === 'quiz') {
    const label = document.createElement('span');
    label.style.cssText = 'font-size:0.9rem;font-weight:700;color:rgba(255,255,255,0.7);';
    label.textContent = `${currentCharIndex + 1}/${QUIZ_TOTAL}`;
    els.progressContainer.appendChild(label);
    return;
  }
  currentChars.forEach((c, i) => {
    const dot = document.createElement('div');
    dot.className = 'progress-dot';
    if (i < currentCharIndex) dot.classList.add('done');
    if (i === currentCharIndex) dot.classList.add('active');
    els.progressContainer.appendChild(dot);
  });
}

// ===== Callbacks =====
function handleMiss() {
  comboCount = 0; // コンボリセット
  showMissFeedback(els.feedbackOverlay, els.feedbackContent);
  setTimeout(() => updateGuide(), 200);
}

function handleStrokeComplete(strokeIndex) {
  updateGuide();
}

async function handleCharComplete() {
  // 二重呼び出し防止
  if (busy) return;
  busy = true;

  // XP加算
  comboCount++;
  gameData.totalCleared++;
  gameData.xp += XP_PER_CHAR + Math.min(comboCount, 5); // コンボボーナス
  gameData.streak++;
  if (gameData.streak > gameData.bestStreak) gameData.bestStreak = gameData.streak;

  // マスタリー記録
  const char = currentChars[currentCharIndex];
  gameData.mastered[char] = (gameData.mastered[char] || 0) + 1;

  // レベルアップ判定
  const newLevel = Math.floor(gameData.xp / XP_PER_LEVEL) + 1;
  const leveledUp = newLevel > gameData.level;
  if (leveledUp) gameData.level = newLevel;

  saveGameData();

  // クイズモードではスコア加算
  if (currentMode === 'quiz') quizScore++;

  // コンボ表示（閾値に達した時）
  if (COMBO_THRESHOLDS.includes(comboCount)) {
    showCombo(comboCount);
  }

  // はなまる表示
  await showClearFeedback(els.feedbackOverlay, els.feedbackContent, comboCount);

  // レベルアップ演出
  if (leveledUp) {
    await showLevelUp(gameData.level, getLevelTitle());
  }

  currentCharIndex++;

  if (currentCharIndex >= currentChars.length) {
    busy = false;
    await handleSetComplete();
  } else {
    loadChar(currentChars[currentCharIndex]);
    busy = false;
  }
}

async function handleSetComplete() {
  if (currentMode === 'quiz') {
    await showQuizResult();
    updateMenuDisplay();
    showScreen('menu');
    return;
  }

  updateMenuDisplay();
  if (currentMode === 'row') {
    showScreen('rowSelect');
    renderRowGrid();
  } else {
    showScreen('menu');
  }
}

// ===== クイズ結果表示 =====
async function showQuizResult() {
  return new Promise(resolve => {
    const overlay = els.feedbackOverlay;
    const content = els.feedbackContent;

    overlay.classList.add('active');
    content.innerHTML = `
      <div class="quiz-result">
        <div class="fb-emoji fb-mega-spin">🎉</div>
        <div class="fb-text" style="color:var(--monster-yellow);">クイズたっせい！</div>
        <div class="fb-text" style="font-size:1rem;animation-delay:0.5s;">
          ${QUIZ_TOTAL}もん ぜんぶ できたよ！
        </div>
        <div style="font-size:3rem;margin-top:8px;">💯</div>
      </div>
    `;

    setTimeout(() => { overlay.classList.remove('active'); resolve(); }, 3000);
  });
}

// ===== ステータス画面 =====
function renderStatusScreen() {
  const stage = getMonsterStage();

  if (els.statusMonster) els.statusMonster.textContent = `${stage.emoji} ${stage.name}`;
  if (els.statusLevel) els.statusLevel.textContent = `Lv.${gameData.level} ${getLevelTitle()}`;
  if (els.statusTotal) els.statusTotal.textContent = `${gameData.totalCleared}もじ`;
  if (els.statusBestStreak) els.statusBestStreak.textContent = `${gameData.bestStreak}れんぞく`;

  // 文字マスタリーグリッド
  if (els.statusGrid) {
    els.statusGrid.innerHTML = '';
    const allChars = getAllChars();
    allChars.forEach(c => {
      const cell = document.createElement('div');
      cell.className = 'mastery-cell';
      const count = gameData.mastered[c] || 0;
      if (count >= 3) cell.classList.add('mastery-3');
      else if (count >= 2) cell.classList.add('mastery-2');
      else if (count >= 1) cell.classList.add('mastery-1');
      cell.innerHTML = `<span class="mastery-char">${c}</span>`;
      els.statusGrid.appendChild(cell);
    });
  }
}

// ===== Init =====
setupMenu();
