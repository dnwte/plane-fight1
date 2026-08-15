/* ============================================================
 * 坦克大战 - game.js
 * 当前版本：仅实现玩家坦克（黄色方块）的基础移动
 * 功能：画布初始化、键盘控制、边界限制、requestAnimationFrame 游戏循环
 * ============================================================ */

/* ==================== 1. 画布设置 ==================== */

// 获取 HTML 中 id 为 gameCanvas 的画布元素
const canvas = document.getElementById('gameCanvas');

// 获取画布的 2D 绘图上下文（之后所有"画画"的操作都通过 ctx 完成）
const ctx = canvas.getContext('2d');

// 记录画布宽高，方便后面做边界检测
const CANVAS_W = canvas.width;   // 800
const CANVAS_H = canvas.height;  // 600

/* ==================== 1.5 音效系统（Web Audio API 程序化生成） ====================
 * 不依赖任何外部音频文件——所有音效都用振荡器实时合成。
 * 浏览器策略要求音频上下文必须由用户手势启动，所以在"开始游戏"按钮里会 resume()。
 */
let audioCtx = null;

/** 获取（必要时创建）音频上下文 */
function getAudio() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            audioCtx = null;   // 不支持就静默失败，游戏照常跑
        }
    }
    return audioCtx;
}

/** 唤醒音频上下文（在用户首次点击时调用，绕过浏览器自动播放限制） */
function resumeAudio() {
    const ac = getAudio();
    if (ac && ac.state === 'suspended') ac.resume();
}

/**
 * 播放一个简单的振荡器音效
 * @param {number} freq 频率（Hz）
 * @param {number} duration 持续时间（秒）
 * @param {string} type 波形：'square' / 'sine' / 'sawtooth' / 'triangle'
 * @param {number} volume 音量 0~1
 */
function playTone(freq, duration, type = 'square', volume = 0.15) {
    const ac = getAudio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ac.destination);
    const now = ac.currentTime;
    // 用指数衰减让音尾自然消失，避免"咔哒"爆音
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.start(now);
    osc.stop(now + duration);
}

/** 玩家开火音效：低沉短促的方波"砰" */
function playFireSound() {
    playTone(200, 0.07, 'square', 0.10);
    playTone(140, 0.09, 'square', 0.08);
}

/**
 * Boss 死亡胜利音效：一段上升旋律（C-E-G-C 高音）+ 低沉收尾
 * 用 setTimeout 把几个音符错开播放，听起来像"胜利号角"
 */
function playVictorySound() {
    const notes = [523, 659, 784, 1047];   // C5 E5 G5 C6
    notes.forEach((f, i) => {
        setTimeout(() => playTone(f, 0.18, 'square', 0.14), i * 130);
    });
    // 最后一个低音长音收尾，强化"胜利"的感觉
    setTimeout(() => playTone(130, 0.6, 'sawtooth', 0.16), notes.length * 130);
}

/* ==================== 1.6 图片系统（背景 + Boss 人头） ====================
 * 三张背景图：开局随机抽一张作主页背景，玩家也可手动选择作为游戏内背景。
 * Boss 形象换成 浩源.jpg 的人头（圆形头像）。
 */

// 三张背景文件 + 名称（顺序和 index.html 缩略图的 data-bg 一致）
const BG_FILES = ['图片/一博.jpg', '图片/西风.jpg', '图片/浩源.jpg'];
const BG_NAMES = ['一博', '西风', '浩源'];

// 预加载三张背景图（Image 对象，src 设好后浏览器异步加载）
const bgImgs = BG_FILES.map(src => {
    const im = new Image();
    im.src = src;
    return im;
});

// Boss 人头图片（浩源.jpg），独立加载，drawBoss 里画成圆形头像
const bossHeadImg = new Image();
bossHeadImg.src = '图片/浩源.jpg';

// 当前选中的背景索引（-1 = 还没选；0/1/2 = 对应 BG_FILES）
let selectedBgIndex = -1;

/**
 * 把图片按 cover 方式画进指定矩形（等价 CSS background-size: cover）
 * 保持比例放大到完全覆盖矩形，居中裁掉多余部分
 */
function drawImageCover(c, img, x, y, w, h) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return;              // 图片还没加载完就不画
    const scale = Math.max(w / iw, h / ih);   // 取更大的缩放比保证覆盖
    const dw = iw * scale, dh = ih * scale;
    const dx = x + (w - dw) / 2;        // 居中
    const dy = y + (h - dh) / 2;
    c.drawImage(img, dx, dy, dw, dh);
}

/**
 * 设置主页背景 + 当前选中背景（同时作为游戏内背景）
 * - 给 #homeScreen 加背景图（cover）+ 半透明深色遮罩，保证文字可读
 * - 更新缩略图选中高亮 + "当前：xxx" 文字
 */
function applyHomeBackground(idx) {
    selectedBgIndex = idx;

    // 主页背景：图层 = 深色渐变遮罩 + 图片 cover
    const home = document.getElementById('homeScreen');
    home.style.background =
        'linear-gradient(rgba(20,20,20,0.72), rgba(20,20,20,0.88)), ' +
        `url('${BG_FILES[idx]}') center/cover no-repeat`;

    // 缩略图选中高亮
    document.querySelectorAll('.bg-thumb').forEach((t, i) => {
        t.classList.toggle('selected', i === idx);
    });

    // "当前：xxx" 文字
    const nameEl = document.getElementById('bgCurrentName');
    if (nameEl) nameEl.textContent = '当前：' + BG_NAMES[idx];
}

/* ==================== 2. 玩家坦克 ==================== */

// 用一个对象描述玩家坦克的所有属性
const player = {
    x: 400,                      // 初始 X：世界坐标，s 和 j 之间的空走廊（第 10 列）
    y: 560,                      // 初始 Y：字母区域的中间一行（第 14 行）
    size: 40,                    // 坦克大小：40 x 40 像素
    speed: 200,                  // 移动速度：每秒 200 像素
    angle: -Math.PI / 2,         // 当前朝向角度（弧度）。-PI/2 表示炮管朝上。
                                 // 角度约定：0 = 朝右，PI/2 = 朝下，PI 或 -PI = 朝左，-PI/2 = 朝上。
                                 // 可以取任意值，所以坦克能 360 度自由旋转。
    turnSpeed: 6                 // 炮塔旋转速度：每秒 6 弧度（约 1 秒转一整圈）
};

// 鼠标位置（画布坐标系）。null 表示鼠标还没进入过画布
const mouse = { x: null, y: null };

/* ==================== 2.8 得分与游戏状态 ==================== */

// 游戏状态：'playing' = 进行中，'win' = 胜利，'lose' = 失败
let gameState = 'playing';

// 得分系统
let score = 0;                                   // 当前得分
let highScore = 0;                               // 历史最高分（刷新前保留在本局）

// HTML 里的得分显示元素，用来把分数同步到页面上
const scoreTextEl = document.getElementById('scoreText');
const highScoreTextEl = document.getElementById('highScoreText');

/** 把当前得分和生命刷到 HTML 的状态栏上 */
function updateScoreDisplay() {
    scoreTextEl.textContent = '得分：' + score;
    highScoreTextEl.textContent = '最高分：' + highScore;
    livesTextEl.textContent = '生命：' + playerLives;
}

/* ==================== 2.85 玩家生命 + 基地 ==================== */

// 玩家生命：被敌方子弹打中一次扣 1 滴血，归零则游戏失败
let playerLives = 3;

// 玩家受伤后的无敌时间（秒）：刚被打中后短暂无敌，防止连续掉血
let playerInvincible = 0;

// HTML 里的生命显示元素
const livesTextEl = document.getElementById('livesText');

/**
 * 基地：玩家出生点旁边的蓝色基地，有 6 血。
 * - 敌方子弹打中基地 → 基地血量 -1；
 * - 基地血量归零 → 游戏失败。
 * 位置：玩家出生点正下方（世界坐标 400~520, 640~680）
 */
const base = {
    x: 400,           // 基地左上角 X（世界坐标，对齐玩家出生点正下方）
    y: 640,           // 基地左上角 Y（玩家下方 80 像素）
    w: 120,           // 基地宽（3 格）
    h: 40,            // 基地高（1 格）
    hp: 6,            // 当前血量
    maxHp: 6,         // 最大血量（画血条用）
};

/* ==================== 2.86 Buff 掉落 + Boss 系统 ====================
 *
 * 【Buff 掉落】敌人被击杀后，在死亡位置随机掉落 1 个 buff。
 * 共 3 种 buff：
 * - 'heal'：恢复 1 滴血（生命 +1）
 * - 'doubleDamage'：子弹伤害翻倍（每发打 2 血，对敌人和 Boss 都生效）
 * - 'shield'：护盾，抵御 1 次伤害（被子弹打中或被敌人撞到时优先消耗护盾）
 *
 * 【Boss 系统】所有普通敌人被消灭后，地图随机位置生成 1 个 Boss。
 * Boss 属性：
 * - 体积：玩家 5 倍（200×200）
 * - 速度：与玩家相同（200 px/s）
 * - 血量：50
 * - 血条：显示在屏幕正上方（固定位置，不随镜头滚动）
 * - 击败 Boss = 游戏胜利
 * - Boss 碰到玩家或基地 = 游戏失败
 */

// 玩家护盾（0 = 无护盾，1 = 有 1 层护盾）
let playerShield = 0;

// 玩家子弹伤害倍数（1 = 普通，2 = 双倍伤害 buff 生效）
let playerBulletDamage = 1;

// 双倍伤害 buff 的剩余时间（秒），时间到恢复 1 倍
let doubleDamageTimer = 0;

// 掉落物数组：每个元素 {x, y, type, pulse} — pulse 用于动画
const powerups = [];

// 游戏阶段：'fighting' = 打普通敌人，'boss' = Boss 战，'cleared' = 全清（包括 Boss）
let gamePhase = 'fighting';

// Boss 对象（未生成时为 null）
let boss = null;

// Boss 死亡后的"特效播放"倒计时：Boss 死后先播 2 秒粒子+音效，再弹出胜利界面
let bossDeathTimer = 0;

/* ==================== 2.87 坦克皮肤 + 关卡配置 ====================
 *
 * 【5 种坦克皮肤】玩家可以在主页选择不同颜色的坦克皮肤。
 * 每种皮肤是一组配色（车体色 + 炮塔色 + 暗色线条 + 炮塔描边），
 * drawTank 会读取这些属性来画不同颜色的坦克。
 */
const SKINS = [
    { name: '经典黄', bodyColor: '#d4a017', turretColor: '#e6b422', bodyDark: '#b8860b', turretDark: '#8a6508' },
    { name: '钢铁灰', bodyColor: '#6a6a6a', turretColor: '#8a8a8a', bodyDark: '#4a4a4a', turretDark: '#3a3a3a' },
    { name: '森林绿', bodyColor: '#2d6a2d', turretColor: '#4a9a4a', bodyDark: '#1a4a1a', turretDark: '#143d14' },
    { name: '沙漠金', bodyColor: '#c9a04c', turretColor: '#d4b560', bodyDark: '#a08030', turretDark: '#7a6020' },
    { name: '烈焰红', bodyColor: '#c03030', turretColor: '#e04040', bodyDark: '#902020', turretDark: '#701818' },
];

// 当前选中的皮肤编号（0~4），默认 0（经典黄）
let selectedSkin = 0;

// 当前选中的关卡编号（1~10），默认 1
let selectedLevel = 1;

// 当前正在玩的关卡（游戏开始后锁定，回主页时重置）
let currentLevel = 1;

// 最高解锁关卡（从 localStorage 读取，默认 1 = 只有第 1 关解锁）
// 玩家通关后自动解锁下一关，进度保存在浏览器本地
let maxUnlockedLevel = parseInt(localStorage.getItem('tank_maxUnlockedLevel') || '1');

/* 【10 个关卡配置】关卡越靠后，敌人越强。
 * 属性说明：
 * - enemyCount: 敌方坦克数量
 * - enemyHp: 每辆敌方血量
 * - enemySpeed: 敌方移动速度（玩家是 200）
 * - enemyFireCooldown: 敌方开火冷却秒数（越小越频繁）
 * - enemyBulletSpeed: 敌方子弹速度
 * - enemyBulletDmg: 敌方子弹对玩家/基地的伤害（默认 1）
 */
