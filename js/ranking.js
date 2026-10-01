/* ==========================================================================
   实时排名榜单 · 渲染 + 上传 txt + 队伍分组 + 删除单条选手 + 改队名
   --------------------------------------------------------------------------
   职责：
     ① 渲染：把榜单数据按总分降序排好、加上名次画成行；
     ② 添加选手：读计分器导出的 txt，从【总分】/【源石锭】两个区里抠出
        「选手名 / 个人基础分 / 沉沦者倍率 / 团队加分 / 源石锭消耗 / 总分」六个值，并入榜单。
     ③ 队伍分组（**仅决赛**）：把选手归到各自队伍的大框里；未归队的进「未分组」框。
        点「添加队伍」弹居中弹框输入队名；点「添加选手」弹框里选队伍 + 选 txt。
     ④ 删除单条选手（2026-09-24 加）：在某一行上**向左拖动** → 该行行尾冒出一个删除键，
        点它并确认后把这位选手从当前赛程的榜单里删掉；点页面其它任何地方则收起删除键。
     ⑤ 拖拽入队（2026-09-24 加，仅决赛）：在某一行上**纵向拖动** → 这一条跟着指针抬起，
        松手落进指针所在的队伍框里（「未分组」框也是合法落点 = 移出队伍）。
        与 ④ 共用同一次按下，靠**支配轴**分流：横着往左 = 删，竖着 = 搬。
     ⑥ 就地改队名（2026-09-24 加，仅决赛）：**双击队名** → 队名变输入框、右侧冒出对勾，
        回车或点对勾确定；Esc、或点框外 → 放弃。改完队员的 `league` 一起跟着改。

   ⚠️ 为什么解析「可读区」而不是末尾的 DATA 行？
      DATA 行只有 counts/toggles 等原始输入，要重算总分就得把计分器整套
      computeAll() 搬过来 —— 两处各维护一份计分逻辑，迟早算不到一块去。
      而【总分】区印的正是计分器自己算好的结果，读它出来**天然与计分器一致**。

   ⚠️ 两个「可能不存在」的值，缺失都按 0（不算解析失败）：
      · 团队得分  → 只有**决赛**存档才有（初赛不拆团队分，压根不打印）
      · 消耗点数  → 在【源石锭】区里；老存档或手改过的 txt 可能没有
   ========================================================================== */
