// 游戏机制来自 CodeExplainedRepo/FlappyBird-JavaScript：重力 1.5 px/帧，跳一次上升 25 px，管道 1 px/帧。
// 改动：碰撞后重置而不是刷新页面；每隔几帧把状态发给 /decide，由 Jev 决定跳不跳。

const cvs = document.getElementById("canvas");
const ctx = cvs.getContext("2d");

const bird = new Image();
const bg = new Image();
const fg = new Image();
const pipeNorth = new Image();
const pipeSouth = new Image();
bird.src = "images/bird.png";
bg.src = "images/bg.png";
fg.src = "images/fg.png";
pipeNorth.src = "images/pipeNorth.png";
pipeSouth.src = "images/pipeSouth.png";

const fly = new Audio("sounds/fly.mp3");
const scor = new Audio("sounds/score.mp3");

const GAP = 85;
const GRAVITY = 1.5;
const FLAP = 25;
const BIRD_X = 10;
const FRAME_MS = 1000 / 60;

let birdY = 150;
let score = 0;
let pipes = [];
let frame = 0;

// Jev 相关状态
let jevOn = false;
let pending = false;
let slow = true;
let started = false;
let lastFlapProb = null;
let lastLatency = null;
let rtts = [];
let decisions = 0;
let errors = 0;
const deaths = [];
const log = [];
let games = 0;
let best = 0;

const ui = {
  toggle: document.getElementById("toggle"),
  prob: document.getElementById("prob"),
  probBar: document.getElementById("prob-bar"),
  latency: document.getElementById("latency"),
  decisions: document.getElementById("decisions"),
  games: document.getElementById("games"),
  best: document.getElementById("best"),
  status: document.getElementById("status"),
  slow: document.getElementById("slow"),
};
ui.slow.addEventListener("change", () => (slow = ui.slow.checked));

function reset() {
  birdY = 150;
  score = 0;
  pipes = [{ x: cvs.width, y: 0 }];
  lastFlapProb = null;
}

function flap() {
  birdY -= FLAP;
  fly.play().catch(() => {});
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    if (!jevOn) {
      started = true;
      flap();
    }
  }
});

// 手机没有键盘：点画布 = 跳
cvs.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (!jevOn) {
    started = true;
    flap();
  }
});

ui.toggle.addEventListener("click", () => {
  jevOn = !jevOn;
  ui.toggle.textContent = jevOn ? "Stop Jev" : "Let Jev play";
  ui.status.textContent = jevOn ? "Jev is playing" : "Manual (Space or tap)";
  if (jevOn) {
    started = true;
    reset();
  }
});

function nextPipe() {
  for (const p of pipes) {
    if (p.x + pipeNorth.width >= BIRD_X) return p;
  }
  return pipes[pipes.length - 1];
}

// 发给 Jev 的状态。实测 Jev 对"above/below by N px"这种文字描述判断最准，数字单独给容易看错方向。
// 位置按最近几次浏览器端往返时间外推：回复到达时鸟已经又掉了那么久，按那时的位置问才来得及。
function buildState(projected = true) {
  const p = nextPipe();
  const gapTop = p.y + pipeNorth.height;
  const gapBottom = gapTop + GAP;
  const gapCenter = (gapTop + gapBottom) / 2;
  const rtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 150;
  const lead = projected ? (GRAVITY * rtt) / FRAME_MS / (slow ? 2 : 1) : 0;
  const y = birdY + lead;
  const birdCenter = y + bird.height / 2;
  const relative = (d) => (d > 0 ? `below by ${d} px` : d < 0 ? `above by ${-d} px` : "level");
  return {
    bird_relative_to_gap_center: relative(Math.round(birdCenter - gapCenter)),
    bird_relative_to_gap_top: relative(Math.round(y - gapTop)),
    bird_relative_to_gap_bottom: relative(Math.round(y + bird.height - gapBottom)),
    next_pipe_distance_px: Math.round(p.x - BIRD_X),
    gap_height_px: GAP,
    bird_center_y: Math.round(birdCenter),
    ground_y: cvs.height - fg.height,
  };
}