const LEVELS = [
    { lvl: 1,  name: '新兵营',   enemyCount: 7, enemyHp: 3, enemySpeed: 180, enemyFireCooldown: 1.5, enemyBulletSpeed: 300 },
    { lvl: 2,  name: '前哨站',   enemyCount: 7, enemyHp: 4, enemySpeed: 190, enemyFireCooldown: 1.3, enemyBulletSpeed: 330 },
    { lvl: 3,  name: '巡逻线',   enemyCount: 7, enemyHp: 4, enemySpeed: 200, enemyFireCooldown: 1.2, enemyBulletSpeed: 360 },
    { lvl: 4,  name: '交锋战',   enemyCount: 7, enemyHp: 5, enemySpeed: 210, enemyFireCooldown: 1.1, enemyBulletSpeed: 390 },
    { lvl: 5,  name: '围攻战',   enemyCount: 7, enemyHp: 5, enemySpeed: 220, enemyFireCooldown: 1.0, enemyBulletSpeed: 420 },
    { lvl: 6,  name: '突围战',   enemyCount: 7, enemyHp: 6, enemySpeed: 230, enemyFireCooldown: 0.9, enemyBulletSpeed: 450 },
    { lvl: 7,  name: '钢铁洪流', enemyCount: 7, enemyHp: 6, enemySpeed: 240, enemyFireCooldown: 0.8, enemyBulletSpeed: 480 },
    { lvl: 8,  name: '末日防线', enemyCount: 7, enemyHp: 7, enemySpeed: 250, enemyFireCooldown: 0.7, enemyBulletSpeed: 500 },
    { lvl: 9,  name: '焦土作战', enemyCount: 7, enemyHp: 7, enemySpeed: 260, enemyFireCooldown: 0.6, enemyBulletSpeed: 520 },
    { lvl: 10, name: '最终决战', enemyCount: 7, enemyHp: 8, enemySpeed: 280, enemyFireCooldown: 0.5, enemyBulletSpeed: 550 },
];

/* ==================== 2.9 敌方坦克 ====================
 *
 * 【敌方坦克管理】用一个独立的 enemies 数组统一管理所有敌方坦克。
 *
 * 敌方坦克行为（自动锁定 + 追踪 + 开火）：
 * - 自动锁定：每秒重新评估离玩家近还是离基地近，锁定最近的那个作为攻击目标；
 * - 追踪移动：朝锁定目标方向走，被墙挡住就试其他方向绕路；
 * - 定时开火：开火时炮管直接对准目标（atan2 精确角度），子弹速度 480 px/s；
 * - 血量 5：要打 5 发才能消灭一辆，头顶有血条显示剩余血量；
 * - 速度 220 px/s（略快于玩家 200），开火冷却 0.8~1.5 秒（比之前更快更灵活）；
 * - 颜色是暗红色，和玩家的黄色坦克区分开。
 */

// 敌方坦克数组：游戏开始时生成 3 辆，击毁后从数组里删掉
const enemies = [];

// 敌方子弹数组：独立于玩家子弹，颜色不同，碰撞对象也不同
const enemyBullets = [];

// Boss 炮弹数组：带追踪逻辑的炮弹（追随玩家 4 秒后改直线），不会伤害基地
const bossBullets = [];

// 粒子数组：用于 Boss 死亡时的"粉碎"特效
const particles = [];

// 4 个方向常量，用 {dx, dy, angle} 表示
// angle 是炮管指向角度（弧度），和玩家 tank.angle 约定一致
const DIRS = [
    { dx: 0, dy: -1, angle: -Math.PI / 2 },  // 上：Y 减小，炮管朝上
    { dx: 0, dy: 1,  angle: Math.PI / 2   },  // 下：Y 增大，炮管朝下
    { dx: -1, dy: 0, angle: Math.PI       },  // 左：X 减小，炮管朝左
    { dx: 1,  dy: 0, angle: 0             },  // 右：X 增大，炮管朝右
];

/**
 * 在地图内随机位置生成一辆敌方坦克
 * 生成时避开砖墙和玩家出生点（找空地），避免一出生就卡在墙里
 */
function spawnEnemy(role) {
    const size = 40;
    const cfg = LEVELS[currentLevel - 1];        // 当前关卡的难度配置
    let x, y, tries = 0;
    // 随机找一个"空地"位置（最多试 50 次，避免死循环）
    do {
        // x、y 都在整个世界范围内随机分布（不再限制在顶部）
        x = Math.floor(Math.random() * (WORLD_W - size));
        y = Math.floor(Math.random() * (WORLD_H - size));
        tries++;
    } while (!canStandAt(x, y, size) && tries < 50);

    // 随机选一个初始方向（0=上 1=下 2=左 3=右）
    const dirIndex = Math.floor(Math.random() * 4);

    // role 决定这辆坦克的开局固定角色：'base' = 冲基地，'player' = 追玩家
    // 不传时默认 'player'（保守起见）
    role = role || 'player';

    enemies.push({
        x: x,
        y: y,
        size: size,
        speed: cfg.enemySpeed,                   // 敌方速度（由关卡决定）
        angle: DIRS[dirIndex].angle,             // 炮管朝向
        dirIndex: dirIndex,                     // 当前方向编号（0~3）
        fireCooldown: 0.5 + Math.random() * cfg.enemyFireCooldown,  // 首炮冷却
        hp: cfg.enemyHp,                        // 敌方血量（由关卡决定）
        maxHp: cfg.enemyHp,                     // 最大血量
        bulletSpeed: cfg.enemyBulletSpeed,      // 子弹速度（由关卡决定）
        retargetTimer: 0,                       // 重新锁定目标的计时器（保留字段）
        stuckTimer: 0,                          // 朝目标方向被墙挡住的累计时间（超 2 秒就开炮打墙）
        role: role,                             // 开局固定角色：一半冲基地，一半追玩家
        target: role,                           // 当前锁定目标 = 固定角色
        // 敌方坦克配色（暗红系），drawTank 会读这几个属性
        bodyColor: '#8b1a1a',                   // 暗红车体
        turretColor: '#b22222',                 // 砖红色炮塔
        bodyDark: '#5c0d0d',                    // 车体暗色线条
        turretDark: '#6b1010',                 // 炮塔描边色
    });
}

/** 游戏开始时根据关卡生成对应数量的敌方坦克：一半冲基地，一半追玩家 */
function spawnEnemies() {
    const cfg = LEVELS[currentLevel - 1];
    const count = cfg.enemyCount;
    const halfBase = Math.floor(count / 2);      // 前一半分配为"冲基地"角色
    for (let i = 0; i < count; i++) {
        // 前半段 → 'base'（冲基地），后半段 → 'player'（追玩家）
        const role = i < halfBase ? 'base' : 'player';
        spawnEnemy(role);
    }
}

// 注意：spawnEnemies() 的调用放在文件末尾，因为需要等 WORLD_W 等常量定义完才能执行


/* ==================== 2.5 地图数据（砖墙障碍物） ====================
 *
 * 【世界比画布大：地图和摄像机的关系】
 *
 * 1. 整个"世界"（地图实际大小）是 30 行 x 30 列，每格 40 x 40：
 *      世界总宽 = 30 x 40 = 1200 像素，总高 = 1200 像素。
 *      而画布只有 800 x 600，一次只能看到世界的一部分（约 1/3 的面积）。
 * 2. MAP 是一个"二维数组"：MAP[行号][列号]。
 *      - 数字 0 表示这一格是空地，数字 1 表示这一格是砖墙。
 * 3. 数组下标 → 世界坐标 的换算公式（关键一步）：
 *      某格左上角的世界坐标 = ( 列号 × TILE , 行号 × TILE )
 *    举例：MAP[11][5] 是第 11 行、第 5 列，它画在世界坐标
 *      x = 5 × 40 = 200 像素，y = 11 × 40 = 440 像素的位置。
 * 4. 世界坐标 → 画布坐标 的换算（摄像机干的事）：
 *      画布坐标 = 世界坐标 - camera.x / camera.y
 *    绘制时统一用 ctx.translate(-camera.x, -camera.y) 平移整个画面，
 *    坦克靠近屏幕边缘时 camera 跟着移动，就会"滚"出原本看不到的区域。
 * 5. 反过来，画布坐标 → 数组下标（鼠标瞄准、子弹打墙时要用）：
 *      先加回摄像机偏移变成世界坐标，再 除以格子大小并向下取整。
 */

const TILE = 40;      // 每个格子的边长（像素），和坦克一样大
const MAP_ROWS = 30;  // 地图行数：30 行
const MAP_COLS = 30;  // 地图列数：30 列

// 世界（整张地图）的总像素尺寸
const WORLD_W = MAP_COLS * TILE;   // 30 × 40 = 1200 像素
const WORLD_H = MAP_ROWS * TILE;   // 30 × 40 = 1200 像素

// 原创标识地图：中央用砖墙拼出 "sjm" 三个字母 + 四角散落砖墙
// - 字母来源：之前确认的 ASCII 示意图（5 列宽 × 7 行高，笔画 1 格粗）
// - 位置：第 11~17 行，s 占第 5~9 列，j 占第 12~16 列，m 占第 19~23 列
// - 字母之间各隔 2 列（s-j 间隔列 10~11，j-m 间隔列 17~18）
// - 玩家出生点在第 14 行第 10 列，正好在 s 和 j 之间的走廊里
// - 四角和两侧有散落的 2×2 砖块和小墙段，作为额外掩体
// - MAP 值含义：0 = 空地，1 = 受损砖墙（剩 1 血），2 = 完好砖墙（2 血）
const MAP = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 0 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 1 行
    [0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0], // 第 2 行：左上+右上 2×2
    [0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0], // 第 3 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 4 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 5 行：顶部小墙
    [0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 6 行
    [0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0], // 第 7 行：左侧+右侧掩体
    [0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0], // 第 8 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 9 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 10 行
    [0,0,0,0,0,2,2,2,2,0,0,0,0,2,2,2,0,0,2,0,0,0,2,0,0,0,0,0,0,0], // 第 11 行：s顶横 j顶横 m两肩
    [0,0,0,0,0,2,0,0,0,0,0,0,0,0,2,0,0,0,2,2,0,2,2,0,0,0,0,0,0,0], // 第 12 行：s左竖 j竖  m斜开
    [0,0,0,0,0,2,0,0,0,0,0,0,0,0,2,0,0,0,2,0,2,0,2,0,0,0,0,0,0,0], // 第 13 行：s左竖 j竖  m中点
    [0,0,0,0,0,0,2,2,2,0,0,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0,0,0,0,0], // 第 14 行：s中横 j竖  m两竖
    [0,0,0,0,0,0,0,0,0,2,0,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0,0,0,0,0], // 第 15 行：s右竖 j竖  m两竖
    [0,0,0,0,0,0,0,0,0,2,0,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0,0,0,0,0], // 第 16 行：s右竖 j竖  m两竖
    [0,0,0,0,0,2,2,2,2,0,0,0,2,2,2,0,0,0,2,0,0,0,2,0,0,0,0,0,0,0], // 第 17 行：s底横 j底钩 m两竖
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 18 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 19 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,2,0,0,0,0,0,0,0,0,0,0], // 第 20 行：下方横墙
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,2,0,0,0,0,0,0,0,0,0,0], // 第 21 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 22 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 23 行
    [0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0], // 第 24 行：下左+下右掩体
    [0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0], // 第 25 行
    [0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0], // 第 26 行：左下+右下 2×2
    [0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0], // 第 27 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 28 行
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 第 29 行
];

/**
 * 画出地图上所有的砖墙
 * 遍历二维数组：外层循环走"行"，内层循环走"列"，
 * 碰到 1 就在对应位置画一块 40x40 的棕色砖头。
 */
