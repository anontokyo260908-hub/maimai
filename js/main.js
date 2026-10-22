/**
 * 界面区块切换逻辑
 * 仅负责各 section 的显示 / 隐藏，不含任何游戏逻辑。
 */

/** 显示指定 id 的区块（移除 hidden 属性） */
function show(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

/** 隐藏指定 id 的区块（加上 hidden 属性） */
function hide(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

// 说明：startGame() 由 game.js 提供（p5.js 渲染相关），main.js 不再定义。

// ---------------------------------------------------------------------------
// 按钮绑定（脚本置于 body 底部，DOM 已就绪）
// ---------------------------------------------------------------------------

// 教程：弹窗盖在菜单上，不隐藏 #menu
document.getElementById('btn-tutorial').addEventListener('click', () => {
  show('tutorial');
});

document.getElementById('btn-tutorial-back').addEventListener('click', () => {
  hide('tutorial');
});

// 设置
document.getElementById('btn-settings').addEventListener('click', () => {
  show('settings');
});

document.getElementById('btn-settings-back').addEventListener('click', () => {
  hide('settings');
});

// 开始游戏
document.getElementById('btn-start').addEventListener('click', () => {
  hide('menu');
  show('game');
  startGame();
});

// 重新开始：回到主菜单
document.getElementById('btn-restart').addEventListener('click', () => {
  hide('result');
  show('menu');
});


