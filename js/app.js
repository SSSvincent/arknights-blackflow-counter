/* ==========================================================================
   黑流树海粥集杯#1 计分器 · 计分逻辑
   说明：各板块的加分规则与交互行为沿用原站
         选手：纯文本记录选手名，不参与计分
         临时招募：六星 +50 / 五星 +20 / 四星 +10（计次型，下限 0）
         通关时长：≤2:00 +60 / ≤2:30 +50 / 2:30~3:00 0 / 超3:00 每分-10 / ≥3:30 阶梯
         违规扣分：计次型 + 开关型（负分）
         击杀特殊敌人：计次型，每个 +20
         源石锭：初赛余额上限 60、决赛初始余额 120（两个数可在面板标题右侧的齿轮里改）；
                 初赛可用余额 = 上限；决赛可用余额 = 初始余额 − 上一位选手使用点数
         关卡通关加分：勾选制，含「同组互斥」与「子项依赖父项」两套联动（沿用原站）
         藏品与路线加分：勾选制，两条「无效验尸」互斥
         商店加分：勾选制，+50（独立栏目）
         通关结算：通关得分 =（结算分 − 零件数×5）÷ 2；沉沦者对个人基础分 ×1.3；
                   总分 = 个人分 + 团队分（已删去原站的「个人+团队」显示切换）
                   面板内并排两列：左＝结算输入，右＝玩家名 + 总分
                   选手名未填写时显示占位名 Player
         导出/导入：导出为 txt 存档（上半可读汇总 + 末尾一行 DATA: JSON）；
                   导入读回该行并「整体替换」当前状态，解析失败弹窗提示格式有误
   ========================================================================== */