function drawBricks() {
    for (let row = 0; row < MAP_ROWS; row++) {          // 从第 0 行到第 29 行
        for (let col = 0; col < MAP_COLS; col++) {      // 从第 0 列到第 29 列
            const hp = MAP[row][col];                    // 读取血量：0=空地, 1=受损, 2=完好
            if (hp === 0) continue;                      // 空地直接跳过

            // 数组下标换算成世界坐标：x = 列号 × 40，y = 行号 × 40
            const x = col * TILE;
            const y = row * TILE;

            // 视口裁剪：算出这块砖在画布上的位置，
            // 完全在屏幕外面的砖（世界太大，镜头只看到一角）直接跳过，不浪费性能
            const viewX = x - camera.x;
            const viewY = y - camera.y;
            if (viewX + TILE < 0 || viewX > CANVAS_W || viewY + TILE < 0 || viewY > CANVAS_H) {
                continue;                               // 在镜头外面，看不见，不用画
            }

            // 砖块底色（棕色）
            ctx.fillStyle = '#a0522d';
            ctx.fillRect(x, y, TILE, TILE);

            // 顶部的亮色高光，做出立体感
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(x, y, TILE, 4);

            // 画出砖缝（深色线条）：一条横缝 + 上下错开的竖缝，像砌砖一样
            ctx.strokeStyle = '#5c2e0d';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, y + TILE / 2); ctx.lineTo(x + TILE, y + TILE / 2);     // 中间横缝
            ctx.moveTo(x + TILE / 2, y); ctx.lineTo(x + TILE / 2, y + TILE / 2); // 上半竖缝
            ctx.moveTo(x + TILE / 4, y + TILE / 2); ctx.lineTo(x + TILE / 4, y + TILE);   // 下左竖缝
            ctx.moveTo(x + TILE * 3 / 4, y + TILE / 2); ctx.lineTo(x + TILE * 3 / 4, y + TILE); // 下右竖缝
            ctx.stroke();

            // 外框描边，让每块砖边界清晰
            ctx.strokeStyle = '#4a2408';
            ctx.strokeRect(x + 0.75, y + 0.75, TILE - 1.5, TILE - 1.5);

            // 受损砖墙（hp=1）：画裂纹，让玩家一眼看出这块砖挨过一炮
            if (hp === 1) {
                ctx.strokeStyle = '#2a1a05';
                ctx.lineWidth = 2;
                ctx.beginPath();
                // 对角裂纹 + 横向裂缝
                ctx.moveTo(x + 5, y + 5);
                ctx.lineTo(x + TILE / 2, y + TILE / 2);
                ctx.lineTo(x + TILE - 8, y + TILE / 2 + 6);
                ctx.moveTo(x + TILE / 3, y + TILE * 2 / 3);
                ctx.lineTo(x + TILE * 2 / 3, y + TILE - 5);
                ctx.stroke();
            }
        }
    }
}

/**
 * 查询画布上某个点落在哪一格、那一格是不是砖墙
 * @param {number} x 点的画布 X 坐标
 * @param {number} y 点的画布 Y 坐标
 * @returns {boolean} true = 这个点在砖墙里
 */
function isBrickAt(x, y) {
    // 画布坐标 → 数组下标：除以格子大小再向下取整
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    // 防止越界（点在画布外面时直接当作没有墙）
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return false;
    return MAP[row][col] > 0;   // >0 表示有砖墙（1=受损 或 2=完好）
}

/**
 * 判断坦克移动到 (x, y) 位置是否合法（不出世界 + 不压到砖墙）
 * 这是"坦克撞墙检测"的核心：移动前先试探，撞墙就不动。
 *
 * 工作原理（AABB 碰撞检测）：
 * 1. 把坦克看成一个正方形盒子（AABB = 轴对齐包围盒）。
 * 2. 用"缩小的判定框"去检查：判定框比车身四周各缩小 4 像素，
 *    这样坦克贴着墙走的时候不会因为 1 像素的误差而卡住。
 * 3. 算出判定框覆盖到了哪几行、哪几列的格子，
 *    只要其中有任何一格是砖墙（数字 >0），就判定"撞墙"，不能移动。
 * 4. 世界边界同样算"撞墙"（不能开出世界外）。
 *
 * @param {number} x 坦克左上角的目标 X 坐标
 * @param {number} y 坦克左上角的目标 Y 坐标
 * @param {number} size 坦克边长（玩家和敌方都是 40，但参数化更通用）
 * @returns {boolean} true = 这个位置站得住，false = 撞墙/出界
 */
function canStandAt(x, y, size) {
    size = size || player.size;           // 没传 size 时默认用玩家坦克的尺寸
    // ① 世界边界检测：坦克完整车身不能跑出 1200x1200 的世界
    if (x < 0 || y < 0 || x + size > WORLD_W || y + size > WORLD_H) {
        return false;
    }

    // ② 基地检测：基地是实体方块，玩家和敌方都不能穿过它
    //    用 AABB 判断坦克判定框是否和基地矩形重叠
    const inset = 4;
    if (x + size - inset > base.x && x + inset < base.x + base.w &&
        y + size - inset > base.y && y + inset < base.y + base.h) {
        return false;   // 和基地重叠 → 不能走
    }

    // ③ 砖墙检测：判定框 = 车身向内缩小 4 像素
    const left = x + inset;
    const top = y + inset;
    const right = x + size - inset;
    const bottom = y + size - inset;

    // 判定框覆盖的格子范围（行号、列号），减 0.01 防止正好压线时多数一格
    const colStart = Math.floor(left / TILE);
    const colEnd = Math.floor((right - 0.01) / TILE);
    const rowStart = Math.floor(top / TILE);
    const rowEnd = Math.floor((bottom - 0.01) / TILE);

    // 逐格检查：只要有一格是砖墙，就撞墙
    for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
            if (MAP[row][col] > 0) return false;   // >0 表示有砖墙（受损或完好都算挡路）
        }
    }
    return true; // 所有覆盖的格子都是空地，可以站
}

/* ==================== 2.7 摄像机（画面跟随坦克滚动） ====================
 *
 * 工作原理：
 * 1. camera.x / camera.y 表示"视口左上角"在世界坐标里的位置。
 *    世界 1200x1200，画布只有 800x600，一次只能看到世界的一角。
 * 2. 每帧让镜头对准坦克：目标位置 = 坦克中心 - 半个画布，
 *    这样坦克永远处在画面正中央；坦克往边界开时镜头跟着滚，
 *    原本藏在屏幕外的世界区域就被"滚"出来显示。
 * 3. 用夹紧（clamp）把镜头限制在合法范围（0 ~ 世界尺寸 - 画布尺寸），
 *    否则坦克走到世界边缘时，镜头会照到世界外面的空白。
 * 4. 绘制时统一 ctx.translate(-camera.x, -camera.y) 平移整个坐标系，
 *    后面画砖墙、坦克、炮弹就都能直接用"世界坐标"来画。
 */

const camera = { x: 0, y: 0 }; // 视口左上角的世界坐标

/**
 * 每帧更新一次摄像机位置，让画面始终以坦克为中心
 */
function updateCamera() {
    // 目标：让坦克中心正好落在画布中心
    const targetX = player.x + player.size / 2 - CANVAS_W / 2;
    const targetY = player.y + player.size / 2 - CANVAS_H / 2;

    // 夹紧到 [0, 世界尺寸 - 画布尺寸]，保证镜头不出世界
    camera.x = Math.max(0, Math.min(targetX, WORLD_W - CANVAS_W));
    camera.y = Math.max(0, Math.min(targetY, WORLD_H - CANVAS_H));
}

/* ==================== 3. 键盘控制（按键监听） ====================
 *
 * 工作原理：
 * 1. 用一个 keys 对象当"按键状态表"，记录每个键当前是否被按住。
 *    例如按住 W 时，keys['w'] = true；松开后变回 false。
 * 2. 给 window 挂两个事件监听器：
 *    - keydown：任意键被按下的一瞬间触发，把对应键记为 true；
 *    - keyup：按键松开的一瞬间触发，把对应键记为 false。
 * 3. 这样在游戏循环里，每一帧只需要查一下 keys 表，
 *    就知道玩家"现在正按着哪些键"，从而决定往哪个方向移动。
 *    （这种"记录状态"的方式比"按下瞬间移动一下"更流畅，
 *      因为按住不放时每一帧都会检测到该键处于按下状态。）
 * 4. 用 e.key.toLowerCase() 把按键名统一转成小写，
 *    这样无论开没开大写锁定、按没按 Shift，都能正确识别 W/A/S/D。
 */

const keys = {}; // 按键状态表：keys['w'] === true 表示 W 正被按住

// 键被按下时触发
window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;   // 统一转小写后，在状态表里把该键标记为"按住"
    // ESC 键：游戏中暂停 / 暂停中继续
    if (e.key === 'Escape') {
        togglePause();
    }
});

// 键被松开时触发
window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;  // 在状态表里把该键标记为"松开"
});

/**
 * 暂停/继续切换
 * - 只有在 playing 或 paused 状态才切换（主页/结束时 ESC 无效）
 * - 切换时同步按钮文字（暂停 ↔ 继续）
 */
function togglePause() {
    const btn = document.getElementById('pauseBtn');
    if (pageState === 'playing') {
        pageState = 'paused';
        if (btn) btn.textContent = '继续';
    } else if (pageState === 'paused') {
        pageState = 'playing';
        if (btn) btn.textContent = '暂停';
    }
}

/* ---------- 鼠标控制（瞄准 + 开火） ----------
 *
 * 工作原理：
 * 1. mousemove：鼠标在画布上移动时，把鼠标位置换算成"画布坐标"记进 mouse 对象，
 *    每一帧坦克都会平滑地把炮管转向鼠标（详见 update 里的旋转逻辑）。
 *    换算时要用画布的显示尺寸（getBoundingClientRect）除以内部尺寸，
 *    因为 CSS 里画布可能被缩小显示（手机上 max-width:100%），坐标需要等比放大才准。
 * 2. mousedown：只监听画布，e.button === 0 表示按下的是"鼠标左键"，
 *    每点一次左键就调用一次 fire()，炮弹沿坦克当前朝向射出。
 */

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();          // 画布在页面上的显示区域
    mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);   // 等比换算成画布内部坐标
    mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
});

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0 && pageState === 'playing') {   // 0 = 左键，且仅在游戏中可开火
        fire();                       // 开火！
    }
});

// 让画布鼠标显示成"十字准星"，暗示这里可以点击开火
canvas.style.cursor = 'crosshair';

/* ==================== 3.5 开火与炮弹 ==================== */

// 炮弹数组：屏幕上同时可能有多颗炮弹在飞，用数组统一管理
const bullets = [];

/**
 * 开火：从炮口位置沿坦克当前朝向角度发射一颗炮弹
 * （角度是 360 度任意的，用三角函数 cos/sin 分解成水平、垂直速度）
 */
function fire() {
    // 坦克中心坐标
    const cx = player.x + player.size / 2;
    const cy = player.y + player.size / 2;
    const muzzle = 30;                          // 炮口离坦克中心的距离（炮管长度）

    bullets.push({
        x: cx + Math.cos(player.angle) * muzzle,   // 出生点：炮口处（沿朝向偏移）
        y: cy + Math.sin(player.angle) * muzzle,
        vx: Math.cos(player.angle) * 400,          // 水平速度 = cos(角度) × 弹速
        vy: Math.sin(player.angle) * 400,          // 垂直速度 = sin(角度) × 弹速
        size: 6                                    // 炮弹大小
    });
    playFireSound();   // 玩家每次开火都播放音效
}

/**
 * 更新所有炮弹的位置，处理"飞出画布"和"打中砖墙"两种情况
 * @param {number} dt 距离上一帧的秒数
 */
function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {  // 倒着遍历，方便边遍历边删除
        const b = bullets[i];
        b.x += b.vx * dt;                     // 按速度移动
        b.y += b.vy * dt;

        // 情况一：飞出世界边界（任意方向）→ 从数组里删掉，避免越积越多拖慢游戏
        if (b.x < -20 || b.x > WORLD_W + 20 || b.y < -20 || b.y > WORLD_H + 20) {
            bullets.splice(i, 1);
            continue;                         // 这颗炮弹已删，继续处理下一颗
        }

        /* ---------- 情况二：炮弹打中砖墙（碰撞检测 + 血量系统） ----------
         *
         * 工作原理：
         * 1. 用炮弹的"中心点"去查地图：isBrickAt 内部会把坐标除以格子
         *    大小并向下取整，找到炮弹当前落在哪一格（第几行第几列）。
         * 2. 如果那一格有砖墙（MAP 值 > 0），说明打中了：
         *    - 砖墙血量减 1（MAP 值从 2→1 或从 1→0）
         *    - 如果减到 0，砖墙被摧毁，下一帧 drawBricks 不再画它；
         *    - 如果还有 1 血，砖墙变成"受损"状态，画时会带裂纹，还需要再打一炮。
         *    - 无论摧毁还是只打伤，炮弹自身都消失（不穿墙）。
         */
        if (isBrickAt(b.x, b.y)) {
            const col = Math.floor(b.x / TILE);   // 炮弹所在的列号
            const row = Math.floor(b.y / TILE);   // 炮弹所在的行号
            MAP[row][col]--;                       // 血量减 1：2→1（受损）或 1→0（摧毁）
            bullets.splice(i, 1);                  // 炮弹消失
            continue;                               // 这颗炮弹已处理，跳过敌方检测
        }

        /* ---------- 情况三：炮弹打中敌方坦克（碰撞检测 + 血量系统） ----------
         *
         * 工作原理（点 vs 矩形 + 血量）：
         * 1. 炮弹是一个小圆点，近似看成一个"点"。
         * 2. 遍历所有敌方坦克，用 pointInRect 判断炮弹中心点
         *    是否落在某辆敌方坦克的矩形范围内。
         * 3. 命中后：
         *    - 炮弹消失（splice 删掉）；
         *    - 敌方血量 -1（敌方有 5 血，要打 5 发才能消灭）；
         *    - 血量归零时，敌方坦克消失，得分 +10。
         */
        let hitEnemy = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (pointInRect(b.x, b.y, e.x, e.y, e.size, e.size)) {
                bullets.splice(i, 1);               // 炮弹消失
                e.hp -= playerBulletDamage;          // 敌方血量减少（双倍伤害时 -2）
                hitEnemy = true;
                // 血量归零 → 敌方坦克被消灭，得分 +10，掉落随机 buff
                if (e.hp <= 0) {
                    dropBuff(e.x + e.size / 2, e.y + e.size / 2);   // 在敌人中心掉落 buff
                    enemies.splice(j, 1);
                    score += 10;
                    if (score > highScore) highScore = score;
                    updateScoreDisplay();
                }
                break;                               // 一颗炮弹只能打中一辆坦克
            }
        }
        if (hitEnemy) continue;                     // 这颗炮弹已处理，继续下一颗

        /* ---------- 情况四：炮弹打中 Boss ----------
         * Boss 战阶段，玩家子弹打中 Boss → Boss 血量 -playerBulletDamage */
        if (boss && gamePhase === 'boss' && pointInRect(b.x, b.y, boss.x, boss.y, boss.size, boss.size)) {
            bullets.splice(i, 1);                   // 炮弹消失
            boss.hp -= playerBulletDamage;          // Boss 血量减少
            continue;
        }
    }
}

