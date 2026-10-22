/**
 * 游戏画布渲染（p5.js 全局模式）
 * 目前负责：中心大圆盘 + 外围 8 个判定点 + 音符（tap / hold / star）。
 * 判定、分数、音效等逻辑由后续模块实现。
 */

// ---------------------------------------------------------------------------
// 音符颜色常量（全部为红/黄，靠形状区分）
// ---------------------------------------------------------------------------
const TAP_COLOR = '#ff3b6b';   // 红：点击音符（--accent）
const HOLD_COLOR = '#ffd54a';  // 黄：长按音符（--hold）
const STAR_COLOR = '#ffd54a';  // 黄：星星滑动音符（与 hold 同色，靠形状区分）

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------
let gameStarted = false;

let notes = [];                     // 存放所有音符
const BPM = 120;                    // 节拍速度，后续可连设置
const NOTE_TRAVEL_TIME = 2000;      // tap/hold 从圆心到判定圈的毫秒数
const STAR_TRAVEL_TIME = 1500;      // star 从一个判定点滑到相邻判定点的毫秒数
const HOLD_LENGTH = 90;             // 长按胶囊长度（像素；后续可改成按住时长换算）
let nextSpawnTime = 0;              // 下一个音符的生成时刻（p5 millis()）

// ---------------------------------------------------------------------------
// 尺寸常量（每帧根据画布尺寸重新计算）
// ---------------------------------------------------------------------------
let discRadius;   // 中心圆盘半径 = min(width, height) * 0.30
let judgeRadius;  // 判定圈半径 = min(width, height) * 0.45（8 个点所在的圈）
// ---------------------------------------------------------------------------
// p5 生命周期
// ---------------------------------------------------------------------------
function setup() {
  createCanvas(windowWidth, windowHeight).parent('game');
}

function draw() {
  background(11, 11, 20); // --bg #0b0b14
  discRadius = min(width, height) * 0.30;
  judgeRadius = min(width, height) * 0.45;

  if (!gameStarted) return; // 未开始时只留背景

  drawDisc();
  drawJudgePoints();

  updateNotes();
  drawNotes();
}

/** 窗口缩放：让画布跟随视口尺寸 */
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

/**
 * 75% 不透明的黄色（alpha 191），用于 hold 连接条与 star 箭头轨道。
 * 返回 p5 颜色对象，直接传给 stroke()/fill() 使用。
 */
function yellow75() {
  const c = color(HOLD_COLOR); // 黄 #ffd54a
  c.setAlpha(191);             // 191 ≈ 75%
  return c;
}
// ---------------------------------------------------------------------------
// 绘制：中心圆盘
// ---------------------------------------------------------------------------
function drawDisc() {
  push();
  translate(width / 2, height / 2); // 圆心对齐到画面中心

  // 大圆盘描边（青色 --cyan #00d4ff）
  noFill();
  stroke(0, 212, 255, 255); // --cyan
  strokeWeight(2);
  circle(0, 0, discRadius * 2);

  // 内部装饰用小同心圆（半透明描边）
  noFill();
  stroke(0, 212, 255, 70); // --cyan 半透明
  strokeWeight(1.5);
  circle(0, 0, discRadius * 1.4);

  pop();
}
// ---------------------------------------------------------------------------
// 绘制：外围 8 个判定点（白色小空心圆环）
// ---------------------------------------------------------------------------
function drawJudgePoints() {
  for (let i = 0; i < 8; i++) {
    // 第 0 个点在正上方，之后顺时针排布（位置公式不变）
    const angle = i * TWO_PI / 8 - PI / 2;
    const x = width / 2 + cos(angle) * judgeRadius;
    const y = height / 2 + sin(angle) * judgeRadius;

    push();

    // 白色空心圆环：直径 16px，线宽 2px
    noFill();
    stroke(255, 255, 255, 200);
    strokeWeight(2);
    circle(x, y, 16);

    pop();
  }
}

// ---------------------------------------------------------------------------
// 音符系统：生成 / 更新 / 绘制
// ---------------------------------------------------------------------------

/**
 * 生成一个音符：
 * - tap / hold：从圆心出发，随机 8 个方向之一
 * - star：沿判定圈从一个判定点滑向相邻判定点（顺/逆时针随机）
 */
function spawnNote() {
  const type = random(['tap', 'tap', 'tap', 'hold', 'star']);

  if (type === 'star') {
    notes.push({
      type: 'star',
      startAngle: floor(random(8)),          // 起始判定点 0~7
      direction: random() < 0.5 ? 1 : -1,    // 1 顺时针，-1 逆时针
      spawnTime: millis(),
      progress: 0,
    });
  } else {
    notes.push({
      type: type,                            // 'tap' | 'hold'
      angle: floor(random(8)),               // 0~7，8 个方向之一
      spawnTime: millis(),
      progress: 0,
    });
  }
}

/**
 * 更新音符：按节拍生成新音符，推进移动进度，
 * 到达终点（progress >= 1）的音符先移除（判定逻辑留给后续模块）。
 */
function updateNotes() {
  const now = millis();

  // 生成：每隔一拍（60000 / BPM 毫秒）生成一个
  if (now >= nextSpawnTime) {
    spawnNote();
    nextSpawnTime += 60000 / BPM;
  }

  // 更新 / 移除：倒序便于 splice
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const travel = n.type === 'star' ? STAR_TRAVEL_TIME : NOTE_TRAVEL_TIME;
    const progress = (now - n.spawnTime) / travel;

    if (progress >= 1) {
      // 已到达终点，先移除
      notes.splice(i, 1);
      continue;
    }

    n.progress = progress;
  }
}

