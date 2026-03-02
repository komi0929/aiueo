/**
 * ストロークエンジン - 描画判定の中核
 * charToCanvas() で文字空間座標をキャンバス座標に変換して判定する。
 * 当たり判定は寛容、書き順・方向は厳格。
 */
import { HIRAGANA_STROKES, interpolateStroke, charToCanvas, measureCharBounds } from './hiragana-data.js';

export class StrokeEngine {
  constructor(canvas, callbacks, level = 'beginner') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;
    this.level = level;

    // 当たり判定の許容範囲（正規化座標での距離）
    // 子供向けなので寛容に設定
    this.toleranceMap = {
      beginner: 0.35,
      intermediate: 0.28,
      advanced: 0.22
    };

    this.currentChar = null;
    this.strokeData = [];
    this.currentStrokeIndex = 0;
    this.isDrawing = false;
    this.userPath = [];
    this.completedStrokes = [];
    this.missAnimating = false;
    this.locked = false;  // onCharComplete後の入力ロック

    this._setupEvents();
  }

  setChar(char) {
    this.currentChar = char;
    const data = HIRAGANA_STROKES[char];
    if (!data) return;

    // 実際のフォント境界を取得して正確な座標変換
    const rect = this.canvas.getBoundingClientRect();
    const fontSize = Math.min(rect.width, rect.height) * 0.75;
    const fontStr = `600 ${fontSize}px "Klee One", serif`;
    const bounds = measureCharBounds(char, fontStr, rect.width, rect.height);
    this.strokeData = data.strokes.map(stroke =>
      stroke.map(pt => {
        const { x, y } = charToCanvas(pt[0], pt[1], bounds);
        // 正規化座標に変換（描画エリア内の相対位置）
        return [x / rect.width, y / rect.height];
      })
    );
    this._rawStrokes = data.strokes;

    this.currentStrokeIndex = 0;
    this.completedStrokes = [];
    this.userPath = [];
    this.locked = false;  // ロック解除
    this.clearCanvas();
  }

  recomputeStrokeData() {
    if (!this._rawStrokes || !this.currentChar) return;
    const rect = this.canvas.getBoundingClientRect();
    const fontSize = Math.min(rect.width, rect.height) * 0.75;
    const fontStr = `600 ${fontSize}px "Klee One", serif`;
    const bounds = measureCharBounds(this.currentChar, fontStr, rect.width, rect.height);
    this.strokeData = this._rawStrokes.map(stroke =>
      stroke.map(pt => {
        const { x, y } = charToCanvas(pt[0], pt[1], bounds);
        return [x / rect.width, y / rect.height];
      })
    );
  }

  clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._redrawCompletedStrokes();
  }

  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  reset() {
    this.currentStrokeIndex = 0;
    this.completedStrokes = [];
    this.userPath = [];
    this.isDrawing = false;
    this.clearCanvas();
  }

  _setupEvents() {
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const touch = e.touches ? e.touches[0] : e;
      return {
        x: (touch.clientX - rect.left) / rect.width,
        y: (touch.clientY - rect.top) / rect.height
      };
    };

    const onStart = (e) => {
      e.preventDefault();
      e.stopPropagation();  // スワイプハンドラへの伝播を遮断
      if (this.locked || this.missAnimating) return;
      if (this.currentStrokeIndex >= this.strokeData.length) return;
      this.isDrawing = true;
      this.userPath = [];
      const pos = getPos(e);
      this.userPath.push(pos);
    };

    const onMove = (e) => {
      e.preventDefault();
      e.stopPropagation();  // スワイプハンドラへの伝播を遮断
      if (!this.isDrawing || this.locked || this.missAnimating) return;
      const pos = getPos(e);
      this.userPath.push(pos);
      this._drawUserStroke();
      // リアルタイム逸脱チェックは無効化（子供向けなので位置エラーを出さない）
    };

    const onEnd = (e) => {
      e.preventDefault();
      e.stopPropagation();  // スワイプハンドラへの伝播を遮断
      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (this.userPath.length < 3) {
        // 短すぎるストロークは無視（タップミス等）
        this.userPath = [];
        this.clearCanvas();
        return;
      }

      // ストローク完了判定
      if (this._validateStroke()) {
        this.completedStrokes.push([...this.userPath]);
        this.currentStrokeIndex++;
        this.userPath = [];

        if (this.currentStrokeIndex >= this.strokeData.length) {
          this.locked = true;  // 次のsetCharまで入力ブロック
          this._redrawCompletedStrokes();
          this.callbacks.onCharComplete?.();
        } else {
          this._redrawCompletedStrokes();
          this.callbacks.onStrokeComplete?.(this.currentStrokeIndex);
        }
      } else {
        this._triggerMiss();
      }
    };

    this.canvas.addEventListener('touchstart', onStart, { passive: false });
    this.canvas.addEventListener('touchmove', onMove, { passive: false });
    this.canvas.addEventListener('touchend', onEnd, { passive: false });
    this.canvas.addEventListener('mousedown', onStart);
    this.canvas.addEventListener('mousemove', onMove);
    this.canvas.addEventListener('mouseup', onEnd);
    this.canvas.addEventListener('mouseleave', onEnd);
  }

  /**
   * ストローク完了時の判定（4段階検証）
   * 1. 開始点が期待位置の近くか
   * 2. 終了点が期待位置の近くか
   * 3. ウェイポイントを順番に通過しているか
   * 4. 全体の方向が正しいか
   */
  _validateStroke() {
    if (this.currentStrokeIndex >= this.strokeData.length) return false;
    if (this.userPath.length < 3) return false;

    const stroke = this.strokeData[this.currentStrokeIndex];
    const tolerance = this.toleranceMap[this.level] || 0.35;
    const userStart = this.userPath[0];
    const userEnd = this.userPath[this.userPath.length - 1];

    // === 1. 開始点チェック ===
    const startDist = this._dist(userStart, stroke[0]);
    if (startDist > tolerance) return false;

    // === 2. 終了点チェック ===
    const endDist = this._dist(userEnd, stroke[stroke.length - 1]);
    if (endDist > tolerance * 1.2) return false;

    // === 3. ウェイポイント順通過チェック ===
    // ストロークの各ウェイポイントに対して、ユーザーパスのどのインデックスが最も近いかを求める
    // インデックスが単調増加（順番通り）であればOK
    if (stroke.length >= 3) {
      const wpTolerance = tolerance * 1.5;
      let lastMatchIdx = -1;
      let passedCount = 0;

      for (let wi = 1; wi < stroke.length - 1; wi++) {
        const wp = stroke[wi];
        let bestDist = Infinity;
        let bestIdx = -1;

        for (let ui = 0; ui < this.userPath.length; ui++) {
          const d = this._dist(this.userPath[ui], wp);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = ui;
          }
        }

        if (bestDist < wpTolerance && bestIdx > lastMatchIdx) {
          lastMatchIdx = bestIdx;
          passedCount++;
        }
      }

      // 中間ウェイポイントの少なくとも40%を順番通りに通過していること
      const middleWPs = stroke.length - 2;
      if (middleWPs > 0 && passedCount < Math.max(1, Math.ceil(middleWPs * 0.4))) {
        return false;
      }
    }

    // === 4. 全体方向チェック ===
    // ストロークの全体的な移動方向がユーザーパスと一致しているか
    const expectedDx = stroke[stroke.length - 1][0] - stroke[0][0];
    const expectedDy = stroke[stroke.length - 1][1] - stroke[0][1];
    const userDx = userEnd.x - userStart.x;
    const userDy = userEnd.y - userStart.y;

    // 期待方向が十分な長さを持つ場合のみ方向チェック
    const expectedLen = Math.sqrt(expectedDx * expectedDx + expectedDy * expectedDy);
    if (expectedLen > 0.08) {
      // 内積で方向の一致度を確認（cosθ > 0 = 大まかに同じ方向）
      const dot = expectedDx * userDx + expectedDy * userDy;
      if (dot < 0) return false;  // 逆方向は不合格
    }

    return true;
  }

  /**
   * リアルタイムの逸脱チェック: 現在の描画位置がストロークエリア内か
   */
  _isInStrokeArea(pos) {
    if (this.currentStrokeIndex >= this.strokeData.length) return true;
    const stroke = this.strokeData[this.currentStrokeIndex];
    const tolerance = this.toleranceMap[this.level] || 0.22;

    // ストロークの任意のポイントとの最短距離を計算
    let minDist = Infinity;
    for (const pt of stroke) {
      const d = this._dist(pos, pt);
      if (d < minDist) minDist = d;
    }

    // 補間ポイントもチェック
    const interpolated = interpolateStroke(stroke, 20);
    for (const pt of interpolated) {
      const d = this._dist(pos, pt);
      if (d < minDist) minDist = d;
    }

    return minDist < tolerance * 2.0;
  }

  _dist(userPt, dataPt) {
    const dx = userPt.x - dataPt[0];
    const dy = userPt.y - dataPt[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  _triggerMiss() {
    this.isDrawing = false;
    this.missAnimating = true;
    setTimeout(() => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this._redrawCompletedStrokes();
      this.userPath = [];
      this.missAnimating = false;
      this.callbacks.onMiss?.();
    }, 100);
  }

  _drawUserStroke() {
    const w = this.canvas.getBoundingClientRect().width;
    const h = this.canvas.getBoundingClientRect().height;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._redrawCompletedStrokes();

    if (this.userPath.length < 2) return;
    this.ctx.beginPath();
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = Math.max(w * 0.055, 7);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.moveTo(this.userPath[0].x * w, this.userPath[0].y * h);
    for (let i = 1; i < this.userPath.length; i++) {
      this.ctx.lineTo(this.userPath[i].x * w, this.userPath[i].y * h);
    }
    this.ctx.stroke();
  }

  _redrawCompletedStrokes() {
    const w = this.canvas.getBoundingClientRect().width;
    const h = this.canvas.getBoundingClientRect().height;
    this.completedStrokes.forEach(path => {
      if (path.length < 2) return;
      this.ctx.beginPath();
      this.ctx.strokeStyle = '#333';
      this.ctx.lineWidth = Math.max(w * 0.055, 7);
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.moveTo(path[0].x * w, path[0].y * h);
      for (let i = 1; i < path.length; i++) {
        this.ctx.lineTo(path[i].x * w, path[i].y * h);
      }
      this.ctx.stroke();
    });
  }

  destroy() {}
}