/**
 * 画出所有炮弹（黄色小圆点，像曳光弹）
 */
function drawBullets() {
    ctx.fillStyle = '#ffe066';
    for (const b of bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size / 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * 画基地：蓝色矩形 + 上方血条
 * 血条随血量从绿色（满血）渐变到红色（濒危），让玩家一眼看出基地还剩多少血
 */
function drawBase() {
    // 基地主体（深蓝底 + 浅蓝边框，像金属堡垒）
    ctx.fillStyle = '#1a4a7a';
    ctx.fillRect(base.x, base.y, base.w, base.h);
    ctx.strokeStyle = '#4a9ada';
    ctx.lineWidth = 2;
    ctx.strokeRect(base.x + 1, base.y + 1, base.w - 2, base.h - 2);

    // 基地上的标志（白色五角星，表示这是己方基地）
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', base.x + base.w / 2, base.y + base.h / 2);

    // 血条：画在基地正上方
    const barW = base.w;                // 血条宽 = 基地宽
    const barH = 6;                     // 血条高
    const barX = base.x;
    const barY = base.y - 12;           // 基地上方 12 像素

    // 血条背景（暗灰色）
    ctx.fillStyle = '#333333';
    ctx.fillRect(barX, barY, barW, barH);

    // 血量条：宽度按 hp/maxHp 比例缩放
    const hpRatio = base.hp / base.maxHp;     // 0~1
    const hpBarW = barW * hpRatio;
    // 颜色随血量变化：满血绿 → 半血黄 → 低血红
    if (hpRatio > 0.5) {
        ctx.fillStyle = '#4caf50';            // 绿色
    } else if (hpRatio > 0.25) {
        ctx.fillStyle = '#ffc107';            // 黄色
    } else {
        ctx.fillStyle = '#f44336';            // 红色
    }
    ctx.fillRect(barX, barY, hpBarW, barH);

    // 血条边框
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.textAlign = 'left';  // 还原对齐方式
}

/** 画敌方子弹：红色小圆点（区别于玩家的黄色子弹） */
function drawEnemyBullets() {
    ctx.fillStyle = '#ff4444';
    for (const b of enemyBullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size / 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * 画敌方坦克头顶的血条
 * 血条随血量从绿色（满血）渐变到红色（濒危），让玩家一眼看出还剩几发能消灭
 */
function drawEnemyHpBar(e) {
    const barW = e.size;                    // 血条宽 = 坦克宽
    const barH = 4;                         // 血条高（比较细，不挡视线）
    const barX = e.x;
    const barY = e.y - 8;                   // 坦克上方 8 像素

    // 血条背景（暗灰色）
    ctx.fillStyle = '#333333';
    ctx.fillRect(barX, barY, barW, barH);

    // 血量条：宽度按 hp/maxHp 比例缩放
    const hpRatio = e.hp / e.maxHp;
    const hpBarW = barW * hpRatio;
    if (hpRatio > 0.5) {
        ctx.fillStyle = '#4caf50';            // 绿色（满血）
    } else if (hpRatio > 0.25) {
        ctx.fillStyle = '#ffc107';            // 黄色（半血）
    } else {
        ctx.fillStyle = '#f44336';            // 红色（濒危）
    }
    ctx.fillRect(barX, barY, hpBarW, barH);

    // 血条边框
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, barY, barW, barH);
}

/* ==================== 3.9 敌方坦克更新（追踪玩家 + 定时开火） ====================
 *
 * 【追踪 AI 的工作原理】
 * 1. 每帧算出"玩家在敌方的哪个方向"：
 *    - 比较 X 方向和 Y 方向的距离差，哪个更大就先走哪个方向
 *    （比如玩家在右下方且水平距离更远，就先朝右走）。
 * 2. 试探这个方向能不能走（canStandAt）：
 *    - 能走 → 朝玩家移动一步；
 *    - 不能走（撞墙）→ 随机尝试其他 3 个方向，找到能走的就走，
 *      都走不了就原地不动（被卡在死角）。
 * 3. 炮管始终指向当前移动方向（方便开火时子弹朝玩家飞）。
 *
 * 【开火逻辑】
 * - 每辆敌方坦克有 fireCooldown（开火冷却秒数），
 *   每帧减 dt，减到 ≤0 就朝当前朝向发一颗子弹，然后重置冷却（1.5~3 秒）。
 * - 敌方子弹用独立的 enemyBullets 数组管理。
 *
 * 【碰撞检测汇总】
 * - 玩家子弹 vs 敌方：在 updateBullets 里用 pointInRect 判断，命中 +10 分。
 * - 敌方子弹 vs 玩家：在 updateEnemyBullets 里判断，命中扣玩家 1 血。
 * - 敌方子弹 vs 基地：在 updateEnemyBullets 里判断，命中扣基地 1 血。
 * - 敌方撞玩家：用 rectsOverlap 判断，碰到扣玩家 1 血（不是直接游戏结束）。
 */

/**
 * 判断点 (px, py) 是否落在矩形 (rx, ry, rw, rh) 内
 * 用于"子弹打敌方坦克/玩家/基地"——炮弹是个小圆点，近似看成一个点
 */
function pointInRect(px, py, rx, ry, rw, rh) {
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/**
 * 判断两个矩形是否重叠（AABB 碰撞）
 * 用于"敌方坦克碰到玩家坦克"
 */
function rectsOverlap(a, b) {
    // 支持两种矩形格式：{x,y,size}（坦克）和 {x,y,w,h}（基地）
    const aw = a.w || a.size, ah = a.h || a.size;
    const bw = b.w || b.size, bh = b.h || b.size;
    return a.x < b.x + bw && a.x + aw > b.x &&
           a.y < b.y + bh && a.y + ah > b.y;
}

/** 敌方坦克开火：朝当前朝向发射一颗子弹（速度由关卡决定）
 * @param {object} e 敌方坦克
 * @param {boolean} breaksBrick 可选，true 表示这颗子弹能打碎砖墙（卡墙时用来破障） */
function enemyFire(e, breaksBrick) {
    const half = e.size / 2;
    const muzzleDist = half + 10;              // 炮口在车体外 10 像素
    const bSpeed = e.bulletSpeed || 480;      // 子弹速度（由关卡决定，默认 480）
    enemyBullets.push({
        x: e.x + half + Math.cos(e.angle) * muzzleDist,   // 炮口 X
        y: e.y + half + Math.sin(e.angle) * muzzleDist,   // 炮口 Y
        vx: Math.cos(e.angle) * bSpeed,       // 子弹速度 X 分量
        vy: Math.sin(e.angle) * bSpeed,       // 子弹速度 Y 分量
        size: 6,                               // 子弹大小
        breaksBrick: !!breaksBrick,           // 标记为破墙子弹：打中砖墙会扣血
    });
}

/**
 * 算出从敌方坦克中心到目标中心的方向编号（0=上 1=下 2=左 3=右）
 * 比较水平/垂直距离，绝对值更大的那个就是优先方向
 */
function dirToward(e, tx, ty) {
    const dx = tx - (e.x + e.size / 2);     // 目标相对敌方的 X 偏移
    const dy = ty - (e.y + e.size / 2);     // 目标相对敌方的 Y 偏移
    if (Math.abs(dx) > Math.abs(dy)) {
        return dx > 0 ? 3 : 2;              // 水平距离大 → 走右(3)或左(2)
    } else {
        return dy > 0 ? 1 : 0;              // 垂直距离大 → 走下(1)或上(0)
    }
}

/**
 * 更新所有敌方坦克：按固定角色锁定目标 + 追踪 + 定时开火 + 碰玩家扣血
 *
 * 【目标锁定的工作原理】
 * 1. 开局生成时，每辆坦克被分配一个固定角色 role：
 *    - 一半 'base'（冲基地），一半 'player'（追玩家）。
 * 2. 每帧把 e.target 设为自己的 role，之后不再动态切换——
 *    冲基地的死磕基地，追玩家的死磕玩家。
 * 3. 锁定后朝目标方向移动（用 dirToward 算方向）。
 * 4. 开火也朝锁定目标的方向打（炮管跟着转向）。
 *
 * @param {number} dt 帧间隔秒数
 */
function updateEnemies(dt) {
    if (gameState !== 'playing') return;     // 游戏已结束就不动了

    // 基地中心坐标（锁定目标时用）
    const baseCx = base.x + base.w / 2;
    const baseCy = base.y + base.h / 2;

    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const distance = e.speed * dt;                // 这一帧要走多少像素

        /* ---------- 目标锁定：由开局固定角色决定 ----------
         * 开局时一半敌人分配为 'base'（冲基地），另一半为 'player'（追玩家），
         * 之后不再动态切换，各自死磕自己的目标。 */
        e.target = e.role;

        // 锁定目标的中心坐标
        const targetX = e.target === 'player' ? player.x + player.size / 2 : baseCx;
        const targetY = e.target === 'player' ? player.y + player.size / 2 : baseCy;

        /* ---------- 追踪移动：朝锁定目标方向走 ----------
         * 先算优先方向（dirToward），被墙挡住就试其他方向绕路。
         * 为了行动更灵活，方向试探顺序用"优先→垂直两个→对侧"。 */
        const preferredDir = dirToward(e, targetX, targetY);
        const preferredDirObj = DIRS[preferredDir];
        // 朝目标方向前进一步会不会被挡（用来判断"卡墙"）
        const preferredBlocked = !canStandAt(
            e.x + preferredDirObj.dx * distance,
            e.y + preferredDirObj.dy * distance,
            e.size
        );
        // 正前方一格是不是砖墙（决定要不要开炮打墙）
        const frontCx = e.x + e.size / 2 + preferredDirObj.dx * (e.size / 2 + 6);
        const frontCy = e.y + e.size / 2 + preferredDirObj.dy * (e.size / 2 + 6);
        const brickInFront = isBrickAt(frontCx, frontCy);

        const tryOrder = [preferredDir];
        const opposite = (preferredDir + 2) % 4;
        for (let d = 0; d < 4; d++) {
            if (d !== preferredDir && d !== opposite) tryOrder.push(d);
        }
        tryOrder.push(opposite);

        for (const dirIdx of tryOrder) {
            const dir = DIRS[dirIdx];
            const nx = e.x + dir.dx * distance;
            const ny = e.y + dir.dy * distance;
            if (canStandAt(nx, ny, e.size)) {
                e.x = nx;
                e.y = ny;
                e.dirIndex = dirIdx;
                e.angle = dir.angle;               // 炮管跟着转向
                break;
            }
        }

        /* ---------- 卡墙破障：朝目标方向被挡超 2 秒 → 开炮打碎挡路的砖墙 ----------
         * 优先方向被挡就累计 stuckTimer；一旦畅通就清零。
         * 累计超 2 秒且正前方是砖墙时，朝该方向开一颗"破墙子弹"
         * （带 breaksBrick 标记，能扣砖墙血），开完重置计时器避免连发。 */
        if (preferredBlocked) {
            e.stuckTimer += dt;
        } else {
            e.stuckTimer = 0;
        }
        if (e.stuckTimer > 2 && brickInFront) {
            e.angle = preferredDirObj.angle;       // 炮管对准挡路的墙
            enemyFire(e, true);                   // 破墙子弹：打中砖墙会扣血
            e.stuckTimer = 0;                      // 打完重置，等下一轮再判断
        }

        /* ---------- 定时开火：朝锁定目标方向打 ----------
         * 冷却好了就开一炮。为了让子弹更准，开火时炮管直接对准目标方向。 */
        e.fireCooldown -= dt;
        if (e.fireCooldown <= 0) {
            // 开火时炮管直接对准目标（用 atan2 算精确角度，360 度）
            e.angle = Math.atan2(targetY - (e.y + e.size/2), targetX - (e.x + e.size/2));
            enemyFire(e);
            const cfg = LEVELS[currentLevel - 1];
            e.fireCooldown = cfg.enemyFireCooldown * (0.7 + Math.random() * 0.6);   // 冷却 ±30% 随机
        }

        /* ---------- 敌方碰到玩家：先检查护盾，再扣 1 血 ----------
         * 玩家有短暂无敌时间，防止一帧内被扣好几滴血。 */
        if (playerInvincible <= 0 && rectsOverlap(e, player)) {
            if (playerShield > 0) {
                playerShield--;                // 有护盾 → 消耗护盾
                playerInvincible = 1.5;        // 给一点无敌时间防止连续扣
            } else {
                playerLives--;
                playerInvincible = 1.5;
                updateScoreDisplay();
                if (playerLives <= 0) {
                    gameState = 'lose';
                    return;
                }
            }
        }
    }
}

/**
 * 更新所有敌方子弹：移动 + 碰撞检测（打玩家 / 打基地 / 打砖墙 / 出界）
 * @param {number} dt 帧间隔秒数
 */
function updateEnemyBullets(dt) {
    if (gameState !== 'playing') return;

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x += b.vx * dt;                          // 移动
        b.y += b.vy * dt;

        // ① 出世界边界 → 删除
        if (b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
            enemyBullets.splice(i, 1);
            continue;
        }
        // ② 打中砖墙 → 子弹消失
        //    普通：砖墙不掉血（敌方平时不破坏地图）
        //    带 breaksBrick 标记：砖墙血量 -1（卡墙时敌人专门开的破障子弹）
        if (isBrickAt(b.x, b.y)) {
            if (b.breaksBrick) {
                const col = Math.floor(b.x / TILE);   // 子弹所在的列
                const row = Math.floor(b.y / TILE);   // 子弹所在的行
                MAP[row][col]--;                       // 2→1（受损）或 1→0（摧毁）
            }
            enemyBullets.splice(i, 1);
            continue;
        }
        // ③ 打中玩家 → 先检查护盾，再扣血（有无敌时间保护）
        if (playerInvincible <= 0 && pointInRect(b.x, b.y, player.x, player.y, player.size, player.size)) {
            enemyBullets.splice(i, 1);
            if (playerShield > 0) {
                playerShield--;                    // 有护盾 → 消耗护盾，不扣血
            } else {
                playerLives--;
                playerInvincible = 1.5;
                updateScoreDisplay();
                if (playerLives <= 0) {
                    gameState = 'lose';
                    return;
                }
            }
            continue;
        }
        // ④ 打中基地 → 基地扣 1 血
        if (pointInRect(b.x, b.y, base.x, base.y, base.w, base.h)) {
            base.hp--;
            enemyBullets.splice(i, 1);
            if (base.hp <= 0) {
                gameState = 'lose';               // 基地被摧毁 → 失败
                return;
            }
            continue;
        }
    }
}


/* ==================== 4. 位置更新（含边界检测） ==================== */

/**
 * 每一帧调用一次，根据按住的按键更新坦克位置
 * @param {number} dt 距离上一帧过去了多少秒（deltaTime）
 */
function update(dt) {
    // 游戏结束后玩家不能移动/开火（敌方更新内部已做同样的判断）
    if (gameState !== 'playing') {
        updateCamera();   // 但摄像机仍跟随，方便玩家看清最终位置
        return;
    }

    // 移动距离 = 速度 × 时间。
    // 例如速度 200 像素/秒，这一帧花了 0.016 秒，就移动 200 × 0.016 ≈ 3.2 像素。
    // 用"速度 × 时间"而不是"每次固定几像素"，可以保证在不同刷新率的
    // 显示器上（60Hz / 144Hz）坦克移动快慢一致。
    const distance = player.speed * dt;

    /* ---------- 试探式移动 + 撞墙检测 ----------
     *
     * 工作原理：
     * 1. 先把这一帧想走的位移算出来，分成 X、Y 两个轴（dx、dy）。
     * 2. 移动前先"试探"：调用 canStandAt(目标位置) 检查坦克移动过去
     *    会不会压到砖墙或开出画布，撞墙就保持不动。
     * 3. X 轴和 Y 轴分开检测的好处：斜着按 W+A 贴墙走时，
     *    被墙挡住的那个轴停住，另一个轴还能继续滑动，手感顺滑。
     */
    let dx = 0, dy = 0;
    if (keys['w']) dy -= distance; // W：向上（Y 轴负方向）
    if (keys['s']) dy += distance; // S：向下（Y 轴正方向）
    if (keys['a']) dx -= distance; // A：向左（X 减小）
    if (keys['d']) dx += distance; // D：向右（X 增大）

    if (dx !== 0 && canStandAt(player.x + dx, player.y)) player.x += dx; // X 轴试探
    if (dy !== 0 && canStandAt(player.x, player.y + dy)) player.y += dy; // Y 轴试探

    /* ---------- 360 度旋转：炮塔平滑转向鼠标 ----------
     *
     * 工作原理：
     * 1. 鼠标事件给的是"画布坐标"，而坦克用的是"世界坐标"，
     *    所以要先加上摄像机偏移，把鼠标换算成世界坐标再算角度。
     * 2. 目标角度 = atan2(鼠标世界Y - 坦克中心Y, 鼠标世界X - 坦克中心X)。
     *    atan2 返回从坦克中心指向鼠标的角度（0 = 右，PI/2 = 下……），
     *    可以是 0~360 度（弧度）里的任何值。
     * 3. diff = 目标角度 - 当前角度，就是要转过的差值。
     *    但角度有"绕圈"问题：比如当前 3.1 弧度、目标 -3.1 弧度，
     *    直接相减差值很大，其实只差 0.08 弧度（转一小段就到了）。
     *    用 Math.atan2(sin(diff), cos(diff)) 把差值规范到 -PI ~ PI 之间，
     *    保证坦克永远走"最短的那条弧"去追鼠标。
     * 4. 每帧最多只能转 turnSpeed × dt 弧度，所以炮塔是平滑地"甩"过去，
     *    而不是瞬间跳变，看起来像真坦克转炮塔。
     */
    if (mouse.x !== null) {
        const wx = mouse.x + camera.x;             // 鼠标的画布坐标 → 世界坐标
        const wy = mouse.y + camera.y;
        const cx = player.x + player.size / 2;     // 坦克中心 X
        const cy = player.y + player.size / 2;     // 坦克中心 Y
        const target = Math.atan2(wy - cy, wx - cx); // 指向鼠标的目标角度

        let diff = target - player.angle;                         // 需要转动的角度差
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));        // 规范到 -PI~PI，走最短弧

        const maxTurn = player.turnSpeed * dt;                    // 这一帧最多能转多少
        // 夹紧：差值大就转 maxTurn，差值小就直接转到位
        player.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }

    /* ---------- 摄像机跟随 ----------
     * 放在移动和旋转之后：先确定坦克的最新位置，再让镜头追上它。
     * 坦克开向画面边缘时，镜头跟着平移，屏幕外的世界区域就显示出来了。 */
    updateCamera();

    /* 说明：世界边界和砖墙的拦截现在统一由上面的 canStandAt 完成
     *（边界检测就是"撞上世界边缘这堵看不见的墙"），所以这里不再需要单独 clamp。 */

    // 更新所有在飞的炮弹（含子弹打砖墙、子弹打敌方坦克 + Boss）
    updateBullets(dt);

    // 更新所有敌方坦克（追踪玩家 + 撞墙绕路 + 定时开火 + 碰玩家扣血）
    updateEnemies(dt);

    // 更新所有敌方子弹（打玩家 / 打基地 / 打砖墙 / 出界）
    updateEnemyBullets(dt);

    // 更新 Boss 炮弹（追踪 + 打玩家 / 打砖墙消失 / 不破坏基地）
    updateBossBullets(dt);

    // 更新掉落物（玩家拾取 buff）
    updatePowerups(dt);

    // 更新粒子（Boss 死亡粉碎特效）
    updateParticles(dt);

    // 更新 Boss（Boss 战阶段才运行）
    if (boss) updateBoss(dt);

    // 玩家无敌时间倒计时
    if (playerInvincible > 0) playerInvincible -= dt;

    // 双倍伤害 buff 倒计时
    if (doubleDamageTimer > 0) {
        doubleDamageTimer -= dt;
        if (doubleDamageTimer <= 0) playerBulletDamage = 1;   // 时间到恢复正常伤害
    }

    /* ---------- 胜负判定 ----------
     * - 普通敌人全灭 → 生成 Boss，进入 Boss 战阶段
     * - Boss 被击败 → 游戏胜利
     * 失败条件在 updateEnemies / updateEnemyBullets / updateBoss 内已判定：
     *   - 玩家血量归零 → lose
     *   - 基地血量归零 → lose */
    if (gameState === 'playing') {
        if (gamePhase === 'fighting' && enemies.length === 0) {
            spawnBoss();                // 生成 Boss
            gamePhase = 'boss';         // 切换到 Boss 战
        } else if (gamePhase === 'boss' && boss && boss.hp <= 0) {
            // Boss 被击败：先在 Boss 中心生成"粉碎"粒子特效（数量按 Boss 体积放大）
            spawnDeathParticles(
                boss.x + boss.size / 2,
                boss.y + boss.size / 2,
                80,                       // 80 颗碎片
                420                        // 扩散更快，更剧烈
            );
            boss = null;
            bossBullets.length = 0;       // 清空 Boss 还在飞的炮弹
            gamePhase = 'cleared';       // Boss 被击败，全清
            playVictorySound();          // 播放胜利音效
            bossDeathTimer = 2.0;        // 先播 2 秒粒子特效，再弹出胜利界面
        }
    }

    // Boss 死亡特效倒计时：时间到才正式判定胜利（让粒子先飘完）
    if (bossDeathTimer > 0) {
        bossDeathTimer -= dt;
        if (bossDeathTimer <= 0) {
            gameState = 'win';           // 游戏胜利
        }
    }
}

