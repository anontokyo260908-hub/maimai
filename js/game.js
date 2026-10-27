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
const HOLD_GRAY = '#8a90a0';   // 灰：长按没接住时的颜色
const ROTATION_OFFSET = -Math.PI / 8; // 逆时针 30°（即原来顺时针 15°，再逆时针 15°）
// ---------------------------------------------------------------------------
// 判定常量
// ---------------------------------------------------------------------------
const JUDGE_WINDOWS = { perfect: 100, great: 200, good: 320 }; // 判定时间窗(ms)，整体放宽
const JUDGE_COLORS = {
  perfect: '#ff3b6b', // 红
  great: '#ffd54a',   // 黄
  good: '#3ddc84',    // 绿
  miss: '#4a90e2',    // 蓝
};

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------
let gameStarted = false;
let paused = false;

let notes = [];                     // 存放所有音符
const BPM = 120;                    // 节拍速度，后续可连设置
const STARTUP_DELAY = 4 * 60000 / BPM; // 开局 4 拍倒计时后再出音符（也等手势模型就绪）
const NOTE_TRAVEL_TIME = 2000;      // tap/hold 从圆心到判定圈的毫秒数
const STAR_TRAVEL_TIME = 1500;      // star 从一个判定点滑到相邻判定点的毫秒数
const HOLD_LENGTH = 300;            // 长按胶囊长度（像素），决定长按时长：条越长按越久
const DOUBLE_CHANCE = 0.25;         // 出现「双压」的概率
let nextSpawnTime = 0;              // 下一个音符的生成时刻（p5 millis()）

let judgeCounts = { perfect: 0, great: 0, good: 0, miss: 0 }; // 各判定计数
let particles = [];                 // 命中星星散落粒子 {x,y,vx,vy,angle,spin,size,color,start}
let missEffects = [];               // miss 淡蓝圆环 {x, y, start}
let emptyEffects = [];              // 空判黄色波纹 {x, y, start}
let judgeOsc, judgeEnv;             // 判定音效
let tickOsc, tickEnv;               // 长按开始的短促「嗒」声（音量独立）
const HOLD_TICK_INTERVAL = 50;     // 长按「嗒」声重复间隔（毫秒）
let lastHoldTick = 0;               // 上次播放长按「嗒」声的时间
const TICK_BASE_FREQ = 5000;        // 长按「嗒」声基准频率
const TICK_VARIATION = 150;         // 每次随机上下浮动（Hz），让「嗒」声有细微音高变化
let song = null;                    // 背景歌曲
let songStarted = false;            // 歌曲是否已开始播放

// 分数与连击
let score = 0;
let combo = 0;
let maxCombo = 0;
let totalNotes = 30;                // 本局总音符数（测试用，后续换谱面）
let spawnedCount = 0;               // 已生成音符数
let gameEnded = false;              // 是否已结算（避免重复触发 endGame）

const SCORE_TABLE = { perfect: 1000, great: 500, good: 100 }; // 计分规则（miss 不加分）

