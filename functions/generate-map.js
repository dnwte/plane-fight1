/* ============================================================
 * Netlify Function: generate-map.js
 * 作用：接收前端 POST { prompt: "地图描述" }，调用 DeepSeek 生成
 *       一个 20 行 × 26 列的坦克大战地图（0=空地 1=砖墙 2=钢墙），
 *       解析 AI 返回的 JSON，把二维数组返回给前端。
 * 部署后访问路径：/.netlify/functions/generate-map
 * 依赖：Node 18+（用全局 fetch）；环境变量 DEEPSEEK_API_KEY
 * ============================================================ */

// 从环境变量读取 DeepSeek 密钥（在 Netlify 后台 → Settings → Environment variables 配置）
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// DeepSeek Chat 接口（与 OpenAI 兼容的格式）
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

// 目标地图尺寸
const MAP_ROWS = 20;
const MAP_COLS = 26;

/**
 * 统一返回 JSON 响应（成功或失败都用这个，保证前端总能 res.json()）
 * @param {number} statusCode HTTP 状态码
 * @param {object} obj 要返回的对象
 */
function jsonResponse(statusCode, obj) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            // 允许前端跨域调用（同源其实不需要，加上更保险）
            'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(obj),
    };
}

/**
 * 从 AI 返回的内容里提取二维数组
 * AI 可能返回：直接数组 [[...]]，或包在对象里 {"map": [[...]]} / {"data": ...}
 * @param {string} content AI 返回的原始文本
 * @returns {Array|null} 二维数组，解析失败返回 null
 */
function extractArray(content) {
    if (!content) return null;
    const text = content.trim();

    // 1. 直接当 JSON 解析
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        // 2. 直接解析失败：尝试抠出第一个 JSON 对象/数组再解析
        //    （防 AI 偶尔多说了一句话或加了 markdown 代码块）
        const match = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
        if (!match) return null;
        try {
            parsed = JSON.parse(match[1]);
        } catch (e2) {
            return null;
        }
    }

    // 3. 如果本身就是数组，直接用
    if (Array.isArray(parsed)) return parsed;

    // 4. 如果是对象，按常见键名找数组，再兜底遍历所有值
    if (parsed && typeof parsed === 'object') {
        for (const key of ['map', 'data', 'grid', 'field', 'matrix', 'board']) {
            if (Array.isArray(parsed[key])) return parsed[key];
        }
        for (const v of Object.values(parsed)) {
            if (Array.isArray(v)) return v;
        }
    }
    return null;
}

/**
 * 把 AI 返回的数组规范化成 MAP_ROWS × MAP_COLS（20×26）
 * - 行数不足补空行，超出截断
 * - 每行不足补 0，超出截断
 * - 只保留 0/1/2，其它值一律归 0（防止 AI 乱给数字）
 * @param {Array} data AI 返回的二维数组
 * @returns {number[][]} 规范化后的 20×26 数组
 */
function normalizeMap(data) {
    const map = [];
    for (let r = 0; r < MAP_ROWS; r++) {
        const srcRow = Array.isArray(data[r]) ? data[r] : [];
        const row = [];
        for (let c = 0; c < MAP_COLS; c++) {
            let v = srcRow[c];
            // 非数字或 NaN → 当空地
            if (typeof v !== 'number' || Number.isNaN(v)) v = 0;
            // 只允许 0/1/2，其它归 0
            if (v !== 0 && v !== 1 && v !== 2) v = 0;
            row.push(v);
        }
        map.push(row);
    }
    return map;
}

/**
 * 构造给 DeepSeek 的提示词
 * 明确要求：严格 20×26、只含 0/1/2、留通行空地、只返回 JSON 对象
 * @param {string} desc 用户的地图描述
 */
function buildPrompt(desc) {
    return [
        '你是一个坦克大战地图生成器。请根据用户的描述生成地图。',
        '',
        '地图规格：',
        '- 严格 20 行 × 26 列的二维数组',
        '- 数字含义：0 = 空地（可通行），1 = 砖墙（可被打碎），2 = 钢墙（不可摧毁的掩体）',
        '- 一定要给玩家和敌方坦克留出可通行的空地走廊，禁止把整张图填满墙',
        '- 数组里只能有 0/1/2 这三种数字，不能有其它内容',
        '',
        '用户描述：' + desc,
        '',
        '输出要求（非常重要）：',
        '- 只返回一个 JSON 对象，格式为 {"map": [[...]]}',
        '- 不要任何解释、不要 markdown 代码块、不要多余文字',
        '- map 的值必须是 20 行 × 26 列的二维数字数组',
    ].join('\n');
}

// Netlify Function 入口（v1 写法，兼容性最好）
exports.handler = async (event) => {
    // ---- 0. 只允许 POST ----
    if (event.httpMethod && event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: '只支持 POST 请求' });
    }

    // ---- 1. 解析请求体 ----
    // event.body 可能是字符串（常见）或已被 Netlify 解析成对象
    let body;
    try {
        body = typeof event.body === 'string'
            ? JSON.parse(event.body || '{}')
            : (event.body || {});
    } catch (e) {
        return jsonResponse(400, { error: '请求体不是合法 JSON' });
    }

    // 兼容 prompt 和 description 两个字段名（前端任一发来都能用）
    const prompt = body.prompt || body.description || '';
    if (!prompt) {
        return jsonResponse(400, { error: '缺少 prompt 字段（地图描述）' });
    }

    // ---- 2. 检查密钥 ----
    if (!DEEPSEEK_API_KEY) {
        return jsonResponse(500, { error: '服务端未配置环境变量 DEEPSEEK_API_KEY' });
    }

    // ---- 3. 调用 DeepSeek ----
    let aiContent = '';
    try {
        const resp = await fetch(DEEPSEEK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + DEEPSEEK_API_KEY,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',                 // DeepSeek-V3，速度快
                response_format: { type: 'json_object' }, // 强制返回合法 JSON
                temperature: 0.7,                       // 适中，地图有点变化又不乱
                max_tokens: 4000,                       // 20×26 数组够用
                messages: [
                    {
                        role: 'system',
                        content: '你是坦克大战地图生成器，只输出 JSON 对象，不输出任何解释或 markdown。',
                    },
                    {
                        role: 'user',
                        content: buildPrompt(prompt),
                    },
                ],
            }),
        });

        // HTTP 状态码非 2xx → 把后端错误透传给前端
        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            return jsonResponse(502, {
                error: `DeepSeek 接口返回错误（HTTP ${resp.status}）`,
                detail: errText.slice(0, 500),   // 截断防 body 过大
            });
        }

        const aiResp = await resp.json();
        // OpenAI 兼容格式：choices[0].message.content 是 AI 的文本输出
        aiContent = aiResp?.choices?.[0]?.message?.content || '';
    } catch (e) {
        // 网络中断 / DNS 失败 / 超时等
        return jsonResponse(502, { error: '调用 DeepSeek 接口失败：' + (e.message || '未知错误') });
    }

    // ---- 4. 解析 AI 返回内容为二维数组 ----
    const rawArray = extractArray(aiContent);
    if (!rawArray || !Array.isArray(rawArray[0])) {
        return jsonResponse(502, {
            error: 'AI 返回内容无法解析为二维数组',
            raw: (aiContent || '').slice(0, 500),
        });
    }

    // ---- 5. 规范化成 20×26，确保结构正确 ----
    const map = normalizeMap(rawArray);

    // ---- 6. 返回数组给前端 ----
    // 直接返回数组（前端 res.json() 拿到就是二维数组）
    return jsonResponse(200, map);
};
