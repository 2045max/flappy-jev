# Flappy Jev

Flappy Bird played by [TypeSafe's Jev](https://typesafe.ai/) — a model that answers yes/no questions with a calibrated probability instead of generating text. Every few frames the game asks: *should the bird flap now?*

Live: https://flappy-jev.2045max.workers.dev

Flappy Bird，每一步跳不跳由 TypeSafe Jev 决定。部署在 Cloudflare Workers。

- `public/`：游戏，浏览器里跑。机制和素材来自 [CodeExplainedRepo/FlappyBird-JavaScript](https://github.com/CodeExplainedRepo/FlappyBird-JavaScript)
- `src/index.js`：Worker，`POST /decide` 收状态，问 Jev 两个 noul（跳不跳、要不要连跳两下），返回概率

## 循环

```
每帧（保持一个请求在途）
  buildState()   鸟相对缝隙中心 above/below N px（按往返延迟外推）、管道距离
  POST /decide → Worker → api.typesafe.ai/v1/systemone
  flap > 0.5 → 跳；double > 0.5 → 再跳一次
```

## 实测记录

- 状态用纯数字（`bird_center_minus_gap_center: -79`）Jev 会看错方向；改成文字 `above by 79 px` 后判断稳定（0.9 / 0.1）
- 指令里的数值阈值 Jev 严格执行：`below by 8 px` → 0.14，`below by 12 px` → 0.97；40 px 的连跳阈值同样精确
- 让 Jev 选"跳几下"（choice 0/1/2/3）分布接近平均，不可用；拆成两个 noul 可用
- Workers AI 上的 `typesafe/jev` 约一半请求返回 `2018: Invalid User Credentials`，改为 Worker 直连 TypeSafe（`wrangler secret put TYPESAFE_API_KEY`）
- 瓶颈是往返延迟（100–250 ms）：1× 速度下鸟每次往返掉 9–20 px，一跳只抬 25 px，过管后爬不上去；0.5× 速度下一局能撑 40 秒以上

```bash
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler deploy
```
