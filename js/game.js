/**
 * 游戏画布渲染（p5.js 全局模式）
 * 目前只负责：中心大圆盘 + 外围 8 个判定点。
 * 音符、判定、分数等逻辑由后续模块实现。
 */

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------
let gameStarted = false;

// ---------------------------------------------------------------------------
// 尺寸常量（每帧根据画布尺寸重新计算）
// ---------------------------------------------------------------------------
let discRadius;   // 中心圆盘半径 = min(width, height) * 0.30
let judgeRadius;  // 判定圈半径 = min(width, height) * 0.45（8 个点所在的圈）

// ---------------------------------------------------------------------------
// p5 生命周期
// ---------------------------------------------------------------------------
function setup() {
  createCanvas(windowWidth, windowHeight);
}

function draw() {
  background(11, 11, 20); // --bg #0b0b14
  discRadius = min(width, height) * 0.30;
  judgeRadius = min(width, height) * 0.45;

  if (!gameStarted) return; // 未开始时只留背景

  drawDisc();
  drawJudgePoints();
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
// 游戏初始化入口（由 main.js 在点击「开始游戏」时调用）
// ---------------------------------------------------------------------------
function startGame() {
  gameStarted = true;
}