/* ==================== 4.5 Buff 掉落 + 拾取 ==================== */

/**
 * 在敌人死亡位置掉落一个随机 buff
 * 3 种 buff 随机选 1：heal（加血）/ doubleDamage（双倍伤害）/ shield（护盾）
 */
function dropBuff(x, y) {
    const types = ['heal', 'doubleDamage', 'shield'];
    const type = types[Math.floor(Math.random() * types.length)];
    powerups.push({ x: x, y: y, type: type, pulse: 0 });
}

/**
 * 更新掉落物：动画脉动 + 玩家拾取
 * 玩家坦克碰到掉落物时自动拾取，根据类型触发效果
 */
function updatePowerups(dt) {
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        p.pulse += dt;     // 脉动计时器（用于上下浮动动画）

        // 玩家碰到掉落物 → 拾取
        if (pointInRect(p.x, p.y, player.x, player.y, player.size, player.size)) {
            applyBuff(p.type);
            powerups.splice(i, 1);
        }
    }
}

/** 应用 buff 效果 */
function applyBuff(type) {
    switch (type) {
        case 'heal':
            if (playerLives < 9) playerLives++;       // 加 1 血（上限 9 防止无限刷）
            updateScoreDisplay();
            break;
        case 'doubleDamage':
            playerBulletDamage = 2;                    // 子弹伤害翻倍
            doubleDamageTimer = 10;                    // 持续 10 秒
            break;
        case 'shield':
            playerShield = 1;                          // 获得 1 层护盾
            break;
    }
}