(function(){
  "use strict";

  /* ============ 数据定义 ============ */

  // 临时招募（计次型）：每招募一个对应星级干员计一次分
  const RECRUIT = [
    {key:"six",  name:"六星干员", score:50},
    {key:"five", name:"五星干员", score:20},
    {key:"four", name:"四星干员", score:10}
  ];

  // 违规扣分 · 计次型
  const VIOLATION_COUNTERS = [
    {key:"v_liuxing_extra", name:"额外招募六星干员",       score:-60}
  ];

  // 违规扣分 · 开关型
  const VIOLATION_TOGGLES = [
    {key:"v_shiyude",       name:"「失与得」节点交换「探测先锋」", score:-200}
  ];

  // 击杀特殊敌人（计次型，每击杀一个 +20）
  const SPECIAL_KILLS = [
    {key:"sk_gaopunike",    name:"高普尼克",   score:20},
    {key:"sk_yajue",        name:"鸭爵",       score:20},
    {key:"sk_liuleixiaozi", name:"流泪小子",   score:20},
    {key:"sk_yuanzai",      name:"圆仔",       score:20}
  ];

  // 源石锭 · 两种模式各自的**默认**余额上限。
  //   ⚠️ 这只是「出厂默认值」：真正生效的数值存在 state.yuanInitPrelim / yuanInitFinal 里，
  //      用户可以在源石锭面板标题右侧的齿轮弹框里改（见「源石锭余额设置弹框」一节）。
  //      算分一律走 yuanInit()，别直接读这两个常量。
  const YUAN_INIT_PRELIM = 60;   // 初赛
  const YUAN_INIT_FINAL  = 120;  // 决赛

  // 关卡通关加分（勾选制，每关只能打一次）
  //   group  —— 同组互斥：勾选一项后，同组其余项变为「点击将替换选择」
  //   parent —— 子项依赖：父项未勾选时子项灰化，点子项会自动补勾父项；
  //             取消父项时会级联取消其全部子项
  const EMERGENCY = [
    {key:"stage_chijin",      name:"赤金厄运",                  score:200, group:"g_chijin"},
    {key:"stage_aidao",       name:"哀悼铁腕",                  score:160, group:"g_chijin"},
    {key:"stage_bingleng",    name:"冰冷流亡",                  score:80,  group:"g_chijin"},
    // ↓ 本项目新增：与「混沌源阶理论」「痛苦将息」互斥（同一关卡的变体）
    {key:"stage_yongwuanning", name:"永无安宁",                 score:250, group:"g_hundun"},
    {key:"stage_hundun",      name:"混沌源阶理论",              score:300, group:"g_hundun"},
    {key:"stage_tongku",      name:"痛苦将息",                  score:350, group:"g_hundun"},
    {key:"stage_jizheng",     name:"畸症",                      score:500},
    {key:"stage_boliweier",   name:"击杀“玻利瓦尔，症结之核”",  score:100, parent:"stage_jizheng"},
    {key:"stage_zhuijizheng", name:"以追猎状态进入“畸症”",      score:50,  parent:"stage_jizheng"},
    // ↓ 黑诞三条**不互斥**（原站是互斥组 g_heidan，本项目按用户要求改为可叠加），故不写 group
    {key:"stage_heidan_nao",  name:"黑诞·“闹乐”",              score:100},
    {key:"stage_heidan_mie",  name:"黑诞·“灭身”",              score:120},
    {key:"stage_heidan_zong", name:"黑诞·“纵怒”",              score:140},
    // ↓ 本项目新增：普通/紧急为同一关卡的两种难度，故归入同一互斥组
    {key:"stage_hehuoren_n",  name:"普通·合伙人会议",           score:50,  group:"g_hehuoren"},
    {key:"stage_hehuoren",    name:"紧急·合伙人会议",           score:100, group:"g_hehuoren"}
  ];

  // 坎诺特砍价（独立栏目，勾选制）
  const KANNUOTE = [
    {key:"k_kannuote", name:"【请坎诺特砍价】并获取全部藏品", score:50}
  ];

  // 藏品与路线加分（勾选制）
  //   本栏由用户给出的规则定义，与 `_reference/ref.js` 里的 ROUTE_BONUS 有出入（见项目备忘）。
  //   group —— 同组互斥：两条「无效验尸」按层数难度二选一
  const ROUTE_BONUS = [
    {key:"r_fenmei",   name:"在进入第五层前，于“失与得”节点换取【焚毁「文明」】",                score:200},
    {key:"r_wuxiao5",  name:"在进入第五层前，通关“无效验尸”获得【湮没「光明」】",                score:150, group:"g_wuxiao"},
    {key:"r_wuxiao3",  name:"在前三层，通关“无效验尸”获得【湮没「光明」】",                      score:200, group:"g_wuxiao"},
    {key:"r_sanlian",  name:"同时携带【击坠「神明」】、【焚毁「文明」】、【湮没「光明」】并通关",  score:100},
    {key:"r_mingyun",  name:"在第六层不进入“命运所指”，或在“命运所指”中不缴纳任何削弱藏品",      score:100},
    {key:"r_shapan",   name:"携带【沙盘α】和【沙盘β】通关结局",                                  score:50}
  ];

  // 沉沦者（特殊位）条件：勾选后对「个人基础分」施加 ×1.3（不作用于团队分）
  const CHENLUN = [
    {key:"r_chenlun", name:"沉沦者（特殊位）双沙盘三上贡全追猎通关"}
  ];

  // 团队分：勾选后计入团队得分的开关项（其余计入个人得分，参与 ×1.3）
  //   —— 沿用原站。本项目已删去「个人+团队」的显示切换，但总分的构成方式未变。
  const TEAM_KEYS = ["stage_chijin","stage_aidao","stage_bingleng","r_hundun2"];

  // 全部勾选型条目（跨面板合并）：互斥组 / 父子依赖 逻辑统一作用于这张表，
  // 因此后续任何板块只要在数据里写上 group / parent 就能自动获得联动。
  const ALL_TOGGLES = EMERGENCY.concat(ROUTE_BONUS, KANNUOTE, CHENLUN);

  // 未填写选手名时，总分区显示的占位名（index.html 里预置了同一份初始文案）
  const PLAYER_PLACEHOLDER = "Player";

  // 赛事规则条目上限（避免存档里塞进异常大的数组，也给界面一个合理边界）
  const RULES_MAX     = 60;    // 最多 60 条
  const RULES_MAX_LEN = 200;   // 单条最长 200 字

  /* ============ 状态 ============ */
  const state = {
    playerName:"",  // 选手名（纯文本，不参与计分）
    counts:{},      // 计次项
    toggles:{},     // 开关项
    durH:0,         // 通关时长 · 小时
    durM:0,         // 通关时长 · 分钟
    yuanStart:0,    // 源石锭 · 开始前
    yuanEnd:0,      // 源石锭 · 结束后
    yuanPrev:0,     // 源石锭 · 上一位选手使用点数（决赛用）
    yuanMode:"prelim",  // 源石锭计分模式："prelim" 初赛 / "final" 决赛
    yuanInitPrelim: YUAN_INIT_PRELIM,  // 源石锭 · 初赛余额上限（齿轮弹框可改）
    yuanInitFinal:  YUAN_INIT_FINAL,   // 源石锭 · 决赛初始余额（齿轮弹框可改）
    settleScore:0,  // 通关结算 · 结算分
    partsCount:0,   // 通关结算 · 零件数量
    rules:[],       // 赛事规则（纯文本列表，不参与计分）
    rulesLocked:false  // 赛事规则是否锁定（只读：不可增删/拖动，隐藏删除键与条目背景）
  };

  RECRUIT.forEach(it=>state.counts[it.key]=0);
  VIOLATION_COUNTERS.forEach(it=>state.counts[it.key]=0);
  VIOLATION_TOGGLES.forEach(it=>state.toggles[it.key]=false);
  SPECIAL_KILLS.forEach(it=>state.counts[it.key]=0);
  EMERGENCY.forEach(it=>state.toggles[it.key]=false);
  KANNUOTE.forEach(it=>state.toggles[it.key]=false);
  ROUTE_BONUS.forEach(it=>state.toggles[it.key]=false);
  CHENLUN.forEach(it=>state.toggles[it.key]=false);

  /* ============ 计分 ============ */
  // 招募小计：各星级数量 × 对应分值之和
  function computeRecruit(){
    return RECRUIT.reduce((a,it)=>{
      return a + (parseInt(state.counts[it.key],10)||0) * it.score;
    }, 0);
  }

  // 计次型小计
  function sumCounters(list){
    let s = 0;
    list.forEach(it=>{ s += (parseInt(state.counts[it.key],10)||0) * it.score; });
    return s;
  }
  // 开关型小计
  function sumToggles(list){
    let s = 0;
    list.forEach(it=>{ if(state.toggles[it.key] && it.score) s += it.score; });
    return s;
  }

  // 清理不合法的勾选状态（互斥组内多选、父项未选而子项已选）—— 沿用原站，作用于全部勾选型条目
  function sanitizeToggles(){
    const groupSeen = {};
    ALL_TOGGLES.forEach(it=>{
      if(it.group && state.toggles[it.key]){
        if(groupSeen[it.group]) state.toggles[it.key] = false;
        else groupSeen[it.group] = it.key;
      }
    });
    ALL_TOGGLES.forEach(it=>{
      if(it.parent && !state.toggles[it.parent]) state.toggles[it.key] = false;
    });
  }

  // 按当前 state 刷新各 toggle-row 的 disabled 视觉状态与提示 —— 沿用原站，作用于全部勾选型条目
  function refreshDisabled(){
    const groupWinner = {};
    ALL_TOGGLES.forEach(it=>{
      if(it.group && state.toggles[it.key]) groupWinner[it.group] = it.key;
    });
    ALL_TOGGLES.forEach(it=>{
      const el = document.querySelector('.toggle-row[data-toggle="'+it.key+'"]');
      if(!el) return;
      let disabled = false, reason = "";
      if(it.group){
        const w = groupWinner[it.group];
        if(w && w !== it.key){
          disabled = true;
          const wit = ALL_TOGGLES.find(x=>x.key===w);
          reason = "已选「" + (wit?wit.name:w) + "」· 点击本项将替换选择";
        }
      }
      if(it.parent && !state.toggles[it.parent]){
        disabled = true;
        const pit = ALL_TOGGLES.find(x=>x.key===it.parent);
        reason = "点击本项将自动勾选「" + (pit?pit.name:it.parent) + "」";
      }
      el.classList.toggle("disabled", disabled);
      if(disabled){
        el.setAttribute("aria-disabled","true");
        el.setAttribute("title", reason);
      } else {
        el.removeAttribute("aria-disabled");
        el.removeAttribute("title");
      }
    });
  }

  // 通关时长加减分（阶梯累进）
  //   ≤2:00        +60
  //   ≤2:30        +50
  //   2:30 ~ 3:00   0
  //   超 3:00       超出部分每分 -10
  //   ≥3:30         3:00→3:30 段 -300，之后再超出部分每分 -30
  function durationScore(){
    const h = Math.max(0, parseInt(state.durH,10)||0);
    const m = Math.max(0, parseInt(state.durM,10)||0);
    const T = h*60 + m;
    let score, tier;
    if(T <= 0){ score = 0; tier = "未填写"; }
    else if(T <= 120){ score = 60;  tier = "≤2:00 速通奖励"; }
    else if(T <= 150){ score = 50;  tier = "≤2:30 速通奖励"; }
    else if(T <= 180){ score = 0;   tier = "2:30–3:00 无加减"; }
    else if(T < 210){ score = -(T-180)*10; tier = "超3:00 每分-10"; }
    else { score = -300 - (T-210)*30; tier = "≥3:30 阶梯(30×-10 + 超出×-30)"; }
    return {T, score, tier};
  }

  // 源石锭 · 当前设置下某模式的余额上限（"=" 出厂默认值"会被齿轮弹框改写，所以不能直读常量）
  //   ⚠️ 一律经此函数取值：算分、界面、导出三处都靠它，才不会出现「显示 100 却按 60 算」。
  //   兜底：state 里的值非法（NaN / 负数）时回落常量，保证任何时候都有个合理基准。
  function yuanInit(mode){
    const isFinal = (mode === "final");
    const v = parseInt(state[isFinal ? "yuanInitFinal" : "yuanInitPrelim"], 10);
    if(isFinite(v) && v >= 0) return v;
    return isFinal ? YUAN_INIT_FINAL : YUAN_INIT_PRELIM;
  }

  // 源石锭 · 消耗点数与超额扣分
  //   消耗点数 = max(0, 开始前 − 结束后)          —— 两种模式通用，与原站一致
  //   初赛：可用余额 = 初赛上限；消耗 ≤ 上限 → 0，否则 (上限 − 消耗) × 50
  //   决赛：可用余额 = 决赛初始余额 − 上一位选手使用点数；
  //         可用余额 ≥ 消耗点数 → 0，否则 (消耗点数 − 可用余额) × (−50)
  function yuanPenalty(){
    const start = Math.max(0, parseInt(state.yuanStart,10)||0);
    const end   = Math.max(0, parseInt(state.yuanEnd,10)||0);
    const used  = Math.max(0, start - end);   // 消耗点数（开始 − 结束，负数视为 0）

    if(state.yuanMode === "final"){
      const prev  = Math.max(0, parseInt(state.yuanPrev,10)||0);
      const avail = yuanInit("final") - prev;               // 当前选手可用余额
      const over  = Math.max(0, used - avail);              // 超出可用余额的部分
      const penalty = avail >= used ? 0 : (used - avail) * -50;
      return {used, bal:avail, avail, prev, over, penalty};
    }

    // 初赛：可用余额 = 初赛上限
    const init = yuanInit("prelim");
    const over = Math.max(0, used - init);
    const penalty = used <= init ? 0 : (init - used) * 50;
    return {used, bal:init, avail:init, prev:0, over, penalty};
  }

  function computeAll(){
    const dp = durationScore();
    const yp = yuanPenalty();

    const recruit   = computeRecruit();
    const emergency = sumToggles(EMERGENCY);
    const violation = sumCounters(VIOLATION_COUNTERS) + sumToggles(VIOLATION_TOGGLES);
    const special   = sumCounters(SPECIAL_KILLS);
    const route     = sumToggles(ROUTE_BONUS);
    const kannuote  = sumToggles(KANNUOTE);

    // 通关得分 =（结算分 − 零件数量×5）÷ 2 —— 不受沉沦者影响
    //   （原站为 ×7.5，本项按用户要求改为 ×5）
    const settle = Math.max(0, parseInt(state.settleScore,10)||0);
    const parts  = Math.max(0, parseInt(state.partsCount,10)||0);
    const clearScore = parseFloat(((settle - parts*5) / 2).toFixed(1));

    // 团队分：TEAM_KEYS 中已勾选的开关项分数之和；不参与 ×1.3
    //   ⚠️ 只有「决赛」才拆分团队分。
    //      「初赛」不拆 —— 团队项直接当个人关卡/路线分，
    //      照常参与沉沦者 ×1.3，明细里也不再单独出现「团队」一行。
    const splitTeam = state.yuanMode === "final";
    let teamScore = 0, emergencyTeam = 0, routeTeam = 0;
    if(splitTeam){
      EMERGENCY.forEach(it=>{
        if(TEAM_KEYS.indexOf(it.key) !== -1 && state.toggles[it.key]){
          teamScore += it.score; emergencyTeam += it.score;
        }
      });
      ROUTE_BONUS.forEach(it=>{
        if(TEAM_KEYS.indexOf(it.key) !== -1 && state.toggles[it.key]){
          teamScore += it.score; routeTeam += it.score;
        }
      });
    }

    // 个人基础分 = 所有非团队分个人项之和（含通关得分与商店分）
    const personalBase = recruit + (emergency - emergencyTeam) + violation + special
                       + yp.penalty + dp.score + (route - routeTeam) + clearScore + kannuote;

    // 沉沦者：仅对个人基础分施加 ×1.3
    const chenlun = !!state.toggles["r_chenlun"];
    const multiplier = chenlun ? 1.3 : 1;
    const personalScore = parseFloat((personalBase * multiplier).toFixed(1));
    const total = parseFloat((personalScore + teamScore).toFixed(1));

    return {
      recruit, emergency, violation, special, route, kannuote,
      yuan: yp.penalty,
      yuanUsed: yp.used,
      yuanAvail: yp.avail,
      duration: dp.score,
      durationMin: dp.T,
      durationTier: dp.tier,
      clearScore, chenlun, multiplier,
      personalBase, personalScore, teamScore, splitTeam, total
    };
  }

  /* ============ 渲染 ============ */
  // 小计数字：0 显示 0、正数带 +（沿用原站）
  const signed = v => (v > 0 ? "+" : "") + v;
  // 可能带小数的分值（总分 / 通关得分）：整数不带小数点，否则保留 1 位
  const fmtNum = v => v % 1 === 0 ? String(v) : v.toFixed(1);
  // 通关时长：0 显示「未填写」，否则「X小时Y分钟」（页面与导出文件共用同一份格式）
  function formatDuration(min){
    if(min <= 0) return "未填写";
    const hh = Math.floor(min/60), mm = min%60;
    return (hh?hh+"小时":"") + (hh&&mm?" ":"") + (mm||!hh?mm+"分钟":"");
  }

  function renderCounterRow(item, opts){
    opts = opts || {};
    const cls = opts.cls || "";
    const div = document.createElement("div");
    div.className = "row " + cls;
    div.innerHTML =
      '<div class="label">'+item.name+(item.hint?'<small>'+item.hint+'</small>':'')+'</div>'+
      '<div class="val">'+(item.score>0?'+':'')+item.score+'</div>'+
      '<button type="button" class="btn minus" data-act="dec" data-key="'+item.key+'">−</button>'+
      '<input class="count-input" type="number" min="0" data-key="'+item.key+'" value="0">'+
      '<button type="button" class="btn" data-act="inc" data-key="'+item.key+'">＋</button>';
    return div;
  }
  function renderToggleRow(item, opts){
    opts = opts || {};
    let cls = opts.cls || "";
    if(item.parent) cls += (cls?" ":"") + "sub";
    const div = document.createElement("div");
    div.className = "toggle-row " + cls;
    div.dataset.toggle = item.key;
    const valTxt = (item.score!==undefined && item.score!==null)
      ? ((item.score>0?'+':'')+item.score)
      : (opts.badge || "✓");
    div.innerHTML =
      '<div class="t-check"></div>'+
      '<div class="t-label">'+item.name+(item.hint?'<small>'+item.hint+'</small>':'')+'</div>'+
      '<div class="t-val">'+valTxt+'</div>';
    return div;
  }

  function buildLists(){
    const em = document.getElementById("emergency-list");
    if(em){
      EMERGENCY.forEach(it=>em.appendChild(renderToggleRow(it)));
    }
    const vi = document.getElementById("violation-list");
    if(vi){
      VIOLATION_COUNTERS.forEach(it=>vi.appendChild(renderCounterRow(it,{cls:"danger"})));
      VIOLATION_TOGGLES.forEach(it=>vi.appendChild(renderToggleRow(it,{cls:"danger"})));
    }
    const sp = document.getElementById("special-list");
    if(sp){
      SPECIAL_KILLS.forEach(it=>sp.appendChild(renderCounterRow(it,{cls:"green"})));
    }
    const kn = document.getElementById("kannuote-list");
    if(kn){
      KANNUOTE.forEach(it=>kn.appendChild(renderToggleRow(it,{cls:"purple"})));
    }
    const rt = document.getElementById("route-list");
    if(rt){
      ROUTE_BONUS.forEach(it=>rt.appendChild(renderToggleRow(it,{cls:"purple"})));
    }
    const cl = document.getElementById("chenlun-list");
    if(cl){
      CHENLUN.forEach(it=>cl.appendChild(renderToggleRow(it,{cls:"purple",badge:"个人×1.3"})));
    }
  }

  function updateUI(){
    const r = computeAll();

    document.querySelectorAll("[data-sub]").forEach(el=>{
      const k = el.dataset.sub;
      let v = 0;
      if(k==="recruit") v = r.recruit;
      else if(k==="emergency") v = r.emergency;
      else if(k==="violation") v = r.violation;
      else if(k==="special") v = r.special;
      else if(k==="route") v = r.route;
      else if(k==="kannuote") v = r.kannuote;
      else if(k==="yuan") v = r.yuan;
      else if(k==="duration") v = r.duration;
      else if(k==="clearscore") v = r.clearScore;
      el.textContent = signed(v);
    });

    // 源石锭：消耗点数 / 初赛·决赛展开区 / 超额扣分
    const isFinal = state.yuanMode === "final";
    const prelimEl   = document.getElementById("yuan-prelim");
    const finalEl    = document.getElementById("yuan-final");
    const takenEl    = document.getElementById("yuan-taken");
    const penEl      = document.getElementById("yuan-penalty");
    const initEl     = document.getElementById("yuan-init");
    const prelimBal  = document.getElementById("yuan-prelim-bal");
    const availEl    = document.getElementById("yuan-avail");
    if(prelimEl)  prelimEl.hidden  = isFinal;
    if(finalEl)   finalEl.hidden   = !isFinal;
    if(takenEl)   takenEl.textContent   = r.yuanUsed;
    if(penEl)     penEl.textContent     = r.yuan;
    if(initEl)    initEl.textContent    = yuanInit("final");
    if(prelimBal) prelimBal.textContent = yuanInit("prelim");
    if(availEl)   availEl.textContent   = r.yuanAvail;

    // 通关时长显示
    const durTotalEl = document.getElementById("dur-total");
    const durTierEl  = document.getElementById("dur-tier");
    const durVerdict = document.getElementById("dur-verdict");
    if(durTotalEl) durTotalEl.textContent = formatDuration(r.durationMin);
    if(durTierEl)  durTierEl.textContent  = r.durationTier;
    if(durVerdict) durVerdict.textContent = signed(r.duration);

    // 总分（本项目已删去「个人+团队」切换，只显示总分）
    // 选手名：未填写（含只填空格）时显示占位名 Player，不隐藏整行
    const nameEl = document.getElementById("total-name");
    if(nameEl){
      const raw = state.playerName || "";
      nameEl.textContent = raw.trim() === "" ? PLAYER_PLACEHOLDER : raw;
    }
    const tv = document.getElementById("total-value");
    if(tv){
      tv.textContent = fmtNum(r.total);
      tv.classList.toggle("negative", r.total < 0);
    }

    // 分项明细
    const bd = document.getElementById("breakdown");
    if(bd){
      const items = [
        ["招募", r.recruit, ""],
        ["关卡", r.emergency, ""],
        ["特敌", r.special, "green"],
        ["违规", r.violation, "danger"],
        ["源石", r.yuan, "warn"],
        ["时长", r.duration, "green"],
        ["路线", r.route, "purple"],
        ["商店", r.kannuote, "purple"],
        ["通关", r.clearScore, "purple"]
      ];
      if(r.chenlun) items.push(["沉沦者", "×1.3", "warn"]);
      if(r.teamScore > 0) items.push(["团队", r.teamScore, "green"]);
      bd.innerHTML = items.map(function(pair){
        const n = pair[0], v = pair[1], c = pair[2];
        const vs = (typeof v === "string") ? v : ((v>0?"+":"")+v);
        return '<span class="'+c+'">'+n+' <b>'+vs+'</b></span>';
      }).join("");
    }

    // 互斥 / 父子依赖：刷新不可选状态
    refreshDisabled();

    // 持久化（含归零后：state 全 0，写回即等于清空存档）
    // ⚠️ 这里**不调 renderRules()**：规则有独立存档通道，且导入会走到 updateUI，
    //    若在此重渲染规则会经由 renderRules→saveRules 间接写回规则。
    save();
  }

  /* ============ 赛事规则（通栏面板） ============ */
  /*  条目是纯文本、不参与任何计分，纯展示用。
      · **完全独立于选手存档**（2026-09-23 用户要求，见 loadRules/saveRules）：
        规则列表与锁定状态只写 STORAGE_KEY_RULES 这一个键，
        既不进 save() 的计分存档，也不被 applySnapshot() 读取 ——
        所以「归零」「导入 txt」「导入一份没带规则的旧档」都不会动它。
      · 归零按钮不会清掉它 —— 它是「赛制配置」，换选手时应当沿用；
      · 导入存档也**不会**覆盖它（导出的 txt 里那段【赛事规则】只是留档快照）；
      · 排序：拖动时先改 DOM 顺序做实时预览，松手后再按 DOM 顺序回写 state.rules。
      · 锁定（state.rulesLocked）＝只读：隐藏条目背景与删除键、禁止拖动、停用输入框。
        所有改动入口（addRule / deleteRule / commitRuleOrder / dragstart）都会再挡一道，
        不依赖「界面上没有按钮就点不到」。 */

  let rulesDragEl = null;      // 正在被拖动的 <li>
  let rulesDragBefore = null;  // 开始拖动时的规则快照（DOM 里存的是这份快照的下标）

  // 把任意输入收敛成合法的规则数组：去空、单条限长、限总条数
  function sanitizeRules(list){
    if(!Array.isArray(list)) return [];
    return list
      .map(v => String(v == null ? "" : v).trim().slice(0, RULES_MAX_LEN))
      .filter(s => s.length > 0)
      .slice(0, RULES_MAX);
  }

  // 锁定状态的界面同步（列表类名 / 输入框停用 / 开关按钮文案与高亮）
  //   放在一个函数里，是因为它有好几个消费方：启动、load、归零、切换开关都要调
  function syncRulesLock(){
    const locked = !!state.rulesLocked;

    const list = document.getElementById("rules-list");
    if(list) list.classList.toggle("locked", locked);

    const input = document.getElementById("rules-input");
    if(input){
      input.disabled = locked;
      input.placeholder = locked ? "已锁定，规则不可修改" : "输入一条赛事规则，按回车添加";
    }

    const btn = document.getElementById("rules-lock");
    if(btn){
      btn.classList.toggle("active", locked);
      btn.textContent = locked ? "已锁定" : "锁定";
      btn.setAttribute("aria-pressed", locked ? "true" : "false");
      btn.title = locked ? "点击解锁，恢复可编辑" : "点击锁定：隐藏删除键并禁止修改";
    }
  }

  // 渲染规则列表：序号按当前顺序实时编号，删除键带上自己的下标
  //   （文字用 textContent 写入，天然免疫 HTML 注入）
  function renderRules(){
    const list = document.getElementById("rules-list");
    if(list){
      list.innerHTML = "";
      state.rules.forEach(function(text, i){
        const li = document.createElement("li");
        li.className = "rules-item";
        li.draggable = !state.rulesLocked;   // 锁定后不再可拖
        li.dataset.index = String(i);

        const idx = document.createElement("span");
        idx.className = "rules-idx";
        idx.textContent = String(i + 1);

        const tx = document.createElement("span");
        tx.className = "rules-text";
        tx.textContent = text;

        const del = document.createElement("button");
        del.type = "button";
        del.className = "rules-del";
        del.dataset.del = String(i);
        del.title = "删除这条规则";
        del.setAttribute("aria-label", "删除第 " + (i + 1) + " 条规则");
        del.textContent = "×";

        li.appendChild(idx);
        li.appendChild(tx);
        li.appendChild(del);
        list.appendChild(li);
      });
    }
    const empty = document.getElementById("rules-empty");
    if(empty) empty.hidden = state.rules.length > 0;

    syncRulesLock();
  }

  // 新增一条：空串 / 全是空白 → 忽略；锁定时一律拒绝。返回是否真的加进去了
  function addRule(text){
    if(state.rulesLocked) return false;
    const s = String(text == null ? "" : text).trim().slice(0, RULES_MAX_LEN);
    if(!s || state.rules.length >= RULES_MAX) return false;
    state.rules.push(s);
    renderRules();
    saveRules();         // ⚠️ 规则只落自己的存档键；updateUI() 的 save() 已经不管规则了
    updateUI();          // 刷新总分等界面
    return true;
  }

  function deleteRule(i){
    if(state.rulesLocked) return false;
    if(!(i >= 0 && i < state.rules.length)) return false;
    state.rules.splice(i, 1);
    renderRules();
    saveRules();
    updateUI();
    return true;
  }

  /* 拖拽结束：把 DOM 里当前的顺序回写成新的 state.rules。
     DOM 每个 <li> 上存的 data-index 是**拖动前**的下标，所以按它去 before 里取值即可。
     顺序没变 / 数据不完整 / 已锁定 → 原样返回 false，不做无谓的重渲染。 */
  function commitRuleOrder(before, listEl){
    if(state.rulesLocked) return false;
    if(!listEl || !Array.isArray(before)) return false;
    const idxs = Array.prototype.map.call(listEl.children, el=>parseInt(el.dataset.index, 10));
    if(idxs.length !== before.length) return false;
    if(idxs.some(n=>!(n >= 0 && n < before.length))) return false;
    const next = idxs.map(n=>before[n]);
    if(next.join("\u0000") === before.join("\u0000")) return false;   // 顺序没变
    state.rules = next;
    renderRules();
    saveRules();
    updateUI();
    return true;
  }

  // 切换锁定：只读开关本身永远是「可用」的，否则锁上就解不开了
  function toggleRulesLock(){
    state.rulesLocked = !state.rulesLocked;
    // 走 renderRules() 而不是只调 syncRulesLock()：条目的 draggable 是渲染时写上去的，
    // 必须重渲染才会跟着变（syncRulesLock 只管列表类名 / 输入框 / 开关外观）
    renderRules();
    saveRules();         // 锁定状态也属于规则存档
    updateUI();          // 刷新总分等界面
    return state.rulesLocked;
  }

  /* ============ 源石锭余额设置弹框 ============ */
  /*  用户 2026-09-25 要求：源石锭面板标题右侧加一个齿轮按钮，点开可修改
      初赛 / 决赛两种模式的**源石锭余额**，下方是「应用」「取消」两个按键。

      ⚠️ 弹框里的两个输入框**故意不进 syncDOM() 的 numMap**：
         它们只在「打开弹框」那一刻从 state 填一次。若进了 numMap，
         updateUI()（背后几乎任何操作都会调它）就会把用户正在敲的数字刷回旧值。
      ⚠️ 也**故意不接** document.body 上那套 input / focusout 白名单处理器 ——
         那两个处理器按 id 认领输入框，不认这两个 id，所以弹框输入框自成一体：
         不点「应用」绝不会写进 state，于是「取消」天然等于「什么都不做」。
      ⚠️ 与榜单页的 #rank-modal 共用同一套 .modal-* 样式；开关同样走 `hidden` 属性
         （逻辑层真相，单测桩没有 css 也能断言），css 的 `.modal-overlay[hidden]`
         才是表现层。 */
  const YUAN_MODAL_MAX = 9999;   // 余额上限的合理上界，挡住误输入的天文数字

  function yuanModalEl(){ return document.getElementById("yuan-modal"); }

  function yuanModalIsOpen(){
    const el = yuanModalEl();
    return !!(el && el.hidden === false);
  }

  // 打开：把 state 的当前值填进输入框（每次重开都重新填，丢掉上次没点「应用」的改动）
  function openYuanModal(){
    const el = yuanModalEl();
    if(!el) return false;
    const pEl = document.getElementById("yuan-init-prelim");
    const fEl = document.getElementById("yuan-init-final");
    if(pEl) pEl.value = yuanInit("prelim");
    if(fEl) fEl.value = yuanInit("final");
    el.hidden = false;
    if(pEl && typeof pEl.focus === "function") pEl.focus();
    return true;
  }

  function closeYuanModal(){
    const el = yuanModalEl();
    if(el) el.hidden = true;
    return true;
  }

  /* 读一个余额输入框：非数字一律剔掉；空 → 0；超上界 → 截到 YUAN_MODAL_MAX。
     ⚠️ 不把「空」当错误：余额本就是自由配置，0 也是合法值（只是任何消耗都会算超额）。 */
  function readYuanInput(el, fallback){
    if(!el) return fallback;
    const raw = String(el.value == null ? "" : el.value).replace(/[^0-9]/g, "");
    if(raw === "") return 0;
    return Math.min(YUAN_MODAL_MAX, parseInt(raw, 10) || 0);
  }

  /* 应用：写回 state → 关框 → updateUI()（后者内部会 save() 落盘）。
     余额一变，消耗点数判定、可用余额、超额扣分、总分全部即时跟着重算。 */
  function applyYuanModal(){
    if(!yuanModalIsOpen()) return false;
    state.yuanInitPrelim = readYuanInput(document.getElementById("yuan-init-prelim"), state.yuanInitPrelim);
    state.yuanInitFinal  = readYuanInput(document.getElementById("yuan-init-final"),  state.yuanInitFinal);
    closeYuanModal();
    updateUI();
    return true;
  }

  /* ============ 事件绑定 ============ */
  function bindEvents(){
    document.body.addEventListener("click", function(ev){
      // 计次 +/- 按钮
      const btn = ev.target.closest("button[data-act]");
      if(btn){
        const key = btn.dataset.key;
        const act = btn.dataset.act;
        const cur = parseInt(state.counts[key],10)||0;
        const next = act==="inc" ? cur+1 : Math.max(0, cur-1);
        state.counts[key] = next;
        const input = document.querySelector('input.count-input[data-key="'+key+'"]');
        if(input) input.value = next;
        updateUI();
        return;
      }
      // 开关项（沿用原站：互斥组替换 + 父项自动补勾 / 取消级联）
      const tg = ev.target.closest(".toggle-row");
      if(tg && tg.dataset.toggle){
        const k = tg.dataset.toggle;
        const item = ALL_TOGGLES.find(x=>x.key===k);
        const willCheck = !state.toggles[k];

        if(willCheck && item){
          // 互斥组：把同组内已勾选的其他项取消（状态与视觉同步）
          if(item.group){
            ALL_TOGGLES.forEach(other=>{
              if(other.group === item.group && other.key !== k && state.toggles[other.key]){
                state.toggles[other.key] = false;
                const oel = document.querySelector('.toggle-row[data-toggle="'+other.key+'"]');
                if(oel) oel.classList.remove("active");
              }
            });
          }
          // 父项：若未勾选则自动补勾
          if(item.parent && !state.toggles[item.parent]){
            state.toggles[item.parent] = true;
            const pel = document.querySelector('.toggle-row[data-toggle="'+item.parent+'"]');
            if(pel) pel.classList.add("active");
          }
        }

        state.toggles[k] = willCheck;
        tg.classList.toggle("active", willCheck);

        // 取消父项 → 级联取消其全部子项
        if(!willCheck){
          ALL_TOGGLES.forEach(it=>{
            if(it.parent === k && state.toggles[it.key]){
              state.toggles[it.key] = false;
              const cel = document.querySelector('.toggle-row[data-toggle="'+it.key+'"]');
              if(cel) cel.classList.remove("active");
            }
          });
        }

        updateUI();
        return;
      }
      // 源石锭计分模式：初赛 / 决赛
      const ybtn = ev.target.closest(".mode-btn[data-yuan-mode]");
      if(ybtn){
        const mode = ybtn.dataset.yuanMode;
        if(mode !== state.yuanMode){
          state.yuanMode = mode;
          document.querySelectorAll(".mode-btn[data-yuan-mode]").forEach(b=>{
            b.classList.toggle("active", b.dataset.yuanMode === mode);
          });
          updateUI();
        }
      }
    });

    // 输入框
    document.body.addEventListener("input", function(ev){
      const t = ev.target;
      if(t.matches("input.count-input[data-key]")){
        const k = t.dataset.key;
        const v = parseInt(t.value,10)||0;
        state.counts[k] = Math.max(0, v);
        updateUI();
      } else if(t.id==="dur-h"){
        state.durH = Math.max(0, parseInt(t.value,10)||0); updateUI();
      } else if(t.id==="dur-m"){
        state.durM = Math.max(0, parseInt(t.value,10)||0); updateUI();
      } else if(t.id==="yuan-start"){
        state.yuanStart = Math.max(0, parseInt(t.value,10)||0); updateUI();
      } else if(t.id==="yuan-end"){
        state.yuanEnd = Math.max(0, parseInt(t.value,10)||0); updateUI();
      } else if(t.id==="yuan-prev"){
        const cleaned = (t.value||"").replace(/[^0-9]/g,"");
        if(cleaned !== t.value) t.value = cleaned;
        state.yuanPrev = parseInt(cleaned,10)||0;
        updateUI();
      } else if(t.id==="settle-score"){
        const cleaned = (t.value||"").replace(/[^0-9]/g,"");
        if(cleaned !== t.value) t.value = cleaned;
        state.settleScore = parseInt(cleaned,10)||0;
        updateUI();
      } else if(t.id==="parts-count"){
        const cleaned = (t.value||"").replace(/[^0-9]/g,"");
        if(cleaned !== t.value) t.value = cleaned;
        state.partsCount = parseInt(cleaned,10)||0;
        updateUI();
      } else if(t.id==="player-name"){
        state.playerName = t.value || "";
        updateUI();
      }
    });

    // 失焦兜底：输入框被清空（或填了非法值）后离开焦点时，一律回填 0
    //   只靠 input 事件是不够的——用户把内容全删掉时 DOM 会留空字符串，
    //   而 state 里已经是 0，两者显示不一致，看起来就像「没归零」。
    document.body.addEventListener("focusout", function(ev){
      const t = ev.target;
      if(!t || typeof t.matches !== "function") return;

      const key = t.matches("input.count-input[data-key]") ? t.dataset.key : null;
      const numMap = {
        "dur-h":"durH", "dur-m":"durM",
        "yuan-start":"yuanStart", "yuan-end":"yuanEnd", "yuan-prev":"yuanPrev",
        "settle-score":"settleScore", "parts-count":"partsCount"
      };
      const field = key === null ? numMap[t.id] : null;
      if(key === null && !field) return;   // 不是本页的数值输入框，不管

      const raw = String(t.value == null ? "" : t.value).trim();
      const n = parseInt(raw, 10);
      const v = (isFinite(n) && n > 0) ? n : 0;   // 空 / 非法 / 负数 / 0 → 0

      t.value = v;
      if(key !== null) state.counts[key] = v;
      else             state[field] = v;
      updateUI();
    });

    // 归零
    const resetBtn = document.getElementById("btn-reset");
    if(resetBtn){
      resetBtn.addEventListener("click", function(){
        clearState();
        // 界面统一交给 syncDOM() 回填，避免两处各维护一份字段清单而漏项
        syncDOM();
        updateUI();
      });
    }

    // 导出 / 导入
    // ⚠️ 导出**直接落 txt 存档**（曾经有个「导出方式」弹框能二选一导 PNG 结算图，已按要求下线）
    const exportBtn = document.getElementById("btn-export");
    if(exportBtn) exportBtn.addEventListener("click", function(){ exportToFile(); });
    const importBtn = document.getElementById("btn-import");
    if(importBtn) importBtn.addEventListener("click", function(){ importFromFile(); });

    /* ---------- 源石锭余额设置弹框：齿轮 / 应用 / 取消 / 点遮罩 / Esc / 回车 ---------- */
    const yuanGearBtn = document.getElementById("btn-yuan-settings");
    if(yuanGearBtn) yuanGearBtn.addEventListener("click", function(){ openYuanModal(); });

    const yuanApplyBtn = document.getElementById("yuan-modal-apply");
    if(yuanApplyBtn) yuanApplyBtn.addEventListener("click", function(){ applyYuanModal(); });

    const yuanCancelBtn = document.getElementById("yuan-modal-cancel");
    if(yuanCancelBtn) yuanCancelBtn.addEventListener("click", function(){ closeYuanModal(); });

    const yuanModal = yuanModalEl();
    if(yuanModal){
      // 点遮罩（卡片之外的空白）＝ 取消；点卡片内部不关
      yuanModal.addEventListener("click", function(ev){
        if(ev.target === yuanModal) closeYuanModal();
      });
    }

    /* 键盘：Esc = 取消，回车 = 应用。
       ⚠️ 挂 document 而不是分别挂在两个输入框上：两个框都要响应，
          而且「点过某处、焦点不在输入框上」时回车也该照常应用。
       ⚠️ 只在弹框开着时才管，页面其余部分一个字不受影响。
       ⚠️ 中文输入法组字中的回车是在选词，必须放过（isComposing / 229 两种都挡）。 */
    document.addEventListener("keydown", function(ev){
      if(!yuanModalIsOpen()) return;
      if(ev.isComposing || ev.keyCode === 229) return;
      if(ev.key === "Escape" || ev.keyCode === 27){ closeYuanModal(); }
      else if(ev.key === "Enter" || ev.keyCode === 13){ ev.preventDefault(); applyYuanModal(); }
    });

    /* ---------- 赛事规则：回车新增 / 删除键 / 拖动排序 / 锁定开关 ---------- */
    const rulesInput = document.getElementById("rules-input");
    if(rulesInput){
      rulesInput.addEventListener("keydown", function(ev){
        // ⚠️ 中文输入法正在组字时，回车是用来「选词」的，必须放过（isComposing / 229 两种都要挡）
        if(ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229) return;
        ev.preventDefault();
        if(addRule(rulesInput.value)) rulesInput.value = "";   // 添加成功才清空；超上限时保留原文
      });
    }

    // 锁定开关：切换「只读」。这个按钮本身任何时候都可点，否则锁上就解不开了
    const rulesLockBtn = document.getElementById("rules-lock");
    if(rulesLockBtn){
      rulesLockBtn.addEventListener("click", function(){ toggleRulesLock(); });
    }

    const rulesList = document.getElementById("rules-list");
    if(rulesList){
      // 删除（事件委托：条目是动态生成的，绑在容器上最稳）
      rulesList.addEventListener("click", function(ev){
        const del = ev.target.closest ? ev.target.closest(".rules-del") : null;
        if(!del || !rulesList.contains(del)) return;
        ev.preventDefault();
        deleteRule(parseInt(del.dataset.del, 10));
      });

      // 拖动开始：记下快照，并给该条目加 .dragging（锁定时根本不让拖）
      rulesList.addEventListener("dragstart", function(ev){
        if(state.rulesLocked) return;
        const li = ev.target.closest ? ev.target.closest(".rules-item") : null;
        if(!li || !rulesList.contains(li)) return;
        rulesDragEl = li;
        rulesDragBefore = state.rules.slice();
        li.classList.add("dragging");
        if(ev.dataTransfer){
          ev.dataTransfer.effectAllowed = "move";
          try{ ev.dataTransfer.setData("text/plain", li.dataset.index); }catch(e){ /* 某些环境只读 */ }
        }
      });

      /* 拖动经过：直接把被拖的条目插到目标条目的前/后半区 → 拖动过程所见即所得。
         用指针在目标条目上/下半区来判断「插到前面还是后面」。 */
      rulesList.addEventListener("dragover", function(ev){
        if(!rulesDragEl) return;
        ev.preventDefault();
        if(ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        const over = ev.target.closest ? ev.target.closest(".rules-item") : null;
        if(!over || over === rulesDragEl || !rulesList.contains(over)) return;
        const box = over.getBoundingClientRect();
        const after = ev.clientY > box.top + box.height / 2;
        rulesList.insertBefore(rulesDragEl, after ? over.nextSibling : over);
      });

      rulesList.addEventListener("drop", function(ev){
        if(rulesDragEl) ev.preventDefault();
      });

      // 拖动结束（不管落在哪儿都会触发）：清样式并把 DOM 顺序回写进 state
      rulesList.addEventListener("dragend", function(){
        if(!rulesDragEl) return;
        rulesDragEl.classList.remove("dragging");
        rulesDragEl = null;
        commitRuleOrder(rulesDragBefore, rulesList);
        rulesDragBefore = null;
      });
    }
  }

  /* ============ 栏位自动分配（3 / 2 / 1 列） ============ */
  //   · 栏数按容器宽度决定（用容器宽度而不是视口宽度：.wrapper 限宽 1400，视口更宽时容器不再变宽）
  //   · 各栏装哪几块：穷举 3^9 种分法，在「高度配平」与「保持阅读顺序」之间取综合最优（见 planAssignment）
  //   · 底边对齐：较短那栏与最高栏的高度差，按各块自然高度的占比分摊给该栏每一块（flex-grow），
  //     所以不会有哪一块被单独拉出大空洞，"不要过度拉伸" 与 "底边对齐" 同时满足
  const layoutEl = document.getElementById("layout");
  const PANELS = layoutEl
    ? Array.prototype.filter.call(layoutEl.children, el=>el.classList.contains("panel"))
    : [];

  const COL_GAP = 10;
  const COL_MIN_3 = 1140;   // 容器宽 ≥ 1140 → 3 列（每列约 373px）
  const COL_MIN_2 = 720;    // 容器宽 ≥  720 → 2 列（每列约 355px）；再窄则 1 列
  // 打乱一对阅读顺序，等价于「愿意多忍受 45px 的高度差」：
  // 只有平衡收益足够大时才允许把面板挪到不那么顺的位置
  const ORDER_WEIGHT = 45;

  let colCount = 0;
  let columnEls = [];
  let resizeTimer = null;

  function pickColumnCount(){
    const w = layoutEl.clientWidth;
    if(w >= COL_MIN_3) return 3;
    if(w >= COL_MIN_2) return 2;
    return 1;
  }

  // 面板太多时退回的顺序贪心（每块放进当前最矮的一栏）
  function greedyAssignment(heights, n){
    const totals = new Array(n).fill(0), assign = new Array(heights.length);
    heights.forEach((h, i)=>{
      let k = 0;
      for(let j=1;j<n;j++) if(totals[j] < totals[k]) k = j;
      assign[i] = k;
      totals[k] += h + COL_GAP;
    });
    return assign;
  }

  /* 决定哪块面板放哪一栏。
     面板只有 9 块、栏数最多 3，3^9 = 19683 种分法，直接穷举并在毫秒内挑出最优：
       分数 =（最高栏 − 最矮栏的高度差）+ 打乱阅读顺序的代价 × ORDER_WEIGHT
     —— 高度差越小越好（差多少，较短那栏的每一块就要按比例被拉长多少），
        同时尽量保持「先按栏、栏内按原次序」的阅读顺序。
     第 1 块（选手）固定放第 1 栏，保证页面左上角从它开始。 */
  function planAssignment(heights, n){
    const m = heights.length;
    if(n <= 1 || m === 0) return heights.map(()=>0);
    if(m > 12) return greedyAssignment(heights, n);   // 兜底，避免组合爆炸

    const sums = new Array(n);
    const totalMasks = Math.pow(n, m);
    let best = null, bestCost = Infinity;

    for(let mask=0; mask<totalMasks; mask++){
      sums.fill(0);
      const assign = new Array(m);
      let x = mask, sumMax = 0, sumMin = Infinity;
      for(let i=0;i<m;i++){
        const c = x % n;
        x = (x - c) / n;
        assign[i] = c;
        sums[c] += heights[i] + COL_GAP;
      }
      if(assign[0] !== 0) continue;                    // 第 1 块固定在首栏
      for(let c=0;c<n;c++){
        if(sums[c] > sumMax) sumMax = sums[c];
        if(sums[c] < sumMin) sumMin = sums[c];
      }
      let cost = sumMax - sumMin;
      if(cost > bestCost) continue;                    // 剪枝：inv*ORDER_WEIGHT ≥ 0，故不可能更优

      const seq = [];                                  // 实际阅读顺序：先按栏，栏内按原次
      for(let c=0;c<n;c++) for(let i=0;i<m;i++) if(assign[i]===c) seq.push(i);
      let inv = 0;
      for(let a=0;a<seq.length;a++)
        for(let b=a+1;b<seq.length;b++) if(seq[a] > seq[b]) inv++;
      cost += inv * ORDER_WEIGHT;

      if(cost < bestCost){ bestCost = cost; best = assign.slice(); }
    }
    return best || greedyAssignment(heights, n);
  }

  function syncColumns(force){
    if(!layoutEl || !PANELS.length) return;
    const n = pickColumnCount();
    if(!force && n === colCount) return;
    colCount = n;

    // 1) 重建栏容器
    while(layoutEl.firstChild) layoutEl.removeChild(layoutEl.firstChild);
    columnEls = [];
    for(let i=0;i<n;i++){
      const col = document.createElement("div");
      col.className = "side";
      layoutEl.appendChild(col);
      columnEls.push(col);
    }
    layoutEl.style.setProperty("--cols", n);

    // 2) 先把所有面板堆进第 1 栏，量出它们在「目标列宽」下的自然高度
    //    （列宽由 grid 的 1fr 决定，与栏里放几块无关，所以此时量到的就是最终高度）
    PANELS.forEach(p=>{
      p.classList.remove("grow");
      p.style.flexGrow = "";                   // 清掉上一轮分摊用的 flex-grow
      columnEls[0].appendChild(p);
    });
    void layoutEl.offsetHeight;                      // 强制重排一次，避免逐块读取时反复 layout
    const heights = PANELS.map(p=>p.getBoundingClientRect().height);

    // 3) 按最优分法装箱（按原始次序逐栏追加 → 每栏内部保持原阅读顺序）
    const assign = planAssignment(heights, n);
    PANELS.forEach((p, i)=>columnEls[assign[i]].appendChild(p));

    // 4) 底边对齐：把「与最高栏的高度差」按各块自然高度的占比，分摊给较短那一栏的每一块。
    //    flex-grow 按自然高度成比例 → 每块的拉伸幅度（百分比）一致，看起来像整体放松了内距；
    //    若只用一块（比如最后一块）独吞，小面板会被拉出远大于自身内容的空洞。
    if(n > 1){
      const colNat = new Array(n).fill(0), colCnt = new Array(n).fill(0);
      PANELS.forEach((p, i)=>{
        colNat[assign[i]] += heights[i];
        colCnt[assign[i]]++;
      });
      // 栏高 = 栏内面板高之和 + 栏内 (块数 − 1) 个间距
      const colSum = colNat.map((s, c)=> s + Math.max(0, colCnt[c] - 1) * COL_GAP);
      const target = Math.max.apply(null, colSum);
      PANELS.forEach((p, i)=>{
        const c = assign[i];
        if(target - colSum[c] <= 0.5 || colNat[c] <= 0) return;   // 最高栏不需要拉伸
        p.classList.add("grow");
        p.style.flexGrow = String(heights[i] / colNat[c]);
      });
    }
  }

  /* ============ 持久化 ============ */
  // 沿用原站的 localStorage 方案，但修掉了原站的一个疏漏：
  // 原站 load() 只把数据写回 state，**不回填输入框**，刷新后会出现
  // 「输入框显示 0、但总分已经按旧值算好」的错位。这里补一个 syncDOM()。
  const STORAGE_KEY = "hlsh_zhoujibei_counter_v1";

  /* ⚠️ 赛事规则走**独立**的存档键（2026-09-23 定）。
     它是「赛制配置」，不是某位选手的成绩：导入别人的选手数据、或导入一份
     没带规则的旧存档，都不应该把它冲掉或被换成文件里的那份。
     所以 rules / rulesLocked 既不在 save() 里写出，也不在 applySnapshot() 里读入，
     只经由 saveRules() / loadRules() 这一条通道往返。
     键名带 _v1，将来若格式要改，换版本号即可（旧键不会互相污染）。 */
  const STORAGE_KEY_RULES = "hlsh_zhoujibei_rules_v1";

  // 只写「赛事规则」这一小块（列表 + 锁定状态）
  function saveRules(){
    try{
      localStorage.setItem(STORAGE_KEY_RULES, JSON.stringify({
        rules: state.rules,
        rulesLocked: state.rulesLocked
      }));
    }catch(e){ /* 隐私模式 / 配额满：静默忽略 */ }
  }

  // 只读「赛事规则」：恢复规则列表与锁定状态
  //   旧存档（键不存在）→ 什么都不做，保持 state 里的默认空规则
  function loadRules(){
    let obj;
    try{
      const raw = localStorage.getItem(STORAGE_KEY_RULES);
      if(!raw) return;
      obj = JSON.parse(raw);
    }catch(e){ return; }
    if(!obj || typeof obj !== "object") return;
    if(Array.isArray(obj.rules)) state.rules = sanitizeRules(obj.rules);
    if(typeof obj.rulesLocked === "boolean") state.rulesLocked = obj.rulesLocked;
    // 规则是数据驱动的面板，恢复后要重渲染。
    // ⚠️ 这一步故意放在 loadRules 里，而不是 updateUI() 里 —— updateUI() 会被「导入」调用，
    //    而导入必须完全不碰规则（连 renderRules 里顺带的 saveRules 也不行）。
    renderRules();
  }

  function save(){
    try{
      // ⚠️ 只序列化**计分数据**：把规则两个字段从快照里摘掉。
      //    规则有自己的存档键（saveRules），若这里照旧整棵 state 写出去，
      //    「导入 → updateUI → save」仍会把当时的规则写进计分存档，
      //    虽然不会被读回，但存档里留着这两个字段本身就是混淆源。
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotCounts()));
    }catch(e){ /* 隐私模式 / 配额满：静默忽略，不影响使用 */ }
  }

  // 计分存档的序列化形态：state 去掉 rules / rulesLocked
  function snapshotCounts(){
    const o = {};
    Object.keys(state).forEach(k=>{
      if(k === "rules" || k === "rulesLocked") return;
      o[k] = state[k];
    });
    return o;
  }

  // 清空全部计分数据（归零按钮 与 导入 共用，避免两处各维护一份字段清单）
  //   ⚠️ 故意不动 state.rules / state.rulesLocked：赛事规则是「赛制配置」，不是某位选手的成绩，
  //      换下一位选手时应当沿用（要清规则就逐条点删除键，或先解锁）。
  //      规则另有自己的存档键（saveRules），这里既不碰内存也不碰磁盘。
  function clearState(){
    Object.keys(state.counts).forEach(k=>state.counts[k] = 0);
    Object.keys(state.toggles).forEach(k=>state.toggles[k] = false);
    state.playerName = "";
    state.durH = 0; state.durM = 0;
    state.yuanStart = 0; state.yuanEnd = 0; state.yuanPrev = 0;
    state.settleScore = 0; state.partsCount = 0;
    /* ⚠️ 故意不动 yuanInitPrelim / yuanInitFinal（源石锭两个余额上限）——
       和赛事规则一样属于「赛制配置」而非某位选手的成绩：
       「归零」是给下一位选手开新局，不该把整场比赛的余额设置一起重置。
       （但导入存档时会被 txt 里的值覆盖，见 applySnapshot —— 余额是**算分参数**，
         必须随存档一起复现，否则会出现「文件里写着 120、本机却按 60 算」的对不上账。） */
  }

  /* 把一份存档对象套用到 state 上。
     · clearFirst=false（localStorage 恢复）—— 未出现的字段保持原值，兼容旧存档；
     · clearFirst=true （导入 txt）        —— 先清空再套用，导入是「整体替换」而不是「合并」。
     只接受「已登记的键」，避免旧版本残留 / 外来文件里的脏数据污染状态。
     ⚠️ 唯独**赛事规则**不走这里：它是赛制配置、不是选手数据，
        既不在本函数读入，也不被 clearState() 清空，只由 saveRules()/loadRules() 管。 */
  function applySnapshot(obj, clearFirst){
    if(clearFirst) clearState();

    if(typeof obj.playerName === "string") state.playerName = obj.playerName;
    if(obj.counts && typeof obj.counts === "object"){
      Object.keys(state.counts).forEach(k=>{
        const v = parseInt(obj.counts[k],10);
        if(isFinite(v)) state.counts[k] = Math.max(0, v);
      });
    }
    if(obj.toggles && typeof obj.toggles === "object"){
      Object.keys(state.toggles).forEach(k=>{
        if(k in obj.toggles) state.toggles[k] = !!obj.toggles[k];
      });
    }
    /* 源石锭的两个余额上限（齿轮弹框可改）也走这里：
       旧存档 / 手改的 txt 里没有这两个字段时**保持现值**（parseInt 得到 NaN，直接跳过），
       所以「导入一份老档」不会把用户设好的余额打回默认。 */
    ["durH","durM","yuanStart","yuanEnd","yuanPrev","settleScore","partsCount",
     "yuanInitPrelim","yuanInitFinal"].forEach(k=>{
      const v = parseInt(obj[k],10);
      if(isFinite(v)) state[k] = Math.max(0, v);
    });
    if(obj.yuanMode === "prelim" || obj.yuanMode === "final") state.yuanMode = obj.yuanMode;

    /* ⚠️ 赛事规则：**故意完全不在这里处理**（2026-09-23 用户要求）。
       规则是赛制配置，不属于选手数据：
         · 旧的 txt 存档里即使带着 rules / rulesLocked，导入时也一律忽略；
         · 导入一份没带规则的文件，更不会把现有规则清空。
       它的读写只走 saveRules() / loadRules() 那条独立通道。
       下面这段注释保留历史原因：曾经它是跟其它字段一起「整体替换」的。 */
  }

  function load(){
    let obj;
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw){ loadRules(); return; }   // 计分存档还没有，但规则存档可能已经有了
      obj = JSON.parse(raw);
    }catch(e){ loadRules(); return; }
    if(!obj || typeof obj !== "object"){ loadRules(); return; }
    applySnapshot(obj, false);
    loadRules();   // ⚠️ 规则独立恢复，必须在 applySnapshot 之后（后者已完全不管规则）
  }

  // 把 state 回填到界面：选手名 / 计次输入框 / 时长与结算输入框 / 勾选高亮 / 源石锭模式按钮
  function syncDOM(){
    const nameEl = document.getElementById("player-name");
    if(nameEl) nameEl.value = state.playerName || "";

    document.querySelectorAll("input.count-input[data-key]").forEach(el=>{
      el.value = parseInt(state.counts[el.dataset.key],10) || 0;
    });

    const numMap = {
      "dur-h":"durH", "dur-m":"durM",
      "yuan-start":"yuanStart", "yuan-end":"yuanEnd", "yuan-prev":"yuanPrev",
      "settle-score":"settleScore", "parts-count":"partsCount"
    };
    Object.keys(numMap).forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.value = state[numMap[id]] || 0;
    });

    ALL_TOGGLES.forEach(it=>{
      const el = document.querySelector('.toggle-row[data-toggle="'+it.key+'"]');
      if(el) el.classList.toggle("active", !!state.toggles[it.key]);
    });

    document.querySelectorAll(".mode-btn[data-yuan-mode]").forEach(b=>{
      b.classList.toggle("active", b.dataset.yuanMode === state.yuanMode);
    });

    /* ⚠️ 赛事规则**故意不在这里渲染**（2026-09-23 用户要求）。
       它有自己的存档通道，只有真正改规则时才重渲染
       （addRule / deleteRule / commitRuleOrder / toggleRulesLock / load）。
       这样「导入选手数据」全程都不会触碰规则列表的 DOM
       —— updateUI() 会被导入调用，它若顺带 renderRules() 就会经由
       renderRules → saveRules 把规则写回去，所以这里必须彻底不碰。 */
  }

  /* ============ 导出 / 导入（txt 存档） ============ */  /*  文件格式分上下两半：
       · 上半是「可读汇总」—— 覆盖页面上的全部信息（选手名、总分、每个板块的每一项），供人阅读/打印；
         其中【赛事规则】一段是**留档快照**，导入时不回读（规则有自己的存档键）。
       · 下半是以 DATA: 开头的一行 JSON —— 导入时只读这一行，且不含 rules / rulesLocked。
     这样解析目标唯一、不受排版与文字改动影响；上半怎么写都不会把导入弄坏。
     导出优先调用 File System Access API 让用户自选保存地址，浏览器不支持时退回普通下载。 */
  const EXPORT_VERSION   = 1;
  const EXPORT_MARKER    = "DATA:";
  const IMPORT_FAIL_MSG  = "文件格式有误，无法导入。\n请选择由本计分器「导出」生成的 txt 文件。";

  // ---- 文本对齐：全角字符按 2 个宽度计，让「标签 ....... 值」的点线对齐 ----
  const WIDE_RE = /[\u1100-\u115f\u2e80-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;
  function displayWidth(s){
    let w = 0;
    for(const ch of String(s)) w += WIDE_RE.test(ch) ? 2 : 1;
    return w;
  }
  function dots(label, width){
    return label + " " + ".".repeat(Math.max(2, width - displayWidth(label))) + " ";
  }

  function two(n){ return String(n).padStart(2, "0"); }
  function fmtNow(){
    const d = new Date();
    return d.getFullYear()+"-"+two(d.getMonth()+1)+"-"+two(d.getDate())+" "+
           two(d.getHours())+":"+two(d.getMinutes())+":"+two(d.getSeconds());
  }
  function fileNameStamp(){
    const d = new Date();
    return ""+d.getFullYear()+two(d.getMonth()+1)+two(d.getDate())+"-"+two(d.getHours())+two(d.getMinutes());
  }

  // 导出文件名：黑流树海粥集杯#1计分器-祁星-20260921-1050.txt
  function exportFileName(){
    const who = (state.playerName || "").trim() || PLAYER_PLACEHOLDER;
    const safe = who.replace(/[\\/:*?"<>|]/g, "_").slice(0, 24);   // 去掉 Windows 文件名非法字符
    return "黑流树海粥集杯#1计分器-" + safe + "-" + fileNameStamp() + ".txt";
  }

  // 组装导出的整份文本
  function buildExportText(){
    const r = computeAll();
    const L = [];
    const put = s => L.push(s == null ? "" : s);
    const d = dots;
    const mark = k => state.toggles[k] ? "√" : " ";
    const choose = k => state.toggles[k] ? "已勾选" : "未勾选";

    put("==============================================================");
    put("  黑流树海粥集杯#1 计分器 · 计分存档");
    put("==============================================================");
    put("导出时间：" + fmtNow());
    put("格式版本：" + EXPORT_VERSION + "（导入时读取文件末尾 " + EXPORT_MARKER + " 开头的那一行）");
    put("");

    put("【选手】");
    put("  " + d("选手名", 26) + ((state.playerName || "").trim() || PLAYER_PLACEHOLDER));
    put("");

    /* ⚠️ 赛事规则这一段**只是留档快照**，导入时完全不读（规则走自己的存档键）。
       仍然打印出来，是为了让这份 txt 单独拿出去看也能知道当时跑的是什么规则。 */
    put("【赛事规则】共 " + state.rules.length + " 条（仅供留档；导入不回读，规则以本机规则存档为准）");
    put("  " + d("锁定状态", 26) + (state.rulesLocked ? "已锁定（只读）" : "未锁定"));
    if(state.rules.length === 0) put("  （暂无规则）");
    state.rules.forEach(function(s, i){
      put("  " + String(i + 1).padStart(2, " ") + ". " + s);
    });
    put("");

    put("【临时招募】小计 " + signed(r.recruit));
    RECRUIT.forEach(it=>{
      const n = state.counts[it.key] || 0;
      put("  " + d(it.name, 26) + n + " 个 × " + signed(it.score) + " = " + signed(n * it.score));
    });
    put("");

    put("【通关时长加减分】小计 " + signed(r.duration));
    put("  " + d("通关时长", 26) + formatDuration(r.durationMin));
    put("  " + d("判定分档", 26) + r.durationTier);
    put("");

    put("【关卡通关加分】小计 " + signed(r.emergency));
    EMERGENCY.forEach(it=>{
      put("  [" + mark(it.key) + "] " + d(it.name, 42) + signed(it.score));
    });
    put("");

    put("【源石锭】小计 " + signed(r.yuan));
    put("  " + d("计分模式", 26) + (state.yuanMode === "final" ? "决赛" : "初赛"));
    /* 两档余额上限也印出来（留档用）：否则换台机器导入后，别人看不出当时按哪个上限算的。
       ⚠️ 这两行由 ranking.js 的 txt 解析器忽略（它只认「消耗点数」那一行），加行不影响上榜。 */
    put("  " + d("初赛余额上限", 26) + yuanInit("prelim"));
    put("  " + d("决赛初始余额", 26) + yuanInit("final"));
    put("  " + d("开始前源石锭数", 26) + state.yuanStart);
    put("  " + d("结束后源石锭数", 26) + state.yuanEnd);
    put("  " + d("消耗点数", 26) + r.yuanUsed);
    put("  " + d("可用余额", 26) + r.yuanAvail);
    if(state.yuanMode === "final") put("  " + d("上一位选手使用点数", 26) + state.yuanPrev);
    put("  " + d("超额扣分", 26) + r.yuan);
    put("");

    put("【违规扣分】小计 " + signed(r.violation));
    VIOLATION_COUNTERS.forEach(it=>{
      const n = state.counts[it.key] || 0;
      put("  " + d(it.name, 26) + n + " 个 × " + signed(it.score) + " = " + signed(n * it.score));
    });
    VIOLATION_TOGGLES.forEach(it=>{
      put("  [" + mark(it.key) + "] " + d(it.name, 42) + signed(it.score));
    });
    put("");

    put("【击杀特殊敌人】小计 " + signed(r.special));
    SPECIAL_KILLS.forEach(it=>{
      const n = state.counts[it.key] || 0;
      put("  " + d(it.name, 26) + n + " 个 × " + signed(it.score) + " = " + signed(n * it.score));
    });
    put("");

    put("【藏品与路线加分】小计 " + signed(r.route));
    ROUTE_BONUS.forEach(it=>{
      put("  [" + mark(it.key) + "] " + d(it.name, 42) + signed(it.score));
    });
    put("");

    put("【商店加分】小计 " + signed(r.kannuote));
    KANNUOTE.forEach(it=>{
      put("  [" + mark(it.key) + "] " + d(it.name, 42) + signed(it.score));
    });
    put("");

    put("【通关结算】");
    put("  " + d("结算分", 26) + state.settleScore);
    put("  " + d("零件数量", 26) + state.partsCount);
    put("  " + d("通关得分", 26) + signed(r.clearScore) + "   （=（结算分 − 零件数量 × 5）÷ 2）");
    CHENLUN.forEach(it=>{
      put("  " + d(it.name, 26) + choose(it.key));
    });
    put("");

    put("--------------------------------------------------------------");
    put("【总分】");
    put("  " + d("个人基础分", 26) + signed(r.personalBase));
    put("  " + d("沉沦者倍率", 26) + "×" + r.multiplier);
    put("  " + d("个人得分", 26) + fmtNum(r.personalScore));
    if(r.splitTeam) put("  " + d("团队得分", 26) + fmtNum(r.teamScore));
    put("  " + d("总分", 26) + fmtNum(r.total)
        + (r.splitTeam ? "   （= 个人基础分 × 倍率 + 团队得分）" : "   （= 个人基础分 × 倍率）"));
    put("");

    put("==============================================================");
    put("  以上为可读汇总，仅供查看。导入时只读取下面这一行，请勿手工修改。");
    put("==============================================================");
    put(EXPORT_MARKER + JSON.stringify({
      v: EXPORT_VERSION,
      playerName: state.playerName,
      counts: state.counts,
      toggles: state.toggles,
      durH: state.durH, durM: state.durM,
      yuanStart: state.yuanStart, yuanEnd: state.yuanEnd, yuanPrev: state.yuanPrev,
      yuanMode: state.yuanMode,
      yuanInitPrelim: state.yuanInitPrelim, yuanInitFinal: state.yuanInitFinal,
      settleScore: state.settleScore, partsCount: state.partsCount
    }));
    /* ⚠️ DATA 行里**故意没有** rules / rulesLocked —— 赛事规则不属于选手存档。
       上面那段可读的【赛事规则】只是给人看的快照。
       （旧版本导出的 txt 里可能还带着这两个字段，导入时会被忽略，见 applySnapshot。） */

    return L.join("\r\n");   // 用 CRLF，Windows 记事本最稳妥
  }

  /* 解析导出的 txt：只认最后一行以 DATA: 开头的内容。
     任何一步不满足都抛错，调用方统一弹「文件格式有误」。 */
  function parseExportText(text){
    const lines = String(text == null ? "" : text).replace(/^\uFEFF/, "").split(/\r?\n/);
    let payload = null;
    for(let i = lines.length - 1; i >= 0; i--){
      const t = lines[i].trim();
      if(t.lastIndexOf(EXPORT_MARKER, 0) === 0){ payload = t.slice(EXPORT_MARKER.length).trim(); break; }
    }
    if(!payload) throw new Error("没有找到 " + EXPORT_MARKER + " 数据行");

    let obj;
    try{ obj = JSON.parse(payload); }
    catch(e){ throw new Error("数据行不是合法的 JSON"); }
    if(!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("数据内容不是对象");
    if(typeof obj.v !== "number") throw new Error("缺少格式版本号");

    const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
    if(!isObj(obj.counts) && !isObj(obj.toggles)) throw new Error("缺少计分数据");
    /* 兼容旧版本导出的 txt：它们曾在 DATA 行里带 rules / rulesLocked。
       这里主动摘掉，确保「赛事规则不随文件走」这条规则在解析层也是硬的
       （applySnapshot 本来就已不读这两个字段，这里是第二道保险）。 */
    delete obj.rules;
    delete obj.rulesLocked;
    return obj;
  }

  // 导入 = 整体替换（先清空再套用）
  function applyImported(obj){ applySnapshot(obj, true); }

  // ---- 存 / 读文件 ----

  function downloadTextFile(name, text){
    const blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });  // BOM 让记事本识别 UTF-8
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    if(a.remove) a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  // 优先让用户自选保存地址；API 不可用或被禁用时退回普通下载
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
      }).catch(function(e){
        if(e && e.name === "AbortError") return;   // 用户自己取消 → 什么都不做
        downloadTextFile(name, text);              // 其它原因（API 被禁等）→ 兜底下载
      });
    }
    downloadTextFile(name, text);
    return null;
  }

  function exportToFile(){
    let text;
    try{ text = buildExportText(); }
    catch(e){ alert("导出失败：无法生成存档内容。"); return; }
    try{
      const p = saveTextFile(exportFileName(), text);
      if(p && typeof p.catch === "function"){
        p.catch(function(e){ alert("导出失败：" + (e && e.message ? e.message : e)); });
      }
    }catch(e){
      alert("导出失败：" + (e && e.message ? e.message : e));
    }
  }

  function readTextFile(file){
    return new Promise(function(resolve, reject){
      const fr = new FileReader();
      fr.onload  = function(){ resolve(String(fr.result)); };
      fr.onerror = function(){ reject(fr.error || new Error("读取失败")); };
      fr.readAsText(file, "utf-8");
    });
  }

  // showOpenFilePicker 不可用时的兜底：临时造一个隐藏的 <input type="file">
  function pickFileWithInput(){
    return new Promise(function(resolve){
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".txt,text/plain";
      inp.style.display = "none";
      let done = false;
      const finish = function(f){
        if(done) return;
        done = true;
        if(inp.remove) inp.remove();
        resolve(f || null);
      };
      inp.addEventListener("change", function(){ finish(inp.files && inp.files[0]); });
      inp.addEventListener("cancel", function(){ finish(null); });   // Chrome 113+ 用户取消
      document.body.appendChild(inp);
      inp.click();
    });
  }

  function importFromFile(){
    let p;
    if(typeof window.showOpenFilePicker === "function"){
      p = window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "文本文件", accept: { "text/plain": [".txt"] } }]
      }).then(function(list){
        return (list && list[0]) ? list[0].getFile() : null;
      }).catch(function(e){
        if(e && e.name === "AbortError") return undefined;   // 用户自己取消
        return pickFileWithInput();                          // API 被禁 → 兜底
      });
    } else {
      p = pickFileWithInput();
    }

    Promise.resolve(p).then(function(file){
      if(!file) return;                                      // 没选文件（取消）
      return readTextFile(file).then(function(text){
        let obj;
        try{ obj = parseExportText(text); }
        catch(err){ alert(IMPORT_FAIL_MSG + "\n\n原因：" + err.message); return; }
        applyImported(obj);
        sanitizeToggles();      // 存档里若有互斥组多选等脏状态，这里清掉
        syncDOM();
        updateUI();
      }, function(){
        alert(IMPORT_FAIL_MSG + "\n\n原因：文件读取失败。");
      });
    }).catch(function(e){
      alert("导入失败：" + (e && e.message ? e.message : e));
    });
  }

  /* ============ 启动 ============ */
  load();              // 先恢复状态，再据此构建界面
  sanitizeToggles();   // 清理不合法的勾选（互斥组多选 / 父项未勾而子项已勾）
  buildLists();
  syncDOM();           // 把恢复的状态回填进输入框与勾选高亮
  bindEvents();
  updateUI();          // 内部会 save()
  syncColumns(true);   // 放最后：等各面板内容就绪，量出的高度才准

  // 窗口尺寸变化：只有栏数会变时才重新分配，栏数不变就不动，免得拖窗口时面板乱跳
  window.addEventListener("resize", function(){
    if(resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){ syncColumns(false); }, 150);
  });

  // 供后续板块复用的接口
  window.BFC = {
    state, RECRUIT, VIOLATION_COUNTERS, VIOLATION_TOGGLES, SPECIAL_KILLS,
    EMERGENCY, KANNUOTE, ROUTE_BONUS, CHENLUN, TEAM_KEYS, ALL_TOGGLES,
    YUAN_INIT_PRELIM, YUAN_INIT_FINAL, YUAN_MODAL_MAX, STORAGE_KEY, STORAGE_KEY_RULES,
    PLAYER_PLACEHOLDER, EXPORT_VERSION, EXPORT_MARKER, IMPORT_FAIL_MSG,
    COL_MIN_2, COL_MIN_3, PANELS,
    computeRecruit, sumCounters, sumToggles, sanitizeToggles, refreshDisabled,
    durationScore, yuanPenalty, yuanInit, computeAll, updateUI, save, load, syncDOM,
    openYuanModal, applyYuanModal, closeYuanModal, yuanModalIsOpen,
    syncColumns, pickColumnCount,
    RULES_MAX, RULES_MAX_LEN, sanitizeRules, renderRules, addRule, deleteRule, commitRuleOrder,
    syncRulesLock, toggleRulesLock, saveRules, loadRules,
    signed, fmtNum, formatDuration,
    clearState, applySnapshot, buildExportText, parseExportText, applyImported, exportFileName,
    exportToFile,
    getLayoutColumns(){ return columnEls; },
    getColCount(){ return colCount; }
  };
})();
