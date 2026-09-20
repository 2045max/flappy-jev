// 静态文件由 wrangler.toml 的 [assets] 托管；只有 POST /decide 进到这里。
// 收游戏状态，问 Jev 一个 noul（是/否）：现在该不该跳。
//
// 优先直连 TypeSafe API（secret TYPESAFE_API_KEY）。Workers AI 上的 typesafe/jev 实测约一半请求
// 返回 "2018: Invalid User Credentials"，只作为没有 secret 时的备用。

// 一次请求两个 noul：flap（跳不跳）和 double（掉得太远时一次跳两下）。
// 阈值 8 px：一次跳上升 25 px，围绕中心线摆动会顶到上管，让它停在中心偏下一点两边余量才均衡。
// 阈值 40 px：过一根管后下一个缝隙可能高很多，每次往返只跳一下爬不上去。
const QUESTIONS = {
  flap: {
    type: "noul",
    instructions:
      "Flappy Bird. Screen y grows downward. The bird must fly through the gap of the next pipe. " +
      "Flapping lifts the bird 25 px instantly; otherwise it keeps falling. " +
      "Because a flap lifts 25 px, the bird should stay slightly below the gap center. " +
      "Answer yes only if the bird center is below the gap center by more than 8 px. " +
      "Answer no if it is above the gap center, or below it by 8 px or less.",
  },
  double: {
    type: "noul",
    instructions:
      "Flappy Bird. Screen y grows downward. Each flap lifts the bird 25 px. " +
      "Answer yes only if the bird center is below the gap center by more than 40 px, " +
      "so that two flaps at once are needed to climb back in time. Answer no otherwise.",
  },
};

async function askTypeSafe(env, state) {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.TYPESAFE_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.TYPESAFE_MODEL || "jev-latest", state, questions: QUESTIONS }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error("typesafe " + res.status + ": " + JSON.stringify(body).slice(0, 200));
  return body.answers;
}

async function askWorkersAI(env, state) {
  const result = await env.AI.run("typesafe/jev", { state, questions: QUESTIONS });
  return result.answers ?? result.result?.answers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/decide" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    let state;
    try {
      state = await request.json();
    } catch {
      return Response.json({ error: "body must be JSON" }, { status: 400 });
    }

    const started = Date.now();
    let answers;
    let backend;
    try {
      if (env.TYPESAFE_API_KEY) {
        backend = "typesafe";
        answers = await askTypeSafe(env, state);
      } else {
        backend = "workers-ai";
        answers = await askWorkersAI(env, state);
      }
    } catch (err) {
      return Response.json({ error: String(err?.message ?? err), backend }, { status: 502 });
    }

    if (!answers?.flap || !answers?.double) return Response.json({ error: "missing answer", raw: answers }, { status: 500 });
    return Response.json({
      flap: answers.flap.noul,
      double: answers.double.noul,
      latency_ms: Date.now() - started,
      backend,
    });
  },
};