async function askJev() {
  pending = true;
  const askedAt = frame;
  const t0 = performance.now();
  try {
    const state = buildState();
    const res = await fetch("/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    lastFlapProb = data.flap;
    lastLatency = data.latency_ms;
    rtts = [...rtts.slice(-2), Math.round(performance.now() - t0)];
    log.push({ state, flap: data.flap, double: data.double });
    if (log.length > 300) log.shift();
    decisions++;
    // 回复晚于一次重置时不执行，避免上一局的判断作用到这一局
    if (jevOn && askedAt >= lastResetFrame && data.flap > 0.5) {
      flap();
      if (data.double > 0.5) flap();
    }
  } catch (err) {
    // 偶发的网络或网关错误不停止游戏，跳过这一次决策
    errors++;
    ui.status.textContent = "Jev is playing (errors: " + errors + ", last: " + err.message + ")";
  } finally {
    pending = false;
  }
}

let lastResetFrame = 0;

function draw() {
  frame++;
  if (!started || (slow && frame % 2)) {
    if (!started) drawFrame(false);
    requestAnimationFrame(draw);
    return;
  }
  drawFrame(true);
  requestAnimationFrame(draw);
}

// advance=false 只画不动，用于开局等待
function drawFrame(advance) {
  ctx.drawImage(bg, 0, 0);

  const constant = pipeNorth.height + GAP;
  let dead = false;

  for (let i = 0; i < pipes.length; i++) {
    const p = pipes[i];
    ctx.drawImage(pipeNorth, p.x, p.y);
    ctx.drawImage(pipeSouth, p.x, p.y + constant);
    if (!advance) continue;
    p.x--;

    if (p.x === 125) {
      pipes.push({ x: cvs.width, y: Math.floor(Math.random() * pipeNorth.height) - pipeNorth.height });
    }

    const hitPipe =
      BIRD_X + bird.width >= p.x &&
      BIRD_X <= p.x + pipeNorth.width &&
      (birdY <= p.y + pipeNorth.height || birdY + bird.height >= p.y + constant);
    const hitGround = birdY + bird.height >= cvs.height - fg.height;
    if (hitPipe || hitGround) dead = hitGround ? "ground" : birdY <= p.y + pipeNorth.height ? "top pipe" : "bottom pipe";

    if (p.x === 5) {
      score++;
      scor.play().catch(() => {});
    }
  }
  pipes = pipes.filter((p) => p.x + pipeNorth.width > 0);

  ctx.drawImage(fg, 0, cvs.height - fg.height);
  ctx.drawImage(bird, BIRD_X, birdY);
  if (advance) birdY += GRAVITY;

  ctx.fillStyle = "#000";
  ctx.font = "20px Verdana";
  ctx.fillText("Score : " + score, 10, cvs.height - 20);

  if (dead) {
    deaths.push({ cause: dead, score, state: buildState(false), lastFlapProb });
    games++;
    if (score > best) best = score;
    lastResetFrame = frame;
    reset();
  }

  if (jevOn && !pending) askJev();

  if (lastFlapProb !== null) {
    ui.prob.textContent = lastFlapProb.toFixed(2);
    ui.probBar.style.width = Math.round(lastFlapProb * 100) + "%";
    ui.probBar.style.background = lastFlapProb > 0.5 ? "#e8590c" : "#2f9e44";
  }
  ui.latency.textContent = lastLatency === null ? "–" : lastLatency + " ms (rtt " + rtts[rtts.length - 1] + " ms)";
  ui.decisions.textContent = decisions;
  ui.games.textContent = games;
  ui.best.textContent = best;
}

reset();
draw();
window.__jev = { deaths, log };