// ---------------------------------------------------------------------------
// 手势引擎（MediaPipe Gesture Recognizer：识别「握拳/张开手掌」等手势）
// ---------------------------------------------------------------------------
const MP_VERSION = "0.10.21";
const MP_URLS = [
  `https://registry.npmmirror.com/@mediapipe/tasks-vision/${MP_VERSION}/files`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`,
];
const MODEL_URLS = [
  "gesture_recognizer.task",
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
];

let video, recognizer = null, hands = [], lastVideoTime = -1;
let lastPoseLog = 0; // 调试用：上次输出手势状态的时间

async function loadGestureRecognizer() {
  console.log('[手势] 开始加载手势模型…');
  for (const base of MP_URLS) {
    let vision, fileset;
    try {
      vision = await import(`${base}/vision_bundle.mjs`);
      fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
      console.log('[手势] vision bundle 加载成功：', base);
    } catch (e) {
      console.warn('[手势] CDN 加载失败：', base, e);
      continue;
    }
    for (const model of MODEL_URLS) {
      for (const delegate of ["GPU", "CPU"]) {
        try {
          recognizer = await vision.GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: model, delegate },
            runningMode: "VIDEO",
            numHands: 2,
          });
          console.log('[手势] 模型加载成功：', model, 'delegate=', delegate);
          return;
        } catch (e) {
          console.warn('[手势] 模型创建失败：', model, delegate, e);
        }
      }
    }
  }
  console.error('[手势] 手势模型加载全部失败！');
}

// 每一帧：向模型要最新的手势与 21 个手部关键点，换算成镜像后的画布像素坐标
function updateHands() {
  if (!recognizer || !video) return;
  if (video.elt.readyState < 2) return;
  if (video.elt.currentTime === lastVideoTime) return;
  lastVideoTime = video.elt.currentTime;

  const result = recognizer.recognizeForVideo(video.elt, performance.now());
  const sides = result.handedness || result.handednesses || [];
  hands = result.landmarks.map((lm, i) => {
    const best = (result.gestures[i] && result.gestures[i][0]) || { categoryName: "None", score: 0 };
    return {
      gesture: best.categoryName || "None",
      score: best.score,
      side: sides[i] && sides[i][0] ? sides[i][0].categoryName : "",
      points: lm.map((p) => ({ x: (1 - p.x) * width, y: p.y * height, z: p.z })),
    };
  });
}

// 手腕触发判定点的半径与状态
const TRIGGER_RADIUS = 165; // 手腕命中判定点的触发半径（像素），觉得难命中就调大
const PINCH_RATIO = 0.4;     // 捏合判定阈值：拇指-食指距离 / 手大小，小于此值算「捏合」
const RELEASE_RATIO = 0.8;   // 松开判定阈值：大于此值才算「完全张开」（长按才松手）
let fistState = {};                 // 每只手(side)当前是否处于「握拳」状态
let holdTracker = {};               // 每只手(side)正在长按的音符对象
const FIST_DEBOUNCE = 3;            // 连续多少帧认定手势切换（越小越灵敏，但太小说不定会抖动）
let fistFrames = {};                // 每只手(side)的连续帧状态 { fist, count }

// ---------------------------------------------------------------------------
// 尺寸常量（每帧根据画布尺寸重新计算）
// ---------------------------------------------------------------------------
let discRadius;   // 中心圆盘半径 = min(width, height) * 0.30
let judgeRadius;  // 判定圈半径 = min(width, height) * 0.38（8 个点所在的圈，比圆盘略外）
let centerX, centerY; // 圆盘中心（centerY 下移，让顶部判定点更容易够到）
let cameraAlpha = 255; // 摄像头背景透明度（0~255），默认完全显示
// ---------------------------------------------------------------------------
// p5 生命周期
// ---------------------------------------------------------------------------
function preload() {
  song = loadSound('assets/songs/song.mp3');
}

function setup() {
  createCanvas(windowWidth, windowHeight).parent('game');
  initSounds();
}

function draw() {
  background(11, 11, 20); // --bg #0b0b14
  discRadius = min(width, height) * 0.30;
  judgeRadius = min(width, height) * 0.38;
  centerX = width * 0.5;      // 水平居中
  centerY = height * 0.55;    // 垂直方向下移，让顶部判定点更好够

    if (!gameStarted) return; // 未开始时只留背景

    // 暂停：只重绘静止画面（不更新音符、不检测手势）
    if (paused) {
      drawDisc();
      drawJudgePoints();
      drawNotes();
      drawMissEffects();
      drawEmptyEffects();
      drawParticles();
      return;
    }

    drawDisc();
    drawJudgePoints();

    updateNotes();
    drawNotes();
    drawMissEffects();
    drawEmptyEffects();
    drawParticles();

    // 手势：更新手势 → 画手腕悬停特效 → 检测握拳命中（画在最上层）
    updateHands();
    drawHover();
    checkHandHits();

    // 长按期间持续「嗒」声（每 HOLD_TICK_INTERVAL 响一下）
    if (Object.keys(holdTracker).length > 0 && millis() - lastHoldTick > HOLD_TICK_INTERVAL) {
      lastHoldTick = millis();
      playHoldTick();
    }

    drawDebug(); // 调试：触发范围 + 手势名 + 把握度（正式版可移除）

    // 调试：每 2 秒输出一次手势状态
    if (millis() - lastPoseLog > 2000) {
      lastPoseLog = millis();
      console.log('[手势] 状态:', 'recognizer=', !!recognizer,
        'video就绪=', !!video && video.elt.readyState >= 2,
        '检测到手数=', hands.length);
    }

    // 歌曲播放完 → 结算
    if (!gameEnded && song && songStarted && song.currentTime() > 0.5 && !song.isPlaying()) {
      endGame();
    }
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
  translate(centerX, centerY); // 圆心对齐到画面中心

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
// 把摄像头画面镜像后铺满整个画布，作为游戏背景。
// 透明度由 cameraAlpha 控制，后续可接到设置里的「背景透明度」滑杆。
// ---------------------------------------------------------------------------
function drawCamera() {
  if (!video) return;
  push();
  translate(width, 0);
  scale(-1, 1);       // 镜像，让动作方向跟画面一致
  tint(255, cameraAlpha); // 透明度（0~255），默认 255 完全不透明
  image(video, 0, 0, width, height);
  pop();
}
// ---------------------------------------------------------------------------
// 绘制：外围 8 个判定点（白色小空心圆环）
// ---------------------------------------------------------------------------
function drawJudgePoints() {
  for (let i = 0; i < 8; i++) {
    // 第 0 个点在正上方，之后顺时针排布（位置公式不变）
    const angle = i * TWO_PI / 8 - PI / 2 + ROTATION_OFFSET;
    const x = centerX + cos(angle) * judgeRadius;
    const y = centerY + sin(angle) * judgeRadius;

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
  spawnedCount++;
  const spawnTime = millis();

  // 双压：一定概率生成一对同时到达、落在两个不同判定点的 tap
  if (random() < DOUBLE_CHANCE) {
    const a1 = floor(random(8));
    let a2 = floor(random(8));
    while (a2 === a1) a2 = floor(random(8)); // 确保两个点不同
    const hitTime = spawnTime + NOTE_TRAVEL_TIME;
    notes.push({ type: 'tap', angle: a1, targetAngle: a1, spawnTime: spawnTime, progress: 0, hitTime: hitTime, judged: false, isDouble: true });
    notes.push({ type: 'tap', angle: a2, targetAngle: a2, spawnTime: spawnTime, progress: 0, hitTime: hitTime, judged: false, isDouble: true });
    return;
  }

  const type = random(['tap', 'tap', 'tap', 'hold', 'star']);

  if (type === 'star') {
    const startAngle = floor(random(8));       // 起始判定点 0~7
    const direction = random() < 0.5 ? 1 : -1; // 1 顺时针，-1 逆时针

    notes.push({
      type: 'star',
      startAngle: startAngle,
      direction: direction,
      spawnTime: spawnTime,
      progress: 0,
      targetAngle: (startAngle + direction + 8) % 8,
      hitTime: spawnTime + STAR_TRAVEL_TIME,
      judged: false,
    });
  } else {
    const angle = floor(random(8)); // 0~7，8 个方向之一

    const note = {
      type: type, // 'tap' | 'hold'
      angle: angle,
      targetAngle: angle,
      spawnTime: spawnTime,
      progress: 0,
      hitTime: spawnTime + NOTE_TRAVEL_TIME,
      judged: false,
    };
    if (type === 'hold') {
      // 长按时长 = 条长度 × 音符速度（尾部通过判定点所需的时间）
      note.holdDuration = HOLD_LENGTH * NOTE_TRAVEL_TIME / max(judgeRadius, 1);
      note.holdEndTime = note.hitTime + note.holdDuration;
      note.holding = false;
      note.grayed = false;
      note.holdGrade = null;
    }
    notes.push(note);
  }
}

/**
 * 更新音符：按节拍生成新音符，推进移动进度，
 * 到达终点（progress >= 1）的音符先移除（判定逻辑留给后续模块）。
 */
function updateNotes() {
  const now = millis();

    // 生成：每隔一拍（60000 / BPM 毫秒）生成一个，直到生满 totalNotes
  if (now >= nextSpawnTime) {
    spawnNote();
    nextSpawnTime += 2 * 60000 / BPM; // 每 2 拍生成一个（测试期降低密度）
  }

  // 更新 / 移除：倒序便于 splice
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const travel = n.type === 'star' ? STAR_TRAVEL_TIME : NOTE_TRAVEL_TIME;
    const progress = (now - n.spawnTime) / travel;

    // 长按：整条持续向外移动，尾部通过判定点(holdEndTime)时结束
    if (n.type === 'hold') {
      if (n.holding) {
        n.progress = progress; // 正在长按，条继续走
        continue;
      }
      if (now > n.holdEndTime) {
        applyMiss(n);          // 尾部已通过还没完成 → miss
        continue;
      }
      if (!n.grayed && now > n.hitTime + JUDGE_WINDOWS.good) {
        n.grayed = true;       // 头部过了 good 窗没被接住 → 变灰
      }
      n.progress = progress;   // 灰色期间条继续走，等待补抓
      continue;
    }

    // tap/star：头部过了 good 窗未判 → miss
    if (!n.judged && now > n.hitTime + JUDGE_WINDOWS.good) {
      applyMiss(n);
      continue;
    }

    // 到达判定圈后停住（progress 上限为 1），等判定窗口结束
    n.progress = min(progress, 1);
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

    // tap：从圆心沿指定方向向外移动（双压时变黄提示）
    const ang = n.angle * TWO_PI / 8 - PI / 2 + ROTATION_OFFSET;
    const r = n.progress * judgeRadius;
    const x = centerX + cos(ang) * r;
    const y = centerY + sin(ang) * r;

    push();
    noFill();
    stroke(n.isDouble ? HOLD_COLOR : TAP_COLOR); // 双压黄、普通红
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
  const ang = n.angle * TWO_PI / 8 - PI / 2 + ROTATION_OFFSET;

  // 头部持续向外走，尾部保持固定间距跟在后面
  const headR = n.progress * judgeRadius;
  const tailR = max(0, headR - HOLD_LENGTH);

  const headX = centerX + cos(ang) * headR;
  const headY = centerY + sin(ang) * headR;
  const tailX = centerX + cos(ang) * tailR;
  const tailY = centerY + sin(ang) * tailR;

  push();

  const barCol = color(n.grayed ? HOLD_GRAY : HOLD_COLOR);
  barCol.setAlpha(191); // 中间连接 75% 透明度
  const ringCol = color(n.grayed ? HOLD_GRAY : HOLD_COLOR);

  // 1) 中间连接：75% 半透明粗条连接两个圆心
  strokeCap(ROUND);
  stroke(barCol);
  strokeWeight(24);
  line(tailX, tailY, headX, headY);

  // 2) 两端：不透明中空圆环（直径 34px、线宽 6px，与 tap 同尺寸）
  noFill();
  stroke(ringCol);
  strokeWeight(6);
  circle(headX, headY, 34);
  if (tailR > 0) circle(tailX, tailY, 34); // 尾部收缩到头部后不再画尾部圆环

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
    const angRad = angIndex * TWO_PI / 8 - PI / 2 + ROTATION_OFFSET;
    const x = centerX + cos(angRad) * judgeRadius;
    const y = centerY + sin(angRad) * judgeRadius;

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
  const angRad = angIndex * TWO_PI / 8 - PI / 2 + ROTATION_OFFSET;
  const x = centerX + cos(angRad) * judgeRadius;
  const y = centerY + sin(angRad) * judgeRadius;

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
// 判定系统：键盘输入（临时） / 判定核心 / 成绩更新 / 音效 / 特效
// ---------------------------------------------------------------------------

/**
 * 音效初始化：正弦振荡器 + 短促包络，只在 setup() 里调用一次。
 */
function initSounds() {
  judgeOsc = new p5.Oscillator('sine');
  judgeOsc.start();
  judgeOsc.amp(0);

  judgeEnv = new p5.Envelope();
  judgeEnv.setADSR(0.001, 0.12, 0, 0.05);
  judgeEnv.setRange(0.4, 0);

  // 长按开始的短促「嗒」声（类似按键/翻页的清脆效果音）
  tickOsc = new p5.Oscillator('triangle');
  tickOsc.freq(TICK_BASE_FREQ);
  tickOsc.start();
  tickOsc.amp(0);

  tickEnv = new p5.Envelope();
  tickEnv.setADSR(0.001, 0.05, 0, 0.02);
  tickEnv.setRange(0.2, 0);
}

/**
 * 根据当前是否有长按在按住，控制持续音的开/关（平滑淡入淡出）。
 */
function playHoldTick() {
  if (!tickOsc || !tickEnv) return;
  // 每次在基准频率附近随机，让「嗒」声有细微音高变化
  tickOsc.freq(TICK_BASE_FREQ + random(-TICK_VARIATION, TICK_VARIATION));
  tickEnv.play(tickOsc);
}

/**
 * 按判定类型播放提示音：越好的判定音高越高。
 */
function playJudgeSound(type) {
  if (!judgeOsc || !judgeEnv) return; // 音效未初始化或未解锁时静默跳过

  const freq = { perfect: 880, great: 660, good: 440, miss: 220 }[type];
  judgeOsc.freq(freq);
  judgeEnv.play(judgeOsc);
}

/**
 * 键盘输入（调试备用）：按 1~8 键模拟 8 个判定点。
 * 正式输入由摄像头手势识别（checkHandHits）提供，此处保留便于无摄像头时测试。
 */
/**
 * 测试用：生成一个指定类型的音符（随机方向）。
 */
function spawnOne(type) {
  const spawnTime = millis();
  if (type === 'star') {
    const startAngle = floor(random(8));
    const direction = random() < 0.5 ? 1 : -1;
    notes.push({ type: 'star', startAngle: startAngle, direction: direction, spawnTime: spawnTime, progress: 0, targetAngle: (startAngle + direction + 8) % 8, hitTime: spawnTime + STAR_TRAVEL_TIME, judged: false });
  } else {
    const angle = floor(random(8));
    const note = { type: type, angle: angle, targetAngle: angle, spawnTime: spawnTime, progress: 0, hitTime: spawnTime + NOTE_TRAVEL_TIME, judged: false };
    if (type === 'hold') { note.holdDuration = HOLD_LENGTH * NOTE_TRAVEL_TIME / max(judgeRadius, 1); note.holdEndTime = note.hitTime + note.holdDuration; note.holding = false; note.grayed = false; note.holdGrade = null; }
    notes.push(note);
  }
}

function keyPressed() {
  if (!gameStarted) return;

  if (key >= '1' && key <= '8') {
    const angleIndex = int(key) - 1; // '1' → 0 … '8' → 7
    hitJudge(angleIndex);
  }

  // 测试用：按 t/h/s 生成单个音符，方便逐类测试识别
  if (key === 't' || key === 'T') spawnOne('tap');
  if (key === 'h' || key === 'H') spawnOne('hold');
  if (key === 's' || key === 'S') spawnOne('star');
}

/**
 * 判定点坐标（第 i 个判定点，0 号在正上方、顺时针）。
 */
function judgePointPosition(i) {
  const ang = i * TWO_PI / 8 - PI / 2 + ROTATION_OFFSET;
  return {
    x: centerX + cos(ang) * judgeRadius,
    y: centerY + sin(ang) * judgeRadius,
  };
}

/**
 * 手腕悬停特效：让玩家实时看到自己的手在屏幕上的位置。
 * 每只手的手腕画两层半透明圆（外层白、内层青）。
 */
function drawHover() {
  push();
  noStroke();
  for (const hand of hands) {
    const w = hand.points[0]; // 手腕
    fill(255, 255, 255, 60);
    circle(w.x, w.y, 46);
    fill(0, 212, 255, 120);
    circle(w.x, w.y, 30);
  }
  pop();
}

/**
 * 调试可视化：画出每个判定点的触发范围（淡青圆），以及每只手的手腕点
 * 和识别到的手势名 + 把握度（比如 Closed_Fist 95%）。
 */
function drawDebug() {
  push();
  // 1) 每个判定点的触发范围（淡青大圆，直径 = TRIGGER_RADIUS*2）
  noFill();
  stroke(0, 212, 255, 55);
  strokeWeight(1);
  for (let i = 0; i < 8; i++) {
    const pos = judgePointPosition(i);
    circle(pos.x, pos.y, TRIGGER_RADIUS * 2);
  }

  // 2) 手部：手腕点 + 捏合比
  for (const hand of hands) {
    const w = hand.points[0]; // 手腕
    noStroke();
    fill(0, 212, 255);
    circle(w.x, w.y, 10);

    const thumbTip = hand.points[4];
    const indexTip = hand.points[8];
    const middleTip = hand.points[12];
    const handScale = dist(w.x, w.y, middleTip.x, middleTip.y);
    const pinch = dist(thumbTip.x, thumbTip.y, indexTip.x, indexTip.y);
    const ratio = handScale > 1 ? (pinch / handScale).toFixed(2) : '?';

    fill(255);
    textSize(14);
    textAlign(CENTER, CENTER);
    text((isPinching(hand) ? '捏合 ' : '张开 ') + ratio, w.x, w.y - 24);
  }
  pop();
}

/**
 * 手腕命中检测：检测到「握拳(Closed_Fist)」手势时，找离手最近的判定点触发一次命中。
 * 只有「从张开变成握拳」的瞬间才触发一次，持续握拳不会重复触发。
 */
/**
 * 计算捏合比：拇指尖(4)↔食指尖(8)距离 ÷ 手腕(0)↔中指指尖(12)距离。
 * 手不可用（太小/不可见）时返回 null。
 */
function pinchRatio(hand) {
  const wrist = hand.points[0];
  const thumbTip = hand.points[4];
  const indexTip = hand.points[8];
  const middleTip = hand.points[12];

  const handScale = dist(wrist.x, wrist.y, middleTip.x, middleTip.y);
  if (handScale < 1) return null;

  const pinch = dist(thumbTip.x, thumbTip.y, indexTip.x, indexTip.y);
  return pinch / handScale;
}

/**
 * 是否处于「捏合」状态（比例小于 PINCH_RATIO）。
 */
function isPinching(hand) {
  const r = pinchRatio(hand);
  return r !== null && r < PINCH_RATIO;
}

function checkHandHits() {
  const activeSides = new Set();

  // 1) 每只手：抓握开始（带防抖）+ 长按的松开检测
  for (const hand of hands) {
    activeSides.add(hand.side);
    const ratio = pinchRatio(hand);
    const isFist = ratio !== null && ratio < PINCH_RATIO;

    // 抓握状态防抖
    let f = fistFrames[hand.side];
    if (!f || f.fist !== isFist) {
      f = { fist: isFist, count: 1 };
    } else {
      f.count = Math.min(f.count + 1, FIST_DEBOUNCE);
    }
    fistFrames[hand.side] = f;

    if (f.count >= FIST_DEBOUNCE) {
      const wasFist = !!fistState[hand.side];
      if (isFist && !wasFist) {
        graspStart(hand);                       // 抓握 → 命中或开始长按
      }
      fistState[hand.side] = isFist;
    }

    // 长按中：只有接近完全张开（ratio > RELEASE_RATIO）才算松开 → 变灰
    if (holdTracker[hand.side] && ratio !== null && ratio > RELEASE_RATIO) {
      breakHold(hand.side);
    }
  }

  // 清理已离开画面的手的状态
  for (const side in fistState) {
    if (!activeSides.has(side)) { delete fistState[side]; delete fistFrames[side]; }
  }

  // 2) 手离开画面 → 对应长按变灰
  for (const side in holdTracker) {
    if (!activeSides.has(side)) breakHold(side);
  }

  // 3) 长按到点 → 完成结算
  for (const side in holdTracker) {
    if (millis() >= holdTracker[side].holdEndTime) completeHold(side);
  }
}

/**
 * 刚握拳：找离手腕最近的判定点，命中 tap/star 或开始 hold 长按。
 */
function graspStart(hand) {
  const w = hand.points[0];

  let idx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < 8; i++) {
    const pos = judgePointPosition(i);
    const d = dist(w.x, w.y, pos.x, pos.y);
    if (d < bestDist) { bestDist = d; idx = i; }
  }
  if (bestDist >= TRIGGER_RADIUS || idx === -1) return;

  const t = findJudgeTarget(idx);
  if (!t) {
    // 尝试补抓灰色长按
    const gh = findGrayHold(idx);
    if (gh) {
      startHold(gh, 'good', hand.side);
      return;
    }
    // 空判：此处没有可判定的音符，生成黄色波纹特效
    const pos = judgePointPosition(idx);
    spawnEmptyEffect(pos.x, pos.y);
    return;
  }

  if (t.note.type === 'hold') {
    startHold(t.note, t.grade, hand.side);
  } else {
    applyJudge(t.note, t.grade);
  }
}

/**
 * 找最接近判定时刻、且未被判定/未被长按占用的音符，返回 { note, grade } 或 null。
 */
function findJudgeTarget(angleIndex) {
  const now = millis();
  let best = null;
  let bestDiff = Infinity;

  for (const n of notes) {
    if (n.judged || n.holding) continue;
    if (n.targetAngle !== angleIndex) continue;

    const diff = abs(now - n.hitTime);
    if (diff > JUDGE_WINDOWS.good) continue;

    if (diff < bestDiff) { bestDiff = diff; best = n; }
  }

  if (!best) return null; // 空打

  let grade;
  if (bestDiff <= JUDGE_WINDOWS.perfect) grade = 'perfect';
  else if (bestDiff <= JUDGE_WINDOWS.great) grade = 'great';
  else grade = 'good';

  return { note: best, grade: grade };
}

/**
 * 键盘输入用（调试备用）：找到目标就直接判定；长按也直接完成（不做持续抓握）。
 */
function hitJudge(angleIndex) {
  const t = findJudgeTarget(angleIndex);
  if (!t) return;
  applyJudge(t.note, t.grade);
}

/**
 * 应用判定结果（perfect/great/good）：计数、计分、连击、音效、特效、移除。
 */
function applyJudge(note, type) {
  note.judged = true;
  judgeCounts[type]++;
  updateJudgeHud();
  playJudgeSound(type);

  score += SCORE_TABLE[type];
  combo++;
  maxCombo = max(maxCombo, combo);
  updateScore();
  updateCombo();

  const pos = noteTargetPosition(note);
  spawnHitEffect(pos.x, pos.y, JUDGE_COLORS[type]);

  const idx = notes.indexOf(note);
  if (idx !== -1) notes.splice(idx, 1);
}

/**
 * miss 处理（漏判 / 长按中途松开）：计数、断连击、miss 音效与特效、移除。
 */
function applyMiss(note) {
  note.judged = true;
  judgeCounts.miss++;
  updateJudgeHud();
  playJudgeSound('miss');
  spawnMissEffect(note);
  combo = 0;
  updateCombo();

  const idx = notes.indexOf(note);
  if (idx !== -1) notes.splice(idx, 1);
}

/**
 * 找灰色（没被接住）的长按音符，用于补抓。
 */
function findGrayHold(angleIndex) {
  for (const n of notes) {
    if (n.type !== 'hold' || !n.grayed || n.judged || n.holding) continue;
    if (n.targetAngle !== angleIndex) continue;
    return n;
  }
  return null;
}

/**
 * 开始长按：标记音符正在被按住，记录初始握拳等级与是哪只手。
 */
function startHold(note, grade, side) {
  note.holding = true;
  note.grayed = false;   // 补抓成功，变回黄色
  note.holdGrade = grade;
  holdTracker[side] = note;  // holdEndTime 固定，到点自动完成
}

/**
 * 长按完成：持续握拳到 holdEndTime，按初始等级结算。
 */
function completeHold(side) {
  const note = holdTracker[side];
  if (!note) return;
  delete holdTracker[side];
  applyJudge(note, note.holdGrade);
}

/**
 * 长按中断：中途松开/手消失，记为 miss。
 */
function breakHold(side) {
  const note = holdTracker[side];
  if (!note) return;
  delete holdTracker[side];
  // 松开 → 变灰，条继续走（可补抓）
  note.holding = false;
  note.grayed = true;
  note.holdGrade = null;
}

/**
 * 把 score 同步到左上角分数框。
 */
function updateScore() {
  const el = document.getElementById('score-box');
  if (el) el.textContent = score;
}

/**
 * 更新连击显示：combo >= 2 时显示并播放 pop 动画，否则隐藏。
 */
function updateCombo() {
  const box = document.getElementById('combo-box');
  const num = document.getElementById('combo-num');
  if (!box || !num) return;

  if (combo >= 2) {
    box.hidden = false;
    num.textContent = combo;

    // 重新触发 pop 动画：移除类 → 强制 reflow → 再加类
    num.classList.remove('pop');
    void num.offsetWidth;
    num.classList.add('pop');
  } else {
    box.hidden = true;
    num.textContent = 0;
  }
}

/**
 * 结算：把成绩写入 #result-body，切换到结算界面。
 */
function endGame() {
  gameEnded = true;
  gameStarted = false;

  const body = document.getElementById('result-body');
  if (body) {
    body.innerHTML = `
      <p>分数：${score}</p>
      <p>最大连击：${maxCombo}</p>
      <p>PERFECT：${judgeCounts.perfect}</p>
      <p>GREAT：${judgeCounts.great}</p>
      <p>GOOD：${judgeCounts.good}</p>
      <p>MISS：${judgeCounts.miss}</p>
    `;
  }

  hide('game');
  show('result');
}

/**
 * 把 judgeCounts 同步到顶部 HUD 的四个计数 span。
 */
function updateJudgeHud() {
  const map = {
    'judge-perfect': judgeCounts.perfect,
    'judge-great': judgeCounts.great,
    'judge-good': judgeCounts.good,
    'judge-miss': judgeCounts.miss,
  };
  for (const id in map) {
    const el = document.getElementById(id);
    if (el) el.textContent = map[id];
  }
}

/**
 * 计算音符目标判定点的坐标（判定圈上的对应角度）。
 */
function noteTargetPosition(note) {
  const ang = note.targetAngle * TWO_PI / 8 - PI / 2 + ROTATION_OFFSET;
  return {
    x: centerX + cos(ang) * judgeRadius,
    y: centerY + sin(ang) * judgeRadius,
  };
}

/**
 * 命中特效：在 (x, y) 处散落约 16 颗小星星粒子。
 */
function spawnHitEffect(x, y, color) {
  const count = 16;

  for (let i = 0; i < count; i++) {
    const a = random(TWO_PI);
    const sp = random(1.5, 5);

    particles.push({
      x: x,
      y: y,
      vx: cos(a) * sp,
      vy: sin(a) * sp,
      angle: random(TWO_PI),
      spin: random(-0.2, 0.2),
      size: random(5, 14),
      color: color,
      start: millis(),
    });
  }
}

/**
 * 绘制命中粒子：500ms 内向外散开、旋转并淡出，每颗是四角星 sparkle。
 */
function drawParticles() {
  const now = millis();
  const LIFE = 500;

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const elapsed = now - p.start;

    if (elapsed > LIFE) {
      particles.splice(i, 1);
      continue;
    }

    // 运动与自转
    p.x += p.vx;
    p.y += p.vy;
    p.angle += p.spin;

    // 透明度从 220 线性衰减到 0
    const a = 220 * (1 - elapsed / LIFE);
    const c = color(p.color);
    c.setAlpha(a);

    drawSparkle(p.x, p.y, p.angle, p.size, c);
  }
}

/**
 * 四角星 sparkle：以 (x, y) 为圆心、按 angle 旋转、半径 s。
 */
function drawSparkle(x, y, angle, s, col) {
  push();
  translate(x, y);
  rotate(angle);

  noStroke();
  fill(col);

  beginShape();
  vertex(0, -s);
  vertex(s * 0.25, -s * 0.25);
  vertex(s, 0);
  vertex(s * 0.25, s * 0.25);
  vertex(0, s);
  vertex(-s * 0.25, s * 0.25);
  vertex(-s, 0);
  vertex(-s * 0.25, -s * 0.25);
  endShape(CLOSE);

  pop();
}

/**
 * miss 特效：在音符目标判定点记录一个淡蓝圆环。
 */
function spawnMissEffect(note) {
  const pos = noteTargetPosition(note);
  missEffects.push({ x: pos.x, y: pos.y, start: millis() });
}

/**
 * 绘制 miss 特效：300ms 内向外扩散并淡出的淡蓝空心圆。
 */
function drawMissEffects() {
  const now = millis();
  const LIFE = 300;

  push();
  noFill();
  strokeWeight(3);

  for (let i = missEffects.length - 1; i >= 0; i--) {
    const e = missEffects[i];
    const p = (now - e.start) / LIFE;

    if (p >= 1) {
      missEffects.splice(i, 1);
      continue;
    }

    const r = map(p, 0, 1, 10, 50);
    const c = color(JUDGE_COLORS.miss); // 淡蓝 #4a90e2
    c.setAlpha(255 * (1 - p));
    stroke(c);
    circle(e.x, e.y, r * 2);
  }

  pop();
}

/**
 * 空判特效：在判定点记录一个黄色波纹（与 miss 同款，只是黄色）。
 */
function spawnEmptyEffect(x, y) {
  emptyEffects.push({ x: x, y: y, start: millis() });
}

/**
 * 绘制空判特效：300ms 内向外扩散并淡出的黄色空心圆。
 */
function drawEmptyEffects() {
  const now = millis();
  const LIFE = 300;

  push();
  noFill();
  strokeWeight(3);

  for (let i = emptyEffects.length - 1; i >= 0; i--) {
    const e = emptyEffects[i];
    const p = (now - e.start) / LIFE;

    if (p >= 1) {
      emptyEffects.splice(i, 1);
      continue;
    }

    const r = map(p, 0, 1, 10, 50);
    const c = color(HOLD_COLOR); // 黄 #ffd54a
    c.setAlpha(255 * (1 - p));
    stroke(c);
    circle(e.x, e.y, r * 2);
  }

  pop();
}

// ---------------------------------------------------------------------------
// 游戏初始化入口（由 main.js 在点击「开始游戏」时调用）
// ---------------------------------------------------------------------------
function startGame() {
  // 重置分数、连击、判定计数与场上对象，保证每局从头开始
  gameStarted = true;
  gameEnded = false;
  score = 0;
  combo = 0;
  maxCombo = 0;
  judgeCounts = { perfect: 0, great: 0, good: 0, miss: 0 };
  notes = [];
  particles = [];
  missEffects = [];
  emptyEffects = [];
  spawnedCount = 0;
  nextSpawnTime = millis() + STARTUP_DELAY;

    // 界面归零
  updateScore();
  updateJudgeHud();
  updateCombo(); // combo 为 0 → 隐藏并归零 #combo-num

  // 摄像头 + 手势模型（只创建一次，避免重复开流）
  if (!video) {
    video = createCapture(VIDEO);
    video.size(640, 480);
    video.hide();
  }
  if (!recognizer) loadGestureRecognizer();

  // 手势状态重置
  fistState = {};
  holdTracker = {};
  fistFrames = {};

  // 解锁浏览器音频（必须由用户手势触发）
  if (typeof userStartAudio === 'function') userStartAudio();
  initSounds();

  // 播放歌曲（从头开始）
  if (song && song.isLoaded()) {
    song.stop();
    song.play();
    songStarted = true;
  }
}

// ---------------------------------------------------------------------------
// 暂停
// ---------------------------------------------------------------------------
function pauseGame() {
  paused = true;
  show('pause');
}

function resumeGame() {
  paused = false;
  nextSpawnTime = millis(); // 避免暂停期间积压的音符在恢复后集中生成
  hide('pause');
}

function pauseRestart() {
  paused = false;
  hide('pause');
  startGame();
}

function pauseQuit() {
  paused = false;
  gameStarted = false;
  hide('pause');
  hide('game');
  show('menu');
}

document.getElementById('btn-pause').addEventListener('click', pauseGame);
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-pause-restart').addEventListener('click', pauseRestart);
document.getElementById('btn-quit').addEventListener('click', pauseQuit);