/** 画掉落物：3 种 buff 用不同颜色和图标区分 */
function drawPowerups() {
    for (const p of powerups) {
        const float = Math.sin(p.pulse * 4) * 3;      // 上下浮动动画
        const cx = p.x, cy = p.y + float;

        if (p.type === 'heal') {
            // 加血：绿色十字
            ctx.fillStyle = '#2e7d32';
            ctx.beginPath();
            ctx.arc(cx, cy, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(cx - 2, cy - 7, 4, 14);      // 竖线
            ctx.fillRect(cx - 7, cy - 2, 14, 4);      // 横线
        } else if (p.type === 'doubleDamage') {
            // 双倍伤害：橙色双箭头
            ctx.fillStyle = '#e65100';
            ctx.beginPath();
            ctx.arc(cx, cy, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('×2', cx, cy);
        } else if (p.type === 'shield') {
            // 护盾：蓝色盾牌
            ctx.fillStyle = '#1565c0';
            ctx.beginPath();
            ctx.arc(cx, cy, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('盾', cx, cy);
        }
        ctx.textAlign = 'left';   // 还原
    }
}

/* ==================== 4.6 Boss 系统 ==================== */

/** 生成 Boss：在世界随机位置出现（Boss 可穿过砖墙，所以不需要找空地） */
function spawnBoss() {
    const size = 200;                    // Boss 体积 = 玩家 5 倍（40×5）
    const x = Math.floor(Math.random() * (WORLD_W - size));
    const y = Math.floor(Math.random() * (WORLD_H - size));

    boss = {
        x: x,
        y: y,
        size: size,
        speed: 170,                     // 稍慢于玩家（玩家 200），方便玩家拉开距离躲避
        hp: 50,                         // 50 血
        maxHp: 50,
        angle: 0,                       // 炮管朝向
        fireCooldown: 2.0,              // 开火冷却（Boss 发射追踪炮弹，稍慢一点）
        retargetTimer: 0,
        target: 'player',               // Boss 永远只攻击玩家
    };
}

/**
 * 更新 Boss：只追踪玩家 + 可穿过砖墙 + 发射追踪炮弹 + 撞玩家判定
 * 【特殊规则】
 * 1. Boss 永远只锁定玩家（不攻击基地，不破坏基地）
 * 2. Boss 可以穿过任何砖墙障碍物（只有世界边界能挡住它）
 * 3. Boss 发射的炮弹会追随玩家移动 4 秒，之后改为直线飞行
 */
function updateBoss(dt) {
    if (!boss) return;

    // 锁定目标：Boss 永远只攻击玩家
    const playerCx = player.x + player.size / 2;
    const playerCy = player.y + player.size / 2;
    const bossCx = boss.x + boss.size / 2;
    const bossCy = boss.y + boss.size / 2;

    // 朝玩家方向移动（Boss 可穿过砖墙，只用世界边界做限制）
    const dx = playerCx - bossCx;
    const dy = playerCy - bossCy;
    const distToPlayer = Math.hypot(dx, dy);
    if (distToPlayer > 1) {
        // 单位方向向量 × 速度 × 帧时间 = 这一帧的位移
        const moveDist = boss.speed * dt;
        let nx = boss.x + (dx / distToPlayer) * moveDist;
        let ny = boss.y + (dy / distToPlayer) * moveDist;
        // 只限制在世界边界内（不检查砖墙，Boss 能穿墙）
        nx = Math.max(0, Math.min(nx, WORLD_W - boss.size));
        ny = Math.max(0, Math.min(ny, WORLD_H - boss.size));
        boss.x = nx;
        boss.y = ny;
        // 炮管始终朝向玩家
        boss.angle = Math.atan2(dy, dx);
    }

    // 定时开火：发射追踪炮弹（追随玩家 4 秒后改为直线）
    boss.fireCooldown -= dt;
    if (boss.fireCooldown <= 0) {
        const half = boss.size / 2;
        const a = boss.angle;        // 朝玩家方向
        // Boss 炮弹单独的数组管理（带追踪逻辑），区别于普通敌方子弹
        bossBullets.push({
            x: boss.x + half + Math.cos(a) * (half + 20),
            y: boss.y + half + Math.sin(a) * (half + 20),
            vx: Math.cos(a) * 260,   // 追踪阶段速度稍慢，方便转向
            vy: Math.sin(a) * 260,
            size: 12,                // Boss 炮弹更大、更有威慑感
            tracking: true,          // 启用追踪
            trackingTime: 4.0,       // 追随玩家 4 秒
            fromBoss: true,          // 标记为 Boss 炮弹（不会伤害基地）
        });
        boss.fireCooldown = 2.0;     // 每 2 秒发射一次追踪炮弹
    }

    // Boss 撞到玩家 → 玩家直接失败（Boss 体积巨大，碾压即死）
    if (rectsOverlap(boss, player)) {
        gameState = 'lose';
        return;
    }
    // 注意：Boss 不再判定撞基地——它只攻击玩家，也不会破坏基地
}

/** 画 Boss：用 浩源.jpg 的人头做圆形头像 + 紫色光环框 */
function drawBoss() {
    if (!boss) return;
    const cx = boss.x + boss.size / 2;     // Boss 中心
    const cy = boss.y + boss.size / 2;
    const r = boss.size / 2;                // 头像半径

    // ① 圆形裁剪，把人头图片 cover 画进圆里（不旋转，保持脸正着）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (bossHeadImg.complete && bossHeadImg.naturalWidth > 0) {
        drawImageCover(ctx, bossHeadImg, cx - r, cy - r, boss.size, boss.size);
    } else {
        // 图片还没加载完：紫色圆兜底，避免空白
        ctx.fillStyle = '#4a1a6a';
        ctx.fillRect(cx - r, cy - r, boss.size, boss.size);
    }
    ctx.restore();

    // ② 外圈光环（Boss 主题紫色粗框）+ 内圈细白边，让人头有"Boss"感
    ctx.strokeStyle = '#9c27b0';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
    ctx.stroke();
}

/** 画 Boss 血条（固定在屏幕正上方，不随镜头滚动） */
function drawBossHpBar() {
    if (!boss) return;

    const barW = 600;                    // 血条宽
    const barH = 16;                     // 血条高
    const barX = (CANVAS_W - barW) / 2;  // 居中
    const barY = 10;                     // 屏幕顶部 10 像素

    // 背景
    ctx.fillStyle = '#333333';
    ctx.fillRect(barX, barY, barW, barH);

    // 血量条
    const hpRatio = boss.hp / boss.maxHp;
    const hpBarW = barW * hpRatio;
    ctx.fillStyle = '#9c27b0';           // 紫色（Boss 主题色）
    ctx.fillRect(barX, barY, hpBarW, barH);

    // 边框
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);

    // 标题
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('BOSS', CANVAS_W / 2, barY - 2);
    ctx.textAlign = 'left';
}

/* ==================== 4.7 Boss 炮弹（追踪 + 绘制） ==================== */

/**
 * 更新所有 Boss 炮弹
 * 【追踪逻辑】每颗炮弹出生时 tracking=true、trackingTime=4。
 *   - 当 trackingTime > 0：每一帧把速度方向缓缓转向玩家（保持速率不变），
 *     营造"炮弹追随玩家"的效果。同时 trackingTime 随帧时间倒数。
 *   - 当 trackingTime ≤ 0：tracking 置 false，之后炮弹按当前速度直线飞行，
 *     不再改变方向。
 * 碰撞处理：
 *   - 出界 → 删除
 *   - 打中砖墙 → 删除（不破坏砖墙，避免 Boss 误伤地图；Boss 攻击只针对玩家）
 *   - 打中玩家 → 扣血（受无敌时间保护）
 *   - 打中基地 → 删除但不扣血（Boss 不会对基地造成破坏）
 */
function updateBossBullets(dt) {
    if (gameState !== 'playing') return;

    const playerCx = player.x + player.size / 2;
    const playerCy = player.y + player.size / 2;

    for (let i = bossBullets.length - 1; i >= 0; i--) {
        const b = bossBullets[i];

        // ---- 追踪阶段：方向逐渐转向玩家 ----
        if (b.tracking && b.trackingTime > 0) {
            b.trackingTime -= dt;
            // 当前速率
            const speed = Math.hypot(b.vx, b.vy);
            // 期望方向：朝玩家
            const desiredAngle = Math.atan2(playerCy - b.y, playerCx - b.x);
            const currentAngle = Math.atan2(b.vy, b.vx);
            // 把角度差归一到 [-PI, PI]，找最短转向方向
            let diff = desiredAngle - currentAngle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            // 每秒最多转 3 弧度（约 172°），转向较慢，玩家有机会躲开
            const maxTurn = 3 * dt;
            const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
            const newAngle = currentAngle + turn;
            b.vx = Math.cos(newAngle) * speed;
            b.vy = Math.sin(newAngle) * speed;

            // 追踪时间用完 → 改为直线飞行
            if (b.trackingTime <= 0) {
                b.tracking = false;
            }
        }

        // ---- 移动 ----
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // ---- 出界 → 删除 ----
        if (b.x < -30 || b.x > WORLD_W + 30 || b.y < -30 || b.y > WORLD_H + 30) {
            bossBullets.splice(i, 1);
            continue;
        }
        // ---- 打中砖墙 → 炮弹消失（不扣砖墙血，Boss 不破坏地图）----
        if (isBrickAt(b.x, b.y)) {
            bossBullets.splice(i, 1);
            continue;
        }
        // ---- 打中玩家 → 扣血（受无敌时间保护）----
        if (playerInvincible <= 0 && pointInRect(b.x, b.y, player.x, player.y, player.size, player.size)) {
            bossBullets.splice(i, 1);
            if (playerShield > 0) {
                playerShield--;                    // 有护盾 → 消耗护盾
            } else {
                playerLives--;
                playerInvincible = 1.5;
                updateScoreDisplay();
                if (playerLives <= 0) {
                    gameState = 'lose';
                    return;
                }
            }
            continue;
        }
        // ---- 打中基地 → 炮弹消失但基地不掉血（Boss 不破坏基地）----
        if (pointInRect(b.x, b.y, base.x, base.y, base.w, base.h)) {
            bossBullets.splice(i, 1);
            continue;
        }
    }
}

/** 画 Boss 炮弹：紫色大圆点 + 外发光，和普通红色敌方子弹区分 */
function drawBossBullets() {
    for (const b of bossBullets) {
        // 外发光（追踪中的炮弹更亮）
        ctx.fillStyle = b.tracking ? 'rgba(186, 85, 211, 0.35)' : 'rgba(128, 0, 128, 0.25)';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
        ctx.fill();
        // 主体
        ctx.fillStyle = '#9c27b0';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size / 2, 0, Math.PI * 2);
        ctx.fill();
        // 高光
        ctx.fillStyle = '#e1bee7';
        ctx.beginPath();
        ctx.arc(b.x - b.size / 6, b.y - b.size / 6, b.size / 6, 0, Math.PI * 2);
        ctx.fill();
    }
}

/* ==================== 4.8 粒子系统（Boss 死亡粉碎特效） ==================== */

/**
 * 在指定位置生成一批"粉碎"粒子
 * @param {number} cx 中心 X
 * @param {number} cy 中心 Y
 * @param {number} count 粒子数量
 * @param {number} spreadSpeed 扩散速度基准
 * 每个粒子有：位置、速度、剩余生命、颜色、大小
 */
function spawnDeathParticles(cx, cy, count = 60, spreadSpeed = 320) {
    // Boss 主题紫色调 + 一些金属灰，模拟"装甲粉碎"的碎片
    const colors = ['#9c27b0', '#6a2a8a', '#4a1a6a', '#ba68c8', '#3a3a3a', '#cccccc', '#ff9800', '#ffeb3b'];
    for (let i = 0; i < count; i++) {
        // 随机方向（0 ~ 2π）+ 随机速率（0.4 ~ 1.0 倍 spreadSpeed）
        const angle = Math.random() * Math.PI * 2;
        const speed = spreadSpeed * (0.4 + Math.random() * 0.6);
        particles.push({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.8 + Math.random() * 0.8,     // 0.8~1.6 秒生命
            maxLife: 0,
            size: 3 + Math.random() * 6,          // 碎片大小 3~9
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 10,    // 自旋角速度
        });
    }
    // 记录 maxLife 用于按比例淡出
    for (const p of particles) p.maxLife = p.life;
}

/**
 * 更新所有粒子：移动 + 受重力（轻微下落感）+ 生命倒计时 + 自旋
 * 生命归零后从数组删除
 */
function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // 轻微"阻力"让粒子逐渐慢下来，模拟碎片掉落
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.vy += 200 * dt;       // 一点重力，让碎片往下落
        p.rotation += p.spin * dt;
        p.life -= dt;
        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }
}

/**
 * 画所有粒子（旋转的小方块碎片，随生命淡出）
 */
function drawParticles() {
    for (const p of particles) {
        const alpha = Math.max(0, p.life / p.maxLife);   // 0~1，生命越短越透明
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
    }
}

/* ==================== 5. 绘制画面 ==================== */

