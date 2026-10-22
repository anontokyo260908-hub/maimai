/**
 * 游戏画布渲染（p5.js 全局模式）
 * 目前负责：中心大圆盘 + 外围 8 个判定点 + 从圆心向外移动的音符。
 * 判定、分数、音效等逻辑由后续模块实现。
 */

// ---------------------------------------------------------------------------
// 音符颜色常量
// ---------------------------------------------------------------------------
const TAP_COLOR = '#ff3b6b';   // 红：点击音符（--accent）
const HOLD_COLOR = '#ffd54a';  // 黄：长按音符（--hold）
const SLIDE_COLOR = '#c58bff'; // 紫：星星滑动音符（--star）
// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------
let gameStarted = false;

let notes = [];                  // 存放所有音符
const BPM = 120;                 // 节拍速度，后续可连设置
const NOTE_TRAVEL_TIME = 2000;   // 音符从圆心到判定圈用时（毫秒），后续连流速设置
let nextSpawnTime = 0;           // 下一个音符的生成时刻（p5 millis()）
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
// 绘制：外围 8 个判定点
// ---------------------------------------------------------------------------
function drawJudgePoints() {
  const pointSize = 30;

  for (let i = 0; i < 8; i++) {
    // 第 0 个点在正上方，之后顺时针排布
    const angle = i * TWO_PI / 8 - PI / 2;
    const x = width / 2 + cos(angle) * judgeRadius;
    const y = height / 2 + sin(angle) * judgeRadius;

    push();

    // 半透明描边一圈
    noFill();
    stroke(255, 59, 107, 90); // --accent #ff3b6b 半透明
    strokeWeight(3);
    circle(x, y, pointSize + 10);

    // 实心圆点（品红 --accent #ff3b6b）
    noStroke();
    fill(255, 59, 107); // --accent
    circle(x, y, pointSize);

    pop();
}
}

// ---------------------------------------------------------------------------
// 音符系统：生成 / 更新 / 绘制
// ---------------------------------------------------------------------------

/**
 * 生成一个音符：类型随机（tap 概率更高），方向为 8 个之一。
 */
function spawnNote() {
  notes.push({
    type: random(['tap', 'tap', 'tap', 'hold', 'slide']),
    angle: floor(random(8)), // 0~7，代表 8 个方向之一
    spawnTime: millis(),     // 生成时刻
    progress: 0,             // 移动进度 0~1
  });
}

/**
 * 更新音符：按节拍生成新音符，推进已有音符的移动进度，
 * 到达判定圈（progress >= 1）的音符先移除（判定逻辑留给后续模块）。
 */
function updateNotes() {
  const now = millis();

  // 生成：每隔一拍（60000 / BPM 毫秒）生成一个
  if (now >= nextSpawnTime) {
    spawnNote();
    nextSpawnTime = now + 60000 / BPM;
  }

  // 移动 / 移除：倒序便于 splice
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const progress = (now - n.spawnTime) / NOTE_TRAVEL_TIME;

    if (progress >= 1) {
      // 已到达判定圈，先移除
      notes.splice(i, 1);
      continue;
    }

    n.progress = progress;
  }
}

/**
 * 绘制音符：从圆心沿各自方向向外移动。
 */
function drawNotes() {
  push();
  translate(width / 2, height / 2); // 以圆心为原点

  for (const n of notes) {
    const ang = n.angle * TWO_PI / 8 - PI / 2; // 0 号在正上方，顺时针
    const r = n.progress * judgeRadius;
    const x = cos(ang) * r;
    const y = sin(ang) * r;

    push();
    translate(x, y);

    if (n.type === 'tap') {
      // 点击音符：实心圆 + 白色半透明描边
      stroke(255, 255, 255, 140);
      strokeWeight(2);
      fill(TAP_COLOR); // 红 #ff3b6b
      circle(0, 0, 26);
    } else if (n.type === 'hold') {
      // 长按音符：空心圆环
      noFill();
      stroke(HOLD_COLOR); // 黄 #ffd54a
      strokeWeight(6);
      circle(0, 0, 30);
    } else {
      // 星星滑动音符：菱形近似
      noStroke();
      fill(SLIDE_COLOR); // 紫 #c58bff
      const s = 9; // 菱形半对角线
      quad(0, -s, s, 0, 0, s, -s, 0);
    }

    pop();
  }

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

