/**
 * ガイドレンダラー - フォントベース + measureCharBounds精密座標変換
 * ピクセルスナップは削除（別ストロークに吸着する逆効果のため）
 */
import { HIRAGANA_STROKES, charToCanvas, measureCharBounds } from './hiragana-data.js';

export class GuideRenderer {
  constructor(guideCanvas) {
    this.canvas = guideCanvas;
    this.ctx = guideCanvas.getContext('2d');
    this._waitForFont();
  }

  async _waitForFont() {
    try { await document.fonts.load('600 48px "Klee One"'); } catch {}
  }

  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(char, level, currentStrokeIndex = 0) {
    this.clear();
    const w = this.canvas.getBoundingClientRect().width;
    const h = this.canvas.getBoundingClientRect().height;
    switch (level) {
      case 'beginner': this._renderBeginner(char, w, h, currentStrokeIndex); break;
      case 'intermediate': this._renderIntermediate(char, w, h); break;
      case 'advanced': this._renderAdvanced(char, w, h); break;
    }
  }

  _renderBeginner(char, w, h, currentStrokeIndex) {
    const fontSize = Math.min(w, h) * 0.75;
    const fontStr = `600 ${fontSize}px "Klee One", serif`;
    this.ctx.font = fontStr;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = 'rgba(200, 200, 220, 0.35)';
    this.ctx.fillText(char, w * 0.5, h * 0.48);

    const bounds = measureCharBounds(char, fontStr, w, h);
    const data = HIRAGANA_STROKES[char];
    if (!data) return;

    const R = 10; // 番号円の半径

    data.strokes.forEach((stroke, idx) => {
      const start = charToCanvas(stroke[0][0], stroke[0][1], bounds);

      // 番号を開始点の左上に配置
      const numX = start.x - R - 2;
      const numY = start.y - R - 2;

      // 番号の円を描画
      this.ctx.beginPath();
      if (idx < currentStrokeIndex) {
        this.ctx.fillStyle = 'rgba(150, 220, 150, 0.7)';
      } else if (idx === currentStrokeIndex) {
        this.ctx.fillStyle = '#FF6B9D';
      } else {
        this.ctx.fillStyle = 'rgba(180, 180, 180, 0.6)';
      }
      this.ctx.arc(numX, numY, R, 0, Math.PI * 2);
      this.ctx.fill();

      // 番号テキスト
      this.ctx.fillStyle = 'white';
      this.ctx.font = 'bold 10px "Zen Maru Gothic", sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(String(idx + 1), numX, numY + 1);
    });
  }

  _renderIntermediate(char, w, h) {
    const fontSize = Math.min(w, h) * 0.75;
    this.ctx.font = `600 ${fontSize}px "Klee One", serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = 'rgba(200, 200, 200, 0.20)';
    this.ctx.fillText(char, w * 0.5, h * 0.48);
  }

  _renderAdvanced(char, w, h) {
    const data = HIRAGANA_STROKES[char];
    if (!data || data.strokes.length === 0) return;
    const fontSize = Math.min(w, h) * 0.75;
    const fontStr = `600 ${fontSize}px "Klee One", serif`;
    const bounds = measureCharBounds(char, fontStr, w, h);
    const start = charToCanvas(data.strokes[0][0][0], data.strokes[0][0][1], bounds);
    this.ctx.beginPath();
    this.ctx.fillStyle = 'rgba(255, 107, 157, 0.6)';
    this.ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.beginPath();
    this.ctx.strokeStyle = 'rgba(255, 107, 157, 0.3)';
    this.ctx.lineWidth = 2;
    this.ctx.arc(start.x, start.y, 16, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  destroy() { this.clear(); }
}