/**
 * 绘制音符：
 * - tap：红色空心圆环，从圆心向外移动
 * - hold：黄色胶囊条（圆头粗线），头部在外、尾部在内
 * - star：黄色圆润大星 + 沿判定圈的箭头轨道
 */
function drawNotes() {
  for (const n of notes) {
    if (n.type === 'star') {
      drawStarNote(n);
      continue;
    }

    if (n.type === 'hold') {
      drawHoldNote(n);
      continue;
    }

    // tap：从圆心沿指定方向向外移动
    const ang = n.angle * TWO_PI / 8 - PI / 2;
    const r = n.progress * judgeRadius;
    const x = width / 2 + cos(ang) * r;
    const y = height / 2 + sin(ang) * r;

    push();
    // 红色空心圆环：线宽 6px，直径 34px
    noFill();
    stroke(TAP_COLOR); // 红 #ff3b6b
    strokeWeight(6);
    circle(x, y, 34);
    pop();
  }
}

/**
 * hold 音符：两端中空圆环（与 tap 同尺寸）+ 中间 75% 半透明黄色连接条。
 * 先画半透明连接条，再画两端不透明圆环 → 两端实色、中间半透明。
 */
function drawHoldNote(n) {
  const ang = n.angle * TWO_PI / 8 - PI / 2;

  // 头部半径在外，尾部半径在内（不小于 0）
  const headR = n.progress * judgeRadius;
  const tailR = max(0, headR - HOLD_LENGTH);

  const headX = width / 2 + cos(ang) * headR;
  const headY = height / 2 + sin(ang) * headR;
  const tailX = width / 2 + cos(ang) * tailR;
  const tailY = height / 2 + sin(ang) * tailR;

  push();

  // 1) 中间连接：75% 黄色粗条连接两个圆心
  strokeCap(ROUND);
  stroke(yellow75()); // 黄 75%（alpha 191）
  strokeWeight(24);
  line(tailX, tailY, headX, headY);

  // 2) 两端：不透明黄色中空圆环（直径 34px、线宽 6px，与 tap 同尺寸）
  noFill();
  stroke(HOLD_COLOR); // 黄 #ffd54a
  strokeWeight(6);
  circle(headX, headY, 34);
  circle(tailX, tailY, 34);

  pop();
}

/**
 * star 音符：先画判定圈上的箭头轨道（指出滑动方向），再画圆润大星本体。
 */
function drawStarNote(n) {
  const startAngle = n.startAngle;
  const direction = n.direction;

  // ---- 箭头轨道：startAngle → endAngle 之间等距 5 个圆角 chevron ----
  push();
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);
  stroke(yellow75()); // 黄 75%（alpha 191）
  strokeWeight(6);

  const arrows = 5;
  const armLen = 16; // 两条短线各约 16px
  for (let k = 0; k < arrows; k++) {
    const t = (k + 0.5) / arrows;
    const angIndex = startAngle + direction * t;
    const angRad = angIndex * TWO_PI / 8 - PI / 2;
    const x = width / 2 + cos(angRad) * judgeRadius;
    const y = height / 2 + sin(angRad) * judgeRadius;

    // 切线方向（沿圆弧的移动方向）
    const tangent = angRad + (direction > 0 ? HALF_PI : -HALF_PI);
    const tx = cos(tangent);
    const ty = sin(tangent);

    // 「>」chevron：从尖端向后张开的两条短线
    const backX = x - tx * armLen;
    const backY = y - ty * armLen;
    const wingX = -ty * armLen * 0.75;
    const wingY = tx * armLen * 0.75;

    line(x, y, backX + wingX, backY + wingY);
    line(x, y, backX - wingX, backY - wingY);
  }
  pop();

  // ---- 星星本体 ----
  const angIndex = startAngle + direction * n.progress;
  const angRad = angIndex * TWO_PI / 8 - PI / 2;
  const x = width / 2 + cos(angRad) * judgeRadius;
  const y = height / 2 + sin(angRad) * judgeRadius;

  drawStar(x, y, 26, 11);
}

/**
 * 在 (cx, cy) 处画一个圆角大五角星（外接半径 outerR、内接半径 innerR）。
 * 用 10 个顶点组成星形，再用同色粗描边（strokeJoin ROUND）把尖角磨圆。
 */
function drawStar(cx, cy, outerR, innerR) {
  push();
  translate(cx, cy);

  fill(STAR_COLOR);           // 黄 #ffd54a
  stroke(STAR_COLOR);         // 描边与填充同色 → 尖角变圆润
  strokeWeight(8);
  strokeJoin(ROUND);
  strokeCap(ROUND);

  beginShape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    // -PI/2 让第一个尖角朝正上方
    const a = i * PI / 5 - PI / 2;
    vertex(cos(a) * r, sin(a) * r);
  }
  endShape(CLOSE);

  pop();
}

// ---------------------------------------------------------------------------
// 游戏初始化入口（由 main.js 在点击「开始游戏」时调用）
// ---------------------------------------------------------------------------
function startGame() {
  gameStarted = true;

  // 重置音符状态，保证每局从头开始
  notes = [];
  nextSpawnTime = millis();
}