(function(){
  "use strict";

  /* ======================= 解析 txt ======================= */

  /* 从一行「标签..........值」里取值：先找标签，再取标签之后的部分并掐掉点线。
     ⚠️ 分隔符可能是「点线 + 空格」（计分器实际印的 `a ........ 300`），
        也可能是冒号（`a：300` / 手改过的存档）—— 两种都要吃掉，
        否则 `toNum("：2405")` 是 NaN，整条记录会被判成「没有读到总分」。
        （踩过：截图里榜单一直空，就是这个冒号没剥。） */
  function pickAfter(text, label){
    var i = text.indexOf(label);
    if(i < 0) return null;
    var rest = text.slice(i + label.length);
    rest = rest.replace(/^[\s.．·…\u2026]+/, "");   // 点线 / 空白
    rest = rest.replace(/^[:：]+/, "");             // 中文或 ASCII 冒号
    return rest.trim();
  }

  /* 转数字：允许正负号、小数点、全角符号；不合法返回 null */
  function toNum(s){
    if(s == null) return null;
    var t = String(s).trim()
      .replace(/^[+＋]/, "")
      .replace(/^[×xX*]\s*/, "")          // 倍率行印的是「×1.3」，先摘掉乘号
      .replace(/^[−ー–—]/, "-")          // 各种长横统一成 ASCII 负号
      .replace(/[，,]/g, "")
      .replace(/[（(].*$/, "")           // 值后可能跟「（= 个人基础分 × 倍率）」这类注释，切掉
      .trim();
    if(t === "") return null;
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  /* 把一个 txt 解析成榜单记录。
     成功返回 {name,base,multiplier,team,yuan,total}，失败返回 {error} */
  function parseExport(text){
    var raw = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    if(raw.trim() === "") return { error: "文件是空的" };

    var lines = raw.split(/\r?\n/);

    /* 区块切片：从含 `head` 的那一行起，到下一条 `^=+$` 分隔线为止。
       取值一律**限定在区块内**，免得别处出现同名标签被误读。 */
    function block(head){
      var i0 = -1;
      for(var a = 0; a < lines.length; a++){
        if(lines[a].indexOf(head) > -1){ i0 = a; break; }
      }
      if(i0 < 0) return null;
      var i1 = lines.length;
      for(var b = i0 + 1; b < lines.length; b++){
        if(/^=+$/.test(lines[b].trim())){ i1 = b; break; }
      }
      return lines.slice(i0 + 1, i1);
    }

    /* 在一个区块里找「首个含 label 的行」并取出它后面的值。
       ⚠️ **跳过「整行就是区块标题」的那种行**：当区块紧跟分隔线时，`block()` 返回的
          第一行就是标题本身（`【总分】` / `【源石锭】` / `【选手】`），而标题里恰好含
          `总分` 这个 label —— 不跳的话 `pick(seg, "总分")` 会命中标题行、取出个 `】`，
          总分就读成 null（踩过：截图里榜单一直空、提示「没有读到总分」）。
          判据用「整行只有【…】」而不是「跳过第 0 行」——真实存档里区块前常有
          `------` 分隔线，那样第 0 行是分隔线、标题行在第 1 行，
          一刀切跳首行反而会漏掉紧跟在标题后的第一项。 */
    function pick(seg, label){
      var hit = null;
      for(var i = 0; i < seg.length; i++){
        if(/^【[^】]*】$/.test(seg[i].trim())) continue;      // 区块标题行本身，跳过
        if(seg[i].indexOf(label) > -1){ hit = pickAfter(seg[i], label); break; }
      }
      return hit;
    }

    /* ① 选手名：在【选手】区里找「选手名」那一行 */
    var segPlayer = block("【选手】");
    var name = segPlayer ? pick(segPlayer, "选手名") : null;

    /* ② 【总分】区：基础分 / 倍率 / 团队加分 / 总分 */
    var segTotal = block("【总分】");
    if(!segTotal) return { error: "没有找到【总分】区块（这可能不是计分器导出的存档）" };

    var vBase  = toNum(pick(segTotal, "个人基础分"));
    var vMult  = toNum(pick(segTotal, "沉沦者倍率"));
    /* ⚠️ 「团队得分」这一行只有**决赛**存档才有（初赛不拆团队分，压根不打印）→ 缺失按 0。
       注意「团队得分」本身不含「总分」二字，与「总分」行不会互相误命中。 */
    var vTeam  = toNum(pick(segTotal, "团队得分"));
    var vTotal = toNum(pick(segTotal, "总分"));

    /* ③ 【源石锭】区：消耗点数（在**另一个区块**里，别跟【总分】混了）
       ⚠️ 用「消耗点数」而不是「开始前源石锭数」（后者不含「消耗」二字，不会误命中，
          但同一个区块里还有「上一位选手使用点数」—— 它含「使用点数」不含「消耗点数」，
          也安全）。这里刻意用完整词「消耗点数」做 key。 */
    var segYuan = block("【源石锭】");
    var vYuan = segYuan ? toNum(pick(segYuan, "消耗点数")) : null;

    /* ④ 校验 */
    name = (name == null ? "" : String(name).trim());
    if(name === "") return { error: "没有读到选手名" };
    if(name === "Player") return { error: "选手名还是默认的 Player，请先在计分器里填写" };
    if(vTotal === null) return { error: "没有读到总分" };
    if(vMult === null || vMult <= 0) vMult = 1;     // 倍率缺失/非法 → 退回 1
    if(vBase === null) vBase = 0;
    if(vTeam === null) vTeam = 0;                   // 初赛没有团队分 → 0
    if(vYuan === null) vYuan = 0;                   // 没有源石锭区 → 0

    return { name: name, base: vBase, multiplier: vMult, team: vTeam, yuan: vYuan, total: vTotal };
  }

  /* ======================= 数据读写 =======================
     ⚠️ 「初赛」「决赛」是**两块完全独立的榜单**（用户 2026-09-23 要求）：
        各有各的存档键与数据，互不影响。初赛沿用原来那个键（**保留既有数据**），
        决赛用新键（从空开始）。切换只切「当前在看哪一块」，不合并、不搬运。

     一块榜单的形状：`{ updatedAt, list:[选手…], teams:[队名…] }`
     ⚠️ `teams` 只在**决赛**用得上（初赛没有队伍概念，恒为空数组）；
        选手靠 `team` 字段（队名字符串）认领自己属于哪一队 —— 存**名字**而不是队伍 id，
        这样导出/导入 txt 时两边都是人可读的，也免得删队后留下悬空 id。 */

  var LS_KEY_PRELIM = "hlsh_zhoujibei_ranking_v1";            // 初赛（原键，兼容既有存档）
  var LS_KEY_FINAL  = "hlsh_zhoujibei_ranking_final_v1";      // 决赛（新键）
  var LS_KEY = LS_KEY_PRELIM;                                 // 向后兼容：旧的引用仍指初赛

  var MODES = {
    prelim: { key: LS_KEY_PRELIM, label: "初赛" },
    final:  { key: LS_KEY_FINAL,  label: "决赛" }
  };
  var MODE_KEY = "hlsh_zhoujibei_ranking_mode_v1";            // 记住用户上次看的赛程
  var DEFAULT_MODE = "prelim";                                // 默认初赛（既有榜单）

  function normMode(m){ return MODES[m] ? m : DEFAULT_MODE; }

  /* localStorage 统一从 window 上取：浏览器里 window.localStorage === localStorage，
     但写成显式取用后，这个脚本在 iframe / 单测桩里也能跑（桩只提供 window.localStorage）。 */
  var LS = (typeof window !== "undefined" && window.localStorage) ? window.localStorage : null;

  var mode = DEFAULT_MODE;

  /* 两个槽位各存一份：slots.prelim / slots.final */
  var slots = {
    prelim: { updatedAt: "", list: [], teams: [] },
    final:  { updatedAt: "", list: [], teams: [] }
  };

  var DATA = slots[mode];        // ⚠️ 始终指向「当前赛程」那一份，别整份替换

  function emptyBoard(){ return { updatedAt: "", list: [], teams: [] }; }

  /* 读一个赛程的存档。找不到就回落：初赛回落到内置的 window.RANKING_DATA，
     决赛没有内置数据 → 空榜单。 */
  function loadSlot(m){
    var d = emptyBoard();
    try{
      var raw = LS ? LS.getItem(MODES[m].key) : null;
      if(raw){
        var o = JSON.parse(raw);
        if(o && typeof o === "object"){
          if(Array.isArray(o.list)) d.list = o.list;
          if(Array.isArray(o.teams)) d.teams = o.teams;
          if(typeof o.updatedAt === "string") d.updatedAt = o.updatedAt;
          return d;
        }
      }
    }catch(e){ /* 存档坏了就退回内置数据 */ }

    if(m === DEFAULT_MODE){
      var builtin = window.RANKING_DATA;
      if(builtin && typeof builtin === "object"){
        if(Array.isArray(builtin.list)) d.list = builtin.list;
        if(Array.isArray(builtin.teams)) d.teams = builtin.teams;
        if(typeof builtin.updatedAt === "string") d.updatedAt = builtin.updatedAt;
      }
    }
    return d;
  }

  function saveData(d){
    try{
      if(LS) LS.setItem(MODES[mode].key, JSON.stringify({
        updatedAt: d.updatedAt, list: d.list,
        teams: Array.isArray(d.teams) ? d.teams : []
      }));
    }catch(e){ /* 隐私模式 / 配额满：静默忽略 */ }
  }

  function loadMode(){
    try{
      var m = LS ? LS.getItem(MODE_KEY) : null;
      if(m) return normMode(m);
    }catch(e){ /* 忽略 */ }
    return DEFAULT_MODE;
  }

  function saveMode(m){
    try{ if(LS) LS.setItem(MODE_KEY, m); }catch(e){ /* 忽略 */ }
  }

  /* ======================= 数值格式化 ======================= */

  function num(v, fallback){
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }
  /* 整数不带小数点，否则保留 1 位（与计分器 fmtNum 同口径） */
  function fmtNum(n){
    var v = num(n, 0);
    return (v % 1 === 0) ? String(v) : v.toFixed(1);
  }
  function fmtMult(m){
    var n = num(m, 1);
    if(n <= 0) n = 1;
    return "×" + (Math.round(n * 100) / 100);
  }
  function fmtSigned(n){
    var v = num(n, 0);
    return (v > 0 ? "+" : "") + fmtNum(v);
  }

  /* ======================= 渲染 ======================= */

  /* 先把两份榜单都读进来，再定「当前看哪一份」（顺序不能反 ——
     `mode` 决定 `DATA` 指向哪个槽位）。 */
  slots.prelim = loadSlot("prelim");
  slots.final  = loadSlot("final");
  mode = loadMode();
  DATA = slots[mode];

  var elPanel = document.querySelector(".rank-panel");
  var elList  = document.getElementById("rank-list");
  var elEmpty = document.getElementById("rank-empty");
  var elCount = document.getElementById("rank-count");
  var elTime  = document.getElementById("rank-time");
  var elToast = document.getElementById("rank-toast");
  var elModes = document.getElementById("rank-modes");
  var elActions = document.querySelector(".rank-actions");
  var elAddTeam = document.getElementById("btn-add-team");
  /* 居中弹框（添加队伍 / 添加选手共用） */
  var elModal      = document.getElementById("rank-modal");
  var elModalTitle = document.getElementById("rank-modal-title");
  var elModalBody  = document.getElementById("rank-modal-body");
  var elModalOk    = document.getElementById("rank-modal-ok");
  var elModalCancel= document.getElementById("rank-modal-cancel");
  var elModalErr   = document.getElementById("rank-modal-err");

  /* 切换赛程：只换「当前在看哪一块」，两块数据各归各的。
     ⚠️ 切换时先重置 filter/排序视图（否则会把上一块的处理结果带过来）。 */
  function setBoard(m, skipSave){
    mode = normMode(m);
    DATA = slots[mode];
    if(!skipSave) saveMode(mode);
    render();
    syncModeUI();
    return mode;
  }

  /* 把「当前赛程」反映到胶囊标签、面板描边、以及操作区按钮上 */
  function syncModeUI(){
    if(elModes){
      var btns = elModes.querySelectorAll(".rank-mode");
      for(var i = 0; i < btns.length; i++){
        var on = btns[i].getAttribute("data-mode") === mode;
        btns[i].className = "rank-mode" + (on ? " is-active" : "");
        btns[i].setAttribute("aria-selected", on ? "true" : "false");
      }
    }
    if(elPanel) elPanel.setAttribute("data-board", mode);
    /* 「添加队伍」只在决赛出现（初赛没有队伍概念）。
       ⚠️ 同时写 `data-board` 属性与 `hidden` 属性：
          前者给 CSS 的显示规则用（`[data-board="final"] #btn-add-team{display:inline-flex}`），
          后者是逻辑层的真相 —— 单测桩里没有 css，只能靠它断言。
          两者都由这里统一维护，不会各说各话。 */
    if(elActions) elActions.setAttribute("data-board", mode);
    if(elAddTeam) elAddTeam.hidden = (mode !== "final");
  }

  function currentMode(){ return mode; }

  function buildRows(){
    return DATA.list.map(function(it){
      it = it || {};
      return {
        name: String(it.name == null ? "" : it.name).trim(),
        base: num(it.base, 0),
        multiplier: num(it.multiplier, 1),
        team: num(it.team, 0),
        yuan: num(it.yuan, 0),
        total: num(it.total, 0),
        /* ⚠️ 队伍归属是**字符串**（队名），与上面数值型的 `team`（团队加分）不是一回事。
           名字撞车是历史原因：txt 里「团队得分」是分数，这里「队伍」是分组。
           为避免混淆，分组字段在渲染/分组逻辑里一律叫 `league`（读作「所属队伍」）。 */
        league: normTeamName(it.league != null ? it.league : it.belong),
        addedAt: it.addedAt == null ? "" : String(it.addedAt)
      };
    }).filter(function(r){ return r.name !== ""; })
      .sort(function(a, b){ return b.total - a.total; });
  }

  /* 榜单行 + **并列名次**（总分相同则名次相同：1,2,3,3）。
     抽出来给 render() 与「导出 txt」共用 —— 各算一份迟早算不到一块去
     （导出的名次与屏幕上看到的名次必须永远一致）。 */
  function rankedRows(){
    var rows = buildRows();
    var pos = 0, prev = null;
    rows.forEach(function(r, i){
      if(prev === null || r.total !== prev){ pos = i + 1; prev = r.total; }
      r.rank = pos;
    });
    return rows;
  }

  /* 画一行选手（7 个数据格 + 行尾 1 个删除键 = 8 格）。抽出来是为了
     「平铺」与「队伍分组」两条渲染路径共用。 */
  function buildRowEl(r){
    var row = document.createElement("div");
    row.className = "rank-row" + (r.rank <= 3 ? " top" + r.rank : "");
    row.setAttribute("data-rank", String(r.rank));
    row.setAttribute("data-name", r.name);         // 向左拖动唤起删除键时用来认人

    var cPos = document.createElement("div");
    cPos.className = "rk-col rk-pos";
    cPos.textContent = String(r.rank);

    var cName = document.createElement("div");
    cName.className = "rk-col rk-name";
    cName.textContent = r.name;                    // textContent：免疫 HTML 注入
    if(r.addedAt){
      var small = document.createElement("small");
      small.textContent = "录入 " + r.addedAt;
      cName.appendChild(small);
    }

    var cBase = document.createElement("div");
    cBase.className = "rk-col rk-num";
    cBase.textContent = fmtSigned(r.base);

    var cMult = document.createElement("div");
    cMult.className = "rk-col rk-num";
    cMult.textContent = fmtMult(r.multiplier);

    /* 团队加分：初赛不拆团队分（值恒为 0），显示 0 而不是留空，
       这样每一行的列数固定 7 格，与表头天然对齐。 */
    var cTeam = document.createElement("div");
    cTeam.className = "rk-col rk-num rk-team";
    cTeam.textContent = fmtSigned(r.team);

    /* 源石锭消耗：用户要求**绿色**显示（`.rk-yuan` 在 css 里定色）。
       消耗是「用掉多少」，不带正负号，直接印数值。 */
    var cYuan = document.createElement("div");
    cYuan.className = "rk-col rk-num rk-yuan";
    cYuan.textContent = fmtNum(r.yuan);

    var cTotal = document.createElement("div");
    cTotal.className = "rk-col rk-num rk-total" + (r.total < 0 ? " negative" : "");
    cTotal.textContent = fmtNum(r.total);

    row.appendChild(cPos);
    row.appendChild(cName);
    row.appendChild(cBase);
    row.appendChild(cMult);
    row.appendChild(cTeam);
    row.appendChild(cYuan);
    row.appendChild(cTotal);

    /* 第 8 格：行尾的「删除选手」键。**默认看不见**，在该行上**向左拖动**才亮出来
       （用户 2026-09-24 先要求双击、当天改为向左拖动；点页面别处收起）。
       ⚠️ 它是 grid 里的**第 8 条显式轨道**（见 css 的 .rank-head,.rank-row）：
          表头只有 7 格、第 8 条轨道空着，所以这条轨道**不会挤动前 7 列的宽度**，
          表头与数据行依旧逐列对齐（若改用「绝对定位」压上去，就会盖住总分那一格）。
       ⚠️ 隐藏用 visibility（css 里写）而不是 display:none —— 保持「位置在、只是看不见」，
          顺带让它不进 Tab 序、不参与命中测试（同「锁定赛事规则」那次的结论）。 */
    var del = document.createElement("button");
    del.type = "button";
    del.className = "row-del";
    del.setAttribute("data-del-player", r.name);
    del.setAttribute("aria-label", "删除选手 " + r.name);
    del.title = "删除这位选手";
    del.textContent = "✕";
    row.appendChild(del);
    return row;
  }

  /* 队头里的一块「弱化小标签 + 绿数字」（已使用 / 剩余各一块）。
     ⚠️ 两块都是纯绿数字、又紧挨着，**不给标签就分不清哪个是使用量、哪个是余量**，
        所以标签必须始终渲染（字号也比合计分矮一档：源石锭是次要信息）。
     ⚠️ `over` = 剩余为负（超支）→ 加 `.is-over` 让文字转红，数值本身照印不截断。 */
  function makeYuanItem(labelText, numText, title, over){
    var item = document.createElement("span");
    item.className = "team-yuan-item" + (over ? " is-over" : "");
    item.setAttribute("title", title);
    var lab = document.createElement("span");
    lab.className = "team-yuan-label";
    lab.textContent = labelText;
    var n = document.createElement("span");
    n.className = "team-yuan-num";
    n.textContent = numText;
    item.appendChild(lab);
    item.appendChild(n);
    return item;
  }

  /* 画一个队伍大框（用户 2026-09-23 参考图）：
     左上角**次序 + 队名**、右上角队伍合计分，下面按 rows 列成员；队名后跟人数。
     ⚠️ 队名用 textContent（免疫注入）。空队也给一句占位文案，免得是个空壳。 */
  function buildTeamBoxEl(g, members){
    var box = document.createElement("div");
    /* ⚠️ 前 3 名队伍戴金 / 银 / 铜（与选手行的 `.rank-row.top1~top3` 同一套色），
       让「队名框 + 左上次序」一眼看出冠亚季。
       ⚠️ 判断只看 `g.idx`（按队伍合计分降序的次序），**不看数组下标** ——
          「未分组」的 idx 是 0，绝不能意外吃到冠军皮。 */
    var cls = "team-box" + (g.grouped ? "" : " team-box-loose");
    if(g.idx >= 1 && g.idx <= 3) cls += " team-top" + g.idx;
    box.className = cls;
    box.setAttribute("data-team", g.name);

    var head = document.createElement("div");
    head.className = "team-head";

    /* 排队次序（按队伍合计分降序 1、2、3…；用户 2026-09-24 要求「队名左侧标次序」）。
       ⚠️⚠️ 「未分组」不编号（`g.idx` 为 0），但**元素照旧渲染**、只是留空 ——
          它带**固定宽度**，所以未分组的队名与真实队伍的队名**左端仍然对齐**。
          真用 `display:none` / 干脆不 append 把它抽掉，会让这一行的名字整段左移
          （跟「规则锁定」那次删除键占位被回收是同一种病）。 */
    var idxEl = document.createElement("div");
    idxEl.className = "team-idx" + (g.idx ? "" : " team-idx-none");
    idxEl.textContent = g.idx ? String(g.idx) : "";

    var nameEl = document.createElement("div");
    nameEl.className = "team-name";
    nameEl.textContent = g.name;
    /* 双击队名就地改名（2026-09-24）。
       ⚠️ 属性只打在**真实队伍**的队名上：「未分组」是个虚拟筐、不在 DATA.teams 里，
          没有名字可改 —— 连入口都不给它（免得双击之后才发现无事发生）。
       ⚠️ 属性值取 `"1"` 而不是空串：沿 parentNode 向上找属性的 `closestByAttr`
          判的是 `getAttribute(attr)` 的真假，空串是假值、会找不到。 */
    if(g.grouped){
      nameEl.setAttribute("data-rename-team", "1");
      nameEl.title = "双击可改队名";
    }

    var cntEl = document.createElement("span");
    cntEl.className = "team-count";
    cntEl.textContent = members.length + " 人";
    nameEl.appendChild(cntEl);

    var sumEl = document.createElement("div");
    sumEl.className = "team-sum";
    sumEl.textContent = fmtNum(g.total != null ? g.total : teamTotal(g.name));

    /* 全队源石锭：**已使用** + **剩余**（均为绿色标注）。
       ⚠️ 已使用 = 队内成员 `yuan`（源石锭消耗）之和；剩余 = 计分器设置的决赛初始余额 − 已使用
          （2026-09-24 加「已使用」，2026-09-25 按用户要求把措辞收成三字并补上「剩余」）。
       ⚠️ 与合计分**并排放、同一种绿**，两个纯数字挨着会分不清谁是谁 ——
          所以每块都配一个弱化小标签，字号也比合计分矮一档
          （源石锭是次要信息，不该抢合计分的视觉重心）。
       ⚠️ 排序仍只看 `total`，源石锭**不参与排序**。 */
    var initFinal = yuanInitFinal();
    var usedYuan = (g.yuanTotal != null) ? g.yuanTotal : teamYuan(g.name);
    var restYuan = initFinal - usedYuan;
    var yuanEl = document.createElement("div");
    yuanEl.className = "team-yuan";
    yuanEl.appendChild(makeYuanItem("已使用", fmtNum(usedYuan), "全队已使用源石锭（队内成员消耗之和）"));
    yuanEl.appendChild(makeYuanItem("剩余", fmtNum(restYuan),
      "全队剩余源石锭 = 决赛初始余额 " + initFinal + " − 已使用 " + usedYuan, restYuan < 0));

    head.appendChild(idxEl);
    head.appendChild(nameEl);
    head.appendChild(yuanEl);
    head.appendChild(sumEl);

    /* 「未分组」不是真实队伍 → 不给删。真实队伍给一个小删除键。
       ⚠️ 事件是**委托**在 #rank-list 上的（队伍框是动态渲的，不能逐个绑）。 */
    if(g.grouped){
      var del = document.createElement("button");
      del.type = "button";
      del.className = "team-del";
      del.setAttribute("data-del-team", g.name);
      del.setAttribute("aria-label", "删除队伍 " + g.name);
      del.textContent = "✕";
      head.appendChild(del);
    }
    box.appendChild(head);

    var body = document.createElement("div");
    body.className = "team-body";
    if(members.length){
      members.forEach(function(r){ body.appendChild(buildRowEl(r)); });
    } else {
      var none = document.createElement("div");
      none.className = "team-none";
      none.textContent = g.grouped ? "这个队伍还没有选手" : "暂无未分组选手";
      body.appendChild(none);
    }
    box.appendChild(body);
    return box;
  }

  /* ======================= 行尾删除键（向左拖动唤起） =======================
     用户 2026-09-24 要求：在某位选手的分数条上**向左拖动** → 它行尾冒出删除键，
     点删除键并确认后把这条删掉；点页面其它任何地方则把删除键收起来。
     （最初做的是「双击唤起」，当天按要求换成了拖动。）

     状态只有一个「当前点开了删除键的那一行」（armedRow / armedName）——
     同一时刻最多亮一个键，不必给每行各存一份状态。
     ⚠️ **读写都用 className 字符串，不用 classList**：单测的 DOM 桩里
        classList 与 className 是两套彼此独立的存储（Set 与字符串），
        混用会出现「代码加了类、断言却读不到」（仓库里 syncModeUI / toast 也都写 className）。 */
  var armedRow = null;        // 当前亮着删除键的那一行（DOM 节点）
  var armedName = "";         // 它的选手名（弹确认框时用来点名）

  function hasClass(el, cls){
    if(!el || !el.className) return false;
    return (" " + String(el.className) + " ").indexOf(" " + cls + " ") > -1;
  }

  /* 通用「加 / 去一个类」。**只用 className 字符串**（理由见上），下面几个 setXxxClass
     都是它的一行包装 —— 新增状态类时不必再抄一遍 split/filter/join。 */
  function toggleClass(el, cls, on){
    if(!el) return;
    var parts = String(el.className || "").split(/\s+/).filter(function(c){
      return c && c !== cls;
    });
    if(on) parts.push(cls);
    el.className = parts.join(" ");
  }

  function setArmedClass(row, on){ toggleClass(row, "is-armed", on); }

  /* 收起删除键。返回 false，方便调用方 `return disarmRow();` */
  function disarmRow(){
    if(armedRow){
      setArmedClass(armedRow, false);
      armedRow = null;
      armedName = "";
    }
    return false;
  }

  /* 给某一行亮出删除键（同时把上一行收起来）。同一行已经亮着则保持原样。 */
  function armRow(row, name){
    if(!row) return false;
    if(armedRow === row) return true;
    disarmRow();
    armedRow = row;
    armedName = String(name == null ? "" : name);
    setArmedClass(row, true);
    return true;
  }

  /* 当前亮着删除键的选手名（没亮则为 ""）—— 给回归测试用 */
  function armedPlayer(){ return armedRow ? armedName : ""; }

  /* --------------------- 手势：向左拖动 ---------------------
     用户 2026-09-24：「把双击选手条目出现删除键改为向左拖动时在右侧出现删除键」。

     交互设计：
       ① 在行上按下 → 记起点，**先不认方向**；
       ② 指针移动时按「支配轴」分流 —— 竖向为主就是用户在滚页面，本次放弃；
          横向且向左超过 6px 才算进入拖动，行加 .is-swiping（去掉过渡，跟手）；
       ③ 拖动期间**行的 7 个数据格一起左移**（位移量 clamp 到 SWIPE_MAX），
          删除键所在的那一格**不动** —— 视觉上就是「内容被推向左边、右边空出来」；
       ④ 松手：向左拖够 SWIPE_TRIGGER 才亮出删除键，同时数据格**平滑归位**
          （归位后前 7 列仍与表头逐列对齐，不会被拖歪）；
          同一行再拖一次 = 收起（手势可逆，不用去点别处）。

     ⚠️ 用 pointer 事件（一套同时覆盖鼠标 / 触摸 / 触控笔），
        而不是 touch + mouse 两套（那样在混合设备上会重复触发）。
     ⚠️ 监听器挂在 **document** 上而不是行上：指针很容易在拖动中滑出行外，
        挂在行上会在那一刻断线（没有 setPointerCapture 时）。
     ⚠️ 不给自己算时间戳做防抖 —— 无头浏览器里虚拟时钟不推进 Date.now()，
        时间差恒为 0 会让防抖永远生效（这类坑仓库里踩过）。改用「事件来源」判断：
        「点别处收起」改挂在 document 的 **pointerdown** 上（而非 click），
        这样它天然早于本次手势的判定，也不会被 arm 之后紧跟的那次 click 误伤。 */
  var SWIPE_TRIGGER = 36;     // 向左拖够这么多像素才算数
  var SWIPE_MAX = 64;         // 跟手位移的上限（再拖也不动了）
  var swipe = null;           // {row, name, x0, y0, dx, active, pid}

  /* 沿 parentNode 往上找 .rank-row（不设边界，因为要跨过 #rank-list 判「点在行外」）。 */
  function closestRow(node){
    var t = node;
    while(t && t !== document){
      if(hasClass(t, "rank-row")) return t;
      t = t.parentNode;
    }
    return null;
  }

  /* 行的 7 个数据格（不含行尾删除键）—— 拖动时只有它们让位。 */
  function rowCols(row){
    var out = [], kids = row ? row.children : [];
    for(var i = 0; i < kids.length; i++){
      if(hasClass(kids[i], "rk-col")) out.push(kids[i]);
    }
    return out;
  }

  /* 给数据格加/去一个水平位移。px 为 0 时清空（回到 css 的自然位置）。 */
  function setSwipeOffset(row, px){
    var cols = rowCols(row);
    /* ⚠️ 用 transform 而不是 margin/left：transform 不参与布局，
       拖到一半也不会引起重排（也就不会让表头跟着抖）。 */
    var v = px ? "translateX(" + Math.round(px) + "px)" : "";
    for(var i = 0; i < cols.length; i++) cols[i].style.transform = v;
  }

  function setSwipingClass(row, on){ toggleClass(row, "is-swiping", on); }

  /* 放弃本次手势（纵向滚动 / 指针取消）：回位、不改变删除键状态。
     ⚠️ 两种手势的收尾不一样 —— 「向左拖动」是把数据格归位、摘 is-swiping；
        「搬运」是摘 is-dragging、收掉幽灵与落点高亮。所以按 kind 分流。 */
  function cancelSwipe(){
    if(!swipe) return;
    var s = swipe;
    swipe = null;
    if(s.kind === "move"){
      endMoveDrag(s.row);
      return;
    }
    if(s.active){
      setSwipingClass(s.row, false);
      setSwipeOffset(s.row, 0);
    }
  }

  /* 当前是否正拖着（给回归测试用） */
  function swipeActive(){ return !!(swipe && swipe.active); }

  /* --------------------- 手势之二：纵向拖动 = 搬到别的队伍 ---------------------
     用户 2026-09-24：「在决赛栏目可以直接通过拖拽未分组下的选手条目，
     将选手拖拽到已有的队伍中」。

     与「向左拖动亮删除键」**共用同一次按下**，靠支配轴分流：
       · 横向向左为主 → 亮删除键（就是上面那条路径，行为一字未改）；
       · 纵向为主     → 这一条跟着指针抬起，松手落进指针所在的队伍框里。
     同一个手势只会走其中一条，两条互不干扰。

     ⚠️ 只在**决赛的分组视图**里接管纵向拖动（初赛没有队伍概念、平铺视图也没有可落的地方）——
        不在分组视图时照旧「放弃本次手势」，纵向手势留给页面滚动。
     ⚠️ 落点用**坐标**去命中队伍框（遍历 .team-box 的 getBoundingClientRect，看指针落在谁里面），
        而不是看 `pointermove` 的 `ev.target`：
          · 鼠标每个 move 都由浏览器重新做命中测试，target 确实是「指针下的元素」，
            但**触摸**有「隐式指针捕获」—— 一旦 pointerdown 落在某行上，
            后续 move 的 target 会**一直钉在那个行上**（规范如此），
            于是「拖到别的框上」永远读成本行所属的那个框，触摸拖拽会静默失效；
          · clientX/clientY 在鼠标 / 触摸 / 触控笔下都是真实坐标，用它判落点一视同仁。
        （`document.elementFromPoint` 也能用、且同样不怕隐式捕获，但矩形遍历
          不依赖 DOM 层级与遮挡关系，还能在单测桩里注入假矩形来验证，所以选了后者。）
     ⚠️ 幽灵挂在 **document.body** 上（桩里没有 body 时回落 #rank-list）：
        若挂在 #rank-list 里，`elList.children` 就会多出一个非队伍框的节点 ——
        队伍框遍历与「共 N 个框」这类回归断言都按 children 数数，会被带歪。
     ⚠️ 拖到视口边缘时的自动滚动只能用 window.scrollBy（每次移动滚一点）——
        无头浏览器里虚拟时钟不推进，任何「定时循环」都不会动，别用 rAF / setInterval 起动画。 */
  var DRAG_TRIGGER = 10;      // 纵向移动超过这么多像素才算「想搬走」（防手抖）
  var SCROLL_EDGE  = 72;      // 指针进入视口上/下这么多像素内就开始自动滚动
  var groupedView  = false;   // 当前是不是决赛的分组视图（render() 维护）
  var dragGhostEl  = null;    // 跟着指针跑的那个小牌子
  var dragTargetBox = null;   // 当前高亮着的落点框

  function setDraggingClass(row, on){ toggleClass(row, "is-dragging", on); }

  /* 造一个跟着指针跑的小牌子（显示选手名），放进 document.body */
  function makeGhost(name, x, y){
    var g = document.createElement("div");
    g.className = "rank-drag-ghost";
    g.textContent = name;
    var host = document.body || elList;
    if(host && host.appendChild) host.appendChild(g);
    placeGhost(g, x, y);
    return g;
  }

  /* ⚠️ 用 fixed 定位 + left/top 跟手：它不进布局，拖多久都不会引起重排。 */
  function placeGhost(g, x, y){
    if(!g || !g.style) return;
    g.style.left = Math.round(x + 14) + "px";
    g.style.top  = Math.round(y - 16) + "px";
  }

  function removeGhost(){
    var g = dragGhostEl;
    dragGhostEl = null;
    if(g && g.parentNode && g.parentNode.removeChild) g.parentNode.removeChild(g);
  }

  /* 指针（clientX/clientY）落在哪个队伍框里（不在分组视图 / 落在框外 → null）。
     ⚠️ 第一次命中就返回：队伍框是竖直排列、互不重叠的，不存在「同时落在两个框里」。
     ⚠️ 矩形与 clientX/Y 都是**视口坐标**，页面滚动后依旧对得上，不必去读 scrollTop。 */
  function dropBoxAtPoint(x, y){
    if(!groupedView || !elList || x == null || y == null) return null;
    var kids = elList.children || [];
    for(var i = 0; i < kids.length; i++){
      var b = kids[i];
      if(!hasClass(b, "team-box")) continue;
      if(typeof b.getBoundingClientRect !== "function") continue;
      var r = b.getBoundingClientRect();
      if(!r || r.right == null || r.bottom == null) continue;
      if(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return b;
    }
    return null;
  }

  function setDropTarget(box){
    box = box || null;
    if(dragTargetBox === box) return;
    if(dragTargetBox) toggleClass(dragTargetBox, "is-drop-target", false);
    dragTargetBox = box;
    if(dragTargetBox) toggleClass(dragTargetBox, "is-drop-target", true);
  }

  /* 拖到视口上下边缘时自己滚一点，好让远处的队伍框也能拖到。 */
  function autoScroll(y){
    if(typeof window === "undefined" || typeof window.scrollBy !== "function") return;
    var de = document.documentElement;
    var vh = (de && de.clientHeight) ? de.clientHeight : 0;
    if(!vh) return;
    if(y < SCROLL_EDGE) window.scrollBy(0, -Math.ceil((SCROLL_EDGE - y) / 5));
    else if(y > vh - SCROLL_EDGE) window.scrollBy(0, Math.ceil((y - (vh - SCROLL_EDGE)) / 5));
  }

  /* 进入「搬运」模式。返回 true 表示这次纵向拖动被我们接管（否则调用方按原样放弃手势）。
     ⚠️ 起手判定取自**行所在的队伍框**，不看指针坐标 ——
        队伍框的第一行上边缘紧贴队头，往上一动就可能已经出了框，
        按坐标判会在第一下移动时就误判成「不在框里」而放弃。 */
  function beginMoveDrag(row){
    if(!groupedView) return false;
    var src = closestByAttr(row, "data-team");
    if(!(src && hasClass(src, "team-box"))) return false;
    var name = row.getAttribute("data-name") || "";
    if(!name) return false;
    swipe.kind = "move";
    swipe.name = name;
    setDraggingClass(row, true);
    dragGhostEl = makeGhost(name, swipe.x0, swipe.y0);
    return true;
  }

  function updateMoveDrag(ev){
    if(dragGhostEl) placeGhost(dragGhostEl, ev.clientX, ev.clientY);
    setDropTarget(dropBoxAtPoint(ev.clientX, ev.clientY));
    autoScroll(ev.clientY);
  }

  /* 收尾：摘虚线、收幽灵、灭高亮。行本身可能已经不在文档里（重渲染过），
     但删类 / 删节点都是幂等的，不必先判存活。
     ⚠️ 行必须从参数拿：`cancelSwipe()` 调它时 `swipe` 已经被清空了，读不到 `swipe.row`。 */
  function endMoveDrag(row){
    if(row) setDraggingClass(row, false);
    removeGhost();
    setDropTarget(null);
  }

  /* 把选手搬到另一个队伍（`teamName` 为「未分组」= 移出队伍）。
     成功返回 {ok:true, msg}，没变化 / 找不到返回 {ok:false, msg}（msg 可能为空 = 静默）。 */
  function movePlayerToTeam(name, teamName){
    var i = findPlayerIndex(name);
    if(i < 0) return { ok: false, msg: "找不到选手「" + name + "」" };
    var target = normTeamName(teamName);
    var dest = "";
    if(target && target !== NO_TEAM){
      /* ⚠️ 只认**已经登记过**的队伍：拖到一个不存在的队名上应当什么都不发生，
         而不是凭空造出一个队（建队有它自己的入口「添加队伍」）。 */
      if(!teamExists(target)) return { ok: false, msg: "" };
      dest = canonTeam(target);                 // 大小写按已登记的那个来
    }
    var cur = normTeamName(DATA.list[i].league);
    if(cur.toLowerCase() === dest.toLowerCase()) return { ok: false, msg: "" };  // 原地放下
    DATA.list[i].league = dest;                 // ⚠️ 改的是 league（队伍归属），不是 team（团队加分）
    DATA.updatedAt = stampNow();
    saveData(DATA);
    render();
    var msg = dest
      ? "已把「" + name + "」移入「" + dest + "」"
      : "已把「" + name + "」移出「" + (cur || NO_TEAM) + "」，回到「" + NO_TEAM + "」";
    return { ok: true, msg: msg };
  }

  /* 松手落位：以**松手那一刻指针所在的框**为准（最后一次移动的位置不一定等于松手位置）。
     ⚠️ 落点要先算再清场 —— `endMoveDrag()` 会把高亮（也就是 dragTargetBox）一起清掉。 */
  function finishMoveDrag(s, ev){
    var box = dropBoxAtPoint(ev && ev.clientX, ev && ev.clientY);
    endMoveDrag(s.row);
    if(!box) return null;                        // 落在框外 → 静默取消，一个字不动
    var res = movePlayerToTeam(s.name, box.getAttribute("data-team"));
    if(res && res.ok) toast("ok", res.msg);
    return res;
  }

  /* 从当前赛程的榜单里删掉一位选手（同名判定与 ingest 同口径：掐首尾空白 + 忽略大小写）。 */
  function findPlayerIndex(name){
    var key = String(name == null ? "" : name).trim().toLowerCase();
    if(!key) return -1;
    return (DATA.list || []).findIndex(function(it){
      return String(it && it.name == null ? "" : it.name).trim().toLowerCase() === key;
    });
  }

  /* 删一位选手。成功返回它的名字（供提示文案），没找到返回 ""。 */
  function removePlayer(name){
    var i = findPlayerIndex(name);
    if(i < 0) return "";
    var nm = String(DATA.list[i].name);
    DATA.list.splice(i, 1);
    DATA.updatedAt = stampNow();       // 删人也是「榜单变了」，时间戳跟着走
    saveData(DATA);
    render();
    return nm;
  }

  function render(){
    /* ⚠️ 每次重渲染都先收起删除键、拖拽痕迹与改名编辑态：`elList.innerHTML = ""`
       会把旧行整批丢掉，留着 armedRow / swipe / renameBox 就指向一个已经脱离文档的节点，
       后面「点别处收起」会操作空气。 */
    disarmRow();
    cancelSwipe();
    cancelRename();
    var rows = rankedRows();

    if(elCount) elCount.textContent = String(rows.length);
    if(elTime)  elTime.textContent  = (DATA.updatedAt || "").trim() === "" ? "—" : DATA.updatedAt;
    /* ⚠️ 空态文案与**分组视图**是互斥的：决赛里只要建了队，名单区就有东西可看
       （哪怕空队），再叠一句「还没有上榜数据」会自相矛盾。
       所以交给下面算完 groups 再决定 elEmpty 的显隐。 */
    var pendingEmpty = (rows.length === 0);

    /* 分组视图**只在决赛**开启（初赛没有队伍概念）。
       ⚠️ 决赛人少也没关系：没有队伍时 groupByTeam() 只返回「未分组」一项，
          而那个单独的分组框跟平铺长得几乎一样，不会突兀。
       ⚠️ 同时把这个事实记到 `groupedView` 上 —— 「纵向拖动 = 搬到别的队伍」只在
          分组视图里接管手势（见 dropBoxOf），不能靠 DOM 上的 data-view 属性现读
          （那属于表现层的附带产物，逻辑不该依赖它）。 */
    var grouped = (mode === "final");
    groupedView = grouped;

    /* 分组视图要渲染的组 —— **一个人都没有时也要渲染**：
       刚建好的队是个空壳，若因「0 人就不画」而不显示，用户会以为建队失败了。
       （平铺视图则照旧：没人 = 列表空着 + 空态文案。） */
    var groups = null;
    if(grouped){
      groups = groupByTeam();
      if(!rows.length){
        /* 没人时 groupByTeam() 会把「未分组」滤掉（它只在有散人时才出现），
           但空队要留着 —— 所以这里直接用队伍列表兜一份。
           ⚠️ 次序要与 groupByTeam() 一致：0 分并列 → 按队名排（这里同样 localeCompare）。 */
        if(!groups.length){
          groups = teamList().map(normTeamName).filter(function(n){ return n !== ""; })
            .sort(function(a, b){ return a.localeCompare(b, "zh"); })
            .map(function(n, i){ return { name: n, members: [], grouped: true, total: 0, yuanTotal: 0, idx: i + 1 }; });
        }
      }
    }

    if(elList){
      elList.innerHTML = "";
      elList.setAttribute("data-view", grouped ? "grouped" : "flat");
      var drawable = grouped ? groups.length : rows.length;
      /* 空态：名单区什么都没画时才提示（决赛建了空队 → 有框可看 → 不提示） */
      if(elEmpty) elEmpty.hidden = !(pendingEmpty && !drawable);
      if(drawable){
        var frag = document.createDocumentFragment();
        if(grouped){
          /* ⚠️ 另一处易踩的坑：`groupByTeam()` 内部**自己又调了一遍 buildRows()**，
             那批行是「新造的」，没带上上面刚算好的 `rank` ——
             直接用会让队伍框里的队员名次全是 undefined（回归抓到过）。
             做法：把 `rank` 按「行对象」记下来，再用**同一套排序键**回填。
             这里按 (name, total) 回查：同名同分是同一行，回填不会串。 */
          var rankOf = {};
          rows.forEach(function(r){ rankOf[r.name + "\u0000" + r.total] = r.rank; });
          groups.forEach(function(g){
            g.members.forEach(function(m){
              m.rank = rankOf[m.name + "\u0000" + m.total];
            });
            frag.appendChild(buildTeamBoxEl(g, g.members));
          });
        } else {
          rows.forEach(function(r){ frag.appendChild(buildRowEl(r)); });
        }
        elList.appendChild(frag);
      }
    } else if(elEmpty){
      elEmpty.hidden = !pendingEmpty;          // 没有名单区可画时的兜底
    }

    window.RANKING_ROWS = rows;
    return rows;
  }

  /* ======================= 提示条 ======================= */

  var toastTimer = null;
  function toast(kind, html, sticky){
    if(!elToast) return;
    elToast.className = "rank-toast" + (kind ? " " + kind : "");
    elToast.innerHTML = html;
    elToast.hidden = false;
    if(toastTimer) clearTimeout(toastTimer);
    if(!sticky) toastTimer = setTimeout(function(){ elToast.hidden = true; }, 6000);
  }

  /* ======================= 队伍（仅决赛） =======================
     用户 2026-09-23 要求：决赛里可以「添加队伍」，选手按队伍归入一个个大框。
     数据上队伍就是**一串队名字符串**（`DATA.teams`），选手记录多一个 `league`
     字段存队名（**不是** `team` —— 那个是数值型的「团队加分」，别混）。
     ⚠️ 存名字不存 id：存档/导出都是人可读的，删队也不会留下悬空 id。 */

  /* 选手「没有队伍」时归到这个虚拟分组；**不是**真实队伍，不写进 DATA.teams。 */
  var NO_TEAM = "未分组";

  function teamList(){
    if(!Array.isArray(DATA.teams)) DATA.teams = [];
    return DATA.teams;
  }

  /* 队名规范化：掐首尾空白；空 → ""（调用方据此判非法） */
  function normTeamName(s){
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  /* 已经有这个队了吗？判定容忍大小写与首尾空格（与选手同名判定同口径） */
  function findTeam(name){
    var key = normTeamName(name).toLowerCase();
    if(!key) return -1;
    return teamList().findIndex(function(t){
      return normTeamName(t).toLowerCase() === key;
    });
  }

  /* 某队名在 DATA.teams 里的**规范写法**（大小写按已存在的那个来）。
     找不到就原样返回规范化后的名字 —— 用于「选手挂到一个还没登记的队」时的兜底。 */
  function canonTeam(name){
    var i = findTeam(name);
    return i > -1 ? normTeamName(teamList()[i]) : normTeamName(name);
  }

  /* 一个队名是否「真实存在」于队伍列表里 */
  function teamExists(name){ return findTeam(name) > -1; }

  /* 加一个队。成功返回 {name}，失败（空名 / 重复）返回 {error} */
  function addTeam(name){
    var n = normTeamName(name);
    if(!n) return { error: "队名不能为空" };
    if(findTeam(n) > -1) return { error: "已经有叫「" + canonTeam(n) + "」的队伍了" };
    teamList().push(n);
    DATA.updatedAt = stampNow();
    saveData(DATA);
    render();
    return { name: n };
  }

  /* 删一个队。⚠️ 队员**不删**，只把它们的 team 摘掉 → 自动落回「未分组」，
     这样误删一个队不会连带把选手成绩一起抹掉。 */
  /* 删一个队。⚠️ 队员**不删**，只把它们的队伍归属摘掉 → 自动落回「未分组」，
     这样误删一个队不会连带把选手成绩一起抹掉。
     ⚠️⚠️ 摘的是 `league`（队伍归属），**不是** `team`（团队加分）！
         这俩字段名字像、含义天差地别 —— 早先这里误写成 `it.team = ""`，
         结果删个队会把选手的团队加分抹成 0、归属却纹丝不动（回归抓到了）。 */
  function removeTeam(name){
    var i = findTeam(name);
    if(i < 0) return false;
    var n = normTeamName(teamList()[i]);
    teamList().splice(i, 1);
    (DATA.list || []).forEach(function(it){
      if(it && normTeamName(it.league).toLowerCase() === n.toLowerCase()) it.league = "";
    });
    saveData(DATA);
    render();
    return true;
  }

  /* ======================= 改队名（双击队名就地编辑，用户 2026-09-24 要求） =======================
     手势：在**队名**上双击 → 队名原地变成输入框、右侧多一个绿对勾；
     回车或点对勾 = 确定，Esc 或点框外 = 放弃。

     ⚠️⚠️ **改队名必须连队员的 `league` 一起改**：队伍归属存的是**队名字符串**，
         只换 DATA.teams 里的那一项、不动 league，队员们会集体掉进「未分组」。
         （`league` 是队伍归属，`team` 是数值型团队加分 —— 这俩别再混。）
     ⚠️ 输入框与对勾是**进编辑态时现插、退出时摘掉**，不常驻。
         常驻就得用 visibility 占位，等于队头**永远**多 24px + 间距，
         双击前后宽度还会跳一下（预占位的意义是「位置在、只是看不见」，这里不需要）。
     ⚠️ 编辑态用**类**表示（`.team-box.is-renaming`），队名本体交给 css
         `.team-box.is-renaming .team-name{display:none}` 让位给输入框 ——
         退出时不必复原任何 DOM 结构：把插进去的两个节点摘掉、类去掉，队名自己就回来了。
         （这里用 display:none 是安全的：被藏起来的队名与顶上来的输入框**二选一**，
           不像「规则锁定」那次是藏掉一个仍要占位的尾巴。） */
  var TEAM_NAME_MAX = 24;      // 与「添加队伍」弹框同一个上限

  var renameBox = null;        // 正在改名的队伍框（DOM 节点）
  var renameOld = "";          // 改名前的队名（写回 league 时按它匹配）
  var renameInput = null;      // 编辑中的输入框
  var renameOkBtn = null;      // 编辑中的对勾

  /* 这个框的队名（读 DOM 上的 data-team，不是读 DATA —— 两者本该一致） */
  function renameOf(box){
    return box ? normTeamName(box.getAttribute("data-team")) : "";
  }

  function renameActive(){ return !!renameBox; }

  function findChildByClass(el, cls){
    if(!el) return null;
    for(var i = 0; i < el.children.length; i++){
      if(hasClass(el.children[i], cls)) return el.children[i];
    }
    return null;
  }

  /* 进入编辑态。返回 true 表示这次双击被我们接手了。 */
  function enterRename(box){
    if(!groupedView) return false;                             // 初赛没有队伍概念
    if(!box || !hasClass(box, "team-box")) return false;
    var head = box.children[0];
    var nameEl = findChildByClass(head, "team-name");
    /* ⚠️ 入口属性打在**队名**上、不在队伍框上（`buildTeamBoxEl` 里那一句）——
       别在框上找它。「未分组」的队名没有这个属性 → 拒改。 */
    if(!nameEl || !nameEl.getAttribute("data-rename-team")) return false;
    if(renameBox === box) return true;                         // 已在编辑这一框，别重来
    cancelRename();                                            // 换框前先把上一框收掉

    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "team-name-input";
    inp.setAttribute("data-rename-input", "1");
    inp.maxLength = TEAM_NAME_MAX;
    inp.value = renameOf(box);
    inp.addEventListener("keydown", function(ev){
      if(ev.key === "Escape" || ev.keyCode === 27){ cancelRename(); return; }
      if(ev.key !== "Enter" && ev.keyCode !== 13) return;
      if(ev.isComposing || ev.keyCode === 229) return;          // 组字中的回车不算
      commitRename();
    });

    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "team-rename-ok";
    ok.setAttribute("data-rename-ok", "1");
    ok.setAttribute("aria-label", "确定改名");
    ok.title = "确定改名（回车）";
    ok.textContent = "✓";

    /* 插在队名**前面**（队名被 css 藏起来），所以视觉顺序仍是「次序 输入框 对勾 …」 */
    head.insertBefore(inp, nameEl);
    head.insertBefore(ok, nameEl);

    renameBox = box; renameOld = renameOf(box);
    renameInput = inp; renameOkBtn = ok;
    toggleClass(box, "is-renaming", true);
    if(inp.focus) inp.focus();
    if(inp.select) inp.select();
    return true;
  }

  /* 退出编辑态、**不改任何数据**。插进去的两个节点摘掉、类去掉，队名自己就回来了。
     ⚠️ 节点可能已经不在文档里（render 过），但 removeChild 是幂等的，不必先判存活。 */
  function cancelRename(){
    if(!renameBox) return;
    var box = renameBox, inp = renameInput, ok = renameOkBtn;
    renameBox = null; renameOld = ""; renameInput = null; renameOkBtn = null;
    if(inp && inp.parentNode) inp.parentNode.removeChild(inp);
    if(ok && ok.parentNode) ok.parentNode.removeChild(ok);
    toggleClass(box, "is-renaming", false);
  }

  /* 改队名。⚠️ 队员的 `league` 一起改。成功返回 {name, from}，失败 {error}。 */
  function renameTeam(oldName, newName){
    var i = findTeam(oldName);
    if(i < 0) return { error: "找不到队伍「" + normTeamName(oldName) + "」" };
    var from = normTeamName(teamList()[i]);
    var to = normTeamName(newName);
    if(!to) return { error: "队名不能为空" };
    /* ⚠️ 重名判定要**排除自己**：只改大小写/首尾空格时 findTeam 命中同一个槽位，
        不排除就会把「TeamA → teama」误报成撞名。 */
    var j = findTeam(to);
    if(j > -1 && j !== i) return { error: "已经有叫「" + canonTeam(to) + "」的队伍了" };

    teamList()[i] = to;
    var key = from.toLowerCase();
    (DATA.list || []).forEach(function(it){
      if(it && normTeamName(it.league).toLowerCase() === key) it.league = to;
    });
    DATA.updatedAt = stampNow();
    saveData(DATA);
    render();
    return { name: to, from: from };
  }

  /* 提交编辑：空名 / 重名就**留在编辑态**、只报个错，别把用户敲的字丢掉。 */
  function commitRename(){
    if(!renameBox) return null;
    var box = renameBox, oldName = renameOld, inp = renameInput;
    var next = normTeamName(inp ? inp.value : "");
    if(next === oldName){ cancelRename(); return null; }        // 一个字没改 → 静静收摊
    if(!next){
      toast("err", "队名不能为空");
      if(inp && inp.focus) inp.focus();
      return { error: "队名不能为空" };
    }
    var res = renameTeam(oldName, next);
    if(res.error){
      /* 失败不 render（render 会把编辑态连同输入框一起冲掉），只提示 + 把焦点还回去 */
      toast("err", res.error);
      if(inp && inp.focus) inp.focus();
      return res;
    }
    cancelRename();                                            // render 里其实也会收，这里收更直白
    toast("ok", "队伍「" + res.from + "」已改名为「" + res.name + "」");
    return res;
  }

  /* 一个选手是否属于「名为 `key`（小写）的那一支」。
     ⚠️ 「未分组」是**虚拟筐**，指 `league` 为空的那批人，并不在 DATA.teams 里；
        只有当真有队伍就叫这个名字时才按普通队名匹配（免得撞名时把散人算进那一队）。
        与 groupByTeam() 的口径一致（那边是「匹配不上任何真实队名 → 落进未分组」）。 */
  function belongsTo(r, key){
    var cur = normTeamName(r.league).toLowerCase();
    if(key === NO_TEAM.toLowerCase() && findTeam(NO_TEAM) < 0) return cur === "";
    return cur === key;
  }

  /* 队伍合计分 = 队内成员总分之和（用户 2026-09-23 选定）。空队 = 0。
     ⚠️ 用 buildRows() 算，保证与榜单上印出来的数字同源。
     ⚠️ 也可以问「未分组」（`NO_TEAM`）—— 纵向拖动把选手搬出队伍后就该看到它涨分。 */
  function teamTotal(name){
    var key = normTeamName(name).toLowerCase();
    return buildRows().reduce(function(sum, r){
      return belongsTo(r, key) ? sum + r.total : sum;
    }, 0);
  }

  /* 全队源石锭消耗 = 队内成员 `yuan`（源石锭消耗）之和。
     ⚠️ 与 `total`（合计分）是两个独立的量，**只用来展示、不参与排序**（用户 2026-09-24 要求）。
     ⚠️ `yuan` 可能缺失（老存档 / 手改 txt），一律按 0。 */
  function teamYuan(name){
    var key = normTeamName(name).toLowerCase();
    return buildRows().reduce(function(sum, r){
      return belongsTo(r, key) ? sum + (r.yuan || 0) : sum;
    }, 0);
  }

  /* ================= 队头的「已使用 / 剩余」源石锭 ================= */

  /* ⚠️「剩余」的基准 = **计分器页面里设置的「决赛初始源石锭余额」**（用户 2026-09-25 要求），
        它是用户在计分器源石锭面板齿轮弹框里改的值，存在**计分器自己的存档键**里。
        榜单页**不引入 app.js**，所以这里只能去读那份存档（同源下 localStorage 共享）。
     ⚠️ 读不到时（对方只拿到榜单页 / 跨 origin 打开 / 隐私模式 / 存档被手改坏）→
        回落**出厂默认 120**，与 app.js 的 `YUAN_INIT_FINAL` 保持一致；
        绝不能因为读不到就按 0 算（那会把「剩余」显示成一个巨大的负数）。
     ⚠️ 只读不写：榜单页永远不碰计分器的存档。 */
  var COUNTER_KEY = "hlsh_zhoujibei_counter_v1";
  var YUAN_INIT_FINAL_FALLBACK = 120;

  function yuanInitFinal(){
    try{
      var raw = LS ? LS.getItem(COUNTER_KEY) : null;
      if(raw){
        var o = JSON.parse(raw);
        var v = parseInt(o && o.yuanInitFinal, 10);
        if(isFinite(v) && v >= 0) return v;
      }
    }catch(e){ /* 坏档 / 隐私模式：按出厂默认 */ }
    return YUAN_INIT_FINAL_FALLBACK;
  }

  /* 全队剩余源石锭 = 计分器设置的决赛初始余额 − 全队已使用（源石锭消耗之和）。
     ⚠️ **允许为负**（全队用得比初始余额还多）：负数是有意义的信息，不 clamp 成 0，
        交给上层用红色标出「超支」。 */
  function teamYuanRest(name){
    return yuanInitFinal() - teamYuan(name);
  }

  /* 把选手按队伍分组，**保持榜单顺序**（组内成员也是总分降序）——
     直接用已经排好序的 buildRows()，不重新排。
     返回 [{name, total, yuanTotal, members:[row…], grouped:bool, idx:number}]；
     ⚠️ 真实队伍按**队伍合计分降序**排，并按这个顺序编上 `idx`（1、2、3…）。
     ⚠️⚠️ 「未分组」是**虚拟筐、不算一支参赛队伍** —— `idx = 0`（**不编号**）且
          **固定在最后**（用户 2026-09-24 选定；此前是钉在最前，现已改）。
          注意它**仍然参与排序位置**：只是永远落底，不按它的合计分插队。 */
  function groupByTeam(){
    var rows = buildRows();
    var buckets = {};                       // key(小写) → {name, members}
    teamList().map(normTeamName).forEach(function(n){
      if(n !== "") buckets[n.toLowerCase()] = { name: n, members: [] };
    });

    var loose = { name: NO_TEAM, members: [], grouped: false, total: 0, yuanTotal: 0 };
    rows.forEach(function(r){
      var b = r.league && buckets[r.league.toLowerCase()];
      (b ? b.members : loose.members).push(r);
    });

    var sum = function(list){ return list.reduce(function(s, r){ return s + r.total; }, 0); };
    /* 全队源石锭消耗（与合计分并列展示，不参与排序） */
    var sumYuan = function(list){ return list.reduce(function(s, r){ return s + (r.yuan || 0); }, 0); };
    var groups = Object.keys(buckets).map(function(k){
      var b = buckets[k];
      /* 空队也留着（用户刚建的队要看得见，才好往里加人） */
      return {
        name: b.name, members: b.members, grouped: true,
        total: sum(b.members), yuanTotal: sumYuan(b.members)
      };
    }).sort(function(a, b){                       // 队伍之间按合计分降序
      if(b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name, "zh");
    });

    /* 编号：**真实队伍**才有次序（1、2、3…，与上面的排序同源，天然单调） */
    groups.forEach(function(g, i){ g.idx = i + 1; });

    if(loose.members.length){
      loose.total = sum(loose.members);
      loose.yuanTotal = sumYuan(loose.members);
      loose.idx = 0;                          // 0 = 不编号（虚拟筐）
      groups.push(loose);                     // ⚠️ 压到最后，不 unshift 到最前
    }
    return groups;
  }

  /* ======================= 居中弹框（通用） =======================
     决赛页有两处要用：① 添加队伍（输入队名）② 添加选手（选队伍 + 选 txt）。
     风格与计分器同款：全屏半透明遮罩 + 居中卡片。
     ⚠️ 弹框 DOM 写在 ranking.html 里（静态、可控），这里只负责开/关与取返回值；
        开关用 `hidden` 属性，css 只管长什么样（与「添加队伍」按钮同一套双真相思路）。
        元素引用统一在文件前部的「元素引用」段里取（elModal*）。 */

  var modalOnOk = null;                    // 点「确定」时调用；返回字符串 → 当错误信息显示

  function modalOpen(title, okText, onOk){
    if(!elModal) return false;
    modalOnOk = onOk;
    if(elModalTitle) elModalTitle.textContent = title;
    if(elModalErr){ elModalErr.textContent = ""; elModalErr.hidden = true; }
    if(elModalOk) elModalOk.textContent = okText || "确定";
    elModal.hidden = false;
    /* 自动聚焦第一个可输入控件，省一次点击 */
    var focusable = elModalBody && elModalBody.querySelector
      ? elModalBody.querySelector("input, select") : null;
    if(focusable && focusable.focus) focusable.focus();
    return true;
  }

  function modalClose(){
    modalOnOk = null;
    if(elModal) elModal.hidden = true;
  }

  function modalIsOpen(){ return !!(elModal && elModal.hidden === false); }

  function modalError(msg){
    if(!elModalErr) return;
    elModalErr.textContent = msg;
    elModalErr.hidden = false;
  }

  /* 「确定」：把结果交给调用方；返回字符串说明有错 → 显示在弹框里、**不关窗**；
     否则关窗。 */
  function modalConfirm(){
    if(typeof modalOnOk !== "function"){ modalClose(); return; }
    var res = modalOnOk();
    if(typeof res === "string" && res !== ""){ modalError(res); return; }
    modalClose();
  }

  if(elModalOk)     elModalOk.addEventListener("click", modalConfirm);
  if(elModalCancel) elModalCancel.addEventListener("click", modalClose);
  /* 点遮罩空白处 = 取消（点卡片内部不算） */
  if(elModal){
    elModal.addEventListener("click", function(ev){
      if(ev.target === elModal) modalClose();
    });
  }
  /* Esc 关窗 */
  document.addEventListener("keydown", function(ev){
    if((ev.key === "Escape" || ev.keyCode === 27) && modalIsOpen()) modalClose();
  });

  /* ======================= 添加选手 ======================= */

  function stampNow(){
    var d = new Date(), p = function(n){ return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function readFile(file){
    return new Promise(function(resolve){
      var fr = new FileReader();
      fr.onload  = function(){ resolve(String(fr.result)); };
      fr.onerror = function(){ resolve(null); };
      fr.readAsText(file, "utf-8");
    });
  }

  /* 把一批文件解析并并入榜单。**同名覆盖旧的**（用户 2026-09-23 选定）
     ⚠️ 只并入**当前赛程**那一块榜单。
     `league`（可选）：把这一批选手归到哪个队伍；省略/空串 → 归「未分组」。
     ⚠️ 如果给了一个**还没登记**的队名，会自动把它登记进 DATA.teams
        —— 免得选手挂在一个队伍框都不存在的队上，界面上直接人间蒸发。 */
  function ingest(files, league){
    if(!files || !files.length) return;
    var arr = Array.prototype.slice.call(files);
    var target = normTeamName(league);
    var dest0 = "";                          // 实际落到的队名（供提示文案用）

    Promise.all(arr.map(function(f){
      return readFile(f).then(function(text){
        if(text == null) return { file: f.name, error: "读取失败" };
        var r = parseExport(text);
        if(r.error) return { file: f.name, error: r.error };
        return { file: f.name, rec: r };
      });
    })).then(function(results){
      var okList = [], errList = [];
      results.forEach(function(x){ (x.error ? errList : okList).push(x); });

      if(okList.length){
        var addedAt = stampNow();
        /* 挂到还没登记的队上时，先把队建出来（幂等：已存在就不重复建） */
        if(target && target !== NO_TEAM && !teamExists(target)){
          var added = addTeam(target);
          target = added.error ? target : added.name;
        }
        var dest = teamExists(target) ? canonTeam(target) : "";
        dest0 = dest;
        okList.forEach(function(x){
          var rec = {
            name: x.rec.name,
            base: x.rec.base,
            multiplier: x.rec.multiplier,
            team: x.rec.team,
            yuan: x.rec.yuan,
            total: x.rec.total,
            league: dest,
            addedAt: addedAt
          };
          var key = rec.name.toLowerCase();          // 同名判定容忍大小写与首尾空格
          var hit = DATA.list.findIndex(function(it){
            return String(it && it.name == null ? "" : it.name).trim().toLowerCase() === key;
          });
          if(hit > -1) DATA.list[hit] = rec;
          else DATA.list.push(rec);
        });
        DATA.updatedAt = addedAt;
        saveData(DATA);
        render();
      }

      /* 反馈：成功绿色、全失败红色、部分成功中性。文案里带上赛程，避免看错榜单。 */
      var mark = "【" + MODES[mode].label + "】";
      var where = dest0 ? (" 归入「" + dest0 + "」") : "";
      var msg = "";
      if(okList.length){
        msg += "<b>" + mark + "已上榜 " + okList.length + " 位" + where + "：</b>" +
               okList.map(function(x){ return x.rec.name; }).join("、");
      }
      if(errList.length){
        if(msg) msg += "<br>";
        else msg += "没有读到有效数据：";
        msg += "<ul>" + errList.map(function(x){
          return "<li>" + x.file + " —— " + x.error + "</li>";
        }).join("") + "</ul>";
      }
      toast(errList.length && !okList.length ? "err" : (errList.length ? "" : "ok"),
            msg || "没有可导入的文件");
    });
  }

  /* ======================= 清空榜单 =======================
     红色按键「清空榜单」（用户 2026-09-23 要求）。
     ⚠️ 只清**当前赛程**那一块；另一块一个字都不动。
     ⚠️ 不可撤销 → 先 window.confirm 二次确认；取消则一个字都不动。
     走 saveData 落盘（与 ingest 同一条路径），保证「清空后刷新页面仍是空的」。
     ⚠️ **队伍一起清**：队都清了、人也没了，留着空壳队框反而费解。 */
  function clearBoard(askConfirm){
    var label = MODES[mode].label;
    if(askConfirm !== false){
      var n = DATA.list ? DATA.list.length : 0;
      var t = teamList().length;
      if(!n && !t){ toast("", "「" + label + "」榜单本来就是空的，无需清空"); return false; }
      if(typeof window.confirm === "function" &&
         !window.confirm("确定要清空「" + label + "」榜单吗？\n\n共 " + n + " 位选手" +
                         (t ? "、" + t + " 支队伍" : "") +
                         "的数据将被删除，此操作不可撤销。\n（另一场赛程的榜单不受影响）")){
        return false;                            // 用户取消 → 保持原样
      }
    }
    DATA.list = [];
    DATA.teams = [];
    DATA.updatedAt = "";
    saveData(DATA);
    render();
    toast("ok", "已清空「" + label + "」榜单");
    return true;
  }

  /* ======================= 导出 / 导入（榜单 txt 存档） =======================

     用户 2026-09-26 要求：「为初赛和决赛页面下的实时选手榜单也做一个导出导入功能，
     按钮在最左和最右侧，导出成 txt 文本形式」。

     格式与计分器的存档一脉相承（见 app.js 的 buildExportText）：
       · 上半是「可读汇总」—— 名次、选手、基础分 / 倍率 / 团队加分 / 源石锭 / 总分；
         决赛还多一段按队汇总（人数 / 已使用 / 剩余 / 合计分）。供人阅读、打印、留档。
       · 下半**只有一行** `DATA:{…}` —— 导入时只读这一行，因此上半怎么写都不会把导入弄坏。

     ⚠️ 导出的是**当前正在看的那一块**榜单（初赛 / 决赛各一份）。
        文件里记下它来自哪一场；导入时若与当前赛程不符，会在确认框里额外警告一句。
     ⚠️ 导入 = **覆盖当前赛程的榜单**（先 window.confirm 再动手），与计分器
        「导入 = 整体替换」同一口径；另一场赛程一个字都不动。
     ⚠️ DATA 行**故意不含源石锭余额设置**：「剩余」的基准只住在计分器的存档里
        （见上面 yuanInitFinal() 那段），本页只是读它来显示。把它抄进榜单文件，
        就等于造出「文件里的基准」与「本机的基准」两个真相。可读区印一行留档即可。
     ========================================================================== */

  var BOARD_VERSION    = 1;
  var BOARD_MARKER     = "DATA:";
  var BOARD_FILE_PREFIX = "黑流树海粥集杯#1榜单";

  /* 文本对齐：全角字符按 2 个宽度计，让「名字 ....... 总分」的点线对齐
     （与计分器同款；榜单页不引入 app.js，所以这里自带一份） */
  var WIDE_RE = /[\u1100-\u115f\u2e80-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;
  function displayWidth(s){
    s = String(s == null ? "" : s);
    var w = 0;
    for(var i = 0; i < s.length; i++) w += WIDE_RE.test(s.charAt(i)) ? 2 : 1;
    return w;
  }
  function dots(label, width){
    return label + " " + ".".repeat(Math.max(2, width - displayWidth(label))) + " ";
  }

  function stampFull(){
    var d = new Date(), p = function(n){ return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
           p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function boardFileStamp(){
    var d = new Date(), p = function(n){ return String(n).padStart(2, "0"); };
    return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
           p(d.getHours()) + p(d.getMinutes());
  }
  /* 导出文件名：黑流树海粥集杯#1榜单-决赛-20260926-1435.txt */
  function boardFileName(){
    return BOARD_FILE_PREFIX + "-" + MODES[mode].label + "-" + boardFileStamp() + ".txt";
  }

  /* 组装导出的整份文本（只读当前赛程那一块） */
  function buildBoardText(){
    var label = MODES[mode].label;
    var rows  = rankedRows();
    var isFinal = (mode === "final");
    var names = teamList().map(normTeamName).filter(function(n){ return n !== ""; });
    var groups = isFinal ? groupByTeam() : null;

    var L = [];
    function put(s){ L.push(s == null ? "" : s); }
    var d = dots;

    put("==============================================================");
    put("  黑流树海粥集杯#1 实时排名榜单 · " + label);
    put("==============================================================");
    put("导出时间：" + stampFull());
    put("榜单更新：" + (((DATA.updatedAt || "").trim()) || "—"));
    put("选手 " + rows.length + " 位" + (isFinal ? "　队伍 " + names.length + " 支" : ""));
    put("（本文件上半仅供阅读；导入时只读取末尾 " + BOARD_MARKER + " 开头的那一行）");
    put("");

    put("【排名】" + (rows.length ? "共 " + rows.length + " 位（总分降序，同分同名次）" : ""));
    if(!rows.length) put("  （暂无选手）");
    rows.forEach(function(r){
      var tail = "基础分 " + fmtNum(r.base) + " " + fmtMult(r.multiplier) +
                 "，团队 " + fmtSigned(r.team) + "，源石锭 " + fmtNum(r.yuan);
      if(isFinal && r.league) tail += "，队伍 " + r.league;
      put("  " + String(r.rank).padStart(2, " ") + ". " + d(r.name, 20) +
          fmtNum(r.total) + "　　（" + tail + "）");
    });
    put("");

    if(isFinal){
      put("【队伍】" + (names.length ? "共 " + names.length + " 支（按合计分降序；「" + NO_TEAM + "」沉底不编号）" : ""));
      /* 留档一行：剩余是怎么算出来的（榜面上那个「剩余」用的就是这个基准）。
         ⚠️ 只印给人看，不进 DATA 行 —— 它不是榜单数据，是计分器的设置。 */
      put("  " + d("决赛初始源石锭余额", 26) + yuanInitFinal());
      if(!groups.length) put("  （暂无队伍）");
      groups.forEach(function(g){
        put("  " + d((g.idx > 0 ? String(g.idx) + ". " : "") + g.name, 24) +
            g.members.length + " 人　已使用 " + fmtNum(g.yuanTotal) +
            "　剩余 " + fmtNum(yuanInitFinal() - g.yuanTotal) +
            "　合计 " + fmtNum(g.total));
        g.members.forEach(function(m){
          put("      · " + d(m.name, 18) + fmtNum(m.total));
        });
      });
      put("");
    }

    put("--------------------------------------------------------------");
    put("==============================================================");
    put("  以上为可读汇总，仅供查看。导入时只读取下面这一行，请勿手工修改。");
    put("==============================================================");
    put(BOARD_MARKER + JSON.stringify({
      v: BOARD_VERSION,
      mode: mode,
      updatedAt: DATA.updatedAt || "",
      list: rows.map(function(r){
        return {
          name: r.name, base: r.base, multiplier: r.multiplier,
          team: r.team, yuan: r.yuan, total: r.total,
          league: r.league || "", addedAt: r.addedAt || ""
        };
      }),
      teams: names
    }));

    return L.join("\r\n");   // CRLF：Windows 记事本最稳妥（与计分器存档一致）
  }

  /* 解析榜单 txt：只认最后一行以 DATA: 开头的内容。
     任何一步不满足都返回 {error}，由调用方提示；绝不抛异常出去。 */
  function parseBoardText(text){
    var raw = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    if(raw.trim() === "") return { error: "文件是空的" };

    var lines = raw.split(/\r?\n/);
    var payload = null;
    for(var i = lines.length - 1; i >= 0; i--){
      var t = lines[i].trim();
      if(t.lastIndexOf(BOARD_MARKER, 0) === 0){
        payload = t.slice(BOARD_MARKER.length).trim();
        break;
      }
    }
    if(payload === null) return { error: "没有找到 " + BOARD_MARKER + " 数据行（请选择本榜单导出的 txt）" };

    var obj;
    try{ obj = JSON.parse(payload); }
    catch(e){ return { error: "数据行不是合法的 JSON" }; }
    if(!obj || typeof obj !== "object" || Array.isArray(obj)) return { error: "数据内容不是对象" };
    if(typeof obj.v !== "number") return { error: "缺少格式版本号" };
    /* ⚠️ 用 list 判断「这是不是一份榜单档」—— 计分器的存档也是 `v:1`，
       但它的 DATA 行里没有 list，这一条正好把它们区分开，
       用户误选计分器 txt 时会得到一句人话，而不是把两份数据搅在一起。 */
    if(!Array.isArray(obj.list)) return { error: "缺少榜单数据（list），这可能不是榜单导出的文件" };

    return { mode: (obj.mode && MODES[obj.mode]) ? obj.mode : "", board: obj };
  }

  /* 把文件里的数据洗成一块干净的榜单：
       · 数值字段一律过 num()（缺字段 → 0 / 倍率 → 1，绝不产出 NaN）；
       · 空名选手丢掉；队名去空白、按小写去重（保留先出现的那个写法）；
       · ⚠️ `league` 写作「未分组」视同「没归队」（那是虚拟筐，不是真队名）；
       · ⚠️⚠️ 选手挂在一个**没登记过**的队名上 → **自动把队补进 teams**。
            否则 groupByTeam() 匹配不到那个队，人会整批落进「未分组」，
            等于导入后分组凭空散架（与 ingest() 的「自动补建队伍」同一口径）。 */
  function sanitizeBoard(obj){
    var out = {
      updatedAt: (typeof obj.updatedAt === "string" ? obj.updatedAt : ""),
      list: [], teams: []
    };
    var seen = {};
    (Array.isArray(obj.teams) ? obj.teams : []).forEach(function(t){
      var n = normTeamName(t);
      if(n === "" || n === NO_TEAM) return;
      var k = n.toLowerCase();
      if(seen[k]) return;
      seen[k] = true;
      out.teams.push(n);
    });
    (Array.isArray(obj.list) ? obj.list : []).forEach(function(it){
      if(!it || typeof it !== "object") return;
      var name = normTeamName(it.name);
      if(name === "") return;
      var league = normTeamName(it.league);
      if(league === NO_TEAM) league = "";
      if(league !== "" && !seen[league.toLowerCase()]){
        seen[league.toLowerCase()] = true;
        out.teams.push(league);
      }
      out.list.push({
        name: name,
        base: num(it.base, 0),
        multiplier: num(it.multiplier, 1),
        team: num(it.team, 0),
        yuan: num(it.yuan, 0),
        total: num(it.total, 0),
        league: league,
        addedAt: (it.addedAt == null ? "" : String(it.addedAt))
      });
    });
    if(out.updatedAt === "") out.updatedAt = stampNow();
    return out;
  }

  /* 把一块榜单套进**当前赛程**（导入的唯一落点）。
     ⚠️ 只改 DATA 的字段、**不替换 DATA 这个对象** —— `DATA` 是「指向当前槽位」的引用，
        整份替换会让后面的 saveData / ingest 改到孤儿对象上、数据不落盘（踩过）。
     ⚠️ 这里**不切赛程**：按钮在哪个赛程下点，就覆盖哪一块。 */
  function applyBoard(board){
    DATA.list = board.list;
    DATA.teams = board.teams;
    DATA.updatedAt = board.updatedAt || stampNow();
    saveData(DATA);
    render();
  }

  /* ---- 存 / 读文件（与计分器同款：优先 File System Access，失败退回普通下载） ---- */

  function downloadTextFile(name, text){
    var blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });  // BOM 让记事本认 UTF-8
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    if(a.remove) a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  /* ⚠️ 返回的是 Promise，且**必须区分「存好了」和「用户自己取消」**：
      取消时不该弹「已导出」（会让人以为白存了一份）。 */
  function saveTextFile(name, text){
    if(typeof window.showSaveFilePicker === "function"){
      return window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "文本文件", accept: { "text/plain": [".txt"] } }]
      }).then(function(handle){
        return handle.createWritable().then(function(w){
          return w.write(new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" }))
                  .then(function(){ return w.close(); });
        });
      }).then(function(){
        return { saved: true, canceled: false };
      }).catch(function(e){
        if(e && e.name === "AbortError") return { saved: false, canceled: true };
        downloadTextFile(name, text);                   // API 被禁等 → 兜底下载
        return { saved: true, canceled: false, download: true };
      });
    }
    downloadTextFile(name, text);
    return Promise.resolve({ saved: true, canceled: false, download: true });
  }

  /* showOpenFilePicker 不可用时的兜底：临时造一个隐藏的 <input type="file">。
     ⚠️ 不能复用页面上那个 `#rank-file` —— 它是 multiple 的、而且绑给了「添加选手」，
        借来用会把人家的 change 处理器搅进来。 */
  function pickTextFileWithInput(){
    return new Promise(function(resolve){
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".txt,text/plain";
      inp.style.display = "none";
      var done = false;
      function finish(f){
        if(done) return;
        done = true;
        if(inp.remove) inp.remove();
        resolve(f || null);
      }
      inp.addEventListener("change", function(){ finish(inp.files && inp.files[0]); });
      inp.addEventListener("cancel", function(){ finish(null); });   // Chrome 113+ 用户取消
      document.body.appendChild(inp);
      inp.click();
    });
  }

  function pickBoardFile(){
    if(typeof window.showOpenFilePicker === "function"){
      return window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "文本文件", accept: { "text/plain": [".txt"] } }]
      }).then(function(list){
        return (list && list[0]) ? list[0].getFile() : null;
      }).catch(function(e){
        if(e && e.name === "AbortError") return null;   // 用户自己取消
        return pickTextFileWithInput();                 // API 被禁 → 兜底
      });
    }
    return pickTextFileWithInput();
  }

  /* ---- 两个入口（绑在操作区最左 / 最右那两个按键上） ---- */

  function exportBoard(){
    var name = boardFileName(), text;
    try{ text = buildBoardText(); }
    catch(e){ toast("err", "导出失败：无法生成榜单内容"); return; }
    try{
      var p = saveTextFile(name, text);
      if(p && typeof p.then === "function"){
        p.then(function(r){
          if(r && r.canceled) return;                   // 用户自己取消 → 不报错也不邀功
          toast("ok", "已导出【" + MODES[mode].label + "】榜单：" + name);
        }, function(e){ toast("err", "导出失败：" + (e && e.message ? e.message : e)); });
      }
    }catch(e){
      toast("err", "导出失败：" + (e && e.message ? e.message : e));
    }
  }

  /* 导入 = 覆盖当前赛程的榜单。⚠️ 覆盖前必确认（不可撤销），
     文件来自**另一个赛程**时在确认框里再点一句（免得把决赛榜导进初赛）。 */
  function importBoard(){
    pickBoardFile().then(function(file){
      if(!file) return;                                 // 没选文件 / 用户取消
      return readFile(file).then(function(text){
        if(text == null){ toast("err", "文件读取失败"); return; }
        var res = parseBoardText(text);
        if(res.error){ toast("err", "<b>导入失败：</b>" + res.error); return; }

        var board = sanitizeBoard(res.board);
        if(!board.list.length && !board.teams.length){
          toast("err", "<b>导入失败：</b>文件里既没有选手、也没有队伍（要清空请用「清空榜单」）");
          return;
        }

        var label = MODES[mode].label;
        var msg = "确定把这份榜单导入【" + label + "】吗？\n\n" +
                  "文件里有 " + board.list.length + " 位选手" +
                  (board.teams.length ? "、" + board.teams.length + " 支队伍" : "") + "。\n" +
                  "导入会覆盖当前【" + label + "】榜单：原有的 " +
                  ((DATA.list || []).length) + " 位选手将被替换，此操作不可撤销。";
        if(res.mode && res.mode !== mode){
          msg += "\n\n⚠️ 这份文件是从【" + MODES[res.mode].label + "】导出的，" +
                 "确认要导入到【" + label + "】吗？";
        }
        if(typeof window.confirm === "function" && !window.confirm(msg)) return;

        applyBoard(board);
        syncModeUI();                                   // 队伍数变了 → 「添加队伍」等按钮状态重算
        toast("ok", "<b>【" + label + "】已导入 " + board.list.length + " 位选手" +
                    (board.teams.length ? "、" + board.teams.length + " 支队伍" : "") + "</b>");
      });
    }).catch(function(e){
      toast("err", "导入失败：" + (e && e.message ? e.message : e));
    });
  }

  /* ======================= 两个弹框里用到的表单 ======================= */

  /* ① 添加队伍：一个队名输入框 */
  function openAddTeamModal(){
    if(!modalOpen("添加队伍", "确定")) return;
    if(!elModalBody) return;
    elModalBody.innerHTML = "";
    var label = document.createElement("label");
    label.className = "modal-field";
    var cap = document.createElement("span");
    cap.className = "modal-label";
    cap.textContent = "队伍名称";
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "modal-input";
    inp.id = "modal-team-name";
    inp.maxLength = TEAM_NAME_MAX;         // 与「双击队名就地改名」同一个上限
    inp.placeholder = "例如：近锋最强队";
    label.appendChild(cap);
    label.appendChild(inp);
    elModalBody.appendChild(label);

    /* ⚠️ 回车 = 确定（与计分器里规则输入框的手感一致）；
         挡掉输入法组字期间的回车（isComposing / keyCode 229）。 */
    inp.addEventListener("keydown", function(ev){
      if(ev.key !== "Enter" && ev.keyCode !== 13) return;
      if(ev.isComposing || ev.keyCode === 229) return;
      modalConfirm();
    });

    modalOpen("添加队伍", "确定", function(){
      var r = addTeam(inp.value);
      if(r.error) return r.error;
      toast("ok", "已添加队伍「" + r.name + "」");
      return "";
    });
    /* ⚠️ modalOpen 会在聚焦前把 body 清空，所以这里再聚焦一次 */
    if(inp.focus) inp.focus();
  }

  /* ② 添加选手：选队伍 + 选 txt（用户 2026-09-23 选定） */
  function openAddPlayerModal(){
    if(!modalOpen("添加选手", "添加")) return;
    if(!elModalBody) return;
    elModalBody.innerHTML = "";

    /* 选队伍：决赛才有这个概念；初赛只上传 txt，不显示这一栏 */
    var sel = null;
    if(mode === "final"){
      var l1 = document.createElement("label");
      l1.className = "modal-field";
      var c1 = document.createElement("span");
      c1.className = "modal-label";
      c1.textContent = "选择队伍";
      sel = document.createElement("select");
      sel.className = "modal-select";
      sel.id = "modal-player-team";
      var teams = teamList().map(normTeamName).filter(function(n){ return n !== ""; });
      var opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = NO_TEAM;              // 允许「暂不归队」，免得必须建队才能加人
      sel.appendChild(opt0);
      teams.forEach(function(n){
        var o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        sel.appendChild(o);
      });
      l1.appendChild(c1);
      l1.appendChild(sel);
      elModalBody.appendChild(l1);
    }

    /* 选 txt（必填） */
    var l2 = document.createElement("label");
    l2.className = "modal-field";
    var c2 = document.createElement("span");
    c2.className = "modal-label";
    c2.textContent = "计分器导出的 txt";
    var fileInp = document.createElement("input");
    fileInp.type = "file";
    fileInp.className = "modal-file";
    fileInp.id = "modal-player-file";
    fileInp.accept = ".txt,text/plain";
    fileInp.multiple = true;
    l2.appendChild(c2);
    l2.appendChild(fileInp);
    elModalBody.appendChild(l2);

    var hint = document.createElement("p");
    hint.className = "modal-hint";
    hint.textContent = "可多选；同名选手会被覆盖更新。";
    elModalBody.appendChild(hint);

    modalOpen("添加选手", "添加", function(){
      var files = fileInp.files;
      if(!files || !files.length) return "请先选择计分器导出的 txt 存档";
      var team = sel ? sel.value : "";
      ingest(files, team);
      return "";
    });
  }

  /* ======================= 事件绑定 ======================= */

  var elFile = document.getElementById("rank-file");
  var elBtn  = document.getElementById("btn-add-player");
  var elClear = document.getElementById("btn-clear-board");
  /* 「导出 txt」「导入 txt」—— 分别钉在操作区的最左 / 最右（用户 2026-09-26 要求）。 */
  var elExport = document.getElementById("btn-export-board");
  var elImport = document.getElementById("btn-import-board");

  /* 老的文件选择器仍在：作为**没有弹框时**的退路（比如 modal 节点缺失）。 */
  if(elFile){
    elFile.addEventListener("change", function(){
      ingest(elFile.files, "");
      elFile.value = "";          // 清空，方便连续添加同一个文件
    });
  }

  /* 「添加选手」：决赛弹「选队伍 + 选 txt」；初赛（无队伍概念）也走同一个弹框，
     只是里面没有选队伍那一栏 —— 一条路径，不必分叉。 */
  if(elBtn){
    elBtn.addEventListener("click", function(){
      if(elModal) openAddPlayerModal();
      else if(elFile) elFile.click();       // 兜底：弹框节点不在时退回老流程
    });
  }

  if(elClear){
    elClear.addEventListener("click", function(){ clearBoard(true); });
  }

  /* 导出 / 导入榜单 txt（作用对象 = **当前正在看的那一块**榜单） */
  if(elExport){
    elExport.addEventListener("click", function(){ exportBoard(); });
  }
  if(elImport){
    elImport.addEventListener("click", function(){ importBoard(); });
  }

  /* 赛程切换：点胶囊里的初赛/决赛 */
  if(elModes){
    elModes.addEventListener("click", function(ev){
      var t = ev.target;
      while(t && t !== elModes && !t.getAttribute("data-mode")) t = t.parentNode;
      if(!t || t === elModes) return;
      var m = t.getAttribute("data-mode");
      if(m && m !== mode) setBoard(m);
    });
  }

  /* 「添加队伍」（仅决赛）：弹居中弹框输入队名，确定后进 DATA.teams —— 用户 2026-09-23 要求。 */
  if(elAddTeam){
    elAddTeam.addEventListener("click", function(){
      if(elModal) openAddTeamModal();
      else toast("err", "弹框没找到，页面可能没加载完整");
    });
  }

  /* #rank-list 上的事件（行与队伍框都是动态渲的 → 一律用**委托**）。
     ⚠️ 行尾删除键与队伍删除键**合用一个 click 处理器**：单测桩里
        `addEventListener(ev, fn)` 是 `handlers[ev] = fn`（同事件会互相覆盖），
        真 DOM 虽会都跑，但合成一个更稳、也更好读。 */
  /* 从点击目标沿 parentNode 往上找「带某属性的那个祖先」（找不到返回 null）。
     ⚠️ 一直走到 null 为止，不设 elList 边界 —— 因为「点页面别处收起删除键」
        那个处理器里，点击目标本来就可能不在 #rank-list 里，靠属性判断就够了。 */
  function closestByAttr(node, attr){
    var t = node;
    while(t){
      if(t.getAttribute && t.getAttribute(attr)) return t;
      t = t.parentNode;
    }
    return null;
  }

  if(elList){
    elList.addEventListener("click", function(ev){
      /* ⓪ 队名后面那个「确定改名」的对勾（双击队名才出现）。
         ⚠️ 必须排在最前：它是编辑态里唯一的新按钮，先认它，免得被后面的分支抢答。 */
      if(closestByAttr(ev.target, "data-rename-ok")){ commitRename(); return; }

      /* ① 队伍框上的「删除队伍」：队员不跟着删，只摘掉归属 → 回「未分组」。 */
      var dt = closestByAttr(ev.target, "data-del-team");
      if(dt){
        var name = dt.getAttribute("data-del-team");
        var n = (DATA.list || []).filter(function(it){
          return normTeamName(it && it.league).toLowerCase() === name.toLowerCase();
        }).length;
        var msg = "确定要删除队伍「" + name + "」吗？";
        msg += n ? "\n\n队内 " + n + " 位选手不会被删除，他们会回到「" + NO_TEAM + "」。"
                 : "\n\n这个队伍还没有选手。";
        if(typeof window.confirm === "function" && !window.confirm(msg)) return;
        if(removeTeam(name)) toast("ok", "已删除队伍「" + name + "」");
        return;
      }

      /* ② 行尾的「删除选手」（向左拖动某行才亮出来的那个键）。 */
      var dp = closestByAttr(ev.target, "data-del-player");
      if(!dp) return;
      var pname = dp.getAttribute("data-del-player") || "";
      if(!pname) return;
      var label = MODES[mode].label;
      if(typeof window.confirm === "function" &&
         !window.confirm("确定要删除选手「" + pname + "」的分数条吗？\n\n" +
                         "该选手会从【" + label + "】榜单中移除，此操作不可撤销。")) return;
      var gone = removePlayer(pname);
      if(gone) toast("ok", "已从【" + label + "】榜单删除选手「" + gone + "」");
    });

    /* 双击队名 → 就地改名（2026-09-24）。
       ⚠️ 认的是队名自己的 `data-rename-team`，不是队伍框的 `data-team` ——
          双击框里别处（队员行、空白）不该莫名其妙进入编辑态。
       ⚠️ dblclick 与「向左拖动亮删除键」不冲突：那个手势在 pointerdown/move/up 里跑，
          双击只是两次快速点按（不移动、够不到阈值），不会点亮任何东西。
       ⚠️ 依赖浏览器原生的双击判定（300ms 内两次）；单测里直接派发 dblclick 即可。 */
    elList.addEventListener("dblclick", function(ev){
      if(!closestByAttr(ev.target, "data-rename-team")) return;
      enterRename(closestByAttr(ev.target, "data-team"));
    });

    /* ① 按下：在某一行上按住，记起点，先不认方向（方向等第一次移动再判）。 */
    elList.addEventListener("pointerdown", function(ev){
      /* 点在删除键上 → 不启动拖动（否则按键时行会跟着滑一下，很毛躁） */
      if(closestByAttr(ev.target, "data-del-player")) return;
      if(ev.button != null && ev.button !== 0) return;    // 只认鼠标主键
      var row = closestRow(ev.target);
      if(!row) return;
      /* ⚠️ 阻止默认行为：鼠标拖动时浏览器默认会**选中文字**，
         拖到一半满屏蓝色高亮，看着像页面坏了。 */
      if(ev.preventDefault) ev.preventDefault();
      swipe = {
        row: row,
        name: row.getAttribute("data-name") || "",
        x0: ev.clientX, y0: ev.clientY,
        dx: 0, active: false,
        kind: "",                 // "" → "swipe"（向左亮删除键）/ "move"（纵向搬队伍）
        pid: ev.pointerId
      };
    });
  }

  /* ② 移动：按支配轴分流 —— 竖向为主＝把这一条搬到指针下的队伍框（决赛分组视图），
     否则横向向左＝亮删除键。两条路一旦选定就不再改判（`swipe.kind`）。 */
  document.addEventListener("pointermove", function(ev){
    if(!swipe) return;
    if(swipe.pid != null && ev.pointerId != null && ev.pointerId !== swipe.pid) return;

    if(swipe.kind === "move"){ updateMoveDrag(ev); return; }

    var dx = ev.clientX - swipe.x0;
    var dy = ev.clientY - swipe.y0;
    if(!swipe.active){
      /* ⚠️ 先看「动够了没」、再看「哪个轴占优」——顺序不能反。
         早先写成「|dy| > |dx| 就直接放弃」，按下时的一点点纵向抖动会把整次手势吃掉；
         现在给纵向留了 DRAG_TRIGGER 的余量，只有明确「想搬走」才接管。 */
      if(Math.abs(dy) > Math.abs(dx)){
        if(Math.abs(dy) < DRAG_TRIGGER) return;                    // 还没动够，继续观望
        /* ⚠️ 接管成功就顺手把这一次的坐标也处理掉（否则松手前不移动的话，
           落点要等到**下一次** move 才认出来）。 */
        if(beginMoveDrag(swipe.row)){ updateMoveDrag(ev); return; }
        cancelSwipe(); return;                                     // 非分组视图 → 放弃，滚动留给页面
      }
      if(dx > -6) return;                                          // 还没明显向左，继续观望
      swipe.active = true;
      swipe.kind = "swipe";
      setSwipingClass(swipe.row, true);
    }
    swipe.dx = dx;
    setSwipeOffset(swipe.row, Math.max(-SWIPE_MAX, dx));
  });

  /* ③ 松手：够阈值才亮删除键，数据格无论如何都平滑归位；
     搬运手势则在这一刻把选手落进指针所在的队伍框。 */
  document.addEventListener("pointerup", function(ev){
    if(!swipe) return;
    var s = swipe;
    swipe = null;
    if(s.kind === "move"){ finishMoveDrag(s, ev); return; }
    if(s.active){
      setSwipingClass(s.row, false);
      setSwipeOffset(s.row, 0);                    // css 上有 transition，会自己弹回去
      if(s.dx <= -SWIPE_TRIGGER){
        /* 同一行再拖一次 = 收起：手势本身可逆，不必先去点别处。 */
        if(armedRow === s.row) disarmRow();
        else armRow(s.row, s.name);
      } else if(armedRow && armedRow !== s.row){
        disarmRow();                               // 拖得不够，且拖的是别的行
      }
    } else if(armedRow && armedRow !== s.row){
      disarmRow();                                 // 只是点了另一行（没拖）
    }
  });

  /* 指针被系统抢走（来电、手势被接管）→ 回位，不改变删除键状态。 */
  document.addEventListener("pointercancel", cancelSwipe);

  /* 点页面**其它任何地方** → 收起删除键。
     ⚠️ 改挂在 **pointerdown** 而不是 click 上：拖动亮出删除键之后，浏览器还会补一次
        click，若在 click 里收起就会「刚亮就灭」。pointerdown 天然早于本次手势的判定，
        不存在这个先后问题（也不必额外做时间戳防抖 —— 无头里虚拟时钟推不动 Date.now()）。
     ⚠️ 点在**某一行上**时这里放行：是「再拖一次收起」还是「点另一行换人」，
        交给上面的松手逻辑统一决定，免得两处各判一半。 */
  document.addEventListener("pointerdown", function(ev){
    /* 改名编辑态：点框外 → 收摊（放弃这次修改）。
       ⚠️ 判断放在**这里**而不是输入框的 blur 上：点对勾时浏览器会先让输入框 blur
          （mousedown → blur → mouseup → click），在 blur 里收摊会把对勾从 DOM 摘掉，
          紧接着的 click 就落空了 —— 真浏览器里表现为「点对勾没反应」。
          pointerdown 早于 blur，且这里只判「落点在不在这个框里」，对勾是框的后代 → 放行。 */
    if(renameBox && !renameBox.contains(ev.target)) cancelRename();

    if(!armedRow) return;
    if(closestRow(ev.target)) return;
    disarmRow();
  });

  /* ======================= 启动 ======================= */

  /* ⚠️ 「剩余」的基准来自计分器的存档 —— 用户在**另一个标签页**的计分器里点齿轮改完余额、
     切回榜单页时，本页并不知道。同源标签页写 localStorage 会派 `storage` 事件，
     这是唯一能感知「别处改了设置」的途径；没有它，用户看到的是旧基准，会以为改没生效。
     ⚠️ `storage` 只在**其它文档**改动时触发，本页自己写不会触发 → 不会自激死循环。
     ⚠️ 桩里 window 没有 addEventListener → 判一下存在性再绑。 */
  if(window.addEventListener){
    window.addEventListener("storage", function(ev){
      var k = ev && ev.key;
      if(k && k !== COUNTER_KEY) return;    // 只关心计分器那份档（key 为 null = 整份被清空）
      render();
    });
  }

  render();
  syncModeUI();

  /* 供调试 / 回归测试使用 */
  window.RANKING_PAGE = {
    parseExport: parseExport,
    ingest: ingest,
    clearBoard: clearBoard,
    render: render,
    setBoard: setBoard,
    currentMode: currentMode,
    getData: function(){ return DATA; },
    setData: function(d){ DATA = d; },
    /* 队伍（仅决赛） */
    addTeam: addTeam,
    removeTeam: removeTeam,
    /* 双击队名改队名（仅决赛） */
    renameTeam: renameTeam,
    enterRename: enterRename,
    commitRename: commitRename,
    cancelRename: cancelRename,
    renameActive: renameActive,
    renameOf: renameOf,
    TEAM_NAME_MAX: TEAM_NAME_MAX,
    teamList: teamList,
    teamTotal: teamTotal,
    teamYuan: teamYuan,
    teamYuanRest: teamYuanRest,
    yuanInitFinal: yuanInitFinal,
    COUNTER_KEY: COUNTER_KEY,
    YUAN_INIT_FINAL_FALLBACK: YUAN_INIT_FINAL_FALLBACK,
    groupByTeam: groupByTeam,
    normTeamName: normTeamName,
    NO_TEAM: NO_TEAM,
    /* 删除单条选手（在行上**向左拖动**亮出行尾删除键） */
    removePlayer: removePlayer,
    findPlayerIndex: findPlayerIndex,
    armedPlayer: armedPlayer,
    disarmRow: disarmRow,
    /* 手势参数与状态（回归测试用来对齐阈值） */
    SWIPE_TRIGGER: SWIPE_TRIGGER,
    SWIPE_MAX: SWIPE_MAX,
    swipeActive: swipeActive,
    /* 拖拽入队（纵向拖动，仅决赛分组视图） */
    movePlayerToTeam: movePlayerToTeam,
    DRAG_TRIGGER: DRAG_TRIGGER,
    moveDragActive: function(){ return !!(swipe && swipe.kind === "move"); },
    dragTargetName: function(){ return dragTargetBox ? (dragTargetBox.getAttribute("data-team") || "") : ""; },
    dragGhostEl: function(){ return dragGhostEl; },
    isGroupedView: function(){ return groupedView; },
    /* 弹框 */
    openAddTeamModal: openAddTeamModal,
    openAddPlayerModal: openAddPlayerModal,
    modalConfirm: modalConfirm,
    modalClose: modalClose,
    modalIsOpen: modalIsOpen,
    LS_KEY: LS_KEY,
    LS_KEY_PRELIM: LS_KEY_PRELIM,
    LS_KEY_FINAL: LS_KEY_FINAL,
    MODE_KEY: MODE_KEY,
    MODES: MODES,
    /* 榜单 txt 存档（导出 / 导入） */
    buildBoardText: buildBoardText,
    parseBoardText: parseBoardText,
    sanitizeBoard: sanitizeBoard,
    applyBoard: applyBoard,
    exportBoard: exportBoard,
    importBoard: importBoard,
    boardFileName: boardFileName,
    rankedRows: rankedRows,
    BOARD_VERSION: BOARD_VERSION,
    BOARD_MARKER: BOARD_MARKER,
    BOARD_FILE_PREFIX: BOARD_FILE_PREFIX
  };
})();
