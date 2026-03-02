/**
 * AnimCJK graphicsJaKana.txt から46文字のひらがなストロークデータを抽出し、
 * hiragana-data.js を再生成するスクリプト
 * 
 * graphicsJaKana.txt のフォーマット: 1行1文字のJSON
 * 各文字は { character, strokes, medians } を持つ
 * medians は [[x,y], [x,y], ...] の配列の配列（各配列が1ストローク）
 * 座標系: AnimCJK SVG は viewBox="0 0 1024 1024" (ただしY軸は反転している場合あり)
 * 
 * 注意: AnimCJK の座標系では Y=0 がベースラインで上に行くほど正
 *       我々のアプリでは Y=0 が上端で下に行くほど正（CSS座標系）
 *       → Y座標を反転する必要がある: normalized_y = 1 - (animCJK_y / 900)
 *       AnimCJK は -100 to 900 の範囲を使う(base ~900, top ~-100)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TARGET_CHARS = [
  'あ','い','う','え','お',
  'か','き','く','け','こ',
  'さ','し','す','せ','そ',
  'た','ち','つ','て','と',
  'な','に','ぬ','ね','の',
  'は','ひ','ふ','へ','ほ',
  'ま','み','む','め','も',
  'や','ゆ','よ',
  'ら','り','る','れ','ろ',
  'わ','を','ん'
];

// 正確なひらがな画数（文部科学省の学習指導要領準拠）
const EXPECTED_STROKES = {
  'あ': 3, 'い': 2, 'う': 2, 'え': 2, 'お': 3,
  'か': 3, 'き': 4, 'く': 1, 'け': 3, 'こ': 2,
  'さ': 3, 'し': 1, 'す': 2, 'せ': 3, 'そ': 1,
  'た': 4, 'ち': 2, 'つ': 1, 'て': 1, 'と': 2,
  'な': 4, 'に': 3, 'ぬ': 2, 'ね': 2, 'の': 1,
  'は': 3, 'ひ': 1, 'ふ': 4, 'へ': 1, 'ほ': 4,
  'ま': 3, 'み': 2, 'む': 3, 'め': 2, 'も': 3,
  'や': 3, 'ゆ': 2, 'よ': 2,
  'ら': 2, 'り': 2, 'る': 1, 'れ': 2, 'ろ': 1,
  'わ': 2, 'を': 3, 'ん': 1
};

// graphicsJaKana.txt を読み込み
const rawText = readFileSync(join(__dirname, 'graphicsJaKana.txt'), 'utf-8');
const lines = rawText.trim().split('\n');

// 各行をパースして文字→データのマップを作成
const charDataMap = {};
for (const line of lines) {
  try {
    const data = JSON.parse(line.trim());
    charDataMap[data.character] = data;
  } catch (e) {
    // skip invalid lines
  }
}

console.log(`Parsed ${Object.keys(charDataMap).length} characters from graphicsJaKana.txt`);

// AnimCJK座標から正規化座標(0-1)に変換
// AnimCJK: x は 0-1024, y は -100(top) to 900(bottom/baseline) のような範囲
// ただし実際のmedian座標を見ると:
//   「あ」の1画目: [[174,642],[251,592],[440,594],[697,659]]
//   x: 174-697 → 0.17-0.68 (1024ベース)
//   y: 592-659 → 反転が必要
//
// AnimCJKのSVGは viewBox="0 0 1024 1024" でYが下向き正
// しかし medians データは Y軸が Mathematical (上向き正)
// → Y座標を反転: canvas_y = 900 - animCJK_y (900がベースライン)
//
// 実測: 
//   「あ」1画目 y=642 → 上から 900-642=258 → norm: 258/900≈0.29 (横画は上部なのでOK)
//   「あ」2画目 start [331,763] → y=763 → 900-763=137 → norm: 137/900≈0.15 (縦画上端)
//
// X: 0-1024 → norm x = x/1024 (ただし右寄り/左寄りのオフセット考慮不要、そのまま)
// Y: medians の Y は「下がベースライン(0付近)、上端が850付近」
//   → ブラウザ座標: canvas_y = 900 - y → 0-1 range: (900 - y) / 900

function normalizeMedians(medians) {
  // AnimCJK の座標検証
  // medians は配列の配列: [[x1,y1],[x2,y2],...]
  // x: 0~1024, y: -50~900 (概ね)
  // 正規化: x/1024, (900-y)/900
  return medians.map(stroke => {
    // 各ストロークのポイントを正規化
    return stroke.map(([x, y]) => {
      // x: 0-1024 → 0-1
      const nx = Math.round((x / 1024) * 100) / 100;
      // y: AnimCJKは数学座標系（上が正）→ ブラウザ座標（下が正）に変換
      // 900がベースライン、0付近がキャップハイト上限
      const ny = Math.round(((900 - y) / 900) * 100) / 100;
      return [nx, ny];
    });
  });
}

// 46文字のデータを抽出
const results = {};
let missingChars = [];

for (const char of TARGET_CHARS) {
  const data = charDataMap[char];
  if (!data) {
    console.log(`  ${char}: NOT FOUND in data`);
    missingChars.push(char);
    continue;
  }
  
  // medians からストロークデータを取得
  const medians = data.medians;
  const expectedCount = EXPECTED_STROKES[char];
  
  // 負の座標を持つストローク（実体のないダミー）を除外
  // AnimCJK では合成ストローク用のダミーmedian（開始座標が負のもの）がある
  // 例: 「お」stroke 3 starts at [-170,458] → ダミー
  const validMedians = medians.filter(stroke => {
    if (stroke.length === 0) return false;
    const [x, y] = stroke[0];
    if (x < -50 || y < -100) return false;
    return true;
  });
  
  // 期待される画数に合わせて先頭からN個を取得
  // AnimCJK は同じストロークの複数パスを別medianとして持つ場合がある
  // (例: ね, す, の などの折れ曲がるストローク)
  let finalMedians;
  if (validMedians.length > expectedCount) {
    // 重複を除去: 同じ開始座標を持つものは除外
    const seen = new Set();
    const deduped = [];
    for (const stroke of validMedians) {
      const key = `${stroke[0][0]},${stroke[0][1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(stroke);
      }
    }
    finalMedians = deduped.slice(0, expectedCount);
  } else {
    finalMedians = validMedians.slice(0, expectedCount);
  }
  
  const normalized = normalizeMedians(finalMedians);
  
  results[char] = {
    strokeCount: normalized.length,
    strokes: normalized
  };
  
  const match = normalized.length === expectedCount ? '✓' : '✗';
  console.log(`  ${char}: ${normalized.length}/${expectedCount} strokes ${match}`);
  normalized.forEach((stroke, i) => {
    const start = stroke[0];
    console.log(`    ${i+1}画: start=[${start.join(', ')}] points=${stroke.length}`);
  });
}

if (missingChars.length > 0) {
  console.log(`\nMissing characters: ${missingChars.join(', ')}`);
}

// hiragana-data.js を生成
console.log('\n\nGenerating hiragana-data.js...');

let output = `// ひらがなストロークデータ
// AnimCJK (https://github.com/parsimonhi/animCJK) のmedianデータを基に生成
// 座標系: [x, y] で 0.0-1.0 の正規化座標
// x: 左端=0, 右端=1
// y: 上端=0, 下端=1
// 各ストロークは始点→経由点の配列

export const HIRAGANA_STROKES = {
`;

for (const char of TARGET_CHARS) {
  const data = results[char];
  if (!data) {
    output += `  // '${char}': DATA MISSING\n`;
    continue;
  }
  
  output += `  '${char}': {\n`;
  output += `    strokes: [\n`;
  data.strokes.forEach((stroke, i) => {
    const pts = stroke.map(p => `[${p.join(', ')}]`).join(', ');
    output += `      [${pts}]${i < data.strokes.length - 1 ? ',' : ''}\n`;
  });
  output += `    ]\n`;
  output += `  },\n`;
}

output += `};

// 文字をキャンバス座標に変換するユーティリティ
export function measureCharBounds(char, font, canvasSize) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';

  const metrics = ctx.measureText(char);
  const ascent = metrics.actualBoundingBoxAscent || canvasSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || canvasSize * 0.1;
  const width = metrics.width;

  // キャンバス中央に配置した場合の描画位置
  const textX = (canvasSize - width) / 2;
  const textY = (canvasSize + ascent - descent) / 2;

  return {
    x: textX,
    y: textY - ascent,
    w: width,
    h: ascent + descent,
    textX,
    textY
  };
}

// 正規化座標 [0-1] → キャンバスピクセル座標に変換
export function charToCanvas(normX, normY, bounds) {
  return {
    x: bounds.x + normX * bounds.w,
    y: bounds.y + normY * bounds.h
  };
}
`;

writeFileSync(join(__dirname, 'src', 'hiragana-data.js'), output);
console.log('✅ src/hiragana-data.js generated successfully!');
console.log(`   Total characters: ${Object.keys(results).length}`);