// 每一帧调用一次：先清空画布，再通过摄像机平移坐标系，画出视口内的世界
function draw() {
    // 画游戏内背景：选中了背景图就画图（cover 填满画布），否则用黑色兜底
    const bgImg = selectedBgIndex >= 0 ? bgImgs[selectedBgIndex] : null;
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
        drawImageCover(ctx, bgImg, 0, 0, CANVAS_W, CANVAS_H);
    } else {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    /* ---------- 摄像机平移（滚动画面的关键） ----------
     * ctx.translate(-camera.x, -camera.y) 把坐标系原点平移到"视口左上角"，
     * 之后画的所有东西都按"世界坐标"来画，Canvas 自动帮我们换算成画布坐标。
     * camera 变大时画面向左上滚，tank 走到哪，镜头就跟到哪。
     * 画完用 ctx.restore() 还原，避免影响下一帧的清屏。 */
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // 先画地图砖墙（在最底层）
    drawBricks();

    // 画基地（蓝色方块 + 上方血条）
    drawBase();

    // 画所有敌方坦克 + 头顶血条
    for (const e of enemies) {
        drawTank(e);
        drawEnemyHpBar(e);
    }

    // 画 Boss（Boss 战阶段）
    drawBoss();

    // 画掉落物（buff）
    drawPowerups();

    // 画玩家坦克：无敌期内闪烁
    if (playerInvincible <= 0 || Math.floor(playerInvincible * 10) % 2 === 0) {
        drawTank(player);
        // 玩家有护盾时画蓝色光环
        if (playerShield > 0) {
            ctx.strokeStyle = 'rgba(33, 150, 243, 0.6)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(player.x + player.size / 2, player.y + player.size / 2, player.size / 2 + 6, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // 画玩家子弹（黄色）
    drawBullets();

    // 画敌方子弹（红色，区别于玩家的黄色子弹）
    drawEnemyBullets();

    // 画 Boss 炮弹（紫色大圆点，带追踪发光）
    drawBossBullets();

    // 画粒子（Boss 死亡粉碎特效，画在最上层，确保可见）
    drawParticles();

    ctx.restore(); // 还原坐标系

    // 画 Boss 血条（固定在屏幕上方，不受镜头影响）
    drawBossHpBar();

    // 画双倍伤害 buff 倒计时（如果激活了）
    if (doubleDamageTimer > 0) {
        ctx.fillStyle = '#e65100';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('双倍伤害：' + Math.ceil(doubleDamageTimer) + 's', 10, 10);
    }

    // 画护盾状态指示（如果有护盾）
    if (playerShield > 0) {
        ctx.fillStyle = '#1565c0';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('护盾：激活', 10, 30);
    }

    /* ---------- 暂停遮罩 ----------
     * 按下 ESC 或"暂停"按钮后，pageState 变成 'paused'，
     * 此时游戏逻辑不再更新，但仍会画一层半透明遮罩 + "已暂停"文字，
     * 让玩家清楚知道游戏停住了。 */
    if (pageState === 'paused') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('已暂停', CANVAS_W / 2, CANVAS_H / 2 - 15);
        ctx.fillStyle = '#cccccc';
        ctx.font = '18px sans-serif';
        ctx.fillText('按 ESC 或点"继续"恢复游戏', CANVAS_W / 2, CANVAS_H / 2 + 25);
        ctx.textAlign = 'left';     // 还原对齐，避免影响后续绘制
    }

    /* ---------- 游戏结束/胜利文字提示 ----------
     * 在画布坐标（不受摄像机影响）的正中央画半透明覆盖层 + 文字，
     * 让玩家清楚知道当前游戏状态。 */
    if (gameState !== 'playing') {
        // 半透明黑色遮罩，让画面变暗
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // 提示文字
        ctx.fillStyle = gameState === 'win' ? '#4caf50' : '#f44336';  // 胜利=绿，失败=红
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const msg = gameState === 'win' ? '游戏胜利！' : '游戏结束';
        ctx.fillText(msg, CANVAS_W / 2, CANVAS_H / 2 - 30);

        // 副标题：失败原因（基地被毁 / 玩家阵亡）
        ctx.fillStyle = '#cccccc';
        ctx.font = '18px sans-serif';
        if (gameState === 'lose') {
            const reason = base.hp <= 0 ? '基地被摧毁' : '坦克被击毁';
            ctx.fillText(reason, CANVAS_W / 2, CANVAS_H / 2 + 5);
        }

        // 最终得分
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px sans-serif';
        ctx.fillText('最终得分：' + score, CANVAS_W / 2, CANVAS_H / 2 + 40);
        ctx.textAlign = 'left';     // 还原对齐方式，避免影响后续绘制
    }
}

/**
 * 画一辆"真实样子"的坦克
 * 思路：所有零件都按"朝上"的姿态画在一个以坦克中心为原点的局部坐标系里，
 *      然后根据 angle 朝向角度把整个坐标系旋转，就能让炮管指向任意方向。
 * 零件组成（从下到上）：
 *   左右两条深灰履带（带负重轮） → 黄色车体（带高光） → 灰色炮管（带炮口）
 *   → 圆角炮塔（带顶盖舱门）
 */
function drawTank(tank) {
    const s = tank.size;                          // 坦克整体尺寸（40）
    const half = s / 2;

    // 颜色：如果坦克对象自带 bodyColor/turretColor 就用它，否则默认黄色（玩家）
    const bodyColor = tank.bodyColor || '#d4a017';       // 默认军黄
    const turretColor = tank.turretColor || '#e6b422';   // 默认亮黄炮塔
    const bodyDark = tank.bodyDark || '#b8860b';          // 车体暗色线条
    const turretDark = tank.turretDark || '#8a6508';      // 炮塔描边色

    // ① 把坐标原点临时搬到坦克中心，并按朝向角度旋转（任意角度，360 度自由）
    //    坦克默认画成"炮管朝上"的姿态（-PI/2 方向），
    //    所以旋转量 = 当前角度 - (-PI/2) = angle + PI/2
    ctx.save();                                   // 保存当前画布状态，画完再还原
    ctx.translate(tank.x + half, tank.y + half);  // 原点移到坦克中心
    ctx.rotate(tank.angle + Math.PI / 2);         // 旋转到当前朝向

    // ---------- 履带（坦克最底下两条黑色的"轨道"） ----------
    ctx.fillStyle = '#3a3a3a';                    // 深灰色履带底
    ctx.fillRect(-half, -half, 11, s);            // 左履带
    ctx.fillRect(half - 11, -half, 11, s);        // 右履带

    // 履带上的负重轮（一排小圆圈，模拟轮子）
    ctx.fillStyle = '#6b6b6b';
    for (let wy = -half + 7; wy <= half - 7; wy += 10) {
        ctx.beginPath();
        ctx.arc(-half + 5.5, wy, 2.5, 0, Math.PI * 2);  // 左履带的轮子
        ctx.arc(half - 5.5, wy, 2.5, 0, Math.PI * 2);   // 右履带的轮子
        ctx.fill();
    }

    // ---------- 车体（履带中间的主装甲板） ----------
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-half + 9, -half + 3, s - 18, s - 6);

    // 车体顶部的亮色高光，做出金属反光的立体感
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(-half + 9, -half + 3, s - 18, 4);

    // 车体前部的斜面装甲线条
    ctx.fillStyle = bodyDark;
    ctx.fillRect(-half + 9, -half + 3, s - 18, 2);

    // ---------- 炮管（从炮塔伸出去的长管子） ----------
    ctx.fillStyle = '#8f8f8f';                    // 灰色炮管
    ctx.fillRect(-2.5, -half - 13, 5, half + 8);  // 从炮塔中心伸到车体外面

    // 炮口制退器（炮管头上一小节更粗的部分）
    ctx.fillStyle = '#5f5f5f';
    ctx.fillRect(-4.5, -half - 15, 9, 6);

    // ---------- 炮塔（车体上方可以旋转的圆脑袋） ----------
    ctx.fillStyle = turretColor;                  // 用炮塔色画圆角炮塔
    roundRect(-10, -10, 20, 20, 6);               // 用圆角矩形画炮塔主体
    ctx.fill();

    // 炮塔边缘的描边，增强轮廓
    ctx.strokeStyle = turretDark;
    ctx.lineWidth = 1.5;
    roundRect(-10, -10, 20, 20, 6);
    ctx.stroke();

    // 炮塔顶盖（指挥官舱门，一个小圆盖）
    ctx.fillStyle = turretDark;
    ctx.beginPath();
    ctx.arc(0, 3, 4, 0, Math.PI * 2);
    ctx.fill();

    // ② 还原画布状态（把旋转和位移撤销，不影响之后画别的东西）
    ctx.restore();
}

/**
 * 辅助函数：画一个圆角矩形的路径（不填充不描边，配合 fill/stroke 使用）
 * @param {number} x 左上角 X    @param {number} y 左上角 Y
 * @param {number} w 宽          @param {number} h 高
 * @param {number} r 圆角半径
 */
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);   // 右上角
    ctx.arcTo(x + w, y + h, x, y + h, r);   // 右下角
    ctx.arcTo(x, y + h, x, y, r);           // 左下角
    ctx.arcTo(x, y, x + w, y, r);           // 左上角
    ctx.closePath();
}

/* ==================== 6. 游戏循环 ====================
 *
 * 工作原理（requestAnimationFrame）：
 * 1. requestAnimationFrame(gameLoop) 会告诉浏览器：
 *    "下一次刷新屏幕之前（大约每秒 60 次），请调用一次 gameLoop"。
 * 2. gameLoop 被调用时会收到一个参数 now（当前时间戳，毫秒），
 *    用它和上一帧的时间 lastTime 相减，就得到这一帧实际花了多少秒 dt。
 * 3. 每一帧的执行顺序：update(dt) → draw() → 预约下一帧。
 * 4. pageState 控制是否更新游戏逻辑（主页/结束时只画不更新）。
 */

let lastTime = 0; // 记录上一帧的时间，用于计算 dt

/* ==================== 6.1 页面状态管理 ====================
 *
 * pageState 控制整个页面的显示状态：
 * - 'home'：显示主页（选皮肤 + 选关卡），游戏暂停
 * - 'playing'：游戏中，游戏循环正常运行
 * - 'gameOver'：显示游戏结束界面（重新挑战 / 回到主页）
 */
let pageState = 'home';

/** 把玩家坦克的配色设为当前选中的皮肤 */
function applyPlayerSkin() {
    const skin = SKINS[selectedSkin];
    player.bodyColor = skin.bodyColor;
    player.turretColor = skin.turretColor;
    player.bodyDark = skin.bodyDark;
    player.turretDark = skin.turretDark;
}

/** 重置游戏状态：清空所有敌人、子弹、Boss、buff、粒子，恢复玩家和基地血量，重置得分 */
function resetGame() {
    enemies.length = 0;
    bullets.length = 0;
    enemyBullets.length = 0;
    bossBullets.length = 0;
    particles.length = 0;
    powerups.length = 0;
    boss = null;
    bossDeathTimer = 0;                  // 清空 Boss 死亡特效计时器
    gamePhase = 'fighting';
    // 恢复 MAP（把被打掉的砖墙还原）——深拷贝初始地图
    for (let r = 0; r < MAP_INIT.length; r++) {
        for (let c = 0; c < MAP_INIT[r].length; c++) {
            MAP[r][c] = MAP_INIT[r][c];
        }
    }
    // 恢复玩家状态
    player.x = 400;
    player.y = 560;
    player.angle = -Math.PI / 2;
    playerLives = 3;
    playerInvincible = 0;
    playerShield = 0;
    playerBulletDamage = 1;
    doubleDamageTimer = 0;
    // 恢复基地
    base.hp = base.maxHp;
    // 恢复游戏状态
    score = 0;
    gameState = 'playing';
    updateScoreDisplay();
}

/** 开始游戏：从主页进入游戏 */
function startGame() {
    resumeAudio();                          // 唤醒音频上下文（绕过浏览器自动播放限制）
    currentLevel = selectedLevel;           // 锁定当前关卡
    applyPlayerSkin();                      // 应用选中的皮肤
    resetGame();                            // 重置游戏状态
    spawnEnemies();                         // 生成敌方坦克
    updateCamera();                        // 摄像机对准玩家
    // 隐藏主页，显示游戏
    document.getElementById('homeScreen').style.display = 'none';
    document.getElementById('gameOverScreen').style.display = 'none';
    pageState = 'playing';
}

/** 显示游戏结束界面（胜利或失败） */
function showGameOver() {
    pageState = 'gameOver';
    const screen = document.getElementById('gameOverScreen');
    const title = document.getElementById('gameOverTitle');
    const reason = document.getElementById('gameOverReason');
    const finalScoreEl = document.getElementById('finalScore');
    const finalLevelEl = document.getElementById('finalLevel');

    if (gameState === 'win') {
        title.textContent = '游戏胜利！';
        title.style.color = '#4caf50';
        reason.textContent = '你击败了所有敌人和 Boss！';
        // 通关后解锁下一关
        if (currentLevel >= maxUnlockedLevel && currentLevel < LEVELS.length) {
            maxUnlockedLevel = currentLevel + 1;
            localStorage.setItem('tank_maxUnlockedLevel', maxUnlockedLevel.toString());
        }
    } else {
        title.textContent = '游戏结束';
        title.style.color = '#f44336';
        if (gamePhase === 'boss') {
            reason.textContent = 'Boss 摧毁了你的防线';
        } else if (base.hp <= 0) {
            reason.textContent = '基地被摧毁';
        } else {
            reason.textContent = '坦克被击毁';
        }
    }
    finalScoreEl.textContent = score;
    finalLevelEl.textContent = currentLevel;
    screen.style.display = 'flex';

    // 异步请求 DeepSeek 生成本局评价（不阻塞界面显示）
    fetchEvaluation();
}

