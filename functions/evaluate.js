/* ============================================================
 * Netlify Function: evaluate.js
 * 作用：关卡结束后，根据输赢 + 玩家数据，让 DeepSeek 生成一句
 *       简短有趣的评价，返回 { comment: "..." } 给前端弹窗显示。
 * 部署后访问路径：/.netlify/functions/evaluate
 * 依赖：Node 18+（全局 fetch）；环境变量 DEEPSEEK_API_KEY
 * ============================================================ */

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

/** 统一返回 JSON */
function jsonResponse(statusCode, obj) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(obj),
    };
}

/**
 * 根据玩家本局数据构造提示词
 * @param {object} d { result, score, level, lives, baseHp, reason }
 */
function buildPrompt(d) {
    const won = d.result === 'win';
    return [
        '你是一个坦克大战游戏的解说员，根据玩家本局表现给一句简短有趣的评价（1-3 句话）。',
        '要求：',
        '- 语气活泼，像游戏解说，带点情绪',
        won ? '- 玩家赢了，给予鼓励和夸奖' : '- 玩家输了，给予安慰和一点小建议',
        '- 不要超过 3 句话，不要用 markdown，不要用引号包裹',
        '- 只返回 JSON 对象，格式为 {"comment": "..."}',
        '',
        '玩家本局数据：',
        '- 结果：' + (won ? '胜利' : '失败'),
        '- 到达关卡：第 ' + d.level + ' 关',
        '- 最终得分：' + d.score,
        '- 剩余生命：' + d.lives,
        '- 基地剩余血量：' + d.baseHp,
        won ? '' : ('- 失败原因：' + (d.reason || '被击败')),
    ].join('\n');
}

// Netlify Function 入口
exports.handler = async (event) => {
    // 0. 只允许 POST
    if (event.httpMethod && event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: '只支持 POST 请求' });
    }

    // 1. 解析请求体
    let body;
    try {
        body = typeof event.body === 'string'
            ? JSON.parse(event.body || '{}')
            : (event.body || {});
    } catch (e) {
        return jsonResponse(400, { error: '请求体不是合法 JSON' });
    }

    // 2. 检查密钥
    if (!DEEPSEEK_API_KEY) {
        return jsonResponse(500, { error: '服务端未配置环境变量 DEEPSEEK_API_KEY' });
    }

    // 3. 调 DeepSeek 生成评价
    try {
        const resp = await fetch(DEEPSEEK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + DEEPSEEK_API_KEY,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                response_format: { type: 'json_object' },  // 强制返回合法 JSON
                temperature: 0.9,                            // 高一点，评价更有变化
                max_tokens: 300,                             // 评价很短，省 token
                messages: [
                    {
                        role: 'system',
                        content: '你是坦克大战游戏解说员，只输出 JSON 对象，不输出任何解释或 markdown。',
                    },
                    {
                        role: 'user',
                        content: buildPrompt(body),
                    },
                ],
            }),
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            return jsonResponse(502, {
                error: 'DeepSeek 接口返回错误（HTTP ' + resp.status + '）',
                detail: errText.slice(0, 500),
            });
        }

        const aiResp = await resp.json();
        const content = (aiResp?.choices?.[0]?.message?.content || '').trim();

        // 4. 解析 AI 返回，提取 comment
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            // 解析失败：直接用原文兜底当评价（截断防过长）
            return jsonResponse(200, { comment: content.slice(0, 200) || '本局表现不错，继续加油！' });
        }
        // 兼容多种键名
        const comment = parsed.comment || parsed.text || parsed.message || parsed.eval || '本局表现不错，继续加油！';
        return jsonResponse(200, { comment });
    } catch (e) {
        return jsonResponse(502, { error: '调用 DeepSeek 失败：' + (e.message || '未知错误') });
    }
};