/**
 * 请求后端让 DeepSeek 根据本局输赢 + 数据生成评价，显示在结束弹窗里
 * - 把结果/得分/关卡/剩余生命/基地血量/失败原因发给后端
 * - 后端调 DeepSeek 返回 { comment: "..." }
 * - 失败时在框里显示红色错误，不影响重玩
 */
async function fetchEvaluation() {
    const evalContent = document.getElementById('evalContent');
    if (!evalContent) return;
    evalContent.style.color = '#ffcc00';
    evalContent.textContent = '正在生成评价...';

    // 组装本局数据发给后端
    const data = {
        result: gameState === 'win' ? 'win' : 'lose',
        score: score,
        level: currentLevel,
        lives: player.lives,
        baseHp: base.hp,
        reason: document.getElementById('gameOverReason').textContent,
    };

    try {
        const res = await fetch('/.netlify/functions/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            throw new Error('HTTP ' + res.status);
        }
        const j = await res.json();
        // 后端成功返回 {comment}，失败返回 {error}
        if (j.comment) {
            evalContent.style.color = '#ffffff';
            evalContent.textContent = j.comment;
        } else {
            evalContent.style.color = '#f44336';
            evalContent.textContent = '评价生成失败：' + (j.error || '未知错误');
        }
    } catch (e) {
        evalContent.style.color = '#f44336';
        evalContent.textContent = '评价生成失败（' + (e.message || '网络错误') + '），可能是未配置 DEEPSEEK_API_KEY';
    }
}

/** 回到主页 */
function showHome() {
    pageState = 'home';
    document.getElementById('gameOverScreen').style.display = 'none';
    document.getElementById('homeScreen').style.display = 'flex';
    generateLevelButtons();   // 刷新关卡按钮（可能解锁了新关卡）
}

/** 重新挑战当前关卡 */
function retryGame() {
    resumeAudio();                          // 唤醒音频上下文
    applyPlayerSkin();
    resetGame();
    spawnEnemies();
    updateCamera();
    document.getElementById('gameOverScreen').style.display = 'none';
    pageState = 'playing';
}

/* ==================== 6.1b AI 生成地图 ====================
 * 点击"AI 生成地图"按钮后：
 * 1. 读输入框文字；空 → 提示并返回
 * 2. 显示"AI 正在生成地图..."，禁用按钮防重复点击
 * 3. fetch POST 到 Netlify 函数 /.netlify/functions/generate-map
 * 4. 后端返回 0/1 二维数组 → 规范化成 30×30 并套用到游戏地图
 * 5. 失败 → 红色错误提示
 */
async function generateAiMap() {
    const input = document.getElementById('mapDescription');
    const loadingEl = document.getElementById('aiLoadingText');
    const btn = document.getElementById('aiGenerateBtn');
    const desc = input.value.trim();

    // 1. 空输入 → 提示用户输入，不发起请求
    if (!desc) {
        loadingEl.style.color = '#ffcc00';
        loadingEl.textContent = '请先输入你想要的地图描述';
        loadingEl.style.display = 'inline';
        input.focus();
        // 2 秒后自动收起提示
        setTimeout(() => { loadingEl.style.display = 'none'; }, 2000);
        return;
    }

    // 2. 显示加载提示 + 禁用按钮（防止连点发多次请求）
    loadingEl.style.color = '#ffcc00';
    loadingEl.textContent = 'AI 正在生成地图...';
    loadingEl.style.display = 'inline';
    btn.disabled = true;

    try {
        // 3. fetch 调用后端 Netlify Function
        //    - method: 'POST'：用 POST 提交用户输入（比 GET 更适合带 body）
        //    - headers: Content-Type 告诉后端 body 是 JSON
        //    - body: JSON.stringify(...)：把 { description } 序列化成 JSON 字符串
        //    - await res：等响应回来；res.ok 判断 HTTP 状态码 2xx
        //    - await res.json()：把响应体解析成 JS 对象/数组
        const res = await fetch('/.netlify/functions/generate-map', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: desc }),
        });
        if (!res.ok) {
            throw new Error('接口返回错误（HTTP ' + res.status + '）');
        }
        const data = await res.json();

        // 4. 兼容多种返回结构：直接是数组，或包在 { map } / { data } / { grid } 里
        const mapData = Array.isArray(data) ? data : (data.map || data.data || data.grid);
        if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
            throw new Error('返回数据不是二维数组');
        }

        // 5. 套用到游戏地图 + 重启游戏
        applyAiMap(mapData);
        loadingEl.style.color = '#4caf50';
        loadingEl.textContent = '地图生成成功！游戏已重启';
    } catch (err) {
        // 6. 请求失败/数据异常 → 红色错误提示
        loadingEl.style.color = '#f44336';
        loadingEl.textContent = '生成失败：' + (err.message || '未知错误');
    } finally {
        btn.disabled = false;                // 恢复按钮可点
        // 3 秒后自动隐藏提示文字
        setTimeout(() => { loadingEl.style.display = 'none'; }, 3000);
    }
}

/**
 * 把 AI 返回的 0/1 二维数组套用到游戏地图并重启游戏
 * - 规范化成 30×30：不足补 0，超出截断
 * - AI 的 1 → 游戏的 2（完好砖墙，2 血），保持和原图砖墙一致的耐久
 * - 清出玩家出生点和基地位置，避免一出生就卡墙/和基地重叠
 * - 同步更新 MAP_INIT，让 resetGame 还原的是 AI 地图
 */
function applyAiMap(data) {
    // 把 AI 的 0/1 数组规范化成 MAP_ROWS × MAP_COLS（30×30），1 → 2
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            // data[r][c] 有值且非 0 → 完好砖墙（2）；否则空地（0）
            MAP[r][c] = (data[r] && data[r][c]) ? 2 : 0;
        }
    }
    // 清出玩家出生点周围 3×3（玩家在 400,560 → 第 14 行第 10 列）
    for (let r = 13; r <= 15; r++) {
        for (let c = 9; c <= 11; c++) {
            if (MAP[r]) MAP[r][c] = 0;
        }
    }
    // 清出基地位置（基地在 400~520, 640~680 → 第 16~17 行第 10~13 列）
    for (let r = 16; r <= 17; r++) {
        for (let c = 10; c <= 13; c++) {
            if (MAP[r]) MAP[r][c] = 0;
        }
    }
    // 同步 MAP_INIT，使 resetGame() 还原的是这张 AI 地图
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            MAP_INIT[r][c] = MAP[r][c];
        }
    }
    // 重启游戏：应用皮肤 → 重置（会从 MAP_INIT 还原地图）→ 生成敌人 → 镜头归位
    resumeAudio();
    applyPlayerSkin();
    resetGame();
    spawnEnemies();
    updateCamera();
    // 隐藏主页/结束界面，进入游戏
    document.getElementById('homeScreen').style.display = 'none';
    document.getElementById('gameOverScreen').style.display = 'none';
    pageState = 'playing';
}

/* ==================== 6.2 主页 UI 初始化 ==================== */

/** 在主页的皮肤卡片上画坦克预览 */
function drawSkinPreviews() {
    const cards = document.querySelectorAll('.skin-card');
    cards.forEach((card, i) => {
        const canvas = card.querySelector('.skin-preview');
        if (!canvas) return;
        const c = canvas.getContext('2d');
        const skin = SKINS[i];
        const s = 48, half = s / 2;
        c.clearRect(0, 0, s, s);
        c.save();
        c.translate(half, half);
        // 履带
        c.fillStyle = '#3a3a3a';
        c.fillRect(-half, -half, 10, s);
        c.fillRect(half - 10, -half, 10, s);
        // 车体
        c.fillStyle = skin.bodyColor;
        c.fillRect(-half + 8, -half + 2, s - 16, s - 4);
        // 炮管
        c.fillStyle = '#8f8f8f';
        c.fillRect(-2, -half - 8, 4, half + 6);
        // 炮塔
        c.fillStyle = skin.turretColor;
        c.beginPath();
        c.arc(0, 0, 8, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = skin.turretDark;
        c.lineWidth = 1;
        c.stroke();
        c.restore();
    });
}

/** 生成关卡选择按钮（未解锁的关卡显示为锁定状态） */
function generateLevelButtons() {
    const grid = document.getElementById('levelGrid');
    grid.innerHTML = '';
    for (let i = 0; i < LEVELS.length; i++) {
        const lvl = LEVELS[i];
        const unlocked = (i + 1) <= maxUnlockedLevel;   // 关卡编号 ≤ 最高解锁关卡 → 已解锁
        const btn = document.createElement('button');
        btn.className = 'level-btn' +
            (i + 1 === selectedLevel ? ' selected' : '') +
            (unlocked ? '' : ' locked');
        // 锁定的关卡显示锁图标，已解锁的显示关卡名
        btn.textContent = unlocked ? ((i + 1) + '\n' + lvl.name) : ((i + 1) + '\n🔒');
        btn.style.whiteSpace = 'pre-line';
        if (unlocked) {
            // 已解锁：点击选中
            btn.addEventListener('click', () => {
                selectedLevel = i + 1;
                document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        } else {
            // 未解锁：不可点击
            btn.disabled = true;
        }
        grid.appendChild(btn);
    }
}

/** 初始化主页交互（皮肤选择、关卡选择、开始按钮） */
function initHomeUI() {
    // 画皮肤预览
    drawSkinPreviews();

    // 生成关卡按钮
    generateLevelButtons();

    // 皮肤卡片点击：选中皮肤
    document.querySelectorAll('.skin-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.skin-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedSkin = parseInt(card.dataset.skin);
        });
    });

    // 背景选择按钮：点开/收起背景缩略图面板
    const bgPanel = document.getElementById('bgPanel');
    document.getElementById('bgSelectBtn').addEventListener('click', () => {
        bgPanel.style.display = (bgPanel.style.display === 'none' || bgPanel.style.display === '') ? 'flex' : 'none';
    });

    // 背景缩略图点击：设为当前游戏内背景（同时更新主页背景预览）
    document.querySelectorAll('.bg-thumb').forEach(thumb => {
        thumb.addEventListener('click', () => {
            const idx = parseInt(thumb.dataset.bg);
            applyHomeBackground(idx);    // 选中的图同时作为主页背景 + 游戏内背景
        });
    });

    // 开始游戏按钮
    document.getElementById('startGameBtn').addEventListener('click', startGame);

    // 暂停按钮：点击切换暂停/继续（和 ESC 等效）
    document.getElementById('pauseBtn').addEventListener('click', togglePause);

    // AI 生成地图按钮：异步请求后端生成地图并重启游戏
    document.getElementById('aiGenerateBtn').addEventListener('click', generateAiMap);

    // 重新挑战按钮
    document.getElementById('retryBtn').addEventListener('click', retryGame);

    // 回到主页按钮
    document.getElementById('homeBtn').addEventListener('click', showHome);
}

/* ==================== 6.3 游戏循环（加入页面状态判断） ==================== */

// 保存 MAP 的初始状态（深拷贝），用于重置游戏时还原被打掉的砖墙
const MAP_INIT = MAP.map(row => [...row]);

// 初始化得分显示
updateScoreDisplay();

// 初始化主页 UI
initHomeUI();

// 开局随机抽一张背景作为主页背景（同时设为默认游戏内背景）
applyHomeBackground(Math.floor(Math.random() * BG_FILES.length));

// 摄像机初始对准玩家
updateCamera();

/**
 * 游戏循环：每帧调用一次
 * - home / gameOver 状态下只画画面（不更新游戏逻辑），让背景显示坦克
 * - playing 状态下正常更新 + 绘制
 */
function gameLoop(now) {
    if (lastTime === 0) lastTime = now;
    const dt = Math.min((now - lastTime) / 1000, 0.05);  // 帧间隔秒数，上限 50ms
    lastTime = now;

    if (pageState === 'playing') {
        update(dt);
        // 检查游戏是否结束
        if (gameState !== 'playing' && pageState === 'playing') {
            showGameOver();
        }
    }
    draw();
    requestAnimationFrame(gameLoop);
}

// 启动游戏循环（主页状态下也运行，用来画背景画面）
requestAnimationFrame(gameLoop);
