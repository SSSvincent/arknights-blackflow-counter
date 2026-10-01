/* 最小 DOM 桩：让 node 直接跑真实的 js/app.js，验证关卡通关加分与坎诺特栏目的计分与联动 */
const fs = require("fs");
const path = require("path");
const APP = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
const APP_SRC_ALL = APP;

let PASS = 0, FAIL = 0;
function eq(actual, expected, label){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(ok) PASS++; else FAIL++;
  console.log((ok ? "  OK   " : "  FAIL ") + label +
    (ok ? "" : "   期望 " + JSON.stringify(expected) + "  实际 " + JSON.stringify(actual)));
}

function makeEl(tag){
  const set = new Set();
  const e = {
    tag, children: [], dataset: {}, className: "",
    hidden: false, textContent: "", attrs: {}, handlers: {},
    clientWidth: 0, offsetHeight: 0, _parent: null,
    // 布局相关：syncColumns() 会重建栏容器、挪动面板、读高度
    style: { props: {}, setProperty(k, v){ this.props[k] = v; } },
    // 真实 DOM 的 appendChild 会把节点从旧父节点「搬走」，这里必须一致，
    // 否则 syncColumns() 先把面板全堆进第 1 栏、再逐块挪走时会在第 1 栏里重复堆积。
    appendChild(c){
      if(c._parent && c._parent !== e) c._parent.removeChild(c);
      c._parent = e;
      if(e.children.indexOf(c) === -1) e.children.push(c);
      return c;
    },
    removeChild(c){ const i = e.children.indexOf(c); if(i > -1) e.children.splice(i, 1); if(c) c._parent = null; return c; },
    // 规则列表拖拽排序要用：把节点插到 ref 之前（ref 为 null 时等同于 appendChild）
    // ⚠️ 必须**无条件**先从旧位置摘掉：真实 DOM 里 insertBefore 一个已是自己子节点的节点，
    //    效果是「搬家」而不是「复制」，否则规则会越拖越多。
    insertBefore(c, ref){
      if(c._parent) c._parent.removeChild(c);
      const i = ref ? e.children.indexOf(ref) : -1;
      if(i > -1) e.children.splice(i, 0, c); else e.children.push(c);
      c._parent = e;
      return c;
    },
    // 真实 DOM 的 contains 是「含后代」，这里必须沿 _parent 往上找（删除键就嵌在 <li> 里）
    contains(c){
      let n = c;
      while(n){ if(n === e) return true; n = n._parent; }
      return false;
    },
    get firstChild(){ return e.children[0] || null; },
    get lastChild(){ return e.children[e.children.length - 1] || null; },
    get lastElementChild(){ return e.children[e.children.length - 1] || null; },
    get nextSibling(){
      const p = e._parent;
      if(!p) return null;
      const i = p.children.indexOf(e);
      return i > -1 ? (p.children[i + 1] || null) : null;
    },
    getBoundingClientRect(){ return { height: e.offsetHeight, width: e.clientWidth, top: 0 }; },
    addEventListener(ev, fn){ e.handlers[ev] = fn; },
    setAttribute(k, v){ e.attrs[k] = v; },
    removeAttribute(k){ delete e.attrs[k]; },
    classList: {
      add: c => set.add(c),
      remove: c => set.delete(c),
      contains: c => set.has(c),
      toggle: (c, force) => { const on = force === undefined ? !set.has(c) : !!force; on ? set.add(c) : set.delete(c); return on; }
    },
    closest(sel){
      if (sel === ".toggle-row") return e.className.split(" ")[0] === "toggle-row" ? e : null;
      if (sel === "button[data-act]") return e.dataset.act ? e : null;
      if (sel === ".rules-item") return e.className.split(" ").indexOf("rules-item") > -1 ? e : null;
      if (sel === ".rules-del") return e.className.split(" ").indexOf("rules-del") > -1 ? e : null;
      return null;
    },
    matches(sel){ return sel === "input.count-input[data-key]" && e.dataset.key && e.className.includes("count-input"); }
  };
  // innerHTML：真实 DOM 里赋空串会清掉所有子节点，renderRules() 就靠这个重建列表
  Object.defineProperty(e, "innerHTML", {
    get(){ return e._html || ""; },
    set(v){
      e._html = String(v);
      if(e._html === ""){
        e.children.slice().forEach(c => { c._parent = null; });
        e.children.length = 0;
      }
    },
    enumerable: true, configurable: true
  });
  // title 是「反射型」属性：真实 DOM 里 el.title = x 会同步到 title 属性上，
  // 所以代码用属性赋值、测试用 attrs.title 读，两边必须对得上
  Object.defineProperty(e, "title", {
    get(){ return "title" in e.attrs ? e.attrs.title : ""; },
    set(v){ e.attrs.title = String(v); },
    enumerable: true, configurable: true
  });
  return e;
}

const clickHandlers = [];
const blurHandlers = [];
const inputHandlers = [];
const byId = {};
["emergency-list", "violation-list", "special-list", "kannuote-list", "route-list",
 "chenlun-list", "total-value", "total-name", "breakdown", "btn-reset",
 "btn-export", "btn-import",
 "yuan-prelim", "yuan-final", "yuan-taken", "yuan-penalty",
 "yuan-init", "yuan-prelim-bal", "yuan-avail",
 "btn-yuan-settings",
 "yuan-modal", "yuan-modal-apply", "yuan-modal-cancel",
 "yuan-init-prelim", "yuan-init-final",
 "dur-total", "dur-tier", "dur-verdict",
 "player-name",
 "rules-list", "rules-empty", "rules-input", "rules-lock",
 "dur-h", "dur-m", "yuan-start", "yuan-end", "yuan-prev", "settle-score", "parts-count"]
  .forEach(id => { const e = makeEl("div"); e.id = id; byId[id] = e; });
byId["rules-list"].className = "rules-list";   // 真实页面里它是 <ol class="rules-list">
byId["rules-input"].value = "";
byId["rules-input"].disabled = false;
byId["rules-lock"].textContent = "锁定";
/* 源石锭余额设置弹框：真实页面里带 `hidden` 属性 → 初始是关着的。
   ⚠️ 桩元素默认 `hidden: false`，不显式设成 true 的话，「初始关闭」这类断言会假过。 */
byId["yuan-modal"].hidden = true;
byId["yuan-init-prelim"].value = "60";
byId["yuan-init-final"].value = "120";

const allEls = [];
const origMake = makeEl;
// document 级 keydown（源石锭余额弹框的 Esc / 回车）—— 桩里得收住，否则测不到
const keydownHandlers = [];
global.document = {
  createElement(t){ const e = origMake(t); allEls.push(e); return e; },
  body: { addEventListener(ev, fn){
    if (ev === "click") clickHandlers.push(fn);
    else if (ev === "focusout") blurHandlers.push(fn);
    else if (ev === "input") inputHandlers.push(fn);
  } },
  addEventListener(ev, fn){ if (ev === "keydown") keydownHandlers.push(fn); },
  querySelectorAll(){ return []; },
  getElementById(id){ return byId[id] || null; },
  querySelector(sel){
    let m = /^\.toggle-row\[data-toggle="([^"]+)"\]$/.exec(sel);
    if (m) return allEls.find(e => e.dataset.toggle === m[1]) || null;
    m = /^input\.count-input\[data-key="([^"]+)"\]$/.exec(sel);
    if (m) return allEls.find(e => e.dataset.key === m[1] && e.className.includes("count-input")) || null;
    return null;
  }
};
global.window = { addEventListener(){} };

/* ---------- 布局桩：#layout + 与 index.html 同序的 9 块面板 ----------
   面板在真实页面里是 index.html 里的静态节点，桩里只有"由 JS 创建"的元素，
   所以这里手工造一批带 mock 高度的面板，让 syncColumns() 真正跑起来。
   mock 高度按页面实际观感估的，只用于验证「分栏行为」，不参与计分断言。 */
const MOCK_H = [92, 232, 232, 612, 402, 162, 232, 402, 122];
const PANEL_ORDER = ["选手", "临时招募", "通关时长加减分", "关卡通关加分", "源石锭",
                     "违规扣分", "击杀特殊敌人", "藏品与路线加分", "商店加分"];
const layoutEl = makeEl("div");
layoutEl.id = "layout";
layoutEl.className = "layout";
layoutEl.clientWidth = 1400;          // 起始给个「三栏」宽度
byId["layout"] = layoutEl;

const panelStubs = PANEL_ORDER.map((nm, i)=>{
  const p = makeEl("section");
  p.className = "panel";
  p.classList.add("panel");
  p.dataset.panelName = nm;
  p.mockHeight = MOCK_H[i];
  p.getBoundingClientRect = ()=>({ height: p.mockHeight, width: 400 });
  layoutEl.appendChild(p);
  return p;
});

// localStorage 桩（用于验证持久化）
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); }
};

eval(APP);

const B = global.window.BFC, S = B.state, E = B.EMERGENCY;

/** 取生成出来的、代表某个 key 的 toggle-row 节点 */
function row(key){ return allEls.find(e => e.dataset.toggle === key && e.className.split(" ")[0] === "toggle-row"); }
function click(key){ const r = row(key); clickHandlers.forEach(fn => fn({ target: r })); }
function blur(el){ blurHandlers.forEach(fn => fn({ target: el })); }
function type(el){ inputHandlers.forEach(fn => fn({ target: el })); }
/** 造一个「文本输入框」替身并按内容触发 input 事件 */
function textInput(id, value){
  return { id, value, matches: () => false };
}
/** 造一个「计次型输入框」替身（真实 DOM 里它由 renderCounterRow 以 innerHTML 生成，桩里取不到） */
function countInput(key, value){
  const e = makeEl("input");
  e.className = "count-input";
  e.dataset.key = key;
  e.value = value;
  return e;
}
function on(key){ return !!S.toggles[key]; }
function onList(){ return B.ALL_TOGGLES.filter(it => S.toggles[it.key]).map(it => it.key); }
function reset(){
  Object.keys(S.counts).forEach(k => S.counts[k] = 0);
  Object.keys(S.toggles).forEach(k => S.toggles[k] = false);
  S.playerName = "";
  S.rules = [];                    // 测试用例之间保持互不干扰（真实「归零」是保留规则的，另有专门断言）
  S.rulesLocked = false;           // 同上：锁定状态也保留，这里只是让用例彼此独立
  S.durH = 0; S.durM = 0;
  S.yuanStart = 0; S.yuanEnd = 0; S.yuanPrev = 0;
  // 齿轮弹框改过的余额也要复位，否则用例之间互相污染（真实「归零」是保留它的，另有断言）
  S.yuanInitPrelim = B.YUAN_INIT_PRELIM;
  S.yuanInitFinal  = B.YUAN_INIT_FINAL;
  S.settleScore = 0; S.partsCount = 0;
  B.renderRules();
  B.updateUI();
}

console.log("========== 1. 关卡通关加分：DOM 生成 ==========");
const em = byId["emergency-list"];
eq(em.children.length, 14, "生成 14 行（原站 12 项 + 新增「永无安宁」「普通·合伙人会议」）");
const labels = em.children.map(c => (c.innerHTML.match(/t-label">([^<]*)/) || [])[1]);
eq(labels[0], "赤金厄运", "第 1 行 = 赤金厄运");
eq(labels[2], "冰冷流亡", "第 3 行 = 冰冷流亡");
eq(labels[3], "永无安宁", "第 4 行 = 永无安宁（在混沌源阶理论之上）");
eq(labels[4], "混沌源阶理论", "第 5 行 = 混沌源阶理论");
eq(labels[5], "痛苦将息", "第 6 行 = 痛苦将息");
eq(labels[12], "普通·合伙人会议", "第 13 行 = 普通·合伙人会议（在紧急之上）");
eq(labels[13], "紧急·合伙人会议", "第 14 行 = 紧急·合伙人会议");
const vals = em.children.map(c => (c.innerHTML.match(/t-val">([^<]*)/) || [])[1]);
eq(vals[3], "+250", "永无安宁 分值 = +250");
eq(vals[12], "+50", "普通·合伙人会议 分值 = +50");
eq(vals[13], "+100", "紧急·合伙人会议 分值 = +100");
eq(em.children.filter(c => c.className.includes("sub")).length, 2, "有 2 个父子联动子项（.sub）");

console.log("\n========== 2. 原站分值逐项核对 ==========");
const REF = [
  ["stage_chijin", 200], ["stage_aidao", 160], ["stage_bingleng", 80],
  ["stage_yongwuanning", 250],
  ["stage_hundun", 300], ["stage_tongku", 350], ["stage_jizheng", 500],
  ["stage_boliweier", 100], ["stage_zhuijizheng", 50],
  ["stage_heidan_nao", 100], ["stage_heidan_mie", 120], ["stage_heidan_zong", 140],
  ["stage_hehuoren_n", 50], ["stage_hehuoren", 100]
];
REF.forEach(([k, s]) => eq(E.find(it => it.key === k).score, s, k + " = " + s));

console.log("\n========== 3. 单选合计 ==========");
reset();
click("stage_jizheng");                 eq(B.computeAll().emergency, 500, "只勾「畸症」= 500");
reset();
click("stage_boliweier");               eq(B.computeAll().emergency, 600, "点子项自动补勾父项：畸症500 + 玻利瓦尔100 = 600");
eq(on("stage_jizheng"), true, "父项「畸症」被自动勾上");
reset();
click("stage_jizheng"); click("stage_zhuijizheng");
eq(B.computeAll().emergency, 550, "畸症500 + 追猎50 = 550");

console.log("\n========== 4. 取消父项 → 级联取消子项 ==========");
reset();
click("stage_jizheng"); click("stage_boliweier");
eq(onList(), ["stage_jizheng", "stage_boliweier"], "两项已勾");
click("stage_jizheng");
eq(onList(), [], "取消「畸症」后子项一并取消");
eq(B.computeAll().emergency, 0, "小计归 0");

console.log("\n========== 5. 同组互斥：赤金组 ==========");
reset();
click("stage_chijin");
eq(B.computeAll().emergency, 200, "勾「赤金厄运」= 200");
click("stage_bingleng");
eq(onList(), ["stage_bingleng"], "再勾「冰冷流亡」→ 替换，赤金被取消");
eq(B.computeAll().emergency, 80, "小计 = 80");

console.log("\n========== 6. 黑诞三条不互斥（本项目改动：可叠加）==========");
reset();
eq(B.EMERGENCY.filter(it => it.key.startsWith("stage_heidan") && !it.group).length, 3,
   "黑诞三条都没有 group（数据层已解除互斥）");
click("stage_heidan_nao"); click("stage_heidan_zong");
eq(onList(), ["stage_heidan_nao", "stage_heidan_zong"], "先勾「闹乐」再勾「纵怒」，两项都在");
eq(B.computeAll().emergency, 240, "小计 = 100 + 140 = 240");
click("stage_heidan_mie");
eq(onList(), ["stage_heidan_nao", "stage_heidan_mie", "stage_heidan_zong"], "三条可以全部勾上");
eq(B.computeAll().emergency, 360, "小计 = 100 + 120 + 140 = 360");
eq([row("stage_heidan_nao").classList.contains("disabled"),
    row("stage_heidan_mie").classList.contains("disabled"),
    row("stage_heidan_zong").classList.contains("disabled")],
   [false, false, false], "三条都不灰化（同组灰化逻辑不再作用于黑诞）");
click("stage_heidan_nao");
eq(onList(), ["stage_heidan_mie", "stage_heidan_zong"], "再点一次可单独取消其中一条");
eq(B.computeAll().emergency, 260, "小计 = 120 + 140 = 260");

console.log("\n========== 6.5 同组互斥：混沌组（本项目新增的「永无安宁」三选一）==========");
reset();
click("stage_yongwuanning");
eq(B.computeAll().emergency, 250, "只勾「永无安宁」= 250");
click("stage_hundun");
eq(onList(), ["stage_hundun"], "再勾「混沌源阶理论」→ 永无安宁被取消");
eq(B.computeAll().emergency, 300, "小计 = 300");
click("stage_tongku");
eq(onList(), ["stage_tongku"], "再勾「痛苦将息」→ 混沌源阶理论被取消");
eq(B.computeAll().emergency, 350, "小计 = 350");
click("stage_yongwuanning");
eq(onList(), ["stage_yongwuanning"], "反向替换回「永无安宁」");
eq(B.computeAll().emergency, 250, "小计 = 250");
eq([row("stage_hundun").classList.contains("disabled"),
    row("stage_tongku").classList.contains("disabled"),
    row("stage_yongwuanning").classList.contains("disabled")],
   [true, true, false], "同组另两项灰化、当前项不灰化");

console.log("\n========== 7. 同组互斥：合伙人会议（本项目新增的组）==========");
reset();
click("stage_hehuoren_n");
eq(B.computeAll().emergency, 50, "只勾「普通·合伙人会议」= 50");
click("stage_hehuoren");
eq(onList(), ["stage_hehuoren"], "再勾「紧急」→ 自动替换普通");
eq(B.computeAll().emergency, 100, "小计 = 100");
click("stage_hehuoren_n");
eq(onList(), ["stage_hehuoren_n"], "反向替换回普通");
eq(B.computeAll().emergency, 50, "小计 = 50");

console.log("\n========== 8. 跨组不互斥 ==========");
reset();
click("stage_chijin"); click("stage_hundun"); click("stage_hehuoren");
eq(B.computeAll().emergency, 200 + 300 + 100, "三组各选一项可共存 = 600");
eq(onList().length, 3, "同时勾中 3 项");

console.log("\n========== 9. 全部勾满（每组取最高）==========");
reset();
["stage_chijin", "stage_tongku", "stage_jizheng", "stage_boliweier",
 "stage_zhuijizheng", "stage_heidan_zong", "stage_hehuoren"]
  .forEach(click);
eq(B.computeAll().emergency, 200 + 350 + 500 + 100 + 50 + 140 + 100, "合计 = 1440（互斥组各取一项）");
// 黑诞三条已不互斥：再补上另外两条照样累加
click("stage_heidan_nao"); click("stage_heidan_mie");
eq(B.computeAll().emergency, 1440 + 100 + 120, "再叠加黑诞·闹乐 + 灭身 → 1660");

console.log("\n========== 10. sanitizeToggles：脏状态自愈 ==========");
reset();
S.toggles.stage_chijin = true; S.toggles.stage_aidao = true; S.toggles.stage_bingleng = true;
S.toggles.stage_boliweier = true; S.toggles.stage_jizheng = false;
B.sanitizeToggles();
eq(onList(), ["stage_chijin"], "同组 3 个只留首个；父项未勾则子项清空");

console.log("\n========== 11. 商店加分栏目 ==========");
reset();
const kn = byId["kannuote-list"];
eq(kn.children.length, 1, "只生成 1 行");
eq((kn.children[0].innerHTML.match(/t-label">([^<]*)/) || [])[1], "【请坎诺特砍价】并获取全部藏品", "行标题正确");
eq((kn.children[0].innerHTML.match(/t-val">([^<]*)/) || [])[1], "+50", "分值 = +50");
eq(B.computeAll().kannuote, 0, "未勾选 = 0");
click("k_kannuote");
eq(B.computeAll().kannuote, 50, "勾选后 = +50");
eq(B.computeAll().emergency, 0, "不影响关卡通关小计");

console.log("\n========== 11.5 藏品与路线加分 ==========");
reset();
const rt = byId["route-list"];
eq(rt.children.length, 6, "生成 6 行");
const rLabels = rt.children.map(c => (c.innerHTML.match(/t-label">([^<]*)/) || [])[1]);
const rVals = rt.children.map(c => (c.innerHTML.match(/t-val">([^<]*)/) || [])[1]);
eq(rLabels[0], "在进入第五层前，于“失与得”节点换取【焚毁「文明」】", "第 1 行文案");
eq(rVals[0], "+200", "第 1 行 = +200");
eq(rLabels[1], "在进入第五层前，通关“无效验尸”获得【湮没「光明」】", "第 2 行文案");
eq(rVals[1], "+150", "第 2 行 = +150");
eq(rLabels[2], "在前三层，通关“无效验尸”获得【湮没「光明」】", "第 3 行文案");
eq(rVals[2], "+200", "第 3 行 = +200");
eq(rVals[3], "+100", "三连携带并通关 = +100");
eq(rVals[4], "+100", "命运所指 = +100");
eq(rVals[5], "+50", "沙盘α/β = +50");
eq(rt.children.filter(c => c.className.includes("sub")).length, 0, "本栏无父子子项");

reset();
click("r_fenmei");
eq(B.computeAll().route, 200, "只勾换取焚毁文明 = 200");
click("r_sanlian"); click("r_mingyun"); click("r_shapan");
eq(B.computeAll().route, 200 + 100 + 100 + 50, "四条可叠加 = 450");

console.log("\n--- 两条「无效验尸」互斥 ---");
reset();
click("r_wuxiao5");
eq(B.computeAll().route, 150, "只勾「五层前」= 150");
click("r_wuxiao3");
eq(onList().filter(k => k.startsWith("r_wuxiao")), ["r_wuxiao3"], "再勾「前三层」→ 五层前被取消");
eq(B.computeAll().route, 200, "小计 = 200");
click("r_wuxiao5");
eq(onList().filter(k => k.startsWith("r_wuxiao")), ["r_wuxiao5"], "反向替换回「五层前」");
eq(B.computeAll().route, 150, "小计 = 150");
eq([row("r_wuxiao3").classList.contains("disabled"),
    row("r_wuxiao5").classList.contains("disabled")], [true, false], "另项灰化、当前项不灰化");
eq(row("r_fenmei").classList.contains("disabled"), false, "跨板块的关卡项未被误伤（不灰化）");

console.log("\n--- 跨板块互斥组互不干扰 ---");
reset();
click("r_wuxiao3"); click("stage_chijin"); click("k_kannuote");
eq([B.computeAll().route, B.computeAll().emergency, B.computeAll().kannuote], [200, 200, 50],
   "藏品 200 / 关卡 200 / 商店 50 三项各记各的");

console.log("\n--- sanitizeToggles 覆盖藏品板块 ---");
Object.keys(S.toggles).forEach(k => S.toggles[k] = false);
S.toggles.r_wuxiao5 = true; S.toggles.r_wuxiao3 = true;
B.sanitizeToggles();
eq(onList().filter(k => k.startsWith("r_wuxiao")), ["r_wuxiao5"], "同组多选只留首个");

console.log("\n========== 12. 各小计独立 & 汇总 ==========");
reset();
click("stage_jizheng");            // 500
click("k_kannuote");               // 50
S.counts.six = 2; S.counts.sk_yajue = 3; S.counts.v_liuxing_extra = 1;
S.toggles.v_shiyude = true;
S.durH = 1; S.durM = 30;
S.yuanMode = "prelim"; S.yuanStart = 100; S.yuanEnd = 0;
const r = B.computeAll();
eq(r.recruit, 100, "招募 2×50 = 100");
eq(r.emergency, 500, "关卡通关 = 500");
eq(r.special, 60, "特殊敌人 3×20 = 60");
eq(r.violation, -260, "违规 -60 +(-200) = -260");
eq(r.duration, 60, "时长 1:30 → ≤2:00 档 +60");
eq(r.yuan, -2000, "源石锭 消耗100 → (60-100)×50 = -2000");
eq(r.kannuote, 50, "坎诺特 = 50");

console.log("\n========== 13. 通关结算：通关得分公式 ==========");
reset();
eq(byId["chenlun-list"].children.length, 1, "沉沦者只生成 1 行");
eq((byId["chenlun-list"].children[0].innerHTML.match(/t-val">([^<]*)/) || [])[1], "个人×1.3", "沉沦者徽标 = 个人×1.3");
eq((byId["chenlun-list"].children[0].innerHTML.match(/t-label">([^<]*)/) || [])[1],
   "沉沦者（特殊位）双沙盘三上贡全追猎通关", "沉沦者行文案");

// clearScore = (settle − parts×5) / 2
[[0,0],[100,0],[0,1],[30,4],[150,10],[75,10],[1000,100]].forEach(([s,p])=>{
  S.settleScore = s; S.partsCount = p;
  const exp = parseFloat(((s - p*5) / 2).toFixed(1));
  eq(B.computeAll().clearScore, exp, "结算分 "+s+" / 零件 "+p+" → 通关得分 "+exp);
});
S.settleScore = 2; S.partsCount = 1;   // (2−5)/2 = −1.5
eq(B.computeAll().clearScore, -1.5, "负值保留正确（-1.5）");

console.log("\n========== 14. 沉沦者 ×1.3 只作用于个人基础分 ==========");
reset();
S.settleScore = 1000; S.partsCount = 0;          // 通关得分 500
S.counts.six = 2;                                 // 招募 100
const base = B.computeAll();
eq(base.personalBase, 100 + 500, "个人基础分 = 100 + 500 = 600");
eq(base.multiplier, 1, "未勾沉沦者 → 倍率 1");
eq(base.total, 600, "总分 = 600");
click("r_chenlun");
const withChenlun = B.computeAll();
eq(withChenlun.multiplier, 1.3, "勾选后倍率 1.3");
eq(withChenlun.personalScore, 780, "600 × 1.3 = 780");
eq(withChenlun.total, 780, "总分 = 780");

console.log("\n--- 团队分：仅「决赛」拆分、不参与 ×1.3 ---");
reset();
S.counts.six = 1;                                  // 招募 50（个人）
click("stage_chijin");                             // 赤金厄运 200（团队项）
click("r_chenlun");
S.yuanMode = "final";
const mix = B.computeAll();
eq(mix.splitTeam, true, "决赛 → 拆分团队分");
eq(mix.teamScore, 200, "团队分 = 赤金厄运 200");
eq(mix.personalBase, 50, "个人基础分只剩招募 50");
eq(mix.personalScore, 65, "50 × 1.3 = 65");
eq(mix.total, 265, "总分 = 65 + 200 = 265（团队项未被放大）");

console.log("\n--- 团队分：初赛并入个人关卡分、照常 ×1.3 ---");
S.yuanMode = "prelim";
const mixP = B.computeAll();
eq(mixP.splitTeam, false, "初赛 → 不拆分团队分");
eq(mixP.teamScore, 0, "初赛团队分恒为 0");
eq(mixP.emergency, 200, "关卡小计仍是全量 200");
eq(mixP.personalBase, 250, "个人基础分 = 招募 50 + 关卡 200 = 250");
eq(mixP.personalScore, 325, "250 × 1.3 = 325（团队项照常被放大）");
eq(mixP.total, 325, "总分 = 325，不再单独加团队分");
B.updateUI();
const bdP = byId["breakdown"].innerHTML;
eq(bdP.indexOf("团队") === -1, true, "初赛明细不出现「团队」");
eq(/关卡 <b>\+200<\/b>/.test(bdP), true, "初赛明细把 200 显示在「关卡」里");
S.yuanMode = "final"; B.updateUI();
eq(byId["breakdown"].innerHTML.indexOf("团队") > -1, true, "决赛明细重新出现「团队」");
S.yuanMode = "prelim";

console.log("\n========== 15. 总分构成与 breakdown ==========");
reset();
S.counts.six = 1;            // +50
S.counts.sk_yajue = 1;       // +20
S.counts.v_liuxing_extra = 1;// -60
S.toggles.v_shiyude = true;  // -200
S.durH = 1; S.durM = 0;      // +60
S.yuanMode = "prelim"; S.yuanStart = 100; S.yuanEnd = 0;  // -2000
S.settleScore = 100; S.partsCount = 0;                    // +50
click("stage_jizheng");       // +500
click("r_shapan");            // +50
click("k_kannuote");          // +50
const r2 = B.computeAll();
eq(r2.recruit, 50, "招募 50");
eq(r2.emergency, 500, "关卡 500");
eq(r2.special, 20, "特敌 20");
eq(r2.violation, -260, "违规 -260");
eq(r2.yuan, -2000, "源石 -2000");
eq(r2.duration, 60, "时长 +60");
eq(r2.route, 50, "路线 50");
eq(r2.kannuote, 50, "商店 50");
eq(r2.clearScore, 50, "通关 50");
eq(r2.teamScore, 0, "无团队项 → 团队 0");
eq(r2.personalBase, 50 + 500 + 20 - 260 - 2000 + 60 + 50 + 50 + 50, "个人基础分 = -1480");
eq(r2.total, -1480, "总分 = -1480");
B.updateUI();
eq(byId["total-value"].textContent, "-1480", "总分显示 -1480");
eq(byId["total-value"].classList.contains("negative"), true, "负数时加 .negative 类");
const bd = byId["breakdown"].innerHTML;
eq((bd.match(/<span/g) || []).length, 9, "明细 9 项（无沉沦者、无团队）");
eq(bd.indexOf("商店") > -1, true, "明细含「商店」");
eq(bd.indexOf("团队") === -1, true, "明细不含「团队」");
eq(bd.indexOf("沉沦者") === -1, true, "未勾沉沦者时明细不含「沉沦者」");
click("r_chenlun"); B.updateUI();
eq(byId["breakdown"].innerHTML.indexOf("沉沦者") > -1, true, "勾选后明细出现「沉沦者 ×1.3」");

console.log("\n--- 小数格式化 ---");
reset();
S.settleScore = 35; S.partsCount = 0;   // (35−0)/2 = 17.5
B.updateUI();
eq(B.computeAll().clearScore, 17.5, "通关得分 17.5");
eq(byId["total-value"].textContent, "17.5", "总分显示 17.5 而非 17.50");

console.log("\n========== 16. 归零按钮 ==========");
reset();
S.counts.six = 3; S.counts.sk_yajue = 2; S.counts.v_liuxing_extra = 1;
S.toggles.v_shiyude = true; S.toggles.r_chenlun = true;
S.durH = 3; S.durM = 40;
S.yuanStart = 500; S.yuanEnd = 100; S.yuanPrev = 30;
S.settleScore = 800; S.partsCount = 12;
click("stage_jizheng"); click("r_shapan"); click("k_kannuote");
B.updateUI();
eq(B.computeAll().total !== 0, true, "归零前总分非 0");
byId["btn-reset"].handlers.click();
const z = B.computeAll();
eq(z.total, 0, "归零后总分 = 0");
eq(z.recruit, 0, "招募归零");
eq(z.emergency, 0, "关卡归零");
eq(z.special, 0, "特敌归零");
eq(z.violation, 0, "违规归零");
eq(z.yuan, 0, "源石归零");
eq(z.duration, 0, "时长归零");
eq(z.clearScore, 0, "通关得分归零");
eq(z.route, 0, "路线归零");
eq(z.kannuote, 0, "商店归零");
eq(z.chenlun, false, "沉沦者取消");
eq([S.durH, S.durM, S.yuanStart, S.yuanEnd, S.yuanPrev, S.settleScore, S.partsCount],
   [0,0,0,0,0,0,0], "全部输入型状态复位");
eq(Object.keys(S.toggles).filter(k => S.toggles[k]), [], "所有开关关闭");
eq(byId["total-value"].textContent, "0", "总分显示归 0");

console.log("\n========== 17. localStorage 持久化 ==========");
eq(typeof B.STORAGE_KEY, "string", "暴露 STORAGE_KEY");
eq(B.STORAGE_KEY !== "hlsh_counter_v1", true, "key 与原站区分，不会互相覆盖");

// 17a. 每次 updateUI 都会写盘
reset();
eq(store[B.STORAGE_KEY] !== undefined, true, "updateUI 后已写入存档");

// 17b. 保存 → 清空内存 → 载入 的完整往返
reset();
S.counts.six = 3; S.counts.sk_yajue = 2; S.counts.v_liuxing_extra = 1;
S.toggles.v_shiyude = true;
S.durH = 1; S.durM = 45;
S.yuanMode = "final"; S.yuanStart = 300; S.yuanEnd = 120; S.yuanPrev = 25;
S.settleScore = 640; S.partsCount = 8;
click("stage_tongku"); click("r_wuxiao3"); click("k_kannuote"); click("r_chenlun");
B.updateUI();
const before = B.computeAll();
const beforeState = JSON.parse(JSON.stringify(S));

// 模拟刷新：把内存状态清掉，再从存档载入
Object.keys(S.counts).forEach(k => S.counts[k] = 0);
Object.keys(S.toggles).forEach(k => S.toggles[k] = false);
S.durH = 0; S.durM = 0; S.yuanStart = 0; S.yuanEnd = 0; S.yuanPrev = 0;
S.yuanMode = "prelim"; S.settleScore = 0; S.partsCount = 0;
eq(B.computeAll().total !== before.total, true, "清空后总分确实变了");

B.load();
B.syncDOM();
B.updateUI();
const after = B.computeAll();
eq(JSON.parse(JSON.stringify(S)), beforeState, "往返后 state 与存档前逐字段一致");
eq(after.total, before.total, "往返后总分一致（" + before.total + "）");
eq(after.recruit, before.recruit, "招募恢复");
eq(after.route, before.route, "藏品与路线恢复（互斥组也恢复正确）");
eq(after.chenlun, true, "沉沦者恢复");
eq(S.yuanMode, "final", "源石锭模式恢复为决赛");

// 17c. 反序列化后仍是合法状态：互斥组没有多选、黑诞三条不该被清掉
S.toggles.stage_chijin = true; S.toggles.stage_aidao = true;            // 赤金组：互斥
S.toggles.stage_heidan_nao = true; S.toggles.stage_heidan_mie = true;
S.toggles.stage_heidan_zong = true;                                     // 黑诞组：已解除互斥
B.sanitizeToggles();
eq(onList().filter(k => k.startsWith("stage_chijin")).length, 1,
   "反序列化后互斥组（赤金组）仍只留一项");
eq(onList().filter(k => k.startsWith("stage_heidan")).length, 3,
   "黑诞三条不互斥，反序列化后仍全部保留");

// 17d. 非法/缺字段的存档不应污染状态
const cleanState = JSON.parse(JSON.stringify(S));
store[B.STORAGE_KEY] = "{ 这不是合法 JSON";
B.load();
eq(JSON.parse(JSON.stringify(S)), cleanState, "存档损坏时 load() 静默跳过，状态不变");
store[B.STORAGE_KEY] = JSON.stringify({ counts: { six: -5, 不存在的键: 999 }, toggles: null, durH: "abc", yuanMode: "乱写" });
B.load();
eq(S.counts.six, 0, "负数计数被夹到 0");
eq("不存在的键" in S.counts, false, "存档里的未知键被忽略");
eq(S.durH, cleanState.durH, "非数字的时长被忽略，保持原值");
eq(S.yuanMode, cleanState.yuanMode, "非法模式值被忽略");

// 17e. 归零会把清空后的状态写回存档
reset();
byId["btn-reset"].handlers.click();
eq(JSON.parse(store[B.STORAGE_KEY]).counts.six, 0, "归零后存档里的计数也是 0");
eq(JSON.parse(store[B.STORAGE_KEY]).toggles.r_chenlun, false, "归零后存档里的开关也是关闭");

console.log("\n========== 18. 输入框清空后失焦自动归零 ==========");
eq(blurHandlers.length, 1, "已注册 focusout 监听");

reset();

console.log("--- 计次型输入框 ---");
S.counts.six = 5; B.updateUI();
const ci = countInput("six", "");          // 用户把内容全删了
eq(B.computeAll().recruit, 250, "清空前招募小计 5×50 = 250");
blur(ci);
eq(String(ci.value), "0", "失焦后输入框回填 0");
eq(S.counts.six, 0, "state 归零");
eq(B.computeAll().recruit, 0, "招募小计归零");

console.log("--- 通关时长 ---");
S.durH = 3; S.durM = 0; B.updateUI();
eq(B.computeAll().duration, 0, "3:00 落在「无加减」档");
byId["dur-h"].value = "";
blur(byId["dur-h"]);
eq(String(byId["dur-h"].value), "0", "小时框回填 0");
eq(S.durH, 0, "durH 归零");
eq(byId["dur-total"].textContent, "未填写", "合计显示「未填写」");

console.log("--- 结算分 / 零件数量 ---");
S.settleScore = 300; S.partsCount = 4; B.updateUI();
eq(B.computeAll().clearScore, 140, "(300−20)/2 = 140");
byId["parts-count"].value = "";
blur(byId["parts-count"]);
eq(String(byId["parts-count"].value), "0", "零件框回填 0");
eq(S.partsCount, 0, "partsCount 归零");
eq(B.computeAll().clearScore, 150, "通关得分重算 = 150");

console.log("--- 源石锭 ---");
S.yuanMode = "prelim"; S.yuanStart = 200; B.updateUI();
byId["yuan-start"].value = "";
blur(byId["yuan-start"]);
eq(S.yuanStart, 0, "yuanStart 归零");
eq(B.computeAll().yuan, 0, "未消耗 → 无扣分");

console.log("--- 非空 / 合法值不应被动 ---");
byId["yuan-start"].value = "200";
blur(byId["yuan-start"]);
eq(S.yuanStart, 200, "填了 200 失焦后仍是 200");
eq(String(byId["yuan-start"].value), "200", "显示保持 200");
byId["yuan-start"].value = "  120  ";
blur(byId["yuan-start"]);
eq(S.yuanStart, 120, "带空格的值能正确解析");
byId["yuan-end"].value = "-7";
blur(byId["yuan-end"]);
eq(S.yuanEnd, 0, "负数失焦夹到 0");
eq(String(byId["yuan-end"].value), "0", "显示也回填 0");
byId["yuan-end"].value = "0";
blur(byId["yuan-end"]);
eq(S.yuanEnd, 0, "本来就填 0 不受影响");
byId["yuan-end"].value = "abc";
blur(byId["yuan-end"]);
eq(S.yuanEnd, 0, "非数字失焦归 0");

console.log("--- 非本页输入框不受影响 ---");
blur({ id: "some-other-input", value: "", matches: () => false });
eq(true, true, "无关元素失焦不报错");
blur({ value: "", matches: () => false });   // 连 id 都没有
eq(true, true, "缺少 id 的元素失焦不报错");

console.log("\n========== 19. 选手栏目 ==========");
reset();
eq(S.playerName, "", "初始为空串");
eq(typeof S.playerName, "string", "类型是字符串");

// 输入即写入
type(textInput("player-name", "祁星"));
eq(S.playerName, "祁星", "输入后写入 state");
type(textInput("player-name", ""));     // 清空应当允许，不能强填 0
eq(S.playerName, "", "清空后是空串（不会像数字框那样被填 0）");
type(textInput("player-name", "  Vin ce  "));
eq(S.playerName, "  Vin ce  ", "原样保存，不 trim、不改写（含空格与英文）");

// 不参与计分
type(textInput("player-name", "祁星"));
S.counts.six = 1;
eq(B.computeAll().recruit, 50, "选手名不影响任何分数");
eq(B.computeAll().total, 50, "总分只由分数项决定");
eq("playerName" in B.computeAll(), false, "computeAll 不返回选手名（它不属于计分）");

// 持久化往返
B.updateUI();
eq(JSON.parse(store[B.STORAGE_KEY]).playerName, "祁星", "选手名已写入存档");
S.playerName = "";
B.load(); B.syncDOM();
eq(S.playerName, "祁星", "刷新后从存档恢复");
eq(String(byId["player-name"].value), "祁星", "输入框也回填");
eq(byId["player-name"].value !== 0, true, "回填的是字符串而非数字 0");

// 坏存档中的选手名
store[B.STORAGE_KEY] = JSON.stringify({ playerName: 12345 });
S.playerName = "原值";
B.load();
eq(S.playerName, "原值", "存档里 playerName 不是字符串时被忽略");

// 归零会清空选手名
S.playerName = "祁星";
byId["player-name"].value = "祁星";
B.updateUI();
byId["btn-reset"].handlers.click();
eq(S.playerName, "", "归零清空选手名");
eq(String(byId["player-name"].value), "", "输入框同步清空");

console.log("--- 总分区顶部的选手名行（未填时显示 Player，不再整行隐藏）---");
reset();
B.updateUI();
eq(byId["total-name"].textContent, "Player", "未填选手名 → 显示占位名 Player");
type(textInput("player-name", "祁星"));
B.updateUI();
eq(byId["total-name"].textContent, "祁星", "填了名字 → 内容 = 选手名");
type(textInput("player-name", ""));
B.updateUI();
eq(byId["total-name"].textContent, "Player", "清空后回到 Player");
type(textInput("player-name", "   "));
B.updateUI();
eq(byId["total-name"].textContent, "Player", "只填空格也视为未填 → Player");
type(textInput("player-name", "Vin ce"));
B.updateUI();
eq(byId["total-name"].textContent, "Vin ce", "含空格的名字原样显示");
byId["btn-reset"].handlers.click();
eq(byId["total-name"].textContent, "Player", "归零后回到 Player");

console.log("--- index.html 结构位置（静态检查）---");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const iName = html.indexOf('id="total-name"');
const iTotal = html.indexOf('id="total-value"');
eq(iName > -1, true, "存在 #total-name");
eq(iName < iTotal, true, "选手名行位于总分数字 #total-value 之前（即上方）");
eq(iName > html.indexOf('class="total-section"'), true, "选手名行位于 .total-section 之内");
eq(iName > html.indexOf("<h2>通关结算</h2>"), true, "选手名行位于「通关结算」栏目内");
eq(html.indexOf("<h2>选手</h2>") < html.indexOf("<h2>临时招募</h2>"), true, "「选手」栏位于「临时招募」之上");
eq(html.indexOf("<h2>选手</h2>") > html.indexOf('id="layout"'), true, "「选手」栏在 #layout 之内");
eq(html.indexOf('id="total-name"') < html.indexOf('id="breakdown"'), true, "选手名行在分项明细之前");

// #total-name 的初始文案与属性
{
  const tagStart = html.lastIndexOf("<", iName);
  const tagEnd = html.indexOf(">", iName);
  const tag = html.slice(tagStart, tagEnd + 1);
  const inner = html.slice(tagEnd + 1, html.indexOf("<", tagEnd + 1));
  eq(/\bhidden\b/.test(tag), false, "#total-name 标签上已无 hidden 属性（改为始终显示）");
  eq(inner, "Player", "index.html 里预置的初始文案就是 Player（JS 未跑时也不为空）");
}

console.log("--- index.html：通关结算并排两列结构（静态检查）---");
const iGrid = html.indexOf('class="total-grid"');
const iLeft = html.indexOf('class="total-left"');
const iSec  = html.indexOf('class="total-section"');
eq(iGrid > -1, true, "存在 .total-grid 两列容器");
eq(iLeft > iGrid, true, ".total-left 在 .total-grid 之内");
eq(iSec > iLeft, true, ".total-section 在 .total-left 之后（DOM 顺序 = 左 → 右）");
// 左列装：结算输入 + 通关得分小计 + 沉沦者
["settle-score", "parts-count", "chenlun-list"].forEach(function(id){
  const i = html.indexOf('id="' + id + '"');
  eq(i > iLeft && i < iSec, true, "#" + id + " 在左列 .total-left 之内");
});
eq(html.indexOf('data-sub="clearscore"') > iLeft && html.indexOf('data-sub="clearscore"') < iSec, true,
   "「通关得分」小计在左列之内");
// 右列装：选手名 + 总分 + 明细 + 归零
["total-name", "total-value", "breakdown", "btn-reset"].forEach(function(id){
  const i = html.indexOf('id="' + id + '"');
  eq(i > iSec, true, "#" + id + " 在右列 .total-section 之内");
});
eq(html.indexOf("通关得分 =（结算分 − 零件数量 × 5）÷ 2") > iLeft, true, "公式提示在左列之内");

console.log("\n========== 20. 自适应分栏（3 / 2 / 1 列） ==========");
const setW = w => { layoutEl.clientWidth = w; };
const cols  = ()=>B.getLayoutColumns();
const panes = ()=>cols().map(c => c.children.map(p => p.dataset.panelName));
const flat  = ()=>[].concat.apply([], panes());
function inversions(seq){
  let inv = 0;
  for(let a=0;a<seq.length;a++)
    for(let b=a+1;b<seq.length;b++) if(seq[a] > seq[b]) inv++;
  return inv;
}
const growCount = ()=>panelStubs.filter(p => p.classList.contains("grow")).length;
const orderOf   = ()=>flat().map(n => PANEL_ORDER.indexOf(n));
// 各栏自然高度 = 栏内面板高之和 + (块数 − 1) 个间距
const colSum = ()=>cols().map(c => c.children.reduce((a, p)=>a + p.mockHeight, 0)
                           + Math.max(0, c.children.length - 1) * 10);
/* 校验「底边对齐」的分摊方式：
   最高栏不拉伸；其余各栏每一块都参与，且 flex-grow 与自然高度成正比
   → 各块拉伸幅度一致，不会出现某一块被单独拉出大空洞 */
function checkStretch(label){
  const cs = colSum();
  const tall = cs.indexOf(Math.max.apply(null, cs));
  let grown = 0;
  cols().forEach(function(c, ci){
    if(ci === tall){
      eq(c.children.every(p => !p.classList.contains("grow")), true,
         label + "：最高栏（第" + (tall + 1) + "栏）不拉伸");
      return;
    }
    if(!c.children.length) return;
    const hs = c.children.map(p => p.mockHeight);
    const sumH = hs.reduce((a, b)=>a + b, 0);
    const gs = c.children.map(p => parseFloat(p.style.flexGrow));
    eq(c.children.every(p => p.classList.contains("grow")), true,
       label + "：第" + (ci + 1) + "栏每块都参与分摊（而不是只拉最后一块）");
    eq(gs.every(g => g > 0), true, label + "：第" + (ci + 1) + "栏 flex-grow 均 > 0");
    eq(Math.abs(gs.reduce((a, b)=>a + b, 0) - 1) < 1e-6, true,
       label + "：第" + (ci + 1) + "栏 flex-grow 之和为 1");
    eq(gs.every((g, k)=>Math.abs(g - hs[k] / sumH) < 1e-3), true,
       label + "：第" + (ci + 1) + "栏按自然高度占比分摊");
    grown += c.children.length;
  });
  eq(growCount(), grown, label + "：共 " + grown + " 块参与分摊");
  // 该栏内每一块的拉伸幅度（百分比）应完全一致
  const pcts = cols().map(function(c, ci){
    if(ci === tall || !c.children.length) return 0;
    return (cs[tall] - cs[ci]) / c.children.reduce((a, p)=>a + p.mockHeight, 0) * 100;
  });
  const maxPct = Math.max.apply(null, pcts);
  eq(maxPct < 35, true, label + "：单块最大拉伸幅度 " + maxPct.toFixed(1) + "% < 35%");
  return tall;
}

console.log("--- 栏数阈值（容器宽度 → 栏数）---");
[[1400,3],[1140,3],[1139,2],[900,2],[720,2],[719,1],[600,1],[360,1],[240,1]].forEach(function(pair){
  setW(pair[0]);
  eq(B.pickColumnCount(), pair[1], "容器 " + pair[0] + "px → " + pair[1] + " 列");
});

console.log("--- 三栏（全屏）---");
setW(1400); B.syncColumns(true);
eq(B.getColCount(), 3, "1400px → 3 列");
eq(cols().length, 3, "生成 3 个栏容器");
eq(layoutEl.style.props["--cols"], 3, "写入 CSS 变量 --cols = 3");
eq(flat().length, 9, "9 块面板一块不少");
eq(new Set(flat()).size, 9, "9 块面板互不重复");
eq(panes()[0][0], "选手", "第 1 栏第 1 块 = 选手（页面左上角）");
eq(panes().every(c => c.length > 0), true, "没有空栏");
checkStretch("三栏");
eq(growCount() >= 3, true, "至少 3 块参与分摊");
const inv3 = inversions(orderOf());
eq(inv3 <= 3, true, "阅读顺序基本保持（三栏逆序对 " + inv3 + " ≤ 3）");
const h3 = colSum();
eq(Math.max.apply(null, h3) - Math.min.apply(null, h3) <= 200, true,
   "三栏自然高度接近（极差 " + (Math.max.apply(null, h3) - Math.min.apply(null, h3)) + "px ≤ 200）");

console.log("--- 两栏（中等窗口）---");
setW(960); B.syncColumns(true);
eq(B.getColCount(), 2, "960px → 2 列");
eq(layoutEl.style.props["--cols"], 2, "--cols = 2");
eq(flat().length, 9, "9 块面板一块不少");
eq(new Set(flat()).size, 9, "9 块面板互不重复");
eq(panes()[0][0], "选手", "第 1 栏第 1 块仍是选手");
checkStretch("两栏");
eq(inversions(orderOf()) <= 3, true, "阅读顺序基本保持（两栏逆序对 " + inversions(orderOf()) + " ≤ 3）");
const h2 = colSum();
eq(Math.max.apply(null, h2) - Math.min.apply(null, h2) <= 200, true,
   "两栏自然高度接近（极差 " + (Math.max.apply(null, h2) - Math.min.apply(null, h2)) + "px ≤ 200）");

console.log("--- 单栏（窄窗口）---");
setW(560); B.syncColumns(true);
eq(B.getColCount(), 1, "560px → 1 列");
eq(layoutEl.style.props["--cols"], 1, "--cols = 1");
eq(flat(), PANEL_ORDER, "单栏时严格保持原始 DOM 顺序");
eq(growCount(), 0, "单栏不拉长任何面板（无需对齐底边）");

console.log("--- 来回切换时 .grow / flex-grow 不残留 ---");
setW(1400); B.syncColumns(true);
const grow3 = growCount();
eq(grow3 >= 3, true, "3 栏 → " + grow3 + " 块参与分摊");
const fg3 = panelStubs.map(p => p.style.flexGrow);
eq(fg3.filter(v => v !== "" && v != null).length, grow3, "有 .grow 的块才带 flex-grow");
setW(560);  B.syncColumns(true);
eq(growCount(), 0, "切回单栏 → 旧 .grow 被清掉");
eq(panelStubs.every(p => p.style.flexGrow === "" || p.style.flexGrow == null), true,
   "切回单栏 → 旧的 flex-grow 也被清掉（不会残留脏样式）");
setW(1400); B.syncColumns(true);
eq(growCount(), grow3, "再切回 3 栏仍正确");
checkStretch("切回三栏");

console.log("--- 栏数不变时不重建 DOM ---");
const colRef = cols()[0];
B.syncColumns(false);
eq(cols()[0] === colRef, true, "宽度未跨阈值 → 不重建（拖动窗口时面板不乱跳）");
setW(560); B.syncColumns(false);
eq(B.getColCount(), 1, "跨过阈值 → 切为 1 列");
eq(cols()[0] === colRef, false, "跨阈值时才重建 DOM");

setW(1400); B.syncColumns(true);   // 复原成三栏

console.log("--- index.html 结构（静态检查）---");
const iLayout2 = html.indexOf('id="layout"');
eq(iLayout2 > -1, true, "存在 #layout 容器");
PANEL_ORDER.forEach(function(nm){
  /* ⚠️ 用「前缀」而不是完整的 `<h2>X</h2>` 去匹配：
     源石锭的标题右侧挂了一个齿轮按钮（`<h2>源石锭<button …>`），
     完整闭合标签在此会失手（2026-09-25 加齿轮后踩到）。 */
  eq(html.indexOf("<h2>" + nm) > iLayout2, true, "「" + nm + "」在 #layout 之内");
});
const iTotalPanel = html.indexOf("total-panel");
eq(iTotalPanel > html.indexOf("<h2>商店加分</h2>"), true, "通关结算面板在 #layout 之后（横跨整幅）");

console.log("--- css 由 --cols 驱动 ---");
const css = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
eq(/grid-template-columns\s*:\s*repeat\(var\(--cols\)/.test(css), true, "列数由 CSS 变量 --cols 驱动");
eq(css.indexOf("max-width:1180px") === -1, true, "旧的 1180px 单列断点已移除（改由 JS 决定栏数）");
eq(/\.panel\.grow\s*\{[^}]*flex-grow:1/.test(css), true, ".panel.grow 用 flex-grow 分摊高度差");
eq(/\.panel\.grow\s+\.subtotal\s*\{[^}]*margin-top:auto/.test(css), true, ".grow 面板的小计被推到贴底");

console.log("--- css：通关结算并排两列 ---");
eq(/\.total-grid\s*\{[^}]*display:grid/.test(css), true, ".total-grid 是 grid");
eq(/\.total-grid\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,1fr\)\s+minmax\(0,1fr\)/.test(css), true,
   ".total-grid 等宽两列");
eq(/\.total-section\s*\{[^}]*border-left:1px dashed/.test(css), true, "右列左侧有分隔虚线");
eq(/\.total-section\s*\{[^}]*justify-content:center/.test(css), true, "右列内容垂直居中");
eq(/@media \(max-width:720px\)\{[\s\S]*?\.total-grid\{[^}]*grid-template-columns:1fr/.test(css), true,
   "窄屏（≤720px）两列堆叠成上下");
eq(/@media \(max-width:720px\)\{[\s\S]*?\.total-section\{[^}]*border-left:none/.test(css), true,
   "窄屏时右列的左侧分隔线撤掉、改为上分隔线");

console.log("\n========== 21. 导出 / 导入 txt 存档 ==========");
eq(typeof B.buildExportText, "function", "暴露 buildExportText");
eq(typeof B.parseExportText, "function", "暴露 parseExportText");
eq(typeof B.applyImported, "function", "暴露 applyImported");
eq(typeof B.exportFileName, "function", "暴露 exportFileName");
eq(typeof B.clearState, "function", "暴露 clearState");
eq(B.IMPORT_FAIL_MSG.indexOf("文件格式有误") > -1, true, "失败提示语包含「文件格式有误」");

console.log("--- index.html：导出 / 归零 / 导入 三个按钮 ---");
{
  const tagOf = id => {
    const i = html.indexOf('id="' + id + '"');
    return i < 0 ? "" : html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
  };
  const iExp = html.indexOf('id="btn-export"');
  const iRst = html.indexOf('id="btn-reset"');
  const iImp = html.indexOf('id="btn-import"');
  eq(iExp > -1 && iRst > -1 && iImp > -1, true, "三个按钮都存在");
  eq(iExp < iRst && iRst < iImp, true, "DOM 顺序：导出 → 归零 → 导入");
  eq(/class="[^"]*\bgreen\b/.test(tagOf("btn-export")), true, "「导出」按钮带 .green（绿）");
  eq(/class="[^"]*\bblue\b/.test(tagOf("btn-import")), true, "「导入」按钮带 .blue（蓝）");
  eq(/class="[^"]*\bdanger\b/.test(tagOf("btn-reset")), true, "「归零」仍是 .danger");
  eq(typeof byId["btn-export"].handlers.click, "function", "导出按钮已绑定点击");
  eq(typeof byId["btn-import"].handlers.click, "function", "导入按钮已绑定点击");
}

console.log("--- css：绿 / 蓝按钮样式 ---");
eq(/--info\s*:\s*#/.test(css), true, "调色板里新增了蓝色变量 --info");
eq(/\.big-btn\.green\s*\{[^}]*color:var\(--accent-3\)/.test(css), true, ".big-btn.green 用绿色（--accent-3）");
eq(/\.big-btn\.blue\s*\{[^}]*color:var\(--info\)/.test(css), true, ".big-btn.blue 用蓝色（--info）");

console.log("--- 导出文本内容 ---");
reset();
S.playerName = "祁星";
S.counts.six = 2; S.counts.five = 1; S.counts.sk_yajue = 3; S.counts.v_liuxing_extra = 1;
S.toggles.v_shiyude = true; S.toggles.stage_chijin = true;
S.toggles.r_shapan = true; S.toggles.k_kannuote = true; S.toggles.r_chenlun = true;
S.durH = 1; S.durM = 30;
S.yuanMode = "final"; S.yuanStart = 300; S.yuanEnd = 120; S.yuanPrev = 25;
S.settleScore = 1000; S.partsCount = 12;
B.updateUI();

const txt = B.buildExportText();
const lines = txt.split("\r\n");
const snap = B.computeAll();

eq(txt.indexOf("\r\n") > -1, true, "用 CRLF 换行（Windows 记事本友好）");
eq(lines[lines.length - 1].lastIndexOf("DATA:", 0) === 0, true, "最后一行是 DATA: 数据行");
eq(lines.filter(l => l.lastIndexOf("DATA:", 0) === 0).length, 1, "全文件只有一行 DATA:");
["选手", "赛事规则", "临时招募", "通关时长加减分", "关卡通关加分", "源石锭", "违规扣分",
 "击杀特殊敌人", "藏品与路线加分", "商店加分", "通关结算", "总分"].forEach(function(nm){
  eq(txt.indexOf("【" + nm + "】") > -1, true, "有【" + nm + "】区块");
});
eq(txt.indexOf("祁星") > -1, true, "导出内容含选手名");
eq(txt.indexOf("（结算分 − 零件数量 × 5）÷ 2") > -1, true, "通关得分那行附了公式");
eq(txt.indexOf("×1.3") > -1, true, "含沉沦者倍率");
eq(txt.indexOf("已勾选") > -1, true, "勾选项标注为「已勾选」");

// 「标签 ....... 值」对齐行
const totalLine = lines.filter(l => /^ {2}总分 \.+ /.test(l))[0] || "";
eq(totalLine.length > 0, true, "有「总分 ....... 值」这一行");
eq(totalLine.indexOf(B.fmtNum(snap.total)) > -1, true, "总分行里带上了总分值 " + B.fmtNum(snap.total));

// 每个条目都导出了
eq(lines.filter(l => /^ {2}\[[√ ]\] /.test(l)).length,
   B.EMERGENCY.length + B.ROUTE_BONUS.length + B.KANNUOTE.length + B.VIOLATION_TOGGLES.length,
   "所有关卡/藏品/商店/违规勾选项都出现在 txt 里");
eq(lines.filter(l => /个 × /.test(l)).length,
   B.RECRUIT.length + B.VIOLATION_COUNTERS.length + B.SPECIAL_KILLS.length,
   "所有计次型条目都出现在 txt 里");
eq(lines.filter(l => /沉沦者.*(已勾选|未勾选)/.test(l)).length, 1, "沉沦者按已勾选/未勾选导出");

console.log("--- 数据行内容 ---");
const payload = JSON.parse(txt.slice(txt.lastIndexOf("DATA:") + 5));
eq(payload.v, B.EXPORT_VERSION, "带格式版本号");
eq(payload.playerName, "祁星", "选手名");
eq(payload.counts.six, 2, "六星数量");
eq(payload.counts.sk_yajue, 3, "鸭爵击杀数");
eq(payload.toggles.stage_chijin, true, "关卡勾选");
eq(payload.toggles.r_chenlun, true, "沉沦者勾选");
eq(payload.toggles.v_shiyude, true, "违规开关");
eq([payload.durH, payload.durM], [1, 30], "通关时长");
eq([payload.yuanMode, payload.yuanStart, payload.yuanEnd, payload.yuanPrev], ["final", 300, 120, 25], "源石锭四项");
eq([payload.settleScore, payload.partsCount], [1000, 12], "通关结算两项");

console.log("--- 团队分行跟着源石锭模式走 ---");
eq(txt.indexOf("团队得分") > -1, true, "决赛导出含「团队得分」一行");
eq(txt.indexOf("个人基础分 × 倍率 + 团队得分") > -1, true, "决赛总分行公式带团队分");
S.yuanMode = "prelim";
const txtP = B.buildExportText();
eq(txtP.indexOf("团队得分") === -1, true, "初赛导出不出现「团队得分」");
eq(txtP.indexOf("+ 团队得分") === -1, true, "初赛总分公式不带团队分");
eq(txtP.indexOf("（= 个人基础分 × 倍率）") > -1, true, "初赛总分公式 = 个人基础分 × 倍率");
eq(JSON.parse(txtP.slice(txtP.lastIndexOf("DATA:") + 5)).yuanMode, "prelim", "初赛的 yuanMode 照样写进 DATA 行");
S.yuanMode = "final";

console.log("--- 往返：导出 → 清空 → 导入 ---");
const beforeTotal = snap.total;
const rtState = JSON.parse(JSON.stringify(S));
reset();
eq(B.computeAll().total !== beforeTotal, true, "清空后总分确实变了");
B.applyImported(B.parseExportText(txt));
B.sanitizeToggles(); B.syncDOM(); B.updateUI();
eq(JSON.parse(JSON.stringify(S)), rtState, "往返后 state 逐字段一致");
eq(B.computeAll().total, beforeTotal, "往返后总分一致（" + beforeTotal + "）");
eq(String(byId["player-name"].value), "祁星", "选手名输入框回填");
eq(byId["total-name"].textContent, "祁星", "总分上方显示选手名");
eq(row("stage_chijin").classList.contains("active"), true, "勾选项高亮恢复");
eq(byId["yuan-final"].hidden, false, "源石锭回到决赛模式");
eq(byId["yuan-prev"].value, 25, "决赛专用输入框也回填");

console.log("--- 解析容错 ---");
eq(B.parseExportText("\ufeff" + txt).playerName, "祁星", "带 UTF-8 BOM 也能解析");
eq(B.parseExportText(txt.replace(/\r\n/g, "\n")).playerName, "祁星", "LF 换行也能解析");
eq(B.parseExportText("随便一段前言\n" + txt + "\n后面还有尾巴").playerName, "祁星", "前后多出文字也能解析");

console.log("--- 格式错误一律抛错（会弹「文件格式有误」）---");
[["", "空文件"],
 ["这不是计分存档", "完全没有 DATA 行"],
 ["DATA:这不是 JSON", "数据行不是合法 JSON"],
 ["DATA:[1,2,3]", "数据是数组"],
 ["DATA:null", "数据是 null"],
 ["DATA:{}", "缺少格式版本号"],
 ['DATA:{"v":1}', "缺少计分数据"]
].forEach(function(pair){
  let threw = false, msg = "";
  try{ B.parseExportText(pair[0]); }catch(e){ threw = true; msg = e.message; }
  eq(threw, true, pair[1] + " → 抛错（" + msg + "）");
});

console.log("--- 导入是「整体替换」而不是「合并」---");
reset();
S.counts.six = 9; S.toggles.stage_chijin = true; S.playerName = "旧名字"; S.durH = 5; S.settleScore = 700;
B.applyImported({ v:1, counts:{}, toggles:{}, playerName:"新名字" });
eq(S.counts.six, 0, "文件里没写的计次项被清零");
eq(S.toggles.stage_chijin, false, "文件里没写的开关被关闭");
eq(S.playerName, "新名字", "选手名被覆盖");
eq(S.durH, 0, "文件里没写的数值字段被清零");
eq(S.settleScore, 0, "结算分也被清零");

console.log("--- 导入脏数据被挡住 ---");
B.applyImported({ v:1, counts:{ six:-5, "不存在的键":9 }, toggles:{ "不存在的开关":true }, durH:"abc" });
eq(S.counts.six, 0, "负数计数被夹到 0");
eq("不存在的键" in S.counts, false, "未知计次键被忽略");
eq("不存在的开关" in S.toggles, false, "未知开关被忽略");
eq(S.durH, 0, "非数字数值被忽略");
S.yuanMode = "final";
B.applyImported({ v:1, counts:{}, toggles:{}, yuanMode:"乱写" });
eq(S.yuanMode, "final", "非法模式值被忽略，保持原值");

console.log("--- 导出文件名 ---");
reset();
eq(/\.txt$/.test(B.exportFileName()), true, "以 .txt 结尾");
eq(B.exportFileName().indexOf("Player") > -1, true, "未填选手名时用 Player 占位");
S.playerName = "祁/星:a*b?";
const fn = B.exportFileName();
eq(/[\\/:*?"<>|]/.test(fn), false, "文件名里不含 Windows 非法字符");
eq(fn.indexOf("祁_星_a_b_") > -1, true, "非法字符被替换成下划线");

console.log("\n========== 22. 赛事规则面板 ==========");
{
  /** 触发某个元素上注册的事件处理器（模拟浏览器派发事件） */
  function fire(el, ev, props){
    const fn = el && el.handlers && el.handlers[ev];
    if(!fn) return false;
    fn(Object.assign({
      target: el, key: "", keyCode: 0, isComposing: false,
      preventDefault(){}, stopPropagation(){}
    }, props || {}));
    return true;
  }
  /** 取列表里每条的规则文字 / 序号 / 删除键下标，便于断言 */
  const texts  = l => l.children.map(c => c.children[1].textContent);
  const idxs   = l => l.children.map(c => c.children[0].textContent);
  const dels   = l => l.children.map(c => c.children[2].dataset.del);

  console.log("--- 接口与上限 ---");
  eq(typeof B.addRule, "function", "暴露 addRule");
  eq(typeof B.deleteRule, "function", "暴露 deleteRule");
  eq(typeof B.renderRules, "function", "暴露 renderRules");
  eq(typeof B.sanitizeRules, "function", "暴露 sanitizeRules");
  eq(typeof B.commitRuleOrder, "function", "暴露 commitRuleOrder");
  eq(B.RULES_MAX, 60, "条数上限 60");
  eq(B.RULES_MAX_LEN, 200, "单条长度上限 200 字");

  console.log("--- sanitizeRules：脏数据收敛 ---");
  eq(B.sanitizeRules(null), [], "null → 空数组");
  eq(B.sanitizeRules("abc"), [], "字符串（非数组）→ 空数组");
  eq(B.sanitizeRules(["  a  ", "", "   ", "b"]), ["a", "b"], "去首尾空白、丢掉空条目");
  eq(B.sanitizeRules([1, true, null]), ["1", "true"], "非字符串先转成字符串（null/undefined 视为空而被丢掉）");
  eq(B.sanitizeRules(["x".repeat(300)])[0].length, 200, "单条超长被截到 200 字");
  eq(B.sanitizeRules(new Array(100).fill("r")).length, 60, "超过 60 条被截断");

  console.log("--- index.html 结构（静态检查）---");
  eq(html.indexOf('id="rules-list"') > -1, true, "存在 #rules-list");
  eq(html.indexOf('id="rules-input"') > -1, true, "存在 #rules-input");
  eq(html.indexOf('id="rules-lock"') > -1, true, "存在锁定开关 #rules-lock");
  eq(html.indexOf('id="rules-empty"') > -1, true, "存在空列表提示 #rules-empty");
  eq(html.indexOf("<h2>赛事规则</h2>") > -1, true, "标题文案 = 赛事规则");
  {
    const iHdr = html.indexOf("</header>");
    const iSec = html.indexOf('class="panel rules-panel"');
    const iLay = html.indexOf('id="layout"');
    const iTit = html.indexOf("<h2>赛事规则</h2>");
    const iLst = html.indexOf('id="rules-list"');
    const iEmp = html.indexOf('id="rules-empty"');
    const iInp = html.indexOf('id="rules-input"');
    eq(iSec > iHdr, true, "赛事规则面板在顶部头图之后");
    eq(iSec < iLay, true, "赛事规则面板在所有栏目（#layout）之前");
    eq(iTit < iLst, true, "标题在规则列表之前");
    eq(iLst < iInp, true, "规则列表在输入框之前 → 新增的规则落在「标题与输入框之间」");
    eq(iEmp > iLst && iEmp < iInp, true, "空列表提示也落在标题与输入框之间");
    eq(html.indexOf('id="rules-lock"') > iInp, true, "锁定开关在输入框的右侧（DOM 顺序在输入框之后）");
    eq(/class="rules-input-row"/.test(html), true, "输入框与锁定开关同处一行（.rules-input-row）");
  }

  console.log("--- css：居中 / 序号 / 删除键 / 拖动 ---");
  eq(/\.rules-panel\s*>\s*h2\s*\{[^}]*justify-content:center/.test(css), true, "标题居中");
  eq(/\.rules-text\s*\{[^}]*text-align:center/.test(css), true, "规则文字居中");
  eq(/\.rules-empty\s*\{[^}]*text-align:center/.test(css), true, "空提示居中");
  eq(/\.rules-list,\.rules-empty,\.rules-input-row\{[^}]*max-width/.test(css), true, "列表、空提示、输入行收在同一条居中窄栏里");
  eq(/\.rules-input-row\{display:flex/.test(css), true, "输入框与锁定开关并排");
  eq(/\.rules-idx\s*\{/.test(css), true, "有序号样式 .rules-idx");
  eq(/\.rules-del\s*\{/.test(css), true, "有删除键样式 .rules-del");
  eq(/\.rules-item\s*\{[^}]*cursor:grab/.test(css), true, "条目可拖动（cursor:grab）");
  eq(/\.rules-item\.dragging\s*\{/.test(css), true, "有「正在拖动」样式 .rules-item.dragging");
  eq(/\.rules-lock\s*\{/.test(css), true, "有锁定开关样式 .rules-lock");
  eq(/\.rules-lock\.active\s*\{/.test(css), true, "锁定开关有「已按下」高亮样式");
  eq(/\.rules-input:disabled\s*\{/.test(css), true, "输入框有停用样式");
  eq(/\.rules-list\.locked \.rules-item\{[^}]*background:none/.test(css), true, "锁定时隐藏条目背景");
  eq(/\.rules-list\.locked \.rules-item\{[^}]*cursor:default/.test(css), true, "锁定时去掉可拖动光标");
  /* ⚠️⚠️ 删除键必须「藏而不摘」：条目是 flex 行（序号 + 文字 + 删除键），
     用 display:none 会让文字的可居中区间变宽 34px → 文字右移 17px、看着就不居中了。
     visibility:hidden 保留占位，锁定与未锁定的居中完全一致。 */
  eq(/\.rules-list\.locked \.rules-del\{visibility:hidden\}/.test(css), true,
     "锁定时删除键用 visibility:hidden 保留占位");
  eq(/\.rules-list\.locked \.rules-del\{display:none\}/.test(css), false,
     "锁定时**不能**用 display:none 摘掉删除键（会让规则文字右移不居中）");
  eq(/\.rules-del\s*\{[^}]*width:24px/.test(css), true, "删除键有固定占位宽度（居中所依赖）");
  eq(/\.rules-item\s*\{[^}]*display:flex/.test(css), true, "条目是 flex 行（删除键摘掉就会改变居中）");
  eq(/@media \(max-width:720px\)[\s\S]*\.rules-idx/.test(css), true, "窄屏下对条目做了收窄处理");
  eq(/@media \(max-width:720px\)[\s\S]*\.rules-text\{[^}]*text-align:left/.test(css), false,
     "窄屏也没有把规则文字改成左对齐（要求是「同样居中」）");

  console.log("--- 渲染：左序号 / 中文字 / 右删除键 ---");
  reset();
  B.addRule("规则甲");
  B.addRule("规则乙");
  const l = byId["rules-list"];
  eq(S.rules, ["规则甲", "规则乙"], "两条规则按添加顺序进入 state");
  eq(l.children.length, 2, "列表渲染出 2 条");
  eq(l.children[0].tag, "li", "条目是 <li>");
  eq(l.children[0].className.split(" ").indexOf("rules-item") > -1, true, "带 .rules-item");
  eq(l.children[0].draggable, true, "条目 draggable=true（可拖动排序）");
  eq(l.children[0].children.length, 3, "条目 = 左序号 / 中文字 / 右删除键 三段");
  eq(l.children[0].children[0].className, "rules-idx", "第 1 段是序号");
  eq(l.children[0].children[0].textContent, "1", "第 1 条序号 = 1");
  eq(l.children[0].children[1].className, "rules-text", "第 2 段是规则文字");
  eq(l.children[0].children[1].textContent, "规则甲", "文字内容正确");
  eq(l.children[0].children[2].className, "rules-del", "第 3 段是删除键");
  eq(l.children[0].children[2].dataset.del, "0", "删除键记着自己的下标 0");
  eq(l.children[1].children[0].textContent, "2", "第 2 条序号 = 2");
  eq(l.children[1].children[2].dataset.del, "1", "第 2 条删除键下标 1");
  eq(byId["rules-empty"].hidden, true, "已有规则 → 空提示隐藏");
  eq(/tx\.textContent = text/.test(APP), true, "规则文字走 textContent 写入（不用 innerHTML，天然免注入）");
  eq(/li\.draggable = !state\.rulesLocked/.test(APP), true, "renderRules 按锁定状态决定条目是否可拖动");

  console.log("--- 新增的边界：空串 / 纯空格 / 超长 / 上限 ---");
  eq(B.addRule(""), false, "空串不新增");
  eq(B.addRule("     "), false, "纯空格不新增");
  eq(S.rules.length, 2, "规则数没变");
  eq(B.addRule("y".repeat(300)), true, "超长文本可以加进去");
  eq(S.rules[2].length, 200, "…但被截到 200 字");
  eq(l.children.length, 3, "列表同步变成 3 条");
  eq(l.children[2].children[1].textContent.length, 200, "渲染出来的也是截断后的内容");
  {
    const saved = S.rules.slice();
    S.rules = new Array(B.RULES_MAX).fill("满");
    B.renderRules();
    eq(B.addRule("第 61 条"), false, "到达上限后不再新增");
    eq(S.rules.length, B.RULES_MAX, "条数仍停在 60");
    S.rules = saved;
    B.renderRules();
  }

  console.log("--- 删除：删掉本条、后面顶上来、序号重排 ---");
  const delBtn = l.children[0].children[2];
  eq(fire(l, "click", { target: delBtn }), true, "删除键的点击已委托到列表容器上");
  eq(S.rules.length, 2, "删掉一条");
  eq(S.rules[0], "规则乙", "删掉的是第 1 条「规则甲」，后面的顶上来了");
  eq(S.rules.length, 2, "…且只少了一条");
  eq(l.children.length, 2, "列表同步只剩 2 条");
  eq(idxs(l), ["1", "2"], "序号重新从 1 开始编号");
  eq(dels(l), ["0", "1"], "删除键下标也跟着更新");
  eq(B.deleteRule(99), false, "越界下标 → 安全返回 false");
  eq(B.deleteRule(-1), false, "负下标 → 安全返回 false");
  eq(B.deleteRule(0), true, "删第 1 条");
  eq(B.deleteRule(0), true, "再删第 1 条");
  eq(S.rules.length, 0, "全部删光");
  eq(l.children.length, 0, "列表 DOM 也清空");
  eq(byId["rules-empty"].hidden, false, "列表空了 → 空提示显示");

  console.log("--- 回车新增（含输入法组字保护）---");
  reset();
  const inp = byId["rules-input"];
  eq(typeof inp.handlers.keydown, "function", "输入框已注册 keydown");
  let prevented = false;
  inp.value = "第一条规则";
  fire(inp, "keydown", { target: inp, key: "Enter", preventDefault(){ prevented = true; } });
  eq(prevented, true, "回车会 preventDefault（不会误触发表单提交/换行）");
  eq(S.rules, ["第一条规则"], "回车后新增一条");
  eq(inp.value, "", "新增成功后输入框被清空");
  fire(inp, "keydown", { target: inp, key: "Enter" });
  eq(S.rules.length, 1, "输入框为空时再按回车不会加出空条目");
  inp.value = "   ";
  fire(inp, "keydown", { target: inp, key: "Enter" });
  eq(S.rules.length, 1, "只填空格也不会加");
  fire(inp, "keydown", { target: inp, key: "a" });
  eq(S.rules.length, 1, "非回车键不新增");
  inp.value = "汉字候选";
  fire(inp, "keydown", { target: inp, key: "Enter", isComposing: true });
  eq(S.rules.length, 1, "输入法组字中的回车被放过（isComposing）");
  eq(inp.value, "汉字候选", "…且输入框内容被保留");
  fire(inp, "keydown", { target: inp, key: "Enter", keyCode: 229 });
  eq(S.rules.length, 1, "keyCode 229 也视为组字中");
  fire(inp, "keydown", { target: inp, key: "Enter" });
  eq(S.rules, ["第一条规则", "汉字候选"], "组字结束后回车才真正新增");
  eq(inp.value, "", "输入框再次清空");

  console.log("--- 拖动排序：commitRuleOrder ---");
  reset();
  B.addRule("A"); B.addRule("B"); B.addRule("C");
  const l2 = byId["rules-list"];
  const snapABC = S.rules.slice();
  const elA = l2.children[0], elB = l2.children[1], elC = l2.children[2];
  l2.insertBefore(elC, elA);                              // 模拟把 C 拖到最前面
  eq(texts(l2), ["C", "A", "B"], "拖动过程中直接改 DOM 顺序 → 所见即所得");
  eq(S.rules, ["A", "B", "C"], "…但此时 state 还没动（等松手才提交）");
  eq(B.commitRuleOrder(snapABC, l2), true, "松手提交，返回 true");
  eq(S.rules, ["C", "A", "B"], "state 顺序 = DOM 顺序");
  eq(l2.children.length, 3, "条目没有多也没有少");
  eq(idxs(l2), ["1", "2", "3"], "序号按新顺序重新编号");
  eq(dels(l2), ["0", "1", "2"], "删除键下标也跟着重排");
  eq(texts(l2), ["C", "A", "B"], "重渲染后的文字顺序不变");
  eq(B.commitRuleOrder(S.rules.slice(), l2), false, "顺序没变 → 返回 false，不做无谓重渲染");
  eq(B.commitRuleOrder(["只有一条"], l2), false, "长度对不上 → 拒绝（不会把规则弄丢）");
  eq(B.commitRuleOrder(S.rules.slice(), null), false, "容器为空 → 安全返回 false");
  eq(B.commitRuleOrder(null, l2), false, "快照为空 → 安全返回 false");
  eq(S.rules, ["C", "A", "B"], "以上几次无效调用都没有破坏 state");

  console.log("--- 拖动事件链（dragstart / dragover / dragend）---");
  eq(typeof l2.handlers.dragstart, "function", "已注册 dragstart");
  eq(typeof l2.handlers.dragover, "function", "已注册 dragover");
  eq(typeof l2.handlers.drop, "function", "已注册 drop");
  eq(typeof l2.handlers.dragend, "function", "已注册 dragend");
  {
    const n1 = l2.children[0], n2 = l2.children[1], n3 = l2.children[2];   // C, A, B
    const dt = { setData(){}, effectAllowed: "", dropEffect: "" };
    l2.handlers.dragstart({ target: n3, dataTransfer: dt });
    eq(n3.classList.contains("dragging"), true, "拖动开始 → 该条目加 .dragging");
    l2.handlers.dragover({ target: n2, clientY: -100, dataTransfer: dt, preventDefault(){} });
    eq(texts(l2), ["C", "B", "A"], "拖到「A」的上半区 → 插到它前面");
    l2.handlers.dragover({ target: n3, clientY: 100, dataTransfer: dt, preventDefault(){} });
    eq(texts(l2), ["C", "B", "A"], "拖到自己身上 → 顺序不变");
    l2.handlers.dragend({});
    eq(n3.classList.contains("dragging"), false, "拖动结束 → 去掉 .dragging");
    eq(S.rules, ["C", "B", "A"], "松手后 state 顺序 = DOM 顺序");
    eq(idxs(l2), ["1", "2", "3"], "序号已重排");
  }

  console.log("--- 与「归零」的关系：规则要保留 ---");
  reset();
  B.addRule("规则一"); B.addRule("规则二");
  S.counts.six = 2; S.playerName = "祁星";
  B.updateUI();
  eq(JSON.parse(store[B.STORAGE_KEY_RULES]).rules, ["规则一", "规则二"],
     "规则已写进**规则专属**存档键（不在计分存档里）");
  byId["btn-reset"].handlers.click();
  eq(S.counts.six, 0, "归零清掉了计分项");
  eq(S.playerName, "", "归零清掉了选手名");
  eq(S.rules, ["规则一", "规则二"], "归零**保留**赛事规则（它是赛制配置，不是选手成绩）");
  eq(byId["rules-list"].children.length, 2, "界面上规则也还在");
  eq(byId["rules-list"].children[0].children[1].textContent, "规则一", "内容原样");
  eq(byId["rules-empty"].hidden, true, "空提示仍是隐藏的");

  console.log("--- 持久化：localStorage 往返 ---");
  S.rules = [];
  B.renderRules();
  B.load(); B.syncDOM(); B.updateUI();
  eq(S.rules, ["规则一", "规则二"], "从 localStorage 恢复后规则还在");
  eq(byId["rules-list"].children.length, 2, "列表也重新渲染出来");
  eq(byId["rules-list"].children[1].children[1].textContent, "规则二", "第 2 条内容正确");

  /* ⚠️ 2026-09-23 用户要求：赛事规则**完全独立**，导入/导出都不许动它。
     这里把旧的「随文件整体替换」约定整段换掉，改为验证「文件不动规则」。 */
  console.log("--- 导出 / 导入：规则快照留档，但导入不回读 ---");
  const rTxt = B.buildExportText();
  eq(rTxt.indexOf("【赛事规则】共 2 条") > -1, true, "导出文本有【赛事规则】区块并带条数");
  eq(rTxt.indexOf("仅供留档") > -1, true, "…并标注「仅供留档」（提醒人不回读）");
  eq(rTxt.indexOf("1. 规则一") > -1, true, "…列出了第 1 条（带序号）");
  eq(rTxt.indexOf("2. 规则二") > -1, true, "…列出了第 2 条（带序号）");

  const dataObj = JSON.parse(rTxt.slice(rTxt.lastIndexOf("DATA:") + 5));
  eq("rules" in dataObj, false, "DATA 行**不再**带 rules 字段（规则不属于选手存档）");
  eq("rulesLocked" in dataObj, false, "DATA 行**不再**带 rulesLocked 字段");
  eq(B.parseExportText(rTxt).rules, undefined, "解析读回的存档里没有 rules");

  // 关键回归：导入一份完整档 → 规则原样不动
  S.rules = ["规则一", "规则二"];
  B.renderRules();
  B.applyImported(B.parseExportText(rTxt));
  eq(S.rules, ["规则一", "规则二"], "导入后规则原样不动");

  // 关键回归：导入一份**完全没带规则**的旧档 → 依然不动（这是本次报的 bug）
  B.applyImported({ v: 1, counts: {}, toggles: {} });
  eq(S.rules, ["规则一", "规则二"], "导入一份没有 rules 的文件 → 规则**不再被清空**（本次修复的 bug）");

  // 旧档遗留字段：即使文件里写了 rules，也必须被忽略
  B.applyImported({ v: 1, counts: {}, toggles: {}, rules: ["恶意覆盖"], rulesLocked: true });
  eq(S.rules, ["规则一", "规则二"], "旧档里即使带了 rules 也一律忽略（不被替换）");
  eq(S.rulesLocked, false, "旧档里的 rulesLocked 同样被忽略（不被强制锁定）");
  {
    // parseExportText 第二道保险：旧版 DATA 行里的 rules 也要摘掉
    const legacy = "DATA:" + JSON.stringify({
      v: 1, counts: {}, toggles: {}, rules: ["旧档规则"], rulesLocked: true
    });
    const parsed = B.parseExportText(legacy);
    eq("rules" in parsed, false, "parseExportText 主动摘掉旧档遗留的 rules");
    eq("rulesLocked" in parsed, false, "parseExportText 主动摘掉旧档遗留的 rulesLocked");
  }

  // 规则为空时，导出照样写区块 + 占位
  S.rules = [];
  B.renderRules();
  eq(B.buildExportText().indexOf("【赛事规则】共 0 条") > -1, true, "无规则时导出也照常写区块");
  eq(B.buildExportText().indexOf("（暂无规则）") > -1, true, "…并有「暂无规则」占位");

  console.log("--- 锁定开关：切换为只读 ---");
  reset();
  eq(typeof B.toggleRulesLock, "function", "暴露 toggleRulesLock");
  eq(typeof B.syncRulesLock, "function", "暴露 syncRulesLock");
  eq(S.rulesLocked, false, "默认未锁定");
  eq(typeof byId["rules-lock"].handlers.click, "function", "锁定按钮已绑定点击");
  B.addRule("规则甲"); B.addRule("规则乙");
  const lockBtn = byId["rules-lock"], listEl = byId["rules-list"], inpEl = byId["rules-input"];
  eq(listEl.classList.contains("locked"), false, "未锁定 → 列表没有 .locked");
  eq(inpEl.disabled, false, "未锁定 → 输入框可用");
  eq(lockBtn.classList.contains("active"), false, "未锁定 → 开关不高亮");
  eq(lockBtn.textContent, "锁定", "未锁定 → 按钮文案「锁定」");
  eq(lockBtn.attrs["aria-pressed"], "false", "未锁定 → aria-pressed=false");
  eq(listEl.children[0].draggable, true, "未锁定 → 条目可拖动");

  fire(lockBtn, "click", { target: lockBtn });
  eq(S.rulesLocked, true, "点一下 → 进入锁定");
  eq(listEl.classList.contains("locked"), true, "列表加上 .locked（CSS 靠它隐藏背景与删除键）");
  eq(inpEl.disabled, true, "输入框被停用");
  eq(inpEl.placeholder, "已锁定，规则不可修改", "输入框提示改成「已锁定」");
  eq(lockBtn.classList.contains("active"), true, "开关高亮");
  eq(lockBtn.textContent, "已锁定", "按钮文案改成「已锁定」");
  eq(lockBtn.attrs["aria-pressed"], "true", "aria-pressed=true");
  eq(String(lockBtn.attrs.title).indexOf("解锁") > -1, true, "悬停提示改成「点击解锁」");
  eq(listEl.children.length, 2, "锁定不影响已渲染的条目数量");
  eq(listEl.children.map(c => c.draggable), [false, false], "锁定后条目都不再可拖动（重渲染已同步）");
  eq(texts(listEl), ["规则甲", "规则乙"], "内容原样保留");
  eq(idxs(listEl), ["1", "2"], "序号也原样保留");
  /* ⚠️ 删除键在锁定后**依然留在 DOM 里**（隐藏交给 CSS 的 visibility:hidden）。
     若哪天改成 JS 不渲染它，flex 行会少掉右侧 24px+间距 → 规则文字右移、不居中。 */
  eq(listEl.children.map(c => c.children.map(k => k.className).join(",")),
     ["rules-idx,rules-text,rules-del", "rules-idx,rules-text,rules-del"],
     "锁定后每条规则仍是「序号 + 文字 + 删除键」三段（删除键要留着占位才居中）");

  console.log("--- 锁定后所有改动入口都被挡住 ---");
  eq(B.addRule("不该加进去"), false, "锁定后 addRule 被拒绝");
  eq(S.rules.length, 2, "规则数没变");
  eq(B.deleteRule(0), false, "锁定后 deleteRule 被拒绝");
  eq(S.rules.length, 2, "规则数仍没变");
  eq(B.commitRuleOrder(["规则乙", "规则甲"], listEl), false, "锁定后 commitRuleOrder 被拒绝");
  {
    const el0 = listEl.children[0], el1 = listEl.children[1];
    const dt2 = { setData(){}, effectAllowed: "", dropEffect: "" };
    eq(fire(listEl, "dragstart", { target: el1, dataTransfer: dt2 }), true, "dragstart 监听器仍在（只是内部早退）");
    eq(el1.classList.contains("dragging"), false, "锁定后拖动不会启动（不加 .dragging）");
    listEl.handlers.dragover({ target: el0, clientY: -100, dataTransfer: dt2, preventDefault(){} });
    eq(texts(listEl), ["规则甲", "规则乙"], "锁定后拖动经过也不改变顺序");
    listEl.handlers.dragend({});
    eq(S.rules, ["规则甲", "规则乙"], "锁定后松手也不会回写 state");
  }

  console.log("--- 再点一下：解锁 ---");
  fire(lockBtn, "click", { target: lockBtn });
  eq(S.rulesLocked, false, "再点一下 → 解锁");
  eq(listEl.classList.contains("locked"), false, "列表去掉 .locked");
  eq(inpEl.disabled, false, "输入框恢复可用");
  eq(inpEl.placeholder, "输入一条赛事规则，按回车添加", "输入框提示还原");
  eq(lockBtn.classList.contains("active"), false, "开关取消高亮");
  eq(lockBtn.textContent, "锁定", "按钮文案还原为「锁定」");
  eq(listEl.children[0].draggable, true, "条目恢复可拖动");
  eq(B.addRule("解锁后可以加"), true, "解锁后能正常新增");
  eq(B.deleteRule(0), true, "解锁后能正常删除");
  eq(S.rules, ["规则乙", "解锁后可以加"], "增删结果正确");

  console.log("--- 锁定状态的持久化 / 导出 / 归零 ---");
  reset();
  B.addRule("A");
  B.toggleRulesLock();
  eq(S.rulesLocked, true, "toggleRulesLock 切到锁定");
  eq(JSON.parse(store[B.STORAGE_KEY_RULES]).rulesLocked, true, "锁定状态已写进**规则专属**存档键");
  const rTxt2 = B.buildExportText();
  eq(rTxt2.indexOf("锁定状态") > -1, true, "导出文本带「锁定状态」一行（留档快照）");
  eq(rTxt2.indexOf("已锁定（只读）") > -1, true, "…锁定时写作「已锁定（只读）」");
  eq("rulesLocked" in JSON.parse(rTxt2.slice(rTxt2.lastIndexOf("DATA:") + 5)), false,
     "DATA 行**不带** rulesLocked（只有可读快照里有）");
  byId["btn-reset"].handlers.click();
  eq(S.rules, ["A"], "归零保留规则");
  eq(S.rulesLocked, true, "归零也保留锁定状态");
  eq(inpEl.disabled, true, "归零后输入框仍是停用的（界面同步到了）");
  /* ⚠️ 导入**不再**影响锁定状态：文件里写什么、写不写，都改不了它。 */
  B.applyImported({ v: 1, counts: {}, toggles: {}, rules: ["X"], rulesLocked: false });
  eq(S.rulesLocked, true, "导入 rulesLocked:false 也**解不开**锁（导入不管规则）");
  eq(S.rules, ["A"], "…规则内容也没被换成文件里的 X");
  B.applyImported({ v: 1, counts: {}, toggles: {}, rules: ["X"] });
  eq(S.rulesLocked, true, "导入文件没写 rulesLocked → 仍保持原锁状态");
  eq(S.rules, ["A"], "规则仍原样");
  // 解锁只能靠开关自己
  eq(B.toggleRulesLock(), false, "toggleRulesLock 切回未锁定并返回 false");
  eq(JSON.parse(store[B.STORAGE_KEY_RULES]).rulesLocked, false, "解锁也落到规则专属存档");
  eq(B.toggleRulesLock(), true, "再切一次返回 true");
  // 此时是锁定态；再切一次回到未锁定，好验证导出文案
  eq(B.toggleRulesLock(), false, "再切一次回到未锁定");
  eq(B.buildExportText().indexOf("未锁定") > -1, true, "未锁定时的导出文案");
}

/* ======================================================================
   22.5 赛事规则与选手存档解耦（2026-09-23 用户报的 bug）
        —— 导入选手数据时，赛事规则被覆盖/清零；现在规则走独立存档键。
        这条通道要证明四件事：
          ① 规则变更写进 STORAGE_KEY_RULES，而**不**写进计分存档 STORAGE_KEY；
          ② load() 能从规则专属键恢复，即使计分存档里"混"着旧字段也不受影响；
          ③ 任何形式的导入都动不了规则；
          ④ 计分存档里根本不再出现 rules / rulesLocked。
   ====================================================================== */
console.log("\n========== 22.5 赛事规则与选手存档解耦 ==========");
{
  const RKEY = B.STORAGE_KEY_RULES;
  eq(typeof RKEY, "string", "暴露 STORAGE_KEY_RULES");
  eq(RKEY !== B.STORAGE_KEY, true, "规则存档键与计分存档键不同");
  eq(typeof B.saveRules, "function", "暴露 saveRules");
  eq(typeof B.loadRules, "function", "暴露 loadRules");

  console.log("--- ① 规则变更只写规则专属键，不污染计分存档 ---");
  reset();
  // ⚠️ 不能整个清空 store：test.js 里的 store 是共享对象，
  //    test.js 早先区块里 catch 下来的 `store` 引用必须继续有效（否则后续断言读不到）。
  //    这里只按需删除两个键即可。
  delete store[RKEY]; delete store[B.STORAGE_KEY];
  B.addRule("规则甲");
  eq(JSON.parse(store[RKEY]).rules, ["规则甲"], "addRule 写进规则专属键");
  eq(store[B.STORAGE_KEY] === undefined || !("rules" in JSON.parse(store[B.STORAGE_KEY])),
     true, "计分存档里没有 rules 字段");

  B.toggleRulesLock();
  eq(JSON.parse(store[RKEY]).rulesLocked, true, "锁定写进规则专属键");
  eq(store[B.STORAGE_KEY] === undefined || !("rulesLocked" in JSON.parse(store[B.STORAGE_KEY])),
     true, "计分存档里没有 rulesLocked 字段");
  B.toggleRulesLock();

  B.deleteRule(0);
  eq(JSON.parse(store[RKEY]).rules, [], "删除也落到规则专属键");

  console.log("--- 拖动排序也落到规则专属键 ---");
  B.addRule("甲"); B.addRule("乙");
  {
    // 真实拖拽：dragstart 取快照 → dragover 挪 DOM → dragend 提交
    const lst = byId["rules-list"];
    const els = lst.children.slice();                 // [甲, 乙]
    const dt = { setData(){}, effectAllowed: "", dropEffect: "" };
    lst.handlers.dragstart({ target: els[1], dataTransfer: dt });   // 拖「乙」
    lst.handlers.dragover({ target: els[0], clientY: -100, dataTransfer: dt, preventDefault(){} });
    eq(lst.children.map(c => c.children[1].textContent), ["乙", "甲"], "拖动期 DOM 预览已换序");
    lst.handlers.dragend({});
    eq(S.rules, ["乙", "甲"], "松手后 state 顺序 = DOM 顺序");
    eq(JSON.parse(store[RKEY]).rules, ["乙", "甲"], "排序结果落到规则专属键");
  }

  console.log("--- ④ 整套计分存档里始终没有 rules / rulesLocked ---");
  S.playerName = "祁星"; S.counts.six = 3; B.updateUI();
  const saved = JSON.parse(store[B.STORAGE_KEY]);
  eq("rules" in saved, false, "计分存档没带 rules");
  eq("rulesLocked" in saved, false, "计分存档没带 rulesLocked");
  eq(saved.playerName, "祁星", "计分存档照常存选手名");

  console.log("--- ② load()：计分存档与规则存档各自恢复 ---");
  S.rules = []; S.rulesLocked = false; S.playerName = ""; S.counts.six = 0;
  B.renderRules();
  B.load(); B.syncDOM(); B.updateUI();
  eq(S.rules, ["乙", "甲"], "load() 从规则专属键恢复规则");
  eq(byId["rules-list"].children.length, 2, "列表也重渲染出来");
  eq(S.playerName, "祁星", "同一轮 load() 也恢复了选手名（两条通道互不干扰）");
  eq(S.counts.six, 3, "计分项也恢复了");

  console.log("--- ②b 只有规则存档、没有计分存档时也能恢复规则 ---");
  const keepScore = store[B.STORAGE_KEY];
  delete store[B.STORAGE_KEY];                 // 模拟"还没计过分、只配了规则"
  S.rules = []; B.renderRules();
  B.load();
  eq(S.rules, ["乙", "甲"], "计分存档缺失时，规则仍从专属键恢复（load 的分支已覆盖）");
  store[B.STORAGE_KEY] = keepScore;            // 还原

  console.log("--- ③ 三种导入姿势都动不了规则 ---");
  const before = ["乙", "甲"];
  // (a) 正常导入一份自带快照的完整 txt
  S.rules = before.slice(); B.renderRules();
  const fullTxt = B.buildExportText();
  B.applyImported(B.parseExportText(fullTxt));
  eq(S.rules, before, "(a) 导入完整 txt → 规则不动");
  // (b) 导入一份没带规则字段的旧档
  B.applyImported({ v: 1, counts: { six: 1 }, toggles: {} });
  eq(S.rules, before, "(b) 导入无 rules 的旧档 → 规则**不再清零**（原 bug）");
  eq(S.counts.six, 1, "…但计分项照常被替换");
  // (c) 导入一份恶意带 rules 的档
  B.applyImported({ v: 1, counts: {}, toggles: {}, rules: ["外部规则"], rulesLocked: true });
  eq(S.rules, before, "(c) 导入带 rules 的档 → 规则不被替换");
  eq(S.rulesLocked, false, "(c) rulesLocked 也不被强制");
  eq(JSON.parse(store[RKEY]).rules, before, "…规则专属存档里仍是本机的规则");

  console.log("--- clearState() 仍然不碰规则（且不误写规则存档）---");
  S.counts.six = 9; S.playerName = "要被清掉";
  B.clearState();
  eq(S.rules, before, "clearState 保留规则");
  eq(S.counts.six, 0, "clearState 清掉计分项");
  eq(JSON.parse(store[RKEY]).rules, before, "规则专属存档里没被 clearState 动过");

  console.log("--- 源码静态断言：applySnapshot 不再读写 rules ---");
  {
    const body = APP_SRC_ALL.slice(
      APP_SRC_ALL.indexOf("function applySnapshot"),
      APP_SRC_ALL.indexOf("function load()")
    );
    eq(body.indexOf("obj.rules") === -1, true, "applySnapshot 里不再出现 obj.rules");
    eq(body.indexOf("obj.rulesLocked") === -1, true, "applySnapshot 里不再出现 obj.rulesLocked");
    eq(body.indexOf("state.rules") === -1, true, "applySnapshot 里不再出现 state.rules");
  }
  console.log("--- 源码静态断言：DATA 行不含 rules 字段 ---");
  {
    const seg = APP_SRC_ALL.slice(
      APP_SRC_ALL.indexOf("put(EXPORT_MARKER + JSON.stringify"),
      APP_SRC_ALL.indexOf("return L.join")
    );
    eq(seg.indexOf("rules:") === -1, true, "导出 DATA 行里没有 rules:");
    eq(seg.indexOf("rulesLocked:") === -1, true, "导出 DATA 行里没有 rulesLocked:");
  }
  reset();
}

/* ======================================================================
   23. 导出：只出 txt（结算图与「导出方式」弹框已按要求下线）
   ====================================================================== */
console.log("\n========== 23. 导出只出 txt（结算图已下线） ==========");

{
  const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const CSS  = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
  const ix = (s) => HTML.indexOf(s);

  console.log("--- 结算图相关接口必须全部下线 ---");
  ["openExportModal", "closeExportModal", "exportShot", "buildShotMarkup",
   "renderShotPng", "shotFileName", "flattenShotLayout", "stripShotInteractions",
   "imageToDataUrl", "embedShotImages", "measureShotHeight",
   "syncFormValues", "bakedShotImage", "isNumericInput",
   "SHOT_CSS", "SHOT_VARS", "SHOT_WIDTH", "SHOT_SCALE"].forEach(function(k){
    eq(typeof B[k], "undefined", "BFC 上不再暴露 " + k);
  });
  eq(typeof B.exportToFile, "function", "导出 txt 的入口仍在");
  eq(typeof B.buildExportText, "function", "txt 内容生成仍在");
  eq(typeof B.parseExportText, "function", "txt 解析仍在");
  eq(typeof B.exportFileName, "function", "txt 文件名生成仍在");

  console.log("--- index.html：没有弹框、没有结算图脚本 ---");
  eq(ix("export-modal") === -1, true, "没有 #export-modal 弹框");
  eq(ix("export-opt-data") === -1, true, "没有「选手数据本」选项按钮");
  eq(ix("export-opt-shot") === -1, true, "没有「选手结算图」选项按钮");
  eq(HTML.indexOf("<dialog") === -1, true, "不再有 <dialog>");
  eq(ix("header-image.js") === -1, true, "不再加载预烘焙头图脚本");
  eq(ix('src="js/app.js"') > -1, true, "仍然加载 app.js");
  eq((HTML.match(/<script/g) || []).length, 1, "页面只剩一个 <script>（就是 app.js）");
  eq(fs.existsSync(path.join(__dirname, "..", "js", "header-image.js")), false,
     "js/header-image.js 文件已删除");

  console.log("--- css：弹框样式清干净（网页样式其余不变） ---");
  /* ⚠️ 注意：这句断言的是**结算图那个弹框**的样式已被清掉，
     不是「css 里不许出现 .modal 字样」——
     2026-09-23 起榜单页有了自己的居中弹框（`.modal-card/.modal-title/.modal-btns`，
     用于「添加队伍 / 添加选手」），那是另一回事，不能一起禁掉。
     所以这里精确断言「旧弹框专属的那些类名」不存在：`#export-modal` 的 `.modal-head/
     .modal-close/.modal-opts/.modal-opt`（其中 `.modal-opt` 是它独有的）。 */
  eq(CSS.indexOf("modal-opt") === -1, true, "css 里没有 .modal-opt 样式");
  eq(CSS.indexOf("modal-head") === -1, true, "css 里没有 .modal-head 样式");
  eq(CSS.indexOf("modal-close") === -1, true, "css 里没有 .modal-close 样式");
  eq(CSS.indexOf("export-opt") === -1, true, "css 里没有 #export-opt-shot 之类");
  eq(/export-modal/.test(CSS), false, "css 里没有旧的 #export-modal 样式");

  console.log("--- 源码：不留任何结算图残留 ---");
  ["SHOT_", "buildShotMarkup", "renderShotPng", "exportShot", "openExportModal",
   "closeExportModal", "BFC_SHOT_IMAGES", "cloneForShot", "bakedShotImage",
   "embedShotImages", "outerHTML"].forEach(function(k){
    eq(APP_SRC_ALL.indexOf(k) === -1, true, "app.js 里不再出现 " + k);
  });

  console.log("--- 点「导出」直连 exportToFile ---");
  eq(typeof byId["btn-export"].handlers.click, "function", "导出按钮已绑定点击");
  eq(/exportBtn\.addEventListener\("click",\s*function\(\)\{\s*exportToFile\(\);\s*\}\)/.test(APP_SRC_ALL),
     true, "导出按钮的处理器直接调 exportToFile()（中间没有弹框）");
  eq(APP_SRC_ALL.indexOf("exportBtn.addEventListener") > -1 &&
     APP_SRC_ALL.indexOf("exportBtn.addEventListener") < APP_SRC_ALL.indexOf("importBtn.addEventListener"),
     true, "导出与导入的绑定顺序未变");

  console.log("--- 三个按钮与 txt 行为保持不变 ---");
  const tagOf = (id) => {
    const i = HTML.indexOf('id="' + id + '"');
    return i < 0 ? "" : HTML.slice(HTML.lastIndexOf("<", i), HTML.indexOf(">", i) + 1);
  };
  eq(ix('id="btn-export"') > -1 && ix('id="btn-reset"') > -1 && ix('id="btn-import"') > -1,
     true, "导出/归零/导入三个按钮都在");
  eq(ix('id="btn-export"') < ix('id="btn-reset"') &&
     ix('id="btn-reset"') < ix('id="btn-import"'), true, "DOM 顺序仍是 导出 → 归零 → 导入");
  eq(/class="[^"]*\bgreen\b/.test(tagOf("btn-export")), true, "「导出」仍是绿色按钮");
  eq(/class="[^"]*\bblue\b/.test(tagOf("btn-import")), true, "「导入」仍是蓝色按钮");
  eq(/class="[^"]*\bdanger\b/.test(tagOf("btn-reset")), true, "「归零」仍是红色按钮");

  // 用户要求「记事本相关的格式等内容都不变」—— 这里把 txt 骨架再钉一遍
  const txt = B.buildExportText();
  eq(txt.indexOf("\r\n") > -1, true, "txt 仍用 CRLF 换行（记事本友好）");
  eq(txt.indexOf("DATA:") > -1, true, "txt 仍有 DATA 数据行");
  const dataLines = txt.split("\n").filter(l => l.lastIndexOf("DATA:", 0) === 0);
  eq(dataLines.length, 1, "DATA 行仍然只有一行");
  eq(txt.split("\n")[txt.split("\n").length - 1].lastIndexOf("DATA:", 0) === 0, true,
     "DATA 行仍是最后一行（收在文件末尾）");
  ["【选手】", "【赛事规则】", "【临时招募】", "【通关时长加减分】", "【关卡通关加分】",
   "【源石锭】", "【违规扣分】", "【击杀特殊敌人】", "【藏品与路线加分】",
   "【商店加分】", "【通关结算】", "【总分】"].forEach(function(h){
    eq(txt.indexOf(h) > -1, true, "txt 仍含 " + h + " 区块（格式未变）");
  });
  eq(B.exportFileName().slice(-4), ".txt", "导出文件名仍以 .txt 结尾");
}

/* ======================================================================
   24. 页脚署名（2026-09-23 新增；2026-09-26 协同开发加「祁星qimstar」）
        —— 一行纯展示小字，三个超链接；不参与计分、不进 PANELS、不影响分栏。
   ====================================================================== */
console.log("\n========== 24. 页脚署名 ==========");
{
  const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const CSS  = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
  const ix = (s) => HTML.indexOf(s);

  console.log("--- 文案与结构 ---");
  eq(ix('class="page-footer"') > -1, true, "存在 .page-footer 页脚");
  eq(HTML.indexOf("作者：") > -1, true, "含「作者：」");
  eq(HTML.indexOf("协同开发：") > -1, true, "含「协同开发：」");
  eq(HTML.indexOf("版本：1.0.1") > -1, true, "含「版本：1.0.1」");
  eq(HTML.indexOf("日期：2026.9.23") > -1, true, "含「日期：2026.9.23」");
  eq(HTML.indexOf("拾柒ACTV") > -1, true, "含作者名「拾柒ACTV」");
  eq(HTML.indexOf("WorkBuddy") > -1, true, "含「WorkBuddy」");
  // 2026-09-26 用户要求：协同开发里再添一位「祁星qimstar」
  eq(HTML.indexOf("祁星qimstar") > -1, true, "含协同开发者「祁星qimstar」");

  console.log("--- 三个超链接指向正确 ---");
  eq(ix('href="https://space.bilibili.com/510463176"') > -1, true,
     "拾柒ACTV → B 站空间 https://space.bilibili.com/510463176");
  eq(ix('href="https://www.workbuddy.cn"') > -1, true,
     "WorkBuddy → https://www.workbuddy.cn");
  eq(ix('href="https://space.bilibili.com/11417698"') > -1, true,
     "祁星qimstar → B 站空间 https://space.bilibili.com/11417698");
  // 「拾柒ACTV」被包在指向 B 站空间的 <a> 里
  eq(/<footer class="page-footer">[\s\S]*?<a[^>]*space\.bilibili\.com\/510463176[^>]*>拾柒ACTV<\/a>[\s\S]*?<\/footer>/
       .test(HTML), true, "「拾柒ACTV」整体是超链接（文字即链接）");
  eq(/<a[^>]*workbuddy\.cn[^>]*>WorkBuddy<\/a>/.test(HTML), true,
     "「WorkBuddy」字样本身是超链接");
  eq(/<a[^>]*space\.bilibili\.com\/11417698[^>]*>祁星qimstar<\/a>/.test(HTML), true,
     "「祁星qimstar」整体是超链接（文字即链接，与另两位同款）");
  // 协同开发的两位之间「依旧空格隔开」——用的是与前面同一个全角空格 U+3000，
  // 不能顺手写成普通半角空格（会让排版风格和「协同开发：」前那个不一致）。
  eq(/WorkBuddy<\/a>\u3000<a[^>]*>祁星qimstar<\/a>/.test(HTML), true,
     "两位协同开发者之间用一个全角空格 U+3000 隔开");
  // 外链安全：新标签打开 + noopener
  // ⚠️ 首页现在有 4 个新标签链接：3 个页脚外链 + 「查看实时榜单」。
  //    这条断言统计的是**页脚那一块**里的数量，别用全文计数（会被新按钮带偏）。
  {
    const foot = HTML.slice(HTML.indexOf('class="page-footer"'), HTML.indexOf("</footer>"));
    eq((foot.match(/target="_blank"/g) || []).length, 3, "页脚三个链接都是新标签打开");
    eq((foot.match(/rel="noopener noreferrer"/g) || []).length, 3, "页脚三个链接都带 rel=noopener noreferrer");
    eq((foot.match(/<a /g) || []).length, 3, "页脚恰好三个 <a>");
  }

  console.log("--- 位置：在 .wrapper 内、最后一块 section 之后、</body> 之前 ---");
  const iFooter = ix('class="page-footer"');
  eq(iFooter > ix('id="btn-import"'), true, "页脚排在底栏三个按钮之后");
  eq(iFooter > HTML.lastIndexOf("</section>"), true, "页脚在最后一个 </section> 之后");
  eq(iFooter < ix('<script src="js/app.js">'), true, "页脚在 app.js 脚本之前");
  eq(iFooter < ix("</body>"), true, "页脚在 </body> 之前");
  // 从页脚往前数，第一个 </div> 之后才是它 —— 确认它落在 .wrapper 闭合之前
  {
    const tail = HTML.slice(iFooter);
    const iCloseWrapper = tail.indexOf("</div>");
    eq(iCloseWrapper > 0, true, "页脚之后仍有 .wrapper 的收尾 </div>（说明它在 wrapper 内）");
  }

  console.log("--- 不干扰计分与分栏 ---");
  eq(B.PANELS.indexOf("页脚") === -1, true, "页脚不在 PANELS 里（不参与分栏配平）");
  eq(B.PANELS.length, 9, "面板数仍是 9（页脚没有混进去）");
  eq(APP_SRC_ALL.indexOf("page-footer") === -1, true, "app.js 完全不碰页脚（纯静态标记）");

  console.log("--- 样式已就位 ---");
  eq(CSS.indexOf(".page-footer{") > -1, true, "css 里有 .page-footer 规则");
  eq(/\.page-footer\{[\s\S]*?text-align:center/.test(CSS), true, "页脚居中");
  eq(/\.page-footer\{[\s\S]*?color:var\(--text-mute\)/.test(CSS), true, "页脚用弱化文字色（小字不抢眼）");
  eq(/\.page-footer a\{[\s\S]*?text-decoration:none/.test(CSS), true, "链接无下划线（改用虚线下边框）");
  eq(/\.page-footer a:hover\{[\s\S]*?color:var\(--accent\)/.test(CSS), true, "悬停变亮色");
}

async function sectionRankingAsync(){
/* ======================================================================
   25. 实时排名榜单（2026-09-23 新增）
        ① index.html 里「查看实时榜单」按钮：位置 / 链接 / 样式；
        ② ranking.html 存在且与首页同风格（共用 css、同款头图、同名页脚）；
        ③ 榜单页要用的样式与数据文件结构。
   ====================================================================== */
console.log("\n========== 25. 实时排名榜单 ==========");
{
  const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const RHTML = fs.readFileSync(path.join(__dirname, "..", "ranking.html"), "utf8");
  const CSS  = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
  const RDATA= fs.readFileSync(path.join(__dirname, "..", "js", "ranking-data.js"), "utf8");
  const ix = (s) => HTML.indexOf(s);

  console.log("--- ① 首页的「查看实时榜单」按钮 ---");
  eq(ix('id="btn-ranking"') > -1, true, "存在 #btn-ranking 按钮");
  eq(HTML.indexOf("查看实时榜单") > -1, true, "按钮文案是「查看实时榜单」");
  eq(/<a[^>]*id="btn-ranking"[^>]*href="ranking\.html"/.test(HTML), true,
     "它是 <a> 且指向 ranking.html（换页用链接，不用 JS 跳转，可中键新标签打开）");
  eq(/id="btn-ranking"[\s\S]{0,220}?target="_blank"/.test(HTML), true, "新标签打开");
  eq(/id="btn-ranking"[\s\S]{0,220}?rel="noopener noreferrer"/.test(HTML), true, "带 rel=noopener noreferrer");
  eq(/class="big-btn purple"/.test(HTML), true, "用紫色按钮样式（与三个主按钮区分）");
  eq(/class="total-btns total-btns-second"/.test(HTML), true, "包在 .total-btns-second 容器里（单独一行）");
  // 位置：在三个按钮之后
  const iRank = ix('id="btn-ranking"');
  eq(iRank > ix('id="btn-export"'), true, "排在「导出」之后");
  eq(iRank > ix('id="btn-reset"'), true, "排在「归零」之后");
  eq(iRank > ix('id="btn-import"'), true, "排在「导入」之后");
  // 位置：仍在「通关结算」面板内（在 .total-section 收尾之前）
  {
    const iSec = HTML.lastIndexOf('class="total-section"');
    const iSecEnd = HTML.indexOf("</section>", iSec);
    eq(iRank > iSec && iRank < iSecEnd, true, "仍在「通关结算」面板内（不在面板外）");
  }
  // app.js 不接管它（纯链接，无需绑定事件）
  eq(APP_SRC_ALL.indexOf("btn-ranking") === -1, true, "app.js 不绑定它（纯静态链接）");

  console.log("--- ② ranking.html 与首页同风格 ---");
  eq(fs.existsSync(path.join(__dirname, "..", "ranking.html")), true, "ranking.html 已创建");
  eq(/<link rel="stylesheet" href="css\/style\.css">/.test(RHTML), true, "复用同一份 css/style.css");
  eq(RHTML.indexOf('src="img/title%20background.png"') > -1, true, "复用同一张头图");
  eq(/<header class="header">/.test(RHTML), true, "用同款 .header 结构");
  eq(RHTML.indexOf("实时排名榜单") > -1, true, "小标题是「实时排名榜单」");
  eq(/<h2>实时排名榜单<\/h2>/.test(RHTML), true, "小标题用 <h2>（与首页面板标题同级）");
  eq(/class="panel rank-panel"/.test(RHTML), true, "榜单主体是 .panel（与首页面板同款）");
  eq(RHTML.indexOf('class="page-footer"') > -1, true, "页脚与首页一致");
  eq(RHTML.indexOf("space.bilibili.com/510463176") > -1, true, "页脚保留作者链接");
  eq(/space\.bilibili\.com\/510463176[^>]*>拾柒ACTV<\/a>/.test(RHTML), true,
     "榜单页作者名也是「拾柒ACTV」（与首页同步）");
  eq(RHTML.indexOf("www.workbuddy.cn") > -1, true, "页脚保留协同开发链接");
  eq(RHTML.indexOf("space.bilibili.com/11417698") > -1, true, "页脚保留「祁星qimstar」链接");
  eq(/space\.bilibili\.com\/11417698[^>]*>祁星qimstar<\/a>/.test(RHTML), true,
     "榜单页协同开发者也有「祁星qimstar」（与首页同步）");
  // 两页页脚必须逐字相同 —— 加署名这类改动最容易「改一处漏一处」，
  // 钉一条恒等断言，漏改任何一页都会立刻红。⚠️ 别放宽成「各含关键字」。
  {
    const IH = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    const footOf = (s) => s.slice(s.indexOf('<footer class="page-footer">'), s.indexOf("</footer>") + 9);
    eq(footOf(RHTML) === footOf(IH), true, "首页与榜单页的页脚逐字相同（改文案必须两页同步）");
    eq((footOf(RHTML).match(/<a /g) || []).length, 3, "榜单页页脚也是三个 <a>");
  }
  eq(RHTML.indexOf('href="index.html"') > -1, true, "有「返回计分器」链接");
  eq(RHTML.indexOf("js/ranking-data.js") > -1, true, "引入数据文件");
  eq(RHTML.indexOf("js/ranking.js") > -1, true, "引入渲染脚本");
  eq(RHTML.indexOf("js/app.js") === -1, true, "不引入计分器的 app.js（榜单页不需要计分逻辑）");
  // 标签配对
  eq((RHTML.match(/<script/g) || []).length, 2, "恰好两个 <script>（数据 + 渲染）");
  eq(/<html lang="zh-CN">/.test(RHTML), true, "语言是 zh-CN");
  eq(/<meta charset="UTF-8">/.test(RHTML), true, "声明 UTF-8");

  console.log("--- ③a 「添加选手」上传控件 ---");
  eq(/<button[^>]*id="btn-add-player"[^>]*>添加选手<\/button>/.test(RHTML), true,
     "有「添加选手」按钮（在 .rank-actions 里）");
  eq(/<input[^>]*type="file"[^>]*id="rank-file"/.test(RHTML), true, "有配套的隐藏文件选择框");
  eq(/id="rank-file"[^>]*hidden|hidden[^>]*id="rank-file"/.test(RHTML), true, "文件框是隐藏的（由按钮代点）");
  eq(/accept="\.txt,text\/plain"/.test(RHTML), true, "只接受 txt");
  eq(/<input[^>]*\bmultiple\b[^>]*id="rank-file"/.test(RHTML) ||
     /<input[^>]*id="rank-file"[^>]*\bmultiple\b/.test(RHTML),
     true, "允许一次选多个文件（multiple 写在同一个 <input> 上）");
  eq(/<div[^>]*class="rank-toast"[^>]*id="rank-toast"/.test(RHTML), true, "有操作反馈提示条");
  // 位置：在「返回计分器」之前（用户要求「在返回计分器上方新增」）
  {
    const iAdd = RHTML.indexOf('id="btn-add-player"');
    const iBack = RHTML.indexOf('href="index.html"');
    eq(iBack > -1 && iAdd > -1 && iAdd < iBack, true,
       "「添加选手」排在「返回计分器」之上（同时说明它在同一操作行内）");
    eq(RHTML.indexOf('class="rank-actions"') < iAdd, true, "它在 .rank-actions 操作行里");
  }

  console.log("--- ③b 表头是 7 列（名次/选手/基础分/倍率/团队加分/源石锭消耗/总分） ---");
  {
    const iHead = RHTML.indexOf('class="rank-head"');
    const iList = RHTML.indexOf('id="rank-list"');
    const head = RHTML.slice(iHead, iList);
    const labels = (head.match(/<div class="rk-col[^"]*">([^<]*)<\/div>/g) || [])
                     .map(s => s.replace(/<[^>]*>/g, ""));
    eq(labels, ["名次", "选手", "基础分", "倍率", "团队加分", "源石锭消耗", "总分"],
       "表头恰是 7 列且顺序正确（源石锭消耗排在团队加分之后、总分之前）");
    eq((head.match(/rk-total/g) || []).length, 1, "只有「总分」列带 rk-total");
    eq((head.match(/rk-team/g) || []).length, 1, "「团队加分」列带 rk-team（窄屏靠它区分，不能漏）");
    eq((head.match(/rk-yuan/g) || []).length, 1, "「源石锭消耗」列带 rk-yuan（窄屏靠它区分，不能漏）");
    // 位置：团队加分 → 源石锭消耗 → 总分
    const iTeam = head.indexOf("团队加分"), iYuan = head.indexOf("源石锭消耗"), iTot = head.indexOf(">总分<");
    eq(iYuan > iTeam && iYuan < iTot, true, "「源石锭消耗」夹在「团队加分」与「总分」之间");
    // ⚠️ 表头与数据行的「特殊列」类名必须逐个对齐：窄屏是用
    //    `.rk-num:not(.rk-total):not(.rk-team):not(.rk-yuan)` 隐藏列的，
    //    表头少一个 rk-yuan 就会「数据格在、表头格没了」→ 没有标题的数字列（踩过）。
    {
      const headCls = (head.match(/<div class="(rk-col[^"]*)"/g) || [])
        .map(s => s.replace(/<div class="|"/g, ""));
      eq(headCls.length, 7, "表头 7 格都写出了完整 class");
      eq(headCls.filter(c => c.indexOf("rk-team") > -1).length, 1, "表头恰有 1 格带 rk-team");
      eq(headCls.filter(c => c.indexOf("rk-yuan") > -1).length, 1, "表头恰有 1 格带 rk-yuan");
      eq(headCls.filter(c => c.indexOf("rk-total") > -1).length, 1, "表头恰有 1 格带 rk-total");
      // 三个「特殊列」都要出现在表头里（防止以后加列忘了同步）
      eq(headCls.filter(c => /rk-team|rk-yuan|rk-total/.test(c)).length, 3,
         "表头的三个特殊列（团队/源石锭/总分）都标了类名");
    }
    /* ⚠️ 表头**只有 7 格**、行却有 8 格 —— 差别就是行尾那个删除键。
       行模板的列宽是同一个（多出的第 8 条轨道在表头里空着），所以前 7 列仍逐列对齐。
       一旦有人把删除键改成 position:absolute 压上去，这条与下面 ① 的 8 格断言就会一起报警。 */
    eq(RHTML.indexOf("row-del"), -1, "行尾删除键是 JS 动态渲的，不在 ranking.html 静态标记里");
  }

  console.log("--- ③c 样式已就位 ---");
  [".rank-panel", ".rank-head", ".rank-row", ".rank-empty", ".rank-actions",
   ".rank-meta", ".rk-total", ".rank-toast", ".rank-live", ".rk-team",
   ".rk-yuan"].forEach(function(sel){
    eq(CSS.indexOf(sel + "{") > -1 || CSS.indexOf(sel + " ") > -1 ||
       CSS.indexOf(sel + ",") > -1 || new RegExp(sel.replace(".", "\\.") + "[\\s,{]").test(CSS),
       true, "css 里有 " + sel + " 规则");
  });
  eq(/\.rank-row\.top1/.test(CSS), true, "前三名有专属高亮（top1/top2/top3）");
  eq(/\.rank-row\.top3/.test(CSS), true, "…含 top3");
  eq(/@media \(max-width:720px\)[\s\S]*?\.rank-panel/.test(CSS), true, "窄屏有专属适配");
  eq(/--rk-cols/.test(CSS), true, "列宽由 CSS 变量统一控制（表头与数据行共用，天然对齐）");
  eq(/\.rank-panel\{[^}]*--rk-cols:54px minmax\(0,1fr\) 82px 62px 78px 96px 106px/.test(CSS), true,
     "7 列模板：名次 54 / 选手 弹性 / 基础分 82 / 倍率 62 / 团队加分 78 / 源石锭消耗 96 / 总分 106");
  // 源石锭消耗必须显式指定绿色
  eq(/\.rank-row \.rk-yuan\{[^}]*color:var\(--accent-3\)/.test(CSS), true,
     "源石锭消耗列显式用绿色（--accent-3 = #00ffa3）");
  eq(/--accent-3:#00ffa3/.test(CSS), true, "…且 --accent-3 确实是绿色 #00ffa3");
  // 窄屏必须保留团队加分与源石锭消耗列
  eq(/\.rank-row \.rk-num:not\(\.rk-total\):not\(\.rk-team\):not\(\.rk-yuan\)\{display:none\}/.test(CSS),
     true, "窄屏只隐藏基础分/倍率两列，团队加分与源石锭消耗都保留");
  eq(/\.rank-panel\{[^}]*--rk-cols:40px minmax\(0,1fr\) 72px 90px 92px/.test(CSS), true,
     "窄屏列模板是 5 列（名次/选手/团队加分/源石锭消耗/总分）");
  eq(/\.rank-toast\.ok/.test(CSS), true, "成功提示有绿色态");
  eq(/\.rank-toast\.err/.test(CSS), true, "失败提示有红色态");
  eq(/@keyframes rankPulse/.test(CSS), true, "「实时」呼吸灯动效仍在");

  console.log("--- ③c2 行尾删除键（向左拖动唤起，2026-09-24） ---");
  eq(/\.rank-head,\.rank-row\{[^}]*grid-template-columns:var\(--rk-cols\) var\(--rk-del-w\)/.test(CSS),
     true, "行模板在 7 列之后**预留第 8 条轨道**（--rk-del-w）给行尾删除键");
  eq(/--rk-del-w:28px/.test(CSS), true, "--rk-del-w 默认 28px（宽屏）");
  eq(/@media \(max-width:720px\)[\s\S]*--rk-del-w:24px/.test(CSS), true,
     "窄屏把删除键轨道收窄到 24px（给选手名多留点宽度）");
  eq(/\.rank-row \.row-del\{[^}]*visibility:hidden/.test(CSS), true,
     "删除键默认 visibility:hidden（保留占位：不进 Tab 序、不参与命中测试）");
  eq(/\.rank-row\.is-armed\{/.test(CSS), true, "被点亮的那一行（.is-armed）有专属高亮");
  eq(/\.rank-row\.is-armed \.row-del\{visibility:visible/.test(CSS), true,
     "行被点亮后删除键才 visible");
  eq(/\.rank-row \.row-del\{[^}]*color:var\(--danger\)/.test(CSS), true, "删除键用危险色 --danger");
  eq(/\.rank-row \.row-del\{[^}]*cursor:pointer/.test(CSS), true, "删除键是可点的（cursor:pointer）");
  // 拖动相关：跟手位移 + 触屏横向手势留给 JS
  eq(/\.rank-row > \.rk-col\{[^}]*transition:transform/.test(CSS), true,
     "数据格带 transform 过渡（松手后平滑归位）");
  eq(/\.rank-row\.is-swiping > \.rk-col\{transition:none\}/.test(CSS), true,
     "跟手期间关掉过渡（否则位移追不上手指）");
  eq(/\.rank-row\{[^}]*touch-action:pan-y/.test(CSS), true,
     "touch-action:pan-y —— 触屏上纵向留给页面滚动、横向留给手势");

  console.log("--- ③d 「清空榜单」红色按键（2026-09-23 新增） ---");
  const RJ = fs.readFileSync(path.join(__dirname, "..", "js", "ranking.js"), "utf8");
  // 手势：向左拖动（2026-09-24，取代原先的双击）
  eq(/SWIPE_TRIGGER = \d+/.test(RJ), true, "有 SWIPE_TRIGGER 阈值常量");
  eq(/SWIPE_MAX = \d+/.test(RJ), true, "有 SWIPE_MAX 跟手位移上限常量");
  eq(/elList\.addEventListener\("pointerdown"/.test(RJ), true, "按下由 #rank-list 委托");
  eq(/document\.addEventListener\("pointermove"/.test(RJ), true,
     "移动监听 document（指针拖动中很容易滑出行外）");
  eq(/document\.addEventListener\("pointerup"/.test(RJ), true, "松手也监听 document");
  eq(/document\.addEventListener\("pointercancel", cancelSwipe\)/.test(RJ), true,
     "pointercancel 有兜底（被系统抢走指针不会卡在拖动态）");
  eq(/document\.addEventListener\("pointerdown"/.test(RJ), true,
     "「点别处收起」挂在 pointerdown（不是 click —— arm 之后紧跟的那次 click 会把它误伤）");
  /* ⚠️ 双击在 2026-09-24 回来了，但**只服务于「双击队名改队名」** ——
     删除键仍然只认「向左拖动」。这里把两件事钉开：dblclick 里认队名、不碰删除。 */
  {
    const i0 = RJ.indexOf('addEventListener("dblclick"');
    const i1 = RJ.indexOf('addEventListener("', i0 + 30);
    const dbl = i0 < 0 ? "" : RJ.slice(i0, i1 < 0 ? RJ.length : i1);
    eq(i0 > -1, true, "dblclick 监听存在（但只用于改队名）");
    eq(/data-rename-team/.test(dbl), true, "…认的是队名上的 data-rename-team");
    eq(/data-del-player/.test(dbl), false, "…与「删除选手」无关（删除仍只在向左拖动后出现）");
    eq(/data-del-team/.test(dbl), false, "…也不掺和「删除队伍」");
  }
  eq(/document\.addEventListener\("click"/.test(RJ), false, "document 上也不再有 click 监听");
  eq(/function closestRow\(/.test(RJ), true, "有 closestRow（沿 parentNode 找行，不设边界）");
  eq(/Math\.abs\(dy\) > Math\.abs\(dx\)/.test(RJ), true,
     "按支配轴分流：纵向为主就放弃本次手势（把滚动还给页面）");
  eq(/s\.dx <= -SWIPE_TRIGGER/.test(RJ), true, "只有**向左**拖够阈值才算数");
  eq(/armedRow === s\.row\) disarmRow\(\)/.test(RJ), true,
     "同一行再拖一次 = 收起（手势可逆，不必先点别处）");
  eq(/cols\[i\]\.style\.transform/.test(RJ), true, "跟手位移写在数据格的 transform 上（不引起重排）");
  eq(/<button[^>]*class="big-btn danger"[^>]*id="btn-clear-board"[^>]*>清空榜单<\/button>/.test(RHTML),
     true, "有红色（danger）的「清空榜单」按钮");
  // 位置：在「返回计分器」右侧（同一 .rank-actions 行内、DOM 顺序在其之后）
  {
    const iBack  = RHTML.indexOf('id="btn-clear-board"') > -1 ? RHTML.indexOf('id="rank-file"') : -1;
    const iClear = RHTML.indexOf('id="btn-clear-board"');
    const iBackLink = RHTML.indexOf('>返回计分器</a>');
    eq(iBackLink > -1 && iClear > iBackLink, true, "「清空榜单」排在「返回计分器」右侧（其后）");
    eq(RHTML.indexOf('class="rank-actions"') < iClear, true, "它在 .rank-actions 操作行里");
    eq(iClear > iBack, true, "它与「添加选手」「返回计分器」同一操作区");
  }
  eq(/\.big-btn\.danger\{[^}]*color:var\(--danger\)/.test(CSS), true, "danger 按钮用主题红色（--danger）");
  // 用户要求：**不要单开一行**，与「添加选手/返回计分器」同一行
  eq(/\.rank-actions #btn-clear-board\{[^}]*flex:1 1 100%/.test(CSS), false,
     "清空按钮不再独占整行（不写 flex:1 1 100%）");
  eq(/\.rank-actions #btn-clear-board\{[^}]*margin-top/.test(CSS), false,
     "不再用 margin-top 把它跟上一行拉开");
  eq(/\.rank-actions \.big-btn\{flex:0 1 \d+px/.test(CSS), true,
     "它与「添加选手/返回计分器」共用同一套 flex 宽度（天然同一行）");
  /* ⚠️ 2026-09-26 加入「导出 txt / 导入 txt」两个端点按钮后，一行里变成 6 个：
     flex 的**换行判定只看 flex-basis**（能压缩也不算数），basis 太大就会折成两行，
     两端那两个反而落不到同一行上。所以这里把「中间那组 basis ≤ 200px」钉住。 */
  {
    const m = /\.rank-actions \.big-btn\{flex:0 1 (\d+)px/.exec(CSS);
    eq(!!m && Number(m[1]) <= 200, true,
       "中间那组 flex-basis ≤200px（6 个按钮才放得进一行，实测 " + (m ? m[1] : "没写") + "px）");
  }
  // 逻辑：二次确认 + 清空 + 落盘 + 重渲染 + 提示，且暴露给调试接口
  eq(/function clearBoard\(/.test(RJ), true, "js/ranking.js 里有 clearBoard()");
  eq(/window\.confirm\(/.test(RJ), true, "清空前有 window.confirm 二次确认（不可撤销）");
  eq(/clearBoard:\s*clearBoard/.test(RJ), true, "clearBoard 暴露在 window.RANKING_PAGE 上");
  eq(/getElementById\("btn-clear-board"\)/.test(RJ), true, "绑定了 #btn-clear-board");
  eq(/elClear\.addEventListener\("click"/.test(RJ), true, "点击事件已接线");

  console.log("--- ③e 赛程切换：初赛 / 决赛（2026-09-23 新增） ---");
  eq(/<div[^>]*class="rank-modes"[^>]*id="rank-modes"/.test(RHTML), true, "有小字下方的赛程切换条");
  eq(/data-mode="prelim"[^>]*>初赛</.test(RHTML), true, "含「初赛」选项");
  eq(/data-mode="final"[^>]*>决赛</.test(RHTML), true, "含「决赛」选项");
  // 位置：在元信息行（小字）之后、表头之前
  {
    const iMeta  = RHTML.indexOf('class="rank-meta"');
    const iModes = RHTML.indexOf('id="rank-modes"');
    const iHead  = RHTML.indexOf('class="rank-head"');
    eq(iModes > iMeta, true, "切换条排在元信息小字**下方**");
    eq(iModes < iHead, true, "…且在表头之前（不打断榜单）");
  }
  eq(/class="rank-mode is-active"[^>]*data-mode="prelim"/.test(RHTML), true,
     "默认停在「初赛」（保留既有榜单与形式）");
  eq(/role="tablist"/.test(RHTML), true, "切换条是 tablist（无障碍）");
  eq(/\.rank-modes\{/.test(CSS), true, "css 里有 .rank-modes 规则");
  eq(/\.rank-mode\.is-active\{/.test(CSS), true, "css 里有选中态样式");
  // 逻辑层：两块独立榜单 + 独立存档键
  eq(/LS_KEY_PRELIM\s*=\s*"hlsh_zhoujibei_ranking_v1"/.test(RJ), true,
     "初赛沿用**原存档键**（既有数据不丢）");
  eq(/LS_KEY_FINAL\s*=\s*"hlsh_zhoujibei_ranking_final_v1"/.test(RJ), true, "决赛用**新存档键**");
  eq(/hlsh_zhoujibei_ranking_final_v1/.test(RJ) && /MODE_KEY/.test(RJ), true, "另存「上次看哪一场」");
  eq(/function setBoard\(/.test(RJ), true, "有 setBoard() 切换赛程");
  eq(/setBoard:\s*setBoard/.test(RJ), true, "setBoard 暴露给调试接口");
  eq(/currentMode:\s*currentMode/.test(RJ), true, "currentMode 暴露给调试接口");
  eq(/DATA = slots\[mode\]/.test(RJ), true, "DATA 始终指向「当前赛程」那一份（不是整份替换）");
  eq(/slots\.prelim = loadSlot\("prelim"\)/.test(RJ) && /slots\.final\s*=\s*loadSlot\("final"\)/.test(RJ),
     true, "启动时两块榜单各读各的存档");

  console.log("--- ③f 「添加队伍」按键（仅决赛显示，2026-09-23 新增） ---");
  eq(/<button[^>]*id="btn-add-team"[^>]*>添加队伍<\/button>/.test(RHTML), true, "有「添加队伍」按钮");
  eq(/class="big-btn gold"[^>]*id="btn-add-team"|id="btn-add-team"[^>]*class="big-btn gold"/
       .test(RHTML), true, "用金色（gold）与初赛的绿色「添加选手」区分");
  eq(/id="btn-add-team"[^>]*\bhidden\b|hidden[^>]*id="btn-add-team"/.test(RHTML), true,
     "HTML 里默认 hidden（初赛不该看到它）");
  // 位置：紧挨在「添加选手」左侧
  {
    const iTeam = RHTML.indexOf('id="btn-add-team"');
    const iAdd  = RHTML.indexOf('id="btn-add-player"');
    const iBack = RHTML.indexOf('>返回计分器</a>');
    eq(iTeam > -1 && iAdd > -1 && iTeam < iAdd, true,
       "「添加队伍」紧挨在「添加选手」**左侧**（DOM 顺序在前）");
    eq(iTeam > RHTML.indexOf('class="rank-actions"'), true, "它在 .rank-actions 操作行里");
    eq(iTeam < iBack, true, "…且在「返回计分器」之前（不是排到最后）");
  }
  eq(/\.big-btn\.gold\{/.test(CSS), true, "css 里有 .big-btn.gold 金色按钮样式");
  eq(/\.rank-actions #btn-add-team\{display:none\}/.test(CSS), true,
     "默认不显示（初赛隐藏）");
  eq(/\.rank-actions\[data-board="final"\] #btn-add-team\{display:inline-flex\}/.test(CSS), true,
     "决赛时（操作区 data-board=final）才显示");
  eq(/getElementById\("btn-add-team"\)/.test(RJ), true, "js 里取了 #btn-add-team");
  eq(/querySelector\("\.rank-actions"\)/.test(RJ), true, "js 里取了 .rank-actions 操作区");
  eq(/elAddTeam\.hidden = \(mode !== "final"\)/.test(RJ), true,
     "syncModeUI 里按当前赛程开关它的 hidden（逻辑层真相）");
  eq(/elActions\.setAttribute\("data-board", mode\)/.test(RJ), true,
     "同时给操作区写 data-board（供 css 显隐）");

  /* ---------- ③g 队伍功能与居中弹框（2026-09-23 实现） ----------
     用户要求：点「添加队伍」弹屏幕居中的框 → 输入队名 → 取消/确定 →
     确定后在选手栏里长出一个大框（左上角队名，参考截图）；
     点「添加选手」也弹框，选一个队伍 + 选 txt，确定后把选手录到那个队伍下。 */
  console.log("--- ③g 队伍大框 + 居中弹框（2026-09-23 实现） ---");

  // (1) 弹框是**静态标记**（写在页面里，不是 JS 拼的）——
  //     且遮罩 + 卡片 + 标题 + 内容区 + 错误位 + 取消/确定 六件套齐全
  eq(/<div[^>]*class="rank-modal"[^>]*id="rank-modal"/.test(RHTML), true,
     "页面里有居中弹框的静态标记 #rank-modal");
  eq(/id="rank-modal"[^>]*\bhidden\b|\bhidden\b[^>]*id="rank-modal"/.test(RHTML), true,
     "弹框默认 hidden（不挡着页面）");
  eq(/class="modal-card"/.test(RHTML), true, "弹框内有居中卡片 .modal-card");
  eq(/id="rank-modal-title"/.test(RHTML), true, "有标题位（添加队伍 / 添加选手 复用）");
  eq(/id="rank-modal-body"/.test(RHTML), true, "有内容区（表单塞在这里）");
  eq(/id="rank-modal-err"/.test(RHTML), true, "有错误提示位（校验失败不关窗）");
  eq(/<button[^>]*id="rank-modal-cancel"[^>]*>取消<\/button>/.test(RHTML), true,
     "有「取消」按钮");
  eq(/<button[^>]*id="rank-modal-ok"[^>]*>确定<\/button>/.test(RHTML), true,
     "有「确定」按钮");
  // 位置：在 wrapper 内、榜单面板之后（弹框是覆盖层，放哪都行，但别塞进 .rank-actions）
  {
    const iPanel = RHTML.indexOf('class="rank-actions"');
    const iModal = RHTML.indexOf('id="rank-modal"');
    const iFoot  = RHTML.indexOf('class="page-footer"');
    eq(iModal > iPanel, true, "弹框排在操作区之后（不打断按钮行）");
    eq(iModal < iFoot, true, "…且在页脚之前");
  }
  eq(/role="dialog"/.test(RHTML), true, "弹框带 role=dialog（无障碍）");
  eq(/aria-modal="true"/.test(RHTML), true, "弹框标了 aria-modal");
  eq(/aria-labelledby="rank-modal-title"/.test(RHTML), true, "用标题做无障碍名称");

  // (2) css：居中 + 遮罩 + 必须能关掉
  eq(/\.rank-modal\{[^}]*position:fixed/.test(CSS), true, "弹框是 fixed 覆盖层");
  eq(/\.rank-modal\{[^}]*align-items:center/.test(CSS), true, "竖向居中（align-items:center）");
  eq(/\.rank-modal\{[^}]*justify-content:center/.test(CSS), true, "横向居中（justify-content:center）");
  eq(/\.rank-modal\{[^}]*inset:0/.test(CSS), true, "铺满全屏（inset:0）做遮罩");
  eq(/\.rank-modal\[hidden\]\{display:none\}/.test(CSS), true,
     "⚠️ 必须显式写 [hidden]{display:none} —— 否则 display:flex 会盖掉 hidden，弹框关不掉");
  eq(/\.modal-btns\{[^}]*justify-content:flex-end/.test(CSS), true, "两个按钮在卡片右下");

  // (3) css：队伍大框（参考截图：队名左上、合计分右上）
  eq(/\.team-box\{/.test(CSS), true, "有队伍大框 .team-box");
  eq(/\.team-box-loose\{[^}]*border-style:dashed/.test(CSS), true,
     "「未分组」用虚线边框，与真实队伍区分");
  eq(/\.team-head\{[^}]*display:flex/.test(CSS), true, "队头是 flex（左队名 / 右合计分）");
  eq(/\.team-name\{[^}]*font-weight:900/.test(CSS), true, "队名是粗体大号（参考图）");
  eq(/\.team-sum\{[^}]*color:var\(--accent-3\)/.test(CSS), true,
     "队伍合计分用主题绿色（与总分列同族）");
  /* (3b) 队名左侧的次序（2026-09-24 加）
     ⚠️ 次序格必须**固定宽度**（不能靠内容撑），否则「未分组」空着时会窄一截
        → 它的队名与真实队伍对不齐。 */
  eq(/\.team-idx\{[^}]*width:\d+px/.test(CSS), true, "次序格 .team-idx 有固定宽度");
  eq(/\.team-idx\{[^}]*font-weight:900/.test(CSS), true, "次序是粗体（与名次列同族）");
  eq(/\.team-idx\{[^}]*font-variant-numeric:tabular-nums/.test(CSS), true,
     "次序用等宽数字（1/2/3 不跳宽）");
  {
    /* 窄屏也要给一条覆盖，否则 26px 的次序格在小屏上挤队名 */
    const narrow = CSS.slice(CSS.indexOf("@media (max-width:720px)"));
    eq(/\.team-idx\{[^}]*width:\d+px/.test(narrow), true, "窄屏下次序格宽度另行收紧");
  }
  /* (3c) 前 3 名队伍戴金 / 银 / 铜（与选手行 top1~top3 同色）
     ⚠️ 必须写成两个类 `.team-box.team-topN`，才稳压住 `.team-box` 自己的底色/边框。 */
  eq(/\.team-box\.team-top1\{[^}]*border-color:rgba\(255,181,71/.test(CSS), true,
     "冠军队伍框是金色边框（与选手行 top1 同色）");
  eq(/\.team-box\.team-top2\{[^}]*border-color:rgba\(200,214,232/.test(CSS), true, "亚军银色");
  eq(/\.team-box\.team-top3\{[^}]*border-color:rgba\(214,146,90/.test(CSS), true, "季军铜色");
  eq(/\.team-box\.team-top1 \.team-idx\{[^}]*color:#ffb547/.test(CSS), true,
     "冠军左上角的次序也染成金色");
  eq(/\.team-box\.team-top2 \.team-idx\{[^}]*color:#c8d6e8/.test(CSS), true, "亚军次序银色");
  eq(/\.team-box\.team-top3 \.team-idx\{[^}]*color:#d6925a/.test(CSS), true, "季军次序铜色");
  eq(/\.team-box\.team-top\d[^{]*\{[^}]*border-style/.test(CSS), false,
     "冠亚季只改颜色，**不该**动 border-style（虚线是「未分组」的专属视觉）");

  /* (3d) 全队源石锭消耗（2026-09-24 加）
     ⚠️ 与合计分**同一种绿**（用户要求「同样用绿色标注」），所以必须靠
        「小标签 + 更小字号」把两者区分开，否则两个绿色数字并排分不清。 */
  eq(/\.team-yuan\{[^}]*display:flex/.test(CSS), true, "有 .team-yuan（标签 + 数字横排）");
  eq(/\.team-yuan-num\{[^}]*color:var\(--accent-3\)/.test(CSS), true,
     "全队源石锭用主题绿（与合计分、源石锭列同族）");
  eq(/\.team-yuan-label\{/.test(CSS), true, "带一个弱化小标签，两个绿色数字才分得清");
  /* 「已使用 / 剩余」两块（2026-09-25 加）：每块自己是一个 .team-yuan-item */
  eq(/\.team-yuan-item\{[^}]*display:flex/.test(CSS), true,
     "每块「标签 + 数字」自己也是一行 flex（两块并排）");
  {
    /* ⚠️ 两块之间的距离必须**大于**块内「标签↔数字」的距离：
       否则「已使用 20 剩余 100」四个元素等距排开，读不出是两个「标签+数值」对。 */
    const outer = /\.team-yuan\{[^}]*gap:(\d+)px/.exec(CSS);
    const inner = /\.team-yuan-item\{[^}]*gap:(\d+)px/.exec(CSS);
    eq(!!outer && !!inner && Number(outer[1]) > Number(inner[1]), true,
       "两块之间比块内更疏（" + (outer && outer[1]) + "px > " + (inner && inner[1]) + "px）");
  }
  /* 剩余为负（超支）→ 整块转红（数值照印，不 clamp 成 0） */
  eq(/\.team-yuan-item\.is-over \.team-yuan-num\{[^}]*color:var\(--danger\)/.test(CSS), true,
     "剩余为负时整块转红（read 成「超支」而不是「用完」）");
  {
    /* ⚠️ 源石锭是次要信息：字号必须**小于**合计分，否则抢掉合计分的视觉重心 */
    const num = /\.team-yuan-num\{[^}]*font-size:([\d.]+)px/.exec(CSS);
    const sum = /\.team-sum\{[^}]*font-size:([\d.]+)px/.exec(CSS);
    eq(!!num && !!sum && Number(num[1]) < Number(sum[1]), true,
       "源石锭字号小于合计分（" + (num && num[1]) + " < " + (sum && sum[1]) + "）");
    const narrow = CSS.slice(CSS.indexOf("@media (max-width:720px)"));
    eq(/\.team-yuan-num\{[^}]*font-size:\d/.test(narrow), true, "窄屏下源石锭字号再收一档");
    eq(/\.team-yuan-label\{[^}]*font-size:\d/.test(narrow), true, "……标签同样收紧");
    eq(/\.team-yuan-item\{[^}]*gap:\d/.test(narrow), true, "……两块之间也收紧（窄屏一行挤得下）");
  }

  // (4) js：队伍数据模型与接口
  eq(/var NO_TEAM = "未分组"/.test(RJ), true, "有「未分组」虚拟分组常量");
  eq(/function normTeamName\(/.test(RJ), true, "有队名规范化 normTeamName()");
  eq(/function addTeam\(/.test(RJ), true, "有 addTeam()");
  eq(/function removeTeam\(/.test(RJ), true, "有 removeTeam()");
  eq(/function groupByTeam\(/.test(RJ), true, "有 groupByTeam() 分组渲染");
  eq(/function teamTotal\(/.test(RJ), true, "有 teamTotal() 队伍合计分");
  /* 全队源石锭（2026-09-24 加已使用、2026-09-25 加剩余）：与合计分**并列展示**，但不参与排序 */
  eq(/function teamYuan\(/.test(RJ), true, "有 teamYuan() 全队已使用源石锭");
  eq(/teamYuan:\s*teamYuan/.test(RJ), true, "teamYuan() 也暴露给调试接口");
  /* 「剩余」的基准来自**计分器页面设置的决赛初始余额**（2026-09-25 用户要求） */
  eq(/function teamYuanRest\(/.test(RJ), true, "有 teamYuanRest() 全队剩余源石锭");
  eq(/function yuanInitFinal\(/.test(RJ), true, "有 yuanInitFinal() 取「决赛初始余额」");
  eq(/var COUNTER_KEY = "hlsh_zhoujibei_counter_v1"/.test(RJ), true,
     "基准读的是**计分器**的存档键（榜单页不引入 app.js，只能去读那份档）");
  eq(/o\.yuanInitFinal/.test(RJ), true, "取的是计分器存档里的 yuanInitFinal 字段（齿轮弹框改的就是它）");
  eq(/YUAN_INIT_FINAL_FALLBACK = 120/.test(RJ), true,
     "读不到时回落出厂默认 120（与 app.js 的 YUAN_INIT_FINAL 一致）");
  eq(/return yuanInitFinal\(\) - teamYuan\(name\)/.test(RJ), true,
     "剩余 = 决赛初始余额 − 全队已使用");
  eq(/teamYuanRest:\s*teamYuanRest/.test(RJ) && /yuanInitFinal:\s*yuanInitFinal/.test(RJ), true,
     "两个新接口都暴露给调试接口");
  {
    /* ⚠️ 只读不写：榜单页**绝不能**反手去写计分器的存档（那是计分器的地盘） */
    const at = RJ.indexOf("function yuanInitFinal(){");
    const seg = RJ.slice(at, RJ.indexOf("function teamYuanRest("));
    eq(/setItem/.test(seg), false, "读余额那段里不许出现 setItem（只读不写）");
  }
  eq(/yuanTotal: sumYuan\(b\.members\)/.test(RJ), true, "groupByTeam() 给每队算出 yuanTotal");
  eq(/return s \+ \(r\.yuan \|\| 0\);/.test(RJ), true,
     "yuanTotal = 队内成员 yuan 之和（yuan 缺失的老存档按 0，不产出 NaN）");
  eq(/yuanTotal: 0/.test(RJ), true, "空队兜底路径也带 yuanTotal:0（框上不会印 undefined）");
  {
    /* ⚠️⚠️ 源石锭**只展示、不排序**：排序段里绝不许出现 yuanTotal */
    const at = RJ.indexOf("}).sort(function(a, b){");
    const seg = RJ.slice(at, at + 200);
    eq(/a\.total|b\.total/.test(seg) && !/yuanTotal/.test(seg), true,
       "队伍排序只看合计分（源石锭再高也不改次序）");
  }
  eq(/addTeam:\s*addTeam/.test(RJ) && /removeTeam:\s*removeTeam/.test(RJ) &&
     /groupByTeam:\s*groupByTeam/.test(RJ), true, "三个队伍接口都暴露给调试接口");
  eq(/teams:\s*\[\]/.test(RJ), true, "榜单形状里有 teams 数组（决赛的建队列表）");
  /* 次序由 groupByTeam() 算：真实队伍编 1、2、3…，「未分组」idx=0（不编号）且 push 到最后。
     ⚠️ 以前是 unshift 到最前；2026-09-24 用户改成「固定最后、不编号」，别改回去。 */
  eq(/groups\.forEach\(function\(g, i\)\{ g\.idx = i \+ 1; \}\)/.test(RJ), true,
     "真实队伍按排序结果依次编上 idx（1、2、3…）");
  eq(/loose\.idx = 0/.test(RJ), true, "「未分组」idx=0（不编号）");
  eq(/groups\.push\(loose\)/.test(RJ), true, "「未分组」push 到最后（不是 unshift）");
  eq(/groups\.unshift\(loose\)/.test(RJ), false, "……确实不再用 unshift 顶到最前");
  /* 队头渲染：次序格**永远渲染**（未分组只是留空），且排在队名之前 */
  eq(/idxEl\.className = "team-idx"/.test(RJ), true, "渲染 .team-idx");
  eq(/head\.appendChild\(idxEl\);\s*\n\s*head\.appendChild\(nameEl\)/.test(RJ), true,
     "次序格 append 在队名**之前**（队名左侧）");
  eq(/team-idx-none/.test(RJ), true, "「未分组」用 team-idx-none 标出（占位不编号）");
  /* 冠亚季皮：**按 idx 判**，不是按数组下标 —— 否则「未分组」跟着名次乱吃皮 */
  eq(/if\(g\.idx >= 1 && g\.idx <= 3\) cls \+= " team-top" \+ g\.idx/.test(RJ), true,
     "前 3 名队伍框按 g.idx 加 team-top1/2/3");
  eq(/if\(Array\.isArray\(o\.teams\)\) d\.teams = o\.teams/.test(RJ), true,
     "loadSlot 会读回 teams（存档往返）");
  eq(/teams: Array\.isArray\(d\.teams\) \? d\.teams : \[\]/.test(RJ), true,
     "saveData 会把 teams 一起写进存档");
  eq(/DATA\.teams = \[\]/.test(RJ), true, "清空榜单时队伍一起清（不留空壳队框）");

  // (5) js：两条弹框路径
  eq(/function openAddTeamModal\(/.test(RJ), true, "有「添加队伍」弹框");
  eq(/function openAddPlayerModal\(/.test(RJ), true, "有「添加选手」弹框");
  eq(/openAddTeamModal:\s*openAddTeamModal/.test(RJ) &&
     /openAddPlayerModal:\s*openAddPlayerModal/.test(RJ), true, "两个弹框都暴露给调试接口");
  eq(/function modalConfirm\(/.test(RJ) && /function modalClose\(/.test(RJ), true,
     "有弹框确定 / 关闭两个入口");
  eq(/elModalCancel\.addEventListener\("click", modalClose\)/.test(RJ), true,
     "「取消」接线到 modalClose");
  eq(/elModalOk\.addEventListener\("click", modalConfirm\)/.test(RJ), true,
     "「确定」接线到 modalConfirm");
  eq(/ev\.target === elModal/.test(RJ), true, "点遮罩空白处 = 取消（点卡片内不算）");
  eq(/ev\.key === "Escape"/.test(RJ), true, "Esc 也能关弹框");
  // 添加选手弹框里要有「选队伍」的下拉（仅决赛）与文件选择
  eq(/createElement\("select"\)/.test(RJ), true, "「添加选手」弹框里有队伍下拉");
  eq(/opt0\.textContent = NO_TEAM/.test(RJ), true, "下拉里带「未分组」（可以不归队就加人）");
  eq(/fileInp\.multiple = true/.test(RJ), true, "文件选择支持多选");
  eq(/ingest\(files, team\)/.test(RJ), true, "确定时把所选队伍一并交给 ingest");
  eq(/function ingest\(files, league\)/.test(RJ), true, "ingest 接受第二个参数：归到哪个队");
  eq(/ev\.isComposing \|\| ev\.keyCode === 229/.test(RJ), true,
     "队名输入框的回车挡掉输入法组字（与计分器同款）");
  eq(/data-del-team/.test(RJ), true, "队伍框上有删除键（事件委托）");
  eq(/removeTeam\(name\)/.test(RJ), true, "删除队伍走 removeTeam()");

  console.log("--- 数据文件结构 ---");
  eq(RDATA.indexOf("window.RANKING_DATA") > -1, true, "数据挂在 window.RANKING_DATA");
  eq(/updatedAt/.test(RDATA), true, "含 updatedAt（更新时间）");
  eq(/list:/.test(RDATA), true, "含 list 数组");
  eq(/list:\s*\[\]/.test(RDATA), true, "list 默认是空数组（示例数据已按要求清空）");
  eq(/team\s+团队加分/.test(RDATA), true, "数据文件注释里记录了 team = 团队加分字段");
  eq(/yuan\s+源石锭消耗/.test(RDATA), true, "数据文件注释里记录了 yuan = 源石锭消耗字段");
}

/* ======================================================================
   26. js/ranking.js（真跑一遍）
        ① 渲染：降序 + 并列名次 + 5 列结构 + 空态；
        ② 解析：parseExport() 从计分器导出的 txt 里抠出四个值；
        ③ 入库：ingest() 同名覆盖、失败反馈。
   ====================================================================== */
console.log("\n========== 26. ranking.js 渲染 / 解析 / 入库 ==========");
{
  const RJ = fs.readFileSync(path.join(__dirname, "..", "js", "ranking.js"), "utf8");

  /* 一个够用的 DOM 桩：getElementById / createElement / createDocumentFragment。
     注意 appendChild(fragment) 必须**先快照再清空** children，否则遍历时边加边改会漏掉行。 */
  function makePage(localStore){
    const made = {};
    const mk = (tag) => {
      const set = new Set();
      const e = {
        tag, children: [], className: "", textContent: "", hidden: false, attrs: {},
        _parent: null, _html: "",
        // 真实元素必有 style：拖动跟手时源码会把位移写进 data 格的 style.transform
        style: { transform: "" },
        // 真 DOM 里 tagName 是**大写**的（"INPUT"/"SELECT"）；桩里照做，免得断言各写各的
        get tagName(){ return String(tag).toUpperCase(); },
        appendChild(c){
          if(c && c._frag && c.children){
            c.children.slice().forEach(k => e.appendChild(k));
            c.children.length = 0;
            return c;
          }
          if(c._parent) c._parent.removeChild(c);
          c._parent = e; e.children.push(c);
          return c;
        },
        removeChild(c){ const i = e.children.indexOf(c); if(i > -1) e.children.splice(i, 1); if(c) c._parent = null; return c; },
        // 双击改名要把输入框/对勾插在队名**前面**（队名被 css 藏起来让位）
        // ⚠️ 与 makeEl 同款：必须**无条件**先从旧父节点摘掉（insertBefore 是「搬家」不是「复制」）
        insertBefore(c, ref){
          if(c._parent) c._parent.removeChild(c);
          const i = ref ? e.children.indexOf(ref) : -1;
          if(i > -1) e.children.splice(i, 0, c); else e.children.push(c);
          c._parent = e;
          return c;
        },
        setAttribute(k, v){ e.attrs[k] = v; },
        getAttribute(k){ return (k in e.attrs) ? e.attrs[k] : null; },
        // 元素上的 querySelectorAll：只服务「在胶囊里找 .rank-mode」这一种用法
        querySelectorAll(sel){
          if(sel === ".rank-mode") return e.children.filter(c => (c.className || "").indexOf("rank-mode") > -1);
          return [];
        },
        // 元素上的 querySelector：只服务弹框里「自动聚焦第一个可输入控件」
        querySelector(sel){
          if(sel === "input, select"){
            const hit = (function walk(n){
              for(const c of n.children){
                if(/modal-input|modal-select|modal-file/.test(c.className || "")) return c;
                const d = walk(c); if(d) return d;
              }
              return null;
            })(e);
            return hit;
          }
          return null;
        },
        focus(){ e._focused = true; },
        // 真 DOM 里 parentNode 就是父元素；ranking.js 的事件委托要沿它往上找行/删除键
        get parentNode(){ return e._parent; },
        contains(node){ let p = node; while(p){ if(p === e) return true; p = p._parent; } return false; },
        addEventListener(ev, fn){ e.handlers = e.handlers || {}; e.handlers[ev] = fn; },
        /* ⚠️ 真 DOM 的 click() 会派发一个 Event（`target` 指向被点的元素）。
           桩里同样给一个 target —— 否则挂在**容器**上做事件委托的处理器
           （赛程胶囊、队伍删除键）一取 `ev.target` 就 TypeError。 */
        click(ev){ if(e.handlers && e.handlers.click) e.handlers.click(ev || { target: e }); },
        // 真 DOM 的 click 会派发一个 Event（`target` 指向被点的元素）
        classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) }
      };
      Object.defineProperty(e, "innerHTML", {
        get(){ return e._html; },
        set(v){ e._html = String(v); if(v === ""){ e.children.forEach(c => c._parent = null); e.children.length = 0; } },
        enumerable: true, configurable: true
      });
      return e;
    };
    ["rank-list", "rank-empty", "rank-count", "rank-time",
     "rank-toast", "rank-file", "btn-add-player", "rank-modes",
     "btn-add-team", "rank-actions"].forEach(id => { made[id] = mk("div"); });
    // 「清空榜单」红色按键（2026-09-23 新增）
    made["btn-clear-board"] = mk("button");
    // 「导出 txt」「导入 txt」（2026-09-26 新增：钉在操作区的最左 / 最右）
    made["btn-export-board"] = mk("button");
    made["btn-import-board"] = mk("button");
    // 居中弹框（2026-09-23 新增：添加队伍 / 添加选手共用）
    ["rank-modal", "rank-modal-title", "rank-modal-body",
     "rank-modal-ok", "rank-modal-cancel", "rank-modal-err"].forEach(id => {
      made[id] = mk(id === "rank-modal-ok" || id === "rank-modal-cancel" ? "button" : "div");
    });
    made["rank-modal"].hidden = true;
    // 赛程切换的两个标签：带上 data-mode 与 rank-mode 类（与真实页面同构），
    // setBoard/syncModeUI/事件委托都靠它们认人
    made["rank-modes"].children = ["prelim", "final"].map(m => {
      const b = mk("button");
      b.className = "rank-mode" + (m === "prelim" ? " is-active" : "");
      b.setAttribute("data-mode", m);
      b._parent = made["rank-modes"];
      return b;
    });
    // 面板（setBoard 会给它写 data-board）
    made["__panel"] = mk("section");
    made["__panel"].className = "panel rank-panel";
    // 拖拽幽灵挂在 document.body 上（真 DOM 就是这样）—— 桩里也给它一个，
    // 免得回落到 #rank-list、把「队伍框共 N 个」这类按 children 数数的断言带歪
    made["__body"] = mk("div");

    const doc = {
      createElement: mk,
      createDocumentFragment(){ const f = mk("fragment"); f._frag = true; return f; },
      body: made["__body"],
      getElementById(id){ return made[id] || null; },
      // ranking.js 用 querySelectorAll 遍历胶囊里的按钮 —— 桩里只能认识那一个容器
      querySelector(sel){
        if(sel === ".rank-panel") return made["__panel"];
        if(sel === ".rank-actions") return made["rank-actions"];
        return null;
      },
      querySelectorAll(sel){
        if(sel === ".rank-mode") return made["rank-modes"].children;
        return [];
      },
      // Esc 关弹框挂在这上面（桩里只记下来，需要时手工触发）
      addEventListener(ev, fn){ doc.handlers = doc.handlers || {}; doc.handlers[ev] = fn; },
      handlers: {}
    };
    const win = {
      /* window 级的监听（目前只有 `storage`：计分器在别的标签页改了余额 → 榜单重算）。
         ⚠️ 桩里默认是 undefined，源码会判存在性；给上之后才测得到「自动跟着变」。 */
      handlers: {},
      addEventListener(ev, fn){ win.handlers[ev] = fn; },
      RANKING_DATA: { updatedAt: "", list: [] },
      localStorage: localStore || (function(){
        const s = {};
        return { getItem: k => (k in s ? s[k] : null),
                 setItem: (k, v) => { s[k] = String(v); },
                 removeItem: k => { delete s[k]; } };
      })()
    };
    // eslint-disable-next-line no-new-func
    new Function("window", "document", RJ)(win, doc);
    return { made, win, doc, P: win.RANKING_PAGE };
  }

  /* ---------- ① 渲染 ---------- */
  console.log("--- ① 降序 + 并列名次 + 7 数据格（+ 行尾删除键） ---");
  const page = makePage();
  eq(typeof page.P, "object", "暴露 window.RANKING_PAGE 调试接口");
  eq(page.P.LS_KEY, "hlsh_zhoujibei_ranking_v1", "榜单自己的 localStorage 键");

  page.P.setData({
    updatedAt: "2026-09-23 22:00",
    list: [
      { name: "甲", base: 100, multiplier: 1,   team: 0,   yuan: 12, total: 100 },
      { name: "乙", base: 100, multiplier: 1.3, team: 0,   yuan: 30, total: 130 },
      { name: "丙", base: 200, multiplier: 1,   team: 60,  yuan: 5,  total: 260 },
      { name: "丁", base: 100, multiplier: 1,   team: 0,   yuan: 0,  total: 100 },   // 与甲并列
      { name: "",  base: 999, multiplier: 9,   team: 999,  yuan: 999, total: 999 }   // 无名 → 丢弃
    ]
  });
  const rows = page.P.render();
  eq(rows.length, 4, "无名记录被丢弃（5 条 → 4 条）");
  eq(rows.map(r => r.name), ["丙", "乙", "甲", "丁"], "按总分降序");
  eq(rows.map(r => r.total), [260, 130, 100, 100], "总分原样取自记录（不再本地重算）");
  eq(rows.map(r => r.team), [60, 0, 0, 0], "团队加分原样带出");
  eq(rows.map(r => r.yuan), [5, 30, 12, 0], "源石锭消耗原样带出（跟着各自的行走）");
  eq(rows.map(r => r.rank), [1, 2, 3, 3], "名次 1,2,3,3（总分相同则名次相同）");

  const made = page.made;
  eq(made["rank-count"].textContent, "4", "元信息行显示人数 4");
  eq(made["rank-time"].textContent, "2026-09-23 22:00", "元信息行显示更新时间");
  eq(made["rank-empty"].hidden, true, "有数据时空态隐藏");
  eq(made["rank-list"].children.length, 4, "渲染出 4 行");
  const r0 = made["rank-list"].children[0];
  eq(r0.className, "rank-row top1", "第一名带 top1 高亮");
  eq(r0.children.length, 8, "每行 8 格 = 7 个数据格 + 行尾 1 个删除键");
  eq(r0.children.slice(0, 7).map(c => c.className),
     ["rk-col rk-pos", "rk-col rk-name", "rk-col rk-num", "rk-col rk-num",
      "rk-col rk-num rk-team", "rk-col rk-num rk-yuan", "rk-col rk-num rk-total"],
     "前 7 格类名依次为 名次/选手/基础分/倍率/团队加分/源石锭消耗/总分");
  eq(r0.children[7].className, "row-del", "第 8 格是行尾删除键 .row-del");
  eq(r0.children[7].attrs["data-del-player"], "丙", "删除键带着选手名（.attrs 是桩里的属性袋）");
  eq(r0.children[7].textContent, "✕", "删除键是个 ✕");
  eq(r0.children[1].textContent, "丙", "第 2 格是选手名");
  eq(r0.children[2].textContent, "+200", "基础分带正号（与计分器 signed 同口径）");
  eq(r0.children[3].textContent, "×1", "倍率为 1 时显示 ×1");
  eq(r0.children[4].textContent, "+60", "第 5 格是团队加分（带正号）");
  eq(r0.children[5].textContent, "5", "第 6 格是源石锭消耗（不带正负号，直接印数值）");
  eq(r0.children[6].textContent, "260", "最后一格是总分");
  // 团队加分为 0 时显示 "0"；源石锭消耗亦然（保证每行列数固定，与表头对齐）
  eq(made["rank-list"].children[1].children[4].textContent, "0", "团队加分为 0 时显示 0（不留空）");
  eq(made["rank-list"].children[1].children[5].textContent, "30", "源石锭消耗跟着行取值（乙 = 30）");
  eq(made["rank-list"].children[3].children[5].textContent, "0", "源石锭消耗为 0 时显示 0（不留空）");
  eq(made["rank-list"].children[3].children.length, 8, "…且格数固定 8（7 数据 + 1 删除键）");
  // 并列：第 3、4 行总分相同，名次都是 3。
  //   注意 top3 高亮是按**名次**给的，所以并列第 3 的两行都会带 top3
  //   （这正是想要的效果：并列领奖台要么都上，要么都不上）。
  eq(made["rank-list"].children[2].className, "rank-row top3", "并列第 3 的第 3 行带 top3");
  eq(made["rank-list"].children[3].className, "rank-row top3", "并列第 3 的第 4 行同样带 top3");
  eq(made["rank-list"].children[3].children[0].textContent, "3", "并列时名次仍显示 3");
  // 第 3 名之后不再高亮
  {
    page.P.setData({ updatedAt: "", list: [
      { name: "A", base: 40, multiplier: 1, total: 40 },
      { name: "B", base: 30, multiplier: 1, total: 30 },
      { name: "C", base: 20, multiplier: 1, total: 20 },
      { name: "D", base: 10, multiplier: 1, total: 10 }
    ]});
    page.P.render();
    eq(made["rank-list"].children.map(c => c.className),
       ["rank-row top1", "rank-row top2", "rank-row top3", "rank-row"],
       "只有前三名带高亮，第 4 名是纯 rank-row");
  }
  page.P.setData({ updatedAt: "2026-09-23 22:00", list: [
    { name: "甲", base: 100, multiplier: 1,   team: 0,  yuan: 12, total: 100 },
    { name: "乙", base: 100, multiplier: 1.3, team: 0,  yuan: 30, total: 130 },
    { name: "丙", base: 200, multiplier: 1,   team: 60, yuan: 5,  total: 260 },
    { name: "丁", base: 100, multiplier: 1,   team: 0,  yuan: 0,  total: 100 }
  ]});
  page.P.render();

  console.log("--- ①a2 团队加分 / 源石锭消耗两列的边界 ---");
  {
    page.P.setData({ list: [
      { name: "缺两值", base: 10,  multiplier: 1,                    total: 10 },     // 两个字段都缺
      { name: "负团队", base: 100, multiplier: 1, team: -40, yuan: 0,   total: 60 },  // 负团队分
      { name: "小数",   base: 100, multiplier: 1, team: 12.5, yuan: 7.5, total: 112.5 },
      { name: "大消耗", base: 100, multiplier: 1, team: 0,  yuan: 120, total: 100 }
    ]});
    const rt = page.P.render();
    // ⚠️ 注意 rows 是按总分降序的：小数 112.5 > 大消耗 100 > 负团队 60 > 缺两值 10
    eq(rt.map(r => r.name), ["小数", "大消耗", "负团队", "缺两值"], "按总分降序");
    eq(rt.map(r => r.team), [12.5, 0, -40, 0], "team 缺失按 0、负值与小数都原样保留");
    eq(rt.map(r => r.yuan), [7.5, 120, 0, 0], "yuan 缺失按 0、小数保留、大值不截断");
    const byName = (n) => made["rank-list"].children.find(c => c.children[1].textContent.indexOf(n) === 0);
    eq(byName("缺两值").children[4].textContent, "0", "无 team 字段 → 团队格显示 0");
    eq(byName("缺两值").children[5].textContent, "0", "无 yuan 字段 → 源石锭格显示 0");
    eq(byName("负团队").children[4].textContent, "-40", "负团队分带负号");
    eq(byName("小数").children[4].textContent, "+12.5", "小数团队分保留 1 位并带正号");
    eq(byName("小数").children[5].textContent, "7.5", "小数源石锭消耗保留 1 位");
    eq(byName("大消耗").children[5].textContent, "120", "源石锭消耗可大于初赛余额（原样显示）");
    eq(byName("负团队").children[6].textContent, "60", "总分照旧按记录里的值显示（不做重算）");
  }
  page.P.setData({ updatedAt: "2026-09-23 22:00", list: [
    { name: "甲", base: 100, multiplier: 1,   team: 0,  yuan: 12, total: 100 },
    { name: "乙", base: 100, multiplier: 1.3, team: 0,  yuan: 30, total: 130 },
    { name: "丙", base: 200, multiplier: 1,   team: 60, yuan: 5,  total: 260 },
    { name: "丁", base: 100, multiplier: 1,   team: 0,  yuan: 0,  total: 100 }
  ]});
  page.P.render();

  console.log("--- ①b 倍率显示与负分 ---");
  page.P.setData({ updatedAt: "", list: [
    { name: "沉沦者", base: 100, multiplier: 1.3, team: 0, yuan: 8, total: 130 },
    { name: "负分",   base: -50, multiplier: 1,   team: 0, yuan: 0, total: -50 }
  ]});
  const rows2 = page.P.render();
  eq(rows2.map(r => r.name), ["沉沦者", "负分"], "负分排在后（不夹到 0）");
  eq(made["rank-list"].children[0].children[3].textContent, "×1.3", "倍率 1.3 原样显示");
  // ⚠️ 总分是第 7 格（children[6]）—— 团队加分、源石锭消耗插进来后下标整体后移了两位
  eq(made["rank-list"].children[1].children[6].className, "rk-col rk-num rk-total negative",
     "负总分带 negative 类（红色渐变）");
  eq(made["rank-list"].children[1].children[6].textContent, "-50", "负总分保留");

  console.log("--- ①c 空态 ---");
  page.P.setData({ updatedAt: "", list: [] });
  const emptyRows = page.P.render();
  eq(emptyRows.length, 0, "空列表 → 0 行");
  eq(made["rank-list"].children.length, 0, "行容器被清空");
  eq(made["rank-empty"].hidden, false, "无数据时空态显示");
  eq(made["rank-count"].textContent, "0", "人数显示 0");
  eq(made["rank-time"].textContent, "—", "updatedAt 为空 → 显示破折号");

  console.log("--- ①d 非法值一律不炸 ---");
  page.P.setData({ list: [ { name: "怪", base: "abc", multiplier: -5, team: "xyz", total: null } ] });
  const junk = page.P.render();
  eq(junk.length, 1, "记录仍保留（只清洗数值）");
  eq(Number.isNaN(junk[0].total), false, "总分不会是 NaN");
  eq(junk[0].total, 0, "非法总分按 0");
  eq(junk[0].team, 0, "非法团队加分按 0");
  eq(made["rank-list"].children[0].children[3].textContent, "×1", "倍率 ≤0 退回 ×1（不吞掉基础分）");

  /* ---------- ② 解析计分器导出的 txt（纯函数，不需要 DOM） ---------- */
  console.log("--- ② parseExport()：从计分器 txt 抠六个值 ---");

  // 一份与 app.js buildExportText() 同构的样本（含【赛事规则】干扰段与尾部 DATA 行）
  //   extra.team 传 undefined → 不打印「团队得分」行（模拟初赛存档）
  //   extra.yuan 传 undefined → 干脆不打印【源石锭】整段（模拟老存档 / 手改过的 txt）
  //   extra.yuan 传 "" → 打印【源石锭】段但**不带「消耗点数」行**（另一种缺法）
  function sampleTxt(name, base, mult, total, extra){
    extra = extra || {};
    var yuanLines;
    if(extra.yuan === undefined){
      yuanLines = [];                                     // 整段缺席
    } else {
      yuanLines = [
        "",
        "【源石锭】决赛（可用 = 120 − 上一位使用）",
        "  上一位使用 ................ 25",
        "  开始前余额 ................ 95",
        "  结束后余额 ................ " + (120 - toNumLocal(extra.yuan)),
        extra.yuan === "" ? null : ("  消耗点数 .................. " + extra.yuan),
        "  可用余额 .................. 95"
      ];
    }
    return [
      "==============================================================",
      "  黑流树海粥集杯#1 计分器 · 计分存档",
      "==============================================================",
      "导出时间：2026-09-23 22:10:00",
      "格式版本：1（导入时读取文件末尾 DATA: 开头的那一行）",
      "",
      "【选手】",
      "  选手名 .................... " + name,
      "",
      "【赛事规则】共 1 条（仅供留档；导入不回读，规则以本机规则存档为准）",
      "  锁定状态 .................. 未锁定",
      "   1. 总分 = 个人基础分 × 倍率",
      "",
      "【临时招募】小计 +50",
      "  六星干员 .................. 1 个 × +50 = +50",
      "",
      "【通关结算】",
      "  结算分 .................... 300",
      "  零件数量 .................. 20",
      "  通关得分 .................. +100   （=（结算分 − 零件数量 × 5）÷ 2）",
      "",
      "--------------------------------------------------------------",
      "【总分】",
      "  个人基础分 ................ " + base,
      "  沉沦者倍率 ................ ×" + mult,
      "  个人得分 .................. " + total,
      extra.team === undefined ? null : ("  团队得分 .................. " + extra.team),
      "  总分 ...................... " + total
        + (extra.team === undefined ? "   （= 个人基础分 × 倍率）"
                                    : "   （= 个人基础分 × 倍率 + 团队得分）"),
      "=============================================================="
    ].concat(yuanLines).concat([
      "",
      "==============================================================",
      "  以上为可读汇总，仅供查看。导入时只读取下面这一行，请勿手工修改。",
      "==============================================================",
      'DATA:{"v":1,"playerName":"' + name + '","counts":{},"toggles":{}}'
    ]).filter(l => l !== null).join("\r\n");
  }
  // sampleTxt 内部的小工具（只为算出「结束后余额」）
  function toNumLocal(s){
    var n = parseFloat(String(s).replace(/[^0-9.\-−]/g, "").replace("−", "-"));
    return isFinite(n) ? n : 0;
  }

  const p1 = page.P.parseExport(sampleTxt("祁星", "+325", 1.3, "422.5", { yuan: 30 }));
  eq(p1.error, undefined, "正常导出文件解析成功");
  eq(p1.name, "祁星", "读到选手名");
  eq(p1.base, 325, "读到个人基础分（带 + 号也能解析）");
  eq(p1.multiplier, 1.3, "读到沉沦者倍率（带 × 号也能解析）");
  eq(p1.team, 0, "初赛存档没有「团队得分」行 → 团队加分按 0");
  eq(p1.yuan, 30, "从【源石锭】区读到消耗点数");
  eq(p1.total, 422.5, "读到总分");

  // 决赛：多一行「团队得分」，总分带备注括号
  const p2 = page.P.parseExport(sampleTxt("阿米娅", "+200", 1, "260", { team: 60, yuan: 12 }));
  eq(p2.error, undefined, "决赛存档（含团队得分行）也能解析");
  eq(p2.base, 200, "团队得分行不会干扰个人基础分");
  eq(p2.team, 60, "读到团队加分");
  eq(p2.yuan, 12, "决赛檔照样读到源石锭消耗");
  eq(p2.total, 260, "总分照读");
  // 团队得分 0 / 负 / 小数
  eq(page.P.parseExport(sampleTxt("零团队", "+200", 1, "200", { team: 0 })).team, 0,
     "团队得分为 0 时读作 0（而不是误判为缺失）");
  eq(page.P.parseExport(sampleTxt("负团队", "+200", 1, "140", { team: "-60" })).team, -60,
     "负团队加分能解析");
  eq(page.P.parseExport(sampleTxt("小数团队", "+200", 1, "212.5", { team: "12.5" })).team, 12.5,
     "小数团队加分能解析");

  // 源石锭消耗：0 / 小数 / 大于初赛余额 / 缺整段 / 缺那一行
  eq(page.P.parseExport(sampleTxt("零消耗", "+200", 1, "200", { yuan: "0" })).yuan, 0,
     "消耗点数为 0 时读作 0（而不是误判为缺失）");
  eq(page.P.parseExport(sampleTxt("小数消耗", "+200", 1, "200", { yuan: "7.5" })).yuan, 7.5,
     "小数消耗点数能解析");
  eq(page.P.parseExport(sampleTxt("大消耗", "+200", 1, "200", { yuan: 120 })).yuan, 120,
     "消耗点数可大于初赛固定 60（原样读，不做夹取）");
  eq(page.P.parseExport(sampleTxt("无源石段", "+200", 1, "200")).yuan, 0,
     "【源石锭】整段缺席（老存档/手改 txt）→ 消耗按 0，不算解析失败");
  eq(page.P.parseExport(sampleTxt("缺那行", "+200", 1, "200", { yuan: "" })).yuan, 0,
     "【源石锭】段在但少了「消耗点数」行 → 照样按 0");
  eq(page.P.parseExport(sampleTxt("无源石段", "+200", 1, "200")).error, undefined,
     "缺源石锭信息不影响整体解析成功");

  // 负分 + 全角符号
  const p3 = page.P.parseExport(sampleTxt("负分选手", "−50", 1, "-50", { yuan: 3 }));
  eq(p3.base, -50, "全角负号（−）能解析成负数");
  eq(p3.total, -50, "负总分保留");
  eq(p3.yuan, 3, "源石锭消耗照读（与负分互不影响）");

  // 无倍率的极端情况
  {
    const t = sampleTxt("无倍率", "+100", 1, "160").replace(/沉沦者倍率[^\r\n]*/, "");
    const p4 = page.P.parseExport(t);
    eq(p4.multiplier, 1, "倍率行缺失 → 退回 1（不吞掉基础分）");
    eq(p4.total, 160, "总分照读");
  }

  // 「团队得分」行只认【总分】区里那一行，别处的「团队」字样不该被误读
  {
    const t = sampleTxt("干扰", "+100", 1, "100")
      .replace("【赛事规则】共 1 条", "【赛事规则】共 1 条（提到团队得分 999 也不该被读）");
    eq(page.P.parseExport(t).team, 0, "【总分】区之外的「团队得分」字样不会被误读");
  }

  // 「消耗点数」只在【源石锭】区里取 —— 别处写同名字样不该被误读
  {
    const t = sampleTxt("干扰2", "+100", 1, "100", { yuan: 42 })
      .replace("【赛事规则】共 1 条", "【赛事规则】共 1 条（提到消耗点数 999）");
    eq(page.P.parseExport(t).yuan, 42, "只在【源石锭】区取「消耗点数」，别处同名字样不误读");
  }

  console.log("--- ②b 不合格的文件一律给 error（不抛异常） ---");
  eq(page.P.parseExport("").error, "文件是空的", "空文件被拒");
  eq(page.P.parseExport(null).error, "文件是空的", "null 也当空处理");
  eq(typeof page.P.parseExport("这不是计分器导出的文件").error, "string",
     "没有【总分】区的文件被拒（并给出原因）");
  eq(page.P.parseExport(sampleTxt("Player", "+1", 1, "1")).error.indexOf("Player") > -1, true,
     "选手名还是默认 Player → 拒绝并提示先填名字");

  /* ---------- ②d 分隔符 / 区块标题两种边界（2026-09-23 截图时踩到） ----------
     这份 txt 是**手工梳理过格式**的存档，两种写法都要能读：
       (1) 区块标题那一行本身含 label（`【总分】` 里有「总分」二字）→ 不该被 pick 命中；
       (2) 标签与值之间用**冒号**而不是点线 → 冒号也要剥掉，
           否则 toNum("：2405") = NaN，整条被判「没有读到总分」。 */
  console.log("--- ②d 分隔符与区块标题的边界 ---");
  {
    // 无分隔线、区块标题紧跟分隔线的「裸标题」写法
    const colonTxt = [
      "【选手】", "选手名：祁星", "==========",
      "", "【总分】",
      "个人基础分：1450", "沉沦者倍率：×1.3", "团队得分：520", "总分：2405",
      "==========", "", "【源石锭】", "消耗点数：30", "=========="
    ].join("\n");
    const pc = page.P.parseExport(colonTxt);
    eq(pc.error === undefined, true, "冒号分隔的存档能读（不报错）");
    eq(pc.total, 2405, "冒号分隔：总分读得到（标题行没被误命中）");
    eq(pc.base, 1450, "冒号分隔：个人基础分读得到");
    eq(pc.multiplier, 1.3, "冒号分隔：倍率读得到（× 也剥掉了）");
    eq(pc.team, 520, "冒号分隔：团队得分读得到");
    eq(pc.yuan, 30, "冒号分隔：消耗点数读得到");
    eq(pc.name, "祁星", "冒号分隔：选手名读得到");

    // 块首行就是标题、且总分行紧跟其后 —— 确认跳过标题后仍能取到第一项
    const headFirstTxt = [
      "【选手】", "选手名：祁星", "==========",
      "", "【总分】",
      " 个人基础分 ................ 800",
      " 总分 ...................... 800",
      "=========="
    ].join("\n");
    eq(page.P.parseExport(headFirstTxt).total, 800,
       "块首行是标题、没有前导分隔线时也能取到总分");

    // 计分器真实的点线写法保持可用
    const dottedTxt = [
      "【选手】", "  选手名 .................... 祁星", "==========",
      "", "------", "【总分】",
      "  个人基础分 ................ 1450",
      "  沉沦者倍率 ................ ×1.3",
      "  总分 ...................... 2405",
      "=========="
    ].join("\n");
    eq(page.P.parseExport(dottedTxt).total, 2405, "点线写法（计分器实际输出）照旧可用");
    eq(page.P.parseExport(dottedTxt).multiplier, 1.3, "点线写法：倍率照旧可用");
  }

  console.log("--- ②c 不读 DATA 行（避免两处各维护一份计分逻辑） ---");
  {
    const t = sampleTxt("祁星", "+325", 1.3, "422.5")
      .replace('"counts":{}', '"counts":{"six":999}');   // 篡改 DATA 行
    const p5 = page.P.parseExport(t);
    eq(p5.total, 422.5, "总分取「可读区」印好的结果，与 DATA 行内容无关");
  }

  /* ---------- ③ 入库：同名覆盖 / 失败反馈 ----------
     ingest() 内部用 FileReader + Promise，所以这一段必须 await。
     这里给 node 补一个最小的 FileReader 替身：读的就是假 file 对象上的 .text。 */
  console.log("--- ③ ingest()：同名覆盖（用户 2026-09-23 选定） ---");
  {
    global.FileReader = function(){
      const self = this;
      this.readAsText = function(file){
        Promise.resolve().then(function(){
          self.result = String(file.text);
          self.onload();
        });
      };
    };
    const settle = () => new Promise(r => setTimeout(r, 0));   // 让 ingest 的 Promise 链跑完

    const pg = makePage();
    const mk = (name, text) => ({ name, text });

    // (1) 两个文件 → 两条（其中一条是决赛档，带团队加分与源石锭消耗）
    pg.P.ingest([mk("a.txt", sampleTxt("祁星", "+100", 1, "150", { yuan: 8 })),
                 mk("b.txt", sampleTxt("阿米娅", "+200", 1, "260", { team: 60, yuan: 24 }))]);
    await settle();
    const d1 = pg.P.getData();
    eq(d1.list.length, 2, "两个文件 → 两条记录");
    eq(d1.list.map(r => r.name).sort(), ["祁星", "阿米娅"], "选手名都进去了");
    {
      const q = d1.list.find(r => r.name === "祁星");
      eq([q.base, q.multiplier, q.team, q.yuan, q.total], [100, 1, 0, 8, 150],
         "初赛那条五个值正确（团队加分 0、源石锭 8）");
    }
    {
      const q = d1.list.find(r => r.name === "阿米娅");
      eq([q.base, q.multiplier, q.team, q.yuan, q.total], [200, 1, 60, 24, 260],
         "决赛那条带上了团队加分 60、源石锭消耗 24");
    }
    eq(d1.updatedAt.length > 0, true, "写入了更新时间戳");
    eq(pg.win.localStorage.getItem(pg.P.LS_KEY) !== null, true, "已落 localStorage");
    eq(JSON.parse(pg.win.localStorage.getItem(pg.P.LS_KEY)).list.length, 2, "落盘内容含两条");
    {
      const q = JSON.parse(pg.win.localStorage.getItem(pg.P.LS_KEY)).list
        .find(r => r.name === "阿米娅");
      eq(q.team, 60, "团队加分也落了盘");
      eq(q.yuan, 24, "源石锭消耗也落了盘");
    }
    eq(pg.made["rank-toast"].hidden, false, "显示了反馈提示条");
    eq(/已上榜 2 位/.test(pg.made["rank-toast"].innerHTML), true, "提示条写明成功 2 位");
    eq(pg.made["rank-toast"].className, "rank-toast ok", "全成功 → 绿色 ok 态");
    eq(pg.made["rank-list"].children.length, 2, "界面也渲出 2 行");
    // 决赛那条（阿米娅 260）排第一，团队加分格应显示 +60，源石锭格显示 24
    eq(pg.made["rank-list"].children[0].children[1].textContent.indexOf("阿米娅"), 0,
       "决赛选手按总分排在第一");
    eq(pg.made["rank-list"].children[0].children[4].textContent, "+60", "团队加分渲染到第 5 格");
    eq(pg.made["rank-list"].children[0].children[5].textContent, "24", "源石锭消耗渲染到第 6 格");
    eq(pg.made["rank-list"].children[1].children[5].textContent, "8", "初赛选手的源石锭消耗照渲（8）");

    // (2) 同名再传一次（新分数）→ 覆盖而不是叠加
    pg.P.ingest([mk("a2.txt", sampleTxt("祁星", "+300", 1, "350", { yuan: 15 }))]);
    await settle();
    const d2 = pg.P.getData();
    eq(d2.list.length, 2, "同名覆盖：记录数仍是 2（没有变成 3）");
    eq(d2.list.find(r => r.name === "祁星").base, 300, "同名记录的四个值被新文件替换");
    eq(d2.list.find(r => r.name === "祁星").total, 350, "…总分也换新");
    eq(d2.list.find(r => r.name === "祁星").yuan, 15, "…源石锭消耗也换新（8 → 15）");

    // (2b) 同名覆盖时团队加分、源石锭也都要跟着更新（旧值 60/24 → 新值 0/0）
    pg.P.ingest([mk("amiya2.txt", sampleTxt("阿米娅", "+200", 1, "200"))]);
    await settle();
    {
      const q = pg.P.getData().list.find(r => r.name === "阿米娅");
      eq(q.team, 0, "同名覆盖时团队加分一并更新（决赛档 → 初赛档，60 → 0）");
      eq(q.yuan, 0, "同名覆盖时源石锭消耗一并更新（24 → 0，决赛档换成无【源石锭】段的旧档）");
    }

    // (3) 首尾空格 / 大小写差异也视作同名
    pg.P.ingest([mk("c.txt", sampleTxt("祁星", "+7", 1, "7").replace("祁星", " 祁星 "))]);
    await settle();
    eq(pg.P.getData().list.length, 2, "名字带首尾空格仍判为同名 → 覆盖");

    // (4) 失败文件 → 红色 + 点名原因，且不动榜单
    pg.P.ingest([mk("bad.txt", "乱七八糟")]);
    await settle();
    eq(pg.made["rank-toast"].className, "rank-toast err", "全失败 → 红色 err 态");
    eq(/bad\.txt/.test(pg.made["rank-toast"].innerHTML), true, "提示条点名了出错的文件");
    eq(pg.P.getData().list.length, 2, "失败文件不改变榜单");

    // (5) 部分成功 → 中性提示，成功的照常上榜
    pg.P.ingest([mk("good.txt", sampleTxt("诗怀雅", "+88", 1, "88")), mk("bad2.txt", "")]);
    await settle();
    eq(pg.P.getData().list.length, 3, "部分成功：成功的那条上榜");
    eq(pg.made["rank-toast"].className, "rank-toast", "部分成功 → 中性提示（不是 ok 也不是 err）");
    eq(/good\.txt/.test(pg.made["rank-toast"].innerHTML) === false &&
       /bad2\.txt/.test(pg.made["rank-toast"].innerHTML), true, "只列出出错的文件");

    // (6) 空入参不炸
    pg.P.ingest([]);
    pg.P.ingest(null);
    await settle();
    eq(pg.P.getData().list.length, 3, "空入参被安全忽略");
  }

  /* ---------- ④ 清空榜单：二次确认 / 取消不动 / 确认后清空并落盘 ---------- */
  console.log("--- ④ clearBoard()：红色按键清空当前榜单（2026-09-23 新增） ---");
  {
    const settle = () => new Promise(r => setTimeout(r, 0));
    const mk = (name, text) => ({ name, text });

    // confirm 的结果由我们控制，模拟用户点「确定」/「取消」
    function withConfirm(returnValue, fn){
      const pg = makePage();
      pg.win.confirm = function(){ return returnValue; };
      return fn(pg);
    }

    // (a) 有数据 + 用户点「取消」→ 一个字都不动
    let cancelled = null;
    withConfirm(false, function(pg){
      pg.P.setData({ updatedAt: "2026-09-23 21:00", list: [
        { name: "甲", base: 1, multiplier: 1, team: 0, yuan: 0, total: 1 },
        { name: "乙", base: 2, multiplier: 1, team: 0, yuan: 0, total: 2 }
      ]});
      pg.P.render();
      const ret = pg.P.clearBoard();
      cancelled = { ret: ret, data: pg.P.getData(), rows: pg.made["rank-list"].children.length,
                    stored: pg.win.localStorage.getItem(pg.P.LS_KEY) };
    });
    eq(cancelled.ret, false, "取消时 clearBoard 返回 false（没清）");
    eq(cancelled.data.list.length, 2, "取消后榜单仍有 2 条");
    eq(cancelled.data.updatedAt, "2026-09-23 21:00", "取消后更新时间也没被动");
    eq(cancelled.rows, 2, "取消后界面仍有 2 行");

    // (b) 有数据 + 点「确定」→ 清空、落盘、重渲染、提示
    let cleared = null;
    withConfirm(true, function(pg){
      pg.P.setData({ updatedAt: "2026-09-23 21:00", list: [
        { name: "甲", base: 1, multiplier: 1, team: 0, yuan: 0, total: 1 },
        { name: "乙", base: 2, multiplier: 1, team: 0, yuan: 0, total: 2 }
      ]});
      pg.P.render();
      const ret = pg.P.clearBoard();
      cleared = { ret: ret, data: pg.P.getData(), rows: pg.made["rank-list"].children.length,
                  emptyHidden: pg.made["rank-empty"].hidden, count: pg.made["rank-count"].textContent,
                  time: pg.made["rank-time"].textContent,
                  toast: pg.made["rank-toast"].className,
                  toastHtml: pg.made["rank-toast"].innerHTML,
                  stored: JSON.parse(pg.win.localStorage.getItem(pg.P.LS_KEY)) };
    });
    eq(cleared.ret, true, "确认时 clearBoard 返回 true");
    eq(cleared.data.list.length, 0, "确认后榜单被清空");
    eq(cleared.data.updatedAt, "", "更新时间一并复位（免得显示旧时间）");
    eq(cleared.rows, 0, "界面行被清空");
    eq(cleared.emptyHidden, false, "空态重新显示");
    eq(cleared.count, "0", "人数显示 0");
    eq(cleared.time, "—", "更新时间显示破折号");
    eq(cleared.toast, "rank-toast ok", "给出绿色提示");
    eq(/已清空/.test(cleared.toastHtml), true, "提示文案说明已清空");
    eq(cleared.stored.list.length, 0, "空榜单已落盘（刷新后仍是空的）");

    // (c) 本来就是空 → 不弹确认框（不打扰用户），只给一句提示
    {
      const pg = makePage();
      let asked = false;
      pg.win.confirm = function(){ asked = true; return true; };
      pg.P.setData({ updatedAt: "", list: [] });
      pg.P.render();
      const ret = pg.P.clearBoard();
      eq(asked, false, "空榜单点清空不弹确认框（没什么可删）");
      eq(ret, false, "空榜单返回 false（没执行清空）");
      eq(/空/.test(pg.made["rank-toast"].innerHTML), true, "只给一句「本来就空」的提示");
    }

    // (d) 清空后还能继续添加（保证不是把状态弄坏了）
    {
      const pg = makePage();
      pg.win.confirm = function(){ return true; };
      pg.P.setData({ updatedAt: "2026-09-23 21:00", list: [
        { name: "甲", base: 1, multiplier: 1, team: 0, yuan: 0, total: 1 }
      ]});
      pg.P.render();
      pg.P.clearBoard();
      eq(pg.P.getData().list.length, 0, "先清空");
      pg.P.ingest([mk("z.txt", sampleTxt("新选手", "+50", 1, "50", { yuan: 3 }))]);
      await settle();
      eq(pg.P.getData().list.length, 1, "清空后仍能正常添加上榜");
      eq(pg.P.getData().list[0].name, "新选手", "新加的那位对");
      eq(pg.P.getData().list[0].yuan, 3, "新加的源石锭消耗也进来了");
    }

    // (e) 清空**不影响**计分器存档与规则存档（榜单是独立键）
    {
      const pg = makePage();
      pg.win.confirm = function(){ return true; };
      pg.win.localStorage.setItem("hlsh_zhoujibei_counter_v1", "计分存档占位");
      pg.P.setData({ updatedAt: "x", list: [{ name: "甲", base: 1, multiplier: 1, team: 0, yuan: 0, total: 1 }] });
      pg.P.render();
      pg.P.clearBoard();
      eq(pg.win.localStorage.getItem("hlsh_zhoujibei_counter_v1"), "计分存档占位",
         "清空榜单只动榜单自己的键，不碰计分器存档");
    }
  }

  /* ---------- ⑤ 初赛 / 决赛两块独立榜单 ---------- */
  console.log("--- ⑤ setBoard()：初赛与决赛完全独立（2026-09-23 新增） ---");
  {
    const settle = () => new Promise(r => setTimeout(r, 0));
    const mk = (name, text) => ({ name, text });

    // (a) 默认是初赛，且初赛沿用原存档键
    {
      const pg = makePage();
      eq(pg.P.currentMode(), "prelim", "默认停在「初赛」");
      eq(pg.P.LS_KEY_PRELIM, "hlsh_zhoujibei_ranking_v1", "初赛键 = 原来的键");
      eq(pg.P.LS_KEY_FINAL, "hlsh_zhoujibei_ranking_final_v1", "决赛键是新的、与初赛不同");
    }

    // (b) 往初赛加人，切到决赛 → 决赛是空的；切回初赛 → 人还在
    {
      const pg = makePage();
      const load = pg.win.localStorage;
      // 模拟「初赛已有存档」（既有数据）
      load.setItem(pg.P.LS_KEY_PRELIM, JSON.stringify({
        updatedAt: "2026-09-23 20:00",
        list: [{ name: "老选手", base: 500, multiplier: 1, team: 0, yuan: 10, total: 500, addedAt: "2026-09-23 20:00" }]
      }));
      // 用同一份 localStorage 重建一个页面（模拟刷新加载）
      const pg2 = makePage(load);
      eq(pg2.P.currentMode(), "prelim", "刷新后仍在初赛");
      eq(pg2.P.getData().list.length, 1, "初赛既有数据保留（老选手）");
      eq(pg2.P.getData().list[0].name, "老选手", "…名字也对");
      eq(pg2.made["rank-list"].children.length, 1, "初赛界面渲出 1 行");

      pg2.P.setBoard("final");
      eq(pg2.P.currentMode(), "final", "切到决赛");
      eq(pg2.P.getData().list.length, 0, "决赛是**新的空榜单**（不继承初赛数据）");
      eq(pg2.made["rank-list"].children.length, 0, "决赛界面为空");
      eq(pg2.made["rank-empty"].hidden, false, "决赛显示空态");
      eq(pg2.made["rank-count"].textContent, "0", "决赛人数 0");
      eq(pg2.made["rank-time"].textContent, "—", "决赛没有更新时间");

      pg2.P.setBoard("prelim");
      eq(pg2.P.getData().list.length, 1, "切回初赛：数据还在（两块互不干扰）");
      eq(pg2.made["rank-list"].children.length, 1, "初赛界面恢复 1 行");
    }

    // (c) 决赛加人 → 只落决赛键；初赛存档一个字不动
    {
      const store = (function(){
        const s = { "hlsh_zhoujibei_ranking_v1": JSON.stringify({
          updatedAt: "2026-09-23 20:00",
          list: [{ name: "老选手", base: 500, multiplier: 1, team: 0, yuan: 10, total: 500 }]
        }) };
        return { getItem: k => (k in s ? s[k] : null),
                 setItem: (k, v) => { s[k] = String(v); },
                 removeItem: k => { delete s[k]; } };
      })();
      const pg2 = makePage(store);
      eq(pg2.P.getData().list.length, 1, "初赛既有数据保留");
      pg2.P.setBoard("final");
      pg2.P.ingest([mk("f.txt", sampleTxt("决赛选手", "+300", 1, "380", { team: 80, yuan: 40 }))]);
      await settle();
      eq(pg2.P.getData().list.length, 1, "决赛里加进 1 位");
      eq(pg2.P.getData().list[0].name, "决赛选手", "…名字对");
      eq(pg2.P.getData().list[0].team, 80, "决赛的团队加分照读");
      eq(pg2.P.getData().list[0].yuan, 40, "决赛的源石锭照读");
      // 决赛键已写
      eq(JSON.parse(store.getItem(pg2.P.LS_KEY_FINAL)).list.length, 1, "决赛数据落在决赛键上");
      // 初赛键没被动
      eq(JSON.parse(store.getItem(pg2.P.LS_KEY_PRELIM)).list.length, 1, "初赛键仍是 1 条（没被决赛带偏）");
      eq(JSON.parse(store.getItem(pg2.P.LS_KEY_PRELIM)).list[0].name, "老选手", "初赛那位的名字也没变");
      // 提示文案点名了赛程
      eq(/【决赛】/.test(pg2.made["rank-toast"].innerHTML), true, "提示文案写明「【决赛】已上榜」");
    }

    // (d) 切换会被记住（刷新后仍停在上次看的那一场）
    {
      // ⚠️ makePage 收的是「storage 对象本身」（不是字典），这样两次 makePage 才共享同一份存档
      const store = (function(){
        const s = {};
        return { getItem: k => (k in s ? s[k] : null),
                 setItem: (k, v) => { s[k] = String(v); },
                 removeItem: k => { delete s[k]; },
                 _raw: s };
      })();
      const pg = makePage(store);
      pg.P.setBoard("final");
      eq(store._raw[pg.P.MODE_KEY], "final", "切换时把当前赛程写进了 MODE_KEY");
      const pg2 = makePage(store);
      eq(pg2.P.currentMode(), "final", "再打开时停在上次的「决赛」");
    }

    // (e) 清空只清当前赛程，另一块纹丝不动
    {
      const store = (function(){
        const s = {};
        return { getItem: k => (k in s ? s[k] : null),
                 setItem: (k, v) => { s[k] = String(v); },
                 removeItem: k => { delete s[k]; },
                 _raw: s };
      })();
      const pg = makePage(store);
      pg.win.confirm = function(){ return true; };
      pg.P.setBoard("prelim");
      pg.P.ingest([mk("p.txt", sampleTxt("初赛甲", "+100", 1, "100"))]);
      await settle();
      pg.P.setBoard("final");
      pg.P.ingest([mk("f.txt", sampleTxt("决赛乙", "+200", 1, "200"))]);
      await settle();
      eq(JSON.parse(store.getItem(pg.P.LS_KEY_PRELIM)).list.length, 1, "初赛 1 条");
      eq(JSON.parse(store.getItem(pg.P.LS_KEY_FINAL)).list.length, 1, "决赛 1 条");

      // 停在决赛，点清空
      pg.P.clearBoard();
      eq(JSON.parse(store.getItem(pg.P.LS_KEY_FINAL)).list.length, 0, "决赛被清空");
      eq(JSON.parse(store.getItem(pg.P.LS_KEY_PRELIM)).list.length, 1, "初赛**不受影响**（还是 1 条）");
      eq(JSON.parse(store.getItem(pg.P.LS_KEY_PRELIM)).list[0].name, "初赛甲", "初赛那条还是原来的人");
      // 提示里点名了是「决赛」
      eq(/决赛/.test(pg.made["rank-toast"].innerHTML), true, "清空提示点名了「决赛」");

      // 切回初赛：还在
      pg.P.setBoard("prelim");
      eq(pg.P.getData().list.length, 1, "切回初赛数据还在");
    }

    // (f) 非法赛程名 → 退回初赛（不炸）
    {
      const pg = makePage();
      pg.P.setBoard("乱写");
      eq(pg.P.currentMode(), "prelim", "非法赛程名退回初赛");
      pg.P.setBoard(null);
      eq(pg.P.currentMode(), "prelim", "null 也退回初赛");
    }

    // (g) 点胶囊按钮真的会切换
    {
      const pg = makePage();
      const modes = pg.made["rank-modes"];
      eq(pg.P.currentMode(), "prelim", "起始是初赛");
      // 找到 data-mode=final 的那个按钮，点它
      const fin = modes.children.find(c => c.getAttribute("data-mode") === "final");
      eq(!!fin, true, "胶囊里有决赛按钮");
      // 模拟事件冒泡：click 处理挂在容器上，靠 target 认人
      modes.handlers = modes.handlers || {};
      modes.handlers.click && modes.handlers.click({ target: fin });
      eq(pg.P.currentMode(), "final", "点「决赛」切过去了");
      eq(fin.className.indexOf("is-active") > -1, true, "决赛标签变成选中态");
      const pre = modes.children.find(c => c.getAttribute("data-mode") === "prelim");
      eq(pre.className.indexOf("is-active") === -1, true, "初赛标签取消选中态");
      eq(pg.made["__panel"].attrs["data-board"], "final", "面板标了 data-board=final");
    }

    // (h) 「添加队伍」只在决赛出现
    {
      const pg = makePage();
      const team = pg.made["btn-add-team"];
      const acts = pg.made["rank-actions"];
      eq(!!team, true, "桩里有 #btn-add-team");
      eq(team.hidden, true, "初赛时「添加队伍」是隐藏的");
      eq(acts.attrs["data-board"], "prelim", "操作区 data-board=prelim（css 据此隐藏它）");

      pg.P.setBoard("final");
      eq(team.hidden, false, "切到决赛 →「添加队伍」显示出来");
      eq(acts.attrs["data-board"], "final", "操作区 data-board=final");

      pg.P.setBoard("prelim");
      eq(team.hidden, true, "切回初赛 → 又藏起来");
      eq(acts.attrs["data-board"], "prelim", "操作区 data-board 回到 prelim");
    }

    // (i) 「添加队伍」现在会弹居中弹框（2026-09-23 实现，取代原占位提示）
    {
      const pg = makePage();
      const team = pg.made["btn-add-team"];
      pg.P.setBoard("final");
      const before = JSON.stringify(pg.P.getData());
      eq(typeof team.handlers === "object" && typeof team.handlers.click === "function",
         true, "「添加队伍」已挂上 click 处理器");
      eq(pg.made["rank-modal"].hidden, true, "起始时弹框是关着的");
      team.click();
      eq(pg.made["rank-modal"].hidden, false, "点它 → 弹出居中弹框");
      eq(pg.P.modalIsOpen(), true, "modalIsOpen() 也认为开着");
      eq(pg.made["rank-modal-title"].textContent, "添加队伍", "弹框标题是「添加队伍」");
      eq(JSON.stringify(pg.P.getData()), before, "光开弹框不动任何榜单数据");
      pg.P.modalClose();
      eq(pg.made["rank-modal"].hidden, true, "取消 / Esc 后弹框关掉");
    }
  }

  /* ---------- ⑥ 队伍：建队 / 归队 / 分组渲染 / 合计分（2026-09-23） ----------
     用户要求：决赛里「添加队伍」→ 选手栏长出一个大框（左上角队名）；
     「添加选手」弹框选队伍 + 选 txt，确定后选手归入该队；未归队的进「未分组」。 */
  console.log("--- ⑥ 队伍分组（决赛专属） ---");
  {
    const settle = () => new Promise(r => setTimeout(r, 0));
    const mk = (name, text) => ({ name, text });
    /* 造一条决赛 txt：带团队得分（决赛才打印这一行） */
    const finalTxt = (name, base, mult, total, team) =>
      sampleTxt(name, base, mult, total, { team: team, yuan: 10 });

    // (a) 建队：规范化、重名、空名
    {
      const pg = makePage();
      pg.P.setBoard("final");
      eq(pg.P.teamList().length, 0, "决赛起始没有队伍");
      eq(pg.P.addTeam("近锋最强队").name, "近锋最强队", "能建队");
      eq(pg.P.teamList().length, 1, "队伍数 +1");
      eq(pg.P.addTeam("  近锋最强队  ").error.indexOf("已经有") > -1, true,
         "重名（含首尾空格）被拒");
      eq(pg.P.addTeam("近锋最强队").error.indexOf("已经有") > -1, true, "一字不差的重名也被拒");
      eq(pg.P.addTeam("   ").error.indexOf("不能为空") > -1, true, "纯空格队名被拒");
      eq(pg.P.addTeam("").error.indexOf("不能为空") > -1, true, "空队名被拒");
      eq(pg.P.teamList().length, 1, "被拒的都没进队伍列表");
      eq(pg.P.addTeam("  多边贸易　分队 ").name, "多边贸易 分队",
         "队名内部空白归一（全角空格也算），首尾掐掉");
      eq(pg.P.teamList().length, 2, "第二支队建起来了");
      eq(pg.P.normTeamName(null), "", "null → 空串（不炸）");
    }

    // (b) 建队会落盘，且**只落决赛键**
    {
      const store = (function(){
        const s = {};
        return { getItem: k => (k in s ? s[k] : null), setItem: (k,v) => { s[k]=String(v); },
                 removeItem: k => { delete s[k]; }, _raw: s };
      })();
      const pg = makePage(store);
      pg.P.setBoard("final");
      pg.P.addTeam("甲队");
      const saved = JSON.parse(store.getItem(pg.P.LS_KEY_FINAL));
      eq(saved.teams.length, 1, "队伍写进了决赛存档");
      eq(saved.teams[0], "甲队", "…名字对");
      eq(store.getItem(pg.P.LS_KEY_PRELIM), null, "初赛键一个字都没写");
      // 刷新（重建页面）后队伍还在
      const pg2 = makePage(store);
      eq(pg2.P.currentMode(), "final", "刷新后仍在决赛");
      eq(pg2.P.teamList().length, 1, "刷新后队伍仍记得");
    }

    // (c) 选手归队：建立后落到该队，未指定的进「未分组」
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.P.addTeam("甲队");
      pg.P.ingest([mk("a.txt", finalTxt("甲一", "+300", 1, "400", 100))], "甲队");
      await settle();
      eq(pg.P.getData().list.length, 1, "选手入库");
      eq(pg.P.getData().list[0].league, "甲队", "归到了「甲队」");

      // 不传队伍 → 未分组
      pg.P.ingest([mk("b.txt", finalTxt("散户", "+100", 1, "100", 0))]);
      await settle();
      const loose = pg.P.getData().list.find(x => x.name === "散户");
      eq(loose.league, "", "没指定队伍的选手 league 为空串");

      // 挂到一个**还没登记**的队名 → 自动建队，不会人间蒸发
      pg.P.ingest([mk("c.txt", finalTxt("乙一", "+200", 1, "200", 0))], "乙队");
      await settle();
      eq(pg.P.teamList().indexOf("乙队") > -1, true, "挂到未登记的队会自动把队建出来");
      eq(pg.P.getData().list.find(x => x.name === "乙一").league, "乙队", "…且真的归进去了");

      // 归到「未分组」这个虚拟名 → 不建队
      pg.P.ingest([mk("d.txt", finalTxt("丙一", "+50", 1, "50", 0))], "未分组");
      await settle();
      eq(pg.P.teamList().indexOf("未分组"), -1, "「未分组」不会被建成真实队伍");
      eq(pg.P.getData().list.find(x => x.name === "丙一").league, "", "…而是当作没归队");
    }

    // (d) 分组渲染：决赛才分组，初赛照旧平铺
    {
      const pg = makePage();
      // 初赛：平铺，没有 team-box
      pg.P.ingest([mk("p.txt", sampleTxt("初赛甲", "+100", 1, "100"))]);
      await settle();
      eq(pg.made["rank-list"].attrs["data-view"], "flat", "初赛是平铺视图");
      eq(pg.made["rank-list"].children[0].className.indexOf("rank-row") > -1, true,
         "初赛第一层就是 .rank-row（没有队伍框）");
    }
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.P.addTeam("甲队");
      pg.P.addTeam("乙队");
      pg.P.ingest([mk("a.txt", finalTxt("甲一", "+300", 1, "400", 100))], "甲队");
      await settle();
      pg.P.ingest([mk("b.txt", finalTxt("甲二", "+200", 1, "200", 0))], "甲队");
      await settle();
      pg.P.ingest([mk("c.txt", finalTxt("乙一", "+600", 1, "600", 0))], "乙队");
      await settle();
      pg.P.ingest([mk("d.txt", finalTxt("散户", "+10", 1, "10", 0))]);
      await settle();

      const list = pg.made["rank-list"];
      eq(list.attrs["data-view"], "grouped", "决赛是分组视图");
      const boxes = list.children;
      // 排序：真实队伍按队伍合计分降序、并依次编号 1/2/3…；
      //      「未分组」**固定在最后、不编号**（2026-09-24 用户选定）
      eq(boxes.length, 3, "3 个框：甲乙两队 + 未分组");
      eq(boxes[0].className.indexOf("team-box-loose") === -1, true, "第一个框是真实队伍");
      eq(boxes[2].className.indexOf("team-box-loose") > -1, true, "最后一个框是「未分组」（虚线）");
      eq(boxes[2].attrs["data-team"], "未分组", "…标着「未分组」");
      eq(boxes.map(b => b.attrs["data-team"]), ["甲队", "乙队", "未分组"],
         "同分并列按队名排（甲<乙），「未分组」沉底");
      // 队头：**次序 + 队名(+人数) + 全队源石锭 + 合计分**（真实队伍末尾还有删除键）
      const head = boxes[0].children[0];
      eq(head.className, "team-head", "队头是 .team-head");
      eq(head.children[0].className, "team-idx", "最左是次序格");
      eq(head.children[0].textContent, "1", "第一队次序 1（按合计分降序）");
      eq(head.children[1].className, "team-name", "其次是队名");
      eq(head.children[2].className, "team-yuan", "再是全队源石锭消耗（2026-09-24 加）");
      eq(head.children[3].className, "team-sum", "最后是队伍合计分");
      eq(boxes[1].children[0].children[0].textContent, "2", "第二队次序 2");
      eq(boxes[2].children[0].children[0].textContent, "", "「未分组」不编号（次序格留空）");
      eq(boxes[2].children[0].children[0].className, "team-idx team-idx-none",
         "…但次序格仍渲染，撑住宽度，队名才不左移");
      // 合计分排序的实质：把甲队加到高于乙队 → 甲队仍在第 1，但编号跟着结果走
      eq(boxes[0].children[0].children[3].textContent, "600", "甲队合计分 = 队内总分之和（400+200）");
      eq(boxes[1].children[0].children[3].textContent, "600", "乙队合计分");
      eq(boxes[2].children[0].children[3].textContent, "10", "未分组合计分");
      /* —— 全队源石锭：**已使用 + 剩余**（2026-09-25 起两块并排）—— */
      const yuanOf = (b) => {
        const y = b.children[0].children[2];
        const item = (i) => ({
          cls: y.children[i].className,
          label: y.children[i].children[0].className + ":" + y.children[i].children[0].textContent,
          num: y.children[i].children[1].textContent,
          title: y.children[i].attrs["title"] || ""
        });
        return { cls: y.className, items: y.children.length, used: item(0), rest: item(1) };
      };
      eq(yuanOf(boxes[0]).cls, "team-yuan", "源石锭还是 .team-yuan 一块");
      eq(yuanOf(boxes[0]).items, 2, "…里面并排两块：已使用 + 剩余");
      eq(yuanOf(boxes[0]).used,
         { cls: "team-yuan-item", label: "team-yuan-label:已使用", num: "20",
           title: "全队已使用源石锭（队内成员消耗之和）" },
         "甲队「已使用」= 队内成员消耗之和（10+10=20），标签收成三个字（2026-09-25 由「已使用源石锭」改来）");
      eq(yuanOf(boxes[0]).rest.label, "team-yuan-label:剩余", "右块标签写作「剩余」");
      eq(yuanOf(boxes[0]).rest.num, "100",
         "甲队「剩余」= 决赛初始余额 120 − 已使用 20（还没读过计分器存档 → 出厂默认 120）");
      eq(yuanOf(boxes[0]).rest.title.indexOf("120") > -1, true,
         "「剩余」的 hover 提示点明基准余额（" + yuanOf(boxes[0]).rest.title + "）");
      eq(yuanOf(boxes[0]).rest.cls, "team-yuan-item", "没超支 → 不带 is-over（不标红）");
      eq(yuanOf(boxes[1]).used.num, "10", "乙队已使用 10");
      eq(yuanOf(boxes[1]).rest.num, "110", "乙队剩余 110");
      eq(yuanOf(boxes[2]).used.num, "10", "「未分组」也照常显示源石锭合计");
      eq(yuanOf(boxes[2]).rest.num, "110", "…剩余也一起算（同一个 buildTeamBoxEl 出的）");
      eq(typeof pg.P.teamYuan, "function", "teamYuan() 对外可查");
      eq(pg.P.teamYuan("甲队"), 20, "teamYuan() 与框上印的一致（20）");
      eq(pg.P.teamYuan("不存在的队"), 0, "不存在的队伍源石锭按 0");
      eq(typeof pg.P.teamYuanRest, "function", "teamYuanRest() 对外可查");
      eq(pg.P.teamYuanRest("甲队"), 100, "teamYuanRest() = 决赛初始余额 − 已使用");
      eq(pg.P.teamYuanRest("不存在的队"), 120, "不存在的队伍：已使用 0 → 剩余 = 整个余额");
      eq(pg.P.yuanInitFinal(), 120, "没读过计分器存档 → 回落出厂默认 120（与 app.js 一致）");
      eq(pg.P.COUNTER_KEY, "hlsh_zhoujibei_counter_v1", "读的是**计分器自己**的存档键（与榜单键不同）");
      // 队名后面缀人数
      eq(/2 人/.test(boxes[0].children[0].children[1].textContent) ||
         new RegExp("2 人").test(boxes[0].children[0].children[1].children[0].textContent),
         true, "甲队标了「2 人」");
      const boxOf = (n) => boxes.find(b => b.attrs["data-team"] === n);
      // 成员行
      const body = boxOf("甲队").children[1];
      eq(body.className, "team-body", "队体是 .team-body");
      eq(body.children.length, 2, "甲队框里 2 个队员行");
      eq(body.children[0].children[1].textContent, "甲一", "队员行仍是 .rank-row（同样 7 数据格）");
      eq(body.children.length && body.children[0].children.length, 8, "队员行也是 8 格（7 数据 + 删除键）");
      eq(body.children[0].children[7].attrs["data-del-player"], "甲一", "队内成员的删除键也带着各自的名字");
      // 空队也留着（刚建好还没加人）
      pg.P.addTeam("空队");
      pg.P.render();
      const boxes2 = pg.made["rank-list"].children;
      const emptyBox = boxes2.find(b => b.attrs["data-team"] === "空队");
      eq(!!emptyBox, true, "空队也留下（刚建的队要看得见）");
      eq(emptyBox.children[0].children[3].textContent, "0", "空队合计分 0");
      eq(emptyBox.children[0].children[2].children[0].children[1].textContent, "0", "空队已使用源石锭也是 0");
      eq(emptyBox.children[0].children[2].children[1].children[1].textContent, "120",
         "空队剩余 = 整个初始余额（一个人都没用）");
      eq(emptyBox.children[0].children[0].textContent, "3", "空队排在最后（0 分）→ 次序 3");
      eq(boxes2[boxes2.length - 1].attrs["data-team"], "未分组",
         "「未分组」永远在空队之后（它不看分，就是沉底）");
      eq(emptyBox.children[1].children[0].className, "team-none", "空队给一句占位文案");
      // 真实队伍有删除键，「未分组」没有
      eq(boxes2.find(b => b.attrs["data-team"] === "甲队").children[0].children.length, 5,
         "真实队伍队头多一个删除键（5 个子元素：次序/队名/源石锭/合计/删除）");
      eq(boxes2.find(b => b.attrs["data-team"] === "未分组").children[0].children.length, 4,
         "「未分组」没有删除键（4 个子元素：次序占位/队名/源石锭/合计）");
    }

    // (d2) 队伍**次序完全由队伍合计分驱动**，并随分数变化重排（2026-09-24 用户要求）
    {
      const pg = makePage();
      pg.P.setBoard("final");
      ["甲队", "乙队", "丙队"].forEach(n => pg.P.addTeam(n));
      pg.P.ingest([mk("a.txt", finalTxt("甲一", "+100", 1, "100", 0))], "甲队");
      await settle();
      pg.P.ingest([mk("b.txt", finalTxt("乙一", "+500", 1, "500", 0))], "乙队");
      await settle();
      pg.P.ingest([mk("c.txt", finalTxt("丙一", "+300", 1, "300", 0))], "丙队");
      await settle();
      pg.P.ingest([mk("d.txt", finalTxt("散人", "+900", 1, "900", 0))]);   // 未分组，分最高
      await settle();

      const board = () => pg.made["rank-list"].children.map(b => ({
        name: b.attrs["data-team"],
        idx: b.children[0].children[0].textContent,
        sum: b.children[0].children[3].textContent,
        ySum: b.children[0].children[2].children[0].children[1].textContent,   // 已使用
        yRest: b.children[0].children[2].children[1].children[1].textContent, // 剩余
        yOver: /(^| )is-over( |$)/.test(b.children[0].children[2].children[1].className),
        cls: b.className
      }));
      eq(board().map(g => [g.name, g.idx, g.sum]), [
        ["乙队", "1", "500"],
        ["丙队", "2", "300"],
        ["甲队", "3", "100"],
        ["未分组", "", "900"]
      ], "队伍按合计分降序编号 1/2/3；「未分组」即使分最高也不编号、沉底");
      eq(board().map(g => g.ySum), ["10", "10", "10", "10"],
         "每队也显示各自的全队**已使用**源石锭（每人 10）");
      eq(board().map(g => g.yRest), ["110", "110", "110", "110"],
         "…并同时印出**剩余**（120 − 10）；「未分组」也有");

      // 前 3 名戴金 / 银 / 铜（与选手行 .rank-row.top1~top3 同族）
      eq(board().map(g => /team-top(\d)/.exec(g.cls)?.[1] || "-"), ["1", "2", "3", "-"],
         "冠军/亚军/季军的队伍框带 team-top1/2/3");
      eq(board()[3].cls.indexOf("team-top") === -1, true,
         "「未分组」绝不戴冠亚季皮（按 idx 判，不是按数组下标）");
      eq(board()[0].cls.indexOf("team-box-loose") === -1, true, "真实队伍框仍不是虚线");
      eq(board()[3].cls.indexOf("team-box-loose") > -1, true, "「未分组」仍是虚线框");

      // 给甲队补一个人（+700）→ 甲队 800，应立刻窜到第 1，编号与冠亚季皮一起重排
      pg.P.ingest([mk("e.txt", finalTxt("甲二", "+700", 1, "700", 0))], "甲队");
      await settle();
      eq(board().map(g => g.name + g.idx), ["甲队1", "乙队2", "丙队3", "未分组"],
         "其中一个队分数一变，次序与编号立刻跟着重排");
      eq(board().map(g => g.sum), ["800", "500", "300", "900"], "各队合计分同步更新");
      eq(board().map(g => g.ySum), ["20", "10", "10", "10"], "甲队源石锭随人数涨到 20");
      // ⚠️ 源石锭**不参与排序**：把乙队源石锭堆到远超甲队，排序仍按合计分
      pg.P.ingest([mk("f.txt", sampleTxt("乙二", "+1", 1, "1", { team: 0, yuan: 9999 }))], "乙队");
      await settle();
      eq(board().map(g => g.name + g.idx), ["甲队1", "乙队2", "丙队3", "未分组"],
         "乙队源石锭暴涨也不改排序（排序只看合计分）");
      eq(board()[1].ySum, "10009", "…但它的已使用源石锭确实涨了");
      /* ⚠️ 剩余 = 余额 − 已使用，**允许为负**：9999 + 10 用超了 → 120 − 10009 = −9889。
         负数不 clamp 成 0（那会把「超支」伪装成「刚好用完」），而是整块转红。 */
      eq(board()[1].yRest, "-9889", "剩余算成负数（超支）也不截断");
      eq(board()[1].yOver, true, "…并整块加 is-over 标红");
      eq(board()[0].yOver, false, "没超支的队不加 is-over");
      eq(board().map(g => /team-top(\d)/.exec(g.cls)?.[1] || "-"), ["1", "2", "3", "-"],
         "冠亚季皮跟着新名次换人（甲队 3→1、乙队 1→2、丙队 2→3）");
      eq(board()[board().length - 1].name, "未分组", "「未分组」始终在最后一个");
    }

    // (d3) 第 4 名及以后不该有冠亚季皮（只有前三有）
    {
      const pg = makePage();
      pg.P.setBoard("final");
      ["一队", "二队", "三队", "四队"].forEach(n => pg.P.addTeam(n));
      const score = { "一队": 400, "二队": 300, "三队": 200, "四队": 100 };
      for(const n of ["一队", "二队", "三队", "四队"]){
        pg.P.ingest([mk(n + ".txt", finalTxt(n + "长", "+" + score[n], 1, String(score[n]), 0))], n);
        await settle();
      }
      const cls = pg.made["rank-list"].children.map(b => b.className);
      eq(cls.map(c => /team-top(\d)/.exec(c)?.[1] || "-"), ["1", "2", "3", "-"],
         "四支队时只有前 3 名戴皮，第 4 名素着");
      eq(cls[3].indexOf("team-box") > -1, true, "第 4 名仍是普通队伍框");
    }

    /* (d4) 「剩余」的基准 = **计分器页面设置的「决赛初始余额」**（2026-09-25 用户要求）
       ⚠️ 榜单页不引入 app.js，只能去读**计分器自己的存档键**（同源下 localStorage 共享）；
          计分器里用齿轮弹框改的那个值，正是存档里的 `yuanInitFinal`。 */
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.P.setData({ updatedAt: "", teams: ["甲队"], list: [
        { name: "甲一", base: 100, multiplier: 1, total: 100, yuan: 30, league: "甲队" },
        { name: "散人", base: 50,  multiplier: 1, total: 50,  yuan: 5,  league: "" }
      ]});
      pg.P.render();
      const yuanBlockOf = (n) => pg.made["rank-list"].children
        .find(x => x.attrs["data-team"] === n).children[0].children[2];
      const restOf = (n) => ({
        text: yuanBlockOf(n).children[1].children[1].textContent,
        over: /(^| )is-over( |$)/.test(yuanBlockOf(n).children[1].className)
      });
      eq(pg.P.yuanInitFinal(), 120, "计分器没设过余额 → 出厂默认 120");
      eq(restOf("甲队").text, "90", "甲队剩余 = 120 − 30");
      eq(restOf("未分组").text, "115", "「未分组」剩余 = 120 − 5（每个框都算）");

      /* 计分器里把「决赛初始余额」改成 200（齿轮弹框干的就是这件事）→ 榜单跟着换基准 */
      pg.win.localStorage.setItem(pg.P.COUNTER_KEY,
        JSON.stringify({ v: 6, yuanInitPrelim: 60, yuanInitFinal: 200 }));
      pg.P.render();
      eq(pg.P.yuanInitFinal(), 200, "读到计分器设置的新余额");
      eq(restOf("甲队").text, "170", "剩余改用新基准：200 − 30");
      eq(restOf("未分组").text, "195", "…每个框都跟着换");

      /* 余额调到比已使用还小 → 剩余为负 + 整块标红（不 clamp 成 0） */
      pg.win.localStorage.setItem(pg.P.COUNTER_KEY, JSON.stringify({ yuanInitFinal: 10 }));
      pg.P.render();
      eq(restOf("甲队").text, "-20", "超支时剩余为负（10 − 30）");
      eq(restOf("甲队").over, true, "…整块标红");
      eq(restOf("未分组").text, "5", "没超支的框不标红");

      /* 计分器在**另一个标签页**里改了余额 → 浏览器派 `storage` 事件 → 榜单立刻重算。
         ⚠️ 没有它，用户改完切回榜单页看到的是旧基准，会以为设置没生效（要手动刷新）。 */
      {
        const oldRow = pg.made["rank-list"].children[0];
        pg.win.localStorage.setItem(pg.P.COUNTER_KEY, JSON.stringify({ yuanInitFinal: 300 }));
        pg.win.handlers.storage({ key: pg.P.COUNTER_KEY });
        eq(pg.made["rank-list"].children[0] === oldRow, false,
           "storage 事件触发了重渲染（行是新建的）");
        eq(restOf("甲队").text, "270", "…剩余按新余额 300 重算（10 → 300）");
        eq(restOf("甲队").over, false, "…超支红标也跟着撤了");
        const keepRow = pg.made["rank-list"].children[0];
        pg.win.handlers.storage({ key: "hlsh_zhoujibei_ranking_v1" });
        eq(pg.made["rank-list"].children[0] === keepRow, true,
           "其它键的 storage 事件不触发重渲染（只关心计分器那份档）");
        eq(typeof pg.win.handlers.storage, "function", "启动时挂上了 storage 监听");
      }

      /* ⚠️ 坏档 / 缺字段 / 非法值一律回落 120 —— 绝不能按 0 算
         （按 0 算会把「剩余」显示成一个巨大的负数，看起来像全员严重超支） */
      [["乱码", "计分器存档占位"], ["空对象", "{}"], ["负数", "{\"yuanInitFinal\":-5}"],
       ["非数字", "{\"yuanInitFinal\":\"abc\"}"]].forEach(function(c){
        pg.win.localStorage.setItem(pg.P.COUNTER_KEY, c[1]);
        eq(pg.P.yuanInitFinal(), 120, "计分器存档是「" + c[0] + "」时回落 120");
      });
      pg.win.localStorage.removeItem(pg.P.COUNTER_KEY);
      eq(pg.P.yuanInitFinal(), 120, "完全没有计分器存档（别人单独打开榜单页）也回落 120");

      /* ⚠️ 只读不写：榜单页**永远不碰**计分器的存档 */
      pg.win.localStorage.setItem(pg.P.COUNTER_KEY, "{\"yuanInitFinal\":200}");
      pg.P.render();
      eq(pg.win.localStorage.getItem(pg.P.COUNTER_KEY), "{\"yuanInitFinal\":200}",
         "读余额不会顺手改写计分器存档");
      eq(pg.P.getData().list.length, 2, "…榜单自己的数据也没被动");
    }

    // (e) 删队：队员不删，只摘归属 → 回到「未分组」
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.P.addTeam("甲队");
      pg.P.ingest([mk("a.txt", finalTxt("甲一", "+300", 1, "400", 100))], "甲队");
      await settle();
      eq(pg.P.getData().list.length, 1, "先有 1 位队员");
      pg.P.removeTeam("甲队");
      eq(pg.P.teamList().length, 0, "队伍被删了");
      eq(pg.P.getData().list.length, 1, "⚠️ 队员**没有被删**（重要：别连带抹掉成绩）");
      eq(pg.P.getData().list[0].league, "", "…只是归属被摘掉");
      eq(pg.P.getData().list[0].name, "甲一", "…名字还在");
      // 渲染上看：只剩「未分组」一个虚线框
      const boxes = pg.made["rank-list"].children;
      eq(boxes.length, 1, "现在只剩 1 个框");
      eq(boxes[0].attrs["data-team"], "未分组", "…是「未分组」");
      eq(boxes[0].children[1].children.length, 1, "那 1 位选手在里面");
      // 删不存在的队 → false，不炸
      eq(pg.P.removeTeam("根本没有"), false, "删不存在的队返回 false");
    }

    // (f) 分组不改动「总分 / 名次」——名次仍是全局并列名次
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.P.addTeam("甲队");
      pg.P.ingest([mk("a.txt", finalTxt("甲一", "+300", 1, "400", 100))], "甲队");
      await settle();
      pg.P.ingest([mk("b.txt", finalTxt("散户", "+600", 1, "600", 0))]);
      await settle();
      const rows = pg.P.render();
      eq(rows.map(r => r.name), ["散户", "甲一"], "名次按总分排（散户 600 > 甲一 400）");
      eq(rows.map(r => r.rank), [1, 2], "名次 1 / 2");
      // 「未分组」沉底，但里面的散户名次仍是 1（框的位置与选手名次是两回事）
      const boxes = pg.made["rank-list"].children;
      eq(boxes.map(b => b.attrs["data-team"]), ["甲队", "未分组"],
         "真实队伍在前、「未分组」沉底");
      eq(boxes[0].children[0].children[0].textContent, "1", "甲队次序 1");
      eq(boxes[1].children[0].children[0].textContent, "", "「未分组」不编号");
      eq(boxes[1].children[1].children[0].children[0].textContent, "1",
         "框排最后不代表名次变了（散户仍是第 1 名）");
    }

    // (g) 赛程切换：队伍也是两套，互不串
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.P.addTeam("决赛队");
      eq(pg.P.teamList().length, 1, "决赛有 1 支队");
      pg.P.setBoard("prelim");
      eq(pg.P.teamList().length, 0, "切到初赛 → 队伍是空的（各归各的）");
      eq(pg.made["rank-list"].attrs["data-view"], "flat", "初赛也不分组");
      pg.P.setBoard("final");
      eq(pg.P.teamList().length, 1, "切回决赛 → 队伍还在");
    }

    // (h) 清空榜单：队伍一起清
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.win.confirm = function(){ return true; };
      pg.P.addTeam("甲队");
      pg.P.ingest([mk("a.txt", finalTxt("甲一", "+300", 1, "400", 100))], "甲队");
      await settle();
      eq(pg.P.teamList().length, 1, "清空前有 1 支队");
      pg.P.clearBoard();
      eq(pg.P.teamList().length, 0, "清空后队伍也没了（不留空壳框）");
      eq(pg.P.getData().list.length, 0, "选手也没了");
    }

    // (i) 「添加队伍」弹框跑通：填名字 → 确定 → 建队 + 重渲染
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.made["btn-add-team"].click();
      const inp = pg.made["rank-modal-body"].children[0].children[1];
      eq(inp.tagName, "INPUT", "弹框里第一个控件是文本输入框");
      eq(inp.id, "modal-team-name", "…id 是 modal-team-name");
      // 空名 → 报错、**不关窗**
      pg.P.modalConfirm();
      eq(pg.made["rank-modal"].hidden, false, "空队名确定后弹框不关（留着改）");
      eq(pg.made["rank-modal-err"].hidden, false, "…并显示错误");
      eq(pg.P.teamList().length, 0, "…且没建出空名队伍");
      // 填个名字 → 确定 → 关窗 + 建队
      inp.value = "近锋最强队";
      pg.P.modalConfirm();
      eq(pg.made["rank-modal"].hidden, true, "填写后确定 → 弹框关掉");
      eq(pg.P.teamList().join(), "近锋最强队", "队伍建起来了");
      eq(pg.made["rank-toast"].hidden, false, "给了成功提示");
      eq(/近锋最强队/.test(pg.made["rank-toast"].innerHTML), true, "提示里点名了队名");
      // 重名 → 也报错不关窗
      pg.made["btn-add-team"].click();
      pg.made["rank-modal-body"].children[0].children[1].value = "近锋最强队";
      pg.P.modalConfirm();
      eq(pg.made["rank-modal"].hidden, false, "重名时不关窗");
      eq(/已经有/.test(pg.made["rank-modal-err"].textContent), true, "…提示「已经有」");
      eq(pg.P.teamList().length, 1, "…队伍数不变");
    }

    // (j) 「添加选手」弹框跑通：选队伍 + 选 txt → 归入该队
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.P.addTeam("甲队");
      pg.P.addTeam("乙队");
      pg.made["btn-add-player"].click();
      eq(pg.made["rank-modal-title"].textContent, "添加选手", "标题是「添加选手」");
      const body = pg.made["rank-modal-body"];
      const sel = body.children[0].children[1];
      eq(sel.tagName, "SELECT", "决赛弹框第一个控件是队伍下拉");
      eq(sel.children.map(o => o.textContent).join("/"), "未分组/甲队/乙队",
         "下拉是「未分组 + 全部队伍」");
      const fileInp = body.children[1].children[1];
      eq(fileInp.tagName, "INPUT", "第二个控件是文件选择框");
      eq(fileInp.type, "file", "…type=file");
      // 不选文件 → 报错不关窗
      pg.P.modalConfirm();
      eq(pg.made["rank-modal"].hidden, false, "没选文件时不关窗");
      eq(/txt/.test(pg.made["rank-modal-err"].textContent), true, "…提示要选 txt");
      eq(pg.P.getData().list.length, 0, "…也没录进任何人");
      // 选乙队 + 给文件 → 确定 → 归入乙队
      sel.value = "乙队";
      fileInp.files = [mk("f.txt", finalTxt("乙一", "+200", 1, "200", 30))];
      pg.P.modalConfirm();
      eq(pg.made["rank-modal"].hidden, true, "选好后确定 → 弹框关掉");
      await settle();
      eq(pg.P.getData().list.length, 1, "选手入库");
      eq(pg.P.getData().list[0].league, "乙队", "归到了下拉选的「乙队」");
      eq(pg.P.getData().list[0].name, "乙一", "…名字对");
      eq(/乙队/.test(pg.made["rank-toast"].innerHTML), true, "提示里点名归入了哪个队");
      // 选「未分组」→ league 为空
      pg.made["btn-add-player"].click();
      pg.made["rank-modal-body"].children[0].children[1].value = "";
      pg.made["rank-modal-body"].children[1].children[1].files =
        [mk("g.txt", finalTxt("散户", "+10", 1, "10", 0))];
      pg.P.modalConfirm();
      await settle();
      eq(pg.P.getData().list.find(x => x.name === "散户").league, "",
         "选「未分组」→ 不归队");
    }

    // (k) 初赛的「添加选手」弹框：没有队伍下拉（初赛没有队伍概念）
    {
      const pg = makePage();
      eq(pg.P.currentMode(), "prelim", "停在初赛");
      pg.made["btn-add-player"].click();
      const kids = pg.made["rank-modal-body"].children;
      eq(kids[0].children[1].tagName, "INPUT", "初赛弹框第一个控件直接是文件框（无队伍下拉）");
      eq(kids[0].children[1].type, "file", "…type=file");
      eq(kids.filter(k => k.children[1] && k.children[1].tagName === "SELECT").length, 0,
         "整个弹框里没有 select");
    }

    // (l) 弹框确定/取消/遮罩/错误位的通用行为
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.P.modalConfirm();                    // 没开窗时点确定不该炸
      eq(pg.made["rank-modal"].hidden, true, "没开窗时点「确定」不炸、也不开窗");
      pg.P.openAddTeamModal();
      eq(pg.P.modalIsOpen(), true, "打开后 modalIsOpen() 为真");
      pg.made["rank-modal-cancel"].click();
      eq(pg.made["rank-modal"].hidden, true, "点「取消」关窗");
      eq(pg.P.modalIsOpen(), false, "modalIsOpen() 转假");
      // 重新打开时错误位要清空
      pg.P.openAddTeamModal();
      pg.P.modalConfirm();                    // 空名 → 错误
      eq(pg.made["rank-modal-err"].hidden, false, "产生错误后错误位可见");
      pg.P.modalClose();
      pg.P.openAddTeamModal();
      eq(pg.made["rank-modal-err"].hidden, true, "重新打开时错误位被清空");
      // 遮罩：点外层 = 关；点卡片内 = 不关
      pg.made["rank-modal"].click();
      eq(pg.made["rank-modal"].hidden, true, "点遮罩（target 是遮罩本身）会关窗");
      pg.P.openAddTeamModal();
      pg.made["rank-modal"].click({ target: pg.made["rank-modal-body"] });
      eq(pg.made["rank-modal"].hidden, false, "点卡片内部不关窗");
      // Esc
      pg.P.modalClose();
      pg.P.openAddTeamModal();
      eq(typeof pg.doc.handlers.keydown, "function", "Esc 处理已挂在 document 上");
      pg.doc.handlers.keydown({ key: "Escape" });
      eq(pg.made["rank-modal"].hidden, true, "按 Esc 关窗");
    }
  }

  /* ---------- ⑦ 行尾删除键：向左拖动唤起 / 点别处收起 / 确认后删除（2026-09-24） ----------
     用户要求：在选手的分数条上**向左拖动** → 它行尾冒出一个删除键，点它并确认后删掉这条；
     点网页其它任何地方则删除键消失。（最早做的是双击，当天按要求换成拖动。） */
  console.log("--- ⑦ 行尾删除键（向左拖动唤起） ---");
  {
    /* 一次完整的拖动：在行的**选手名格子**上按下 → 移动 dx/dy → 松手。
       ⚠️ 桩不会自动冒泡，所以 pointerdown 要派发在**容器**上、用 target 指明真正按下的元素
          （与赛程胶囊、删除键那几处测试同一套写法）。
       ⚠️ pointermove / pointerup 挂的是 **document**（源码就在 document 上，因为指针很容易
          在拖动中滑出行外）—— 桩里按事件名存一个处理器，也要派发在 doc 上。 */
    /* 按下：真 DOM 里一次 pointerdown 会先命中 #rank-list 上的委托、
       再冒泡到 document（「点别处收起」挂在那儿）。桩不冒泡，所以两个都手动派一次，
       顺序与真 DOM 保持一致。 */
    const press = (pg, target, x, y) => {
      const ev = { target, clientX: x, clientY: y, pointerId: 1, button: 0 };
      pg.made["rank-list"].handlers.pointerdown(ev);
      pg.doc.handlers.pointerdown(ev);
    };
    /* 只在 document 上派发（即「点在了 #rank-list 之外」的地方，比如提示条） */
    const pressOutside = (pg, el) => pg.doc.handlers.pointerdown({ target: el });
    const pmove = (pg, x, y) => pg.doc.handlers.pointermove({ clientX: x, clientY: y, pointerId: 1 });
    const pup   = (pg, x, y) => pg.doc.handlers.pointerup({ clientX: x, clientY: y, pointerId: 1 });
    /* 一次完整拖动：在行的**选手名格子**上按下 → 移动 dx/dy → 松手 */
    const drag  = (pg, row, dx, dy = 0) => {
      press(pg, row.children[1], 200, 60);
      pmove(pg, 200 + dx, 60 + dy);
      pup(pg, 200 + dx, 60 + dy);
    };
    /* 点删除键（真 DOM 里删除键自己没有处理器，是 #rank-list 接的委托） */
    const hitDel = (pg, del) => pg.made["rank-list"].click({ target: del });
    const isArmed = (row) => (" " + row.className + " ").indexOf(" is-armed ") > -1;
    /* 数据格的跟手位移（源码用 transform，静止时应为空串） */
    const offs = (row) => row.children.slice(0, 7).map(c => c.style.transform || "");

    // (a) 渲染出来就有删除键，但默认谁都没点亮
    {
      const pg = makePage();
      pg.P.setData({ updatedAt: "", list: [
        { name: "甲", base: 300, multiplier: 1, total: 300 },
        { name: "乙", base: 200, multiplier: 1, total: 200 },
        { name: "丙", base: 100, multiplier: 1, total: 100 }
      ]});
      pg.P.render();
      const rows = pg.made["rank-list"].children;
      eq(rows.length, 3, "渲染出 3 行");
      eq(rows.every(r => r.children.length === 8), true, "每行都是 8 格（7 数据 + 1 删除键）");
      eq(rows.map(r => r.children[7].attrs["data-del-player"]), ["甲", "乙", "丙"],
         "每行的删除键都写着对应选手名（删谁不会串）");
      eq(rows.every(r => isArmed(r) === false), true, "默认没有任何一行被点亮");
      eq(pg.P.armedPlayer(), "", "armedPlayer() 默认为空");
      eq(offs(rows[0]), ["", "", "", "", "", "", ""], "静止时数据格没有位移（与表头逐列对齐）");

      // 手势相关的监听：三个都挂在 document 上；双击那套已经不存在
      eq(typeof pg.doc.handlers.pointerdown, "function",
         "「点别处收起」已挂在 document 的 pointerdown 上");
      eq(typeof pg.doc.handlers.pointermove, "function", "拖动中监听 document 的 pointermove");
      eq(typeof pg.doc.handlers.pointerup, "function", "松手监听 document 的 pointerup");
      eq(typeof pg.doc.handlers.pointercancel, "function", "被系统抢走指针时也有 pointercancel 兜底");
      eq(typeof pg.doc.handlers.click, "undefined", "「点别处收起」不再挂在 click 上（会被 arm 后的那次 click 误伤）");
      eq(typeof pg.made["rank-list"].handlers.dblclick, "function",
         "列表上有 dblclick 处理器（2026-09-24 起用于双击队名改名）");
      eq(typeof pg.made["rank-list"].handlers.pointerdown, "function",
         "按下由 #rank-list 委托（行是动态渲的）");

      // (b) 向左拖够距离 → 只有它亮
      drag(pg, rows[1], -60);
      eq(pg.P.armedPlayer(), "乙", "向左拖第 2 行后点亮的是「乙」");
      eq(rows.map(isArmed), [false, true, false], "只有被拖动的那一行带 is-armed");
      eq(offs(rows[1]), ["", "", "", "", "", "", ""], "松手后数据格归位（不会被拖歪）");

      // (c) 再拖第 3 行 → 亮的那一行跟着换
      drag(pg, rows[2], -60);
      eq(pg.P.armedPlayer(), "丙", "改成点亮「丙」");
      eq(rows.map(isArmed), [false, false, true], "同一时刻**最多只亮一行**（上一行自动收起）");

      // (n) 在删除键上按下 → 不启动拖动（否则按删除键时行会跟着滑一下）
      pg.P.disarmRow();
      press(pg, rows[0].children[7], 200, 60);
      pmove(pg, 120, 60); pup(pg, 120, 60);
      eq(pg.P.armedPlayer(), "", "在删除键上向左拖也不会点亮行");
      eq(offs(rows[0]), ["", "", "", "", "", "", ""], "…而且行不会跟着滑");

      // (o) 拖得不够（只拖了 20px < 阈值）→ 不点亮
      drag(pg, rows[0], -20);
      eq(pg.P.armedPlayer(), "", "向左拖 20px 不够阈值（" + pg.P.SWIPE_TRIGGER + "px）→ 不点亮");

      // (p) 向右拖 → 不点亮（只认向左）
      drag(pg, rows[0], 60);
      eq(pg.P.armedPlayer(), "", "向右拖不点亮");
      eq(offs(rows[0]), ["", "", "", "", "", "", ""], "…而且一点都不位移");

      // (q) 纵向为主（在滚页面）→ 放弃本次手势，且不留拖动态
      drag(pg, rows[0], -30, 70);
      eq(pg.P.armedPlayer(), "", "纵向为主的拖动（|dy|>|dx|）不算数（留给页面滚动）");
      eq(rows.map(r => (" " + r.className + " ").indexOf(" is-swiping ") > -1), [false, false, false],
         "…也不会留下 is-swiping");

      // (d) 点页面别处 → 收起
      drag(pg, rows[0], -60);
      eq(pg.P.armedPlayer(), "甲", "先点亮「甲」");
      eq(pg.P.swipeActive(), false, "松手后手势状态已清干净");
      pressOutside(pg, pg.made["rank-toast"]);
      eq(pg.P.armedPlayer(), "", "点页面其它地方（提示条）→ 删除键收起");
      eq(rows.map(isArmed), [false, false, false], "界面上也不再有任何 is-armed");

      // (e) 按下删除键时，**不能**被「点别处」提前收起（否则等于永远点不到它）
      drag(pg, rows[0], -60);
      press(pg, rows[0].children[7], 200, 60);
      eq(pg.P.armedPlayer(), "甲", "按下删除键时不会被「点别处」收起（它属于某一行）");

      // (e2) 点另一行（只是点，没拖）→ 收起旧的那一行
      drag(pg, rows[1], -60);
      eq(pg.P.armedPlayer(), "乙", "先点亮「乙」");
      press(pg, rows[0].children[1], 200, 60);
      pup(pg, 200, 60);
      eq(pg.P.armedPlayer(), "", "只点了另一行（没拖）→ 旧的收起");

      // (e3) 同一行再向左拖一次 = 收起（手势可逆，不必先点别处）
      drag(pg, rows[0], -60);
      eq(pg.P.armedPlayer(), "甲", "点亮「甲」");
      drag(pg, rows[0], -60);
      eq(pg.P.armedPlayer(), "", "同一行再拖一次 → 收起（可逆）");
      eq(rows.map(isArmed), [false, false, false], "界面上也确实灭了");

      // (e4) 拖到一半（还没松手）就能看到跟手位移，并带 is-swiping
      pg.P.disarmRow();
      press(pg, rows[0].children[1], 200, 60);
      pmove(pg, 160, 60);
      eq(offs(rows[0]), ["translateX(-40px)", "translateX(-40px)", "translateX(-40px)",
                         "translateX(-40px)", "translateX(-40px)", "translateX(-40px)",
                         "translateX(-40px)"],
         "拖动中 7 个数据格一起左移（跟手 40px）");
      eq(rows[0].children[7].style.transform || "", "", "…但删除键那一格原地不动");
      eq((" " + rows[0].className + " ").indexOf(" is-swiping ") > -1, true,
         "拖动中带 is-swiping（去掉过渡才跟得上手）");
      eq(pg.P.swipeActive(), true, "swipeActive() 反映「正在拖」");
      // 拖超过 SWIPE_MAX → 位移封顶
      pmove(pg, 0, 60);
      eq(offs(rows[0])[0], "translateX(-" + pg.P.SWIPE_MAX + "px)",
         "跟手位移封顶在 SWIPE_MAX（" + pg.P.SWIPE_MAX + "px）");
      pup(pg, 0, 60);
      eq((" " + rows[0].className + " ").indexOf(" is-swiping ") > -1, false, "松手后摘掉 is-swiping");
      eq(pg.P.armedPlayer(), "甲", "拖过头也算数 → 点亮");

      // (e5) pointercancel（被系统抢走指针）→ 回位、不改变删除键状态
      pg.P.disarmRow();
      press(pg, rows[1].children[1], 200, 60);
      pmove(pg, 150, 60);
      pg.doc.handlers.pointercancel({ pointerId: 1 });
      eq(offs(rows[1]), ["", "", "", "", "", "", ""], "pointercancel 后数据格归位");
      eq(pg.P.armedPlayer(), "", "…也不会点亮任何行");
      eq(pg.P.swipeActive(), false, "手势状态清空");

      // (m) render() 会顺手收起（旧行整批被丢掉，不留悬空引用）
      drag(pg, rows[0], -60);
      pg.P.render();
      eq(pg.P.armedPlayer(), "", "重渲染后删除键状态被清空");

      // (f) 点删除键但按「取消」→ 一个字都不动
      const rows2 = pg.made["rank-list"].children;
      drag(pg, rows2[0], -60);
      pg.win.confirm = () => false;
      hitDel(pg, rows2[0].children[7]);
      eq(pg.P.getData().list.length, 3, "确认框按「取消」→ 选手还在（3 位）");
      eq(pg.made["rank-list"].children.length, 3, "界面也还是 3 行");
      eq(pg.P.armedPlayer(), "甲", "取消后删除键仍亮着（方便再点一次）");

      // (g) 点删除键并「确定」→ 删掉这一条
      const before = pg.P.getData().updatedAt;
      pg.win.confirm = () => true;
      hitDel(pg, rows2[0].children[7]);
      eq(pg.P.getData().list.map(r => r.name), ["乙", "丙"], "「甲」被删掉了");
      eq(pg.made["rank-list"].children.length, 2, "界面剩 2 行");
      eq(pg.P.armedPlayer(), "", "删完自动收起删除键");
      eq(pg.made["rank-list"].children.map(r => r.children[0].textContent), ["1", "2"],
         "剩下的重排名次 1,2（不会留空档）");
      eq(pg.P.getData().updatedAt !== before, true, "更新时间跟着刷新（删人也算榜单变了）");
      eq(/rank-toast ok/.test(pg.made["rank-toast"].className), true, "给了绿色成功提示");
      eq(/甲/.test(pg.made["rank-toast"].innerHTML || pg.made["rank-toast"]._html || ""), true,
         "提示里点了被删选手的名字");
      // 落盘
      eq(/丙/.test(pg.win.localStorage.getItem("hlsh_zhoujibei_ranking_v1")), true,
         "剩余选手已写入 localStorage");
      eq(/"name":"甲"/.test(pg.win.localStorage.getItem("hlsh_zhoujibei_ranking_v1")), false,
         "被删的「甲」已从 localStorage 里消失");
    }

    // (h) removePlayer 的同名判定：忽略大小写与首尾空白（与 ingest 同口径）
    {
      const pg = makePage();
      pg.P.setData({ updatedAt: "", list: [
        { name: "Alice", base: 10, multiplier: 1, total: 10 },
        { name: "Bob",   base: 5,  multiplier: 1, total: 5 }
      ]});
      eq(pg.P.findPlayerIndex("  alice  "), 0, "找选手时忽略大小写与首尾空白");
      eq(pg.P.removePlayer("  ALICE "), "Alice", "照样能删掉（返回被删选手的原名）");
      eq(pg.P.getData().list.map(r => r.name), ["Bob"], "只剩 Bob");
      // (i) 找不到 → 返回空串、不动数据
      eq(pg.P.removePlayer("查无此人"), "", "删不存在的选手返回空串");
      eq(pg.P.getData().list.length, 1, "…且数据一条没动");
    }

    // (j) 分组视图（决赛）里的删除键同样能用，且队伍合计分跟着重算
    {
      const pg = makePage();
      pg.P.setBoard("final");
      pg.P.setData({ updatedAt: "", teams: ["甲队"], list: [
        { name: "甲一", base: 300, multiplier: 1, total: 300, league: "甲队" },
        { name: "甲二", base: 100, multiplier: 1, total: 100, league: "甲队" },
        { name: "散人", base: 50,  multiplier: 1, total: 50,  league: "" }
      ]});
      pg.P.render();
      const boxes = pg.made["rank-list"].children;
      eq(boxes.map(b => b.attrs["data-team"]), ["甲队", "未分组"],
         "甲队（400 分）在前、「未分组」（50 分）沉底且不编号");
      const teamBody = boxes.find(b => b.attrs["data-team"] === "甲队").children[1];
      eq(teamBody.children[0].children[7].attrs["data-del-player"], "甲一",
         "队伍框里的成员行也有删除键");
      drag(pg, teamBody.children[0], -60);
      eq(pg.P.armedPlayer(), "甲一", "在队内成员上向左拖也能点亮");
      pg.win.confirm = () => true;
      hitDel(pg, teamBody.children[0].children[7]);
      eq(pg.P.groupByTeam().find(g => g.name === "甲队").members.map(m => m.name), ["甲二"],
         "甲一被删掉了");
      eq(pg.P.groupByTeam().find(g => g.name === "甲队").total, 100,
         "队伍合计分跟着重算（300+100 → 100）");
      eq(pg.P.teamList(), ["甲队"], "队伍本身没被删（只是少了个成员）");
      // 删到空队：框还在（刚建好的空队要看得见）
      const teamBoxNow = () => pg.made["rank-list"].children
        .find(b => b.attrs["data-team"] === "甲队");
      drag(pg, teamBoxNow().children[1].children[0], -60);
      hitDel(pg, teamBoxNow().children[1].children[0].children[7]);
      eq(pg.P.teamList(), ["甲队"], "队员删光后队伍仍在");
      eq(teamBoxNow().children.some(c => c.className === "team-body"), true,
         "空队框照旧渲染出来");
      eq(pg.P.armedPlayer(), "", "删完收起");
    }

    /* ---------- ⑧ 拖拽入队：在行上**纵向拖动**把选手搬进别的队伍（2026-09-24） ----------
       用户要求：「在决赛栏目可以直接通过拖拽未分组下的选手条目，将选手拖拽到已有的队伍中」。
       与 ⑦ 的「向左拖动亮删除键」**共用同一次按下**，靠支配轴分流：横=删、竖=搬。 */
    console.log("--- ⑧ 拖拽入队（纵向拖动） ---");
    {
      /* 按下：与 ⑦ 同一套写法（桩不冒泡 → 分别派发到 #rank-list 与 document）。
         ⚠️ 落点是**按坐标**命中队伍框的（源码遍历 getBoundingClientRect），
            所以桩里得给每个队伍框注入一条假矩形 —— 顺便也把「各框竖直排布」这件事钉住。 */
      const setRect = (el, top, bottom) => {
        el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 800, width: 800, height: bottom - top });
      };
      const hasCls = (el, cls) => (" " + el.className + " ").indexOf(" " + cls + " ") > -1;
      const pressAt = (pg, target, x, y) => {
        const ev = { target, clientX: x, clientY: y, pointerId: 1, button: 0 };
        pg.made["rank-list"].handlers.pointerdown(ev);
        pg.doc.handlers.pointerdown(ev);
      };
      const pmoveTo = (pg, x, y) =>
        pg.doc.handlers.pointermove({ clientX: x, clientY: y, pointerId: 1 });
      const pupTo = (pg, x, y) =>
        pg.doc.handlers.pointerup({ clientX: x, clientY: y, pointerId: 1 });
      /* 三个框自上而下：甲队 0~100、乙队 110~210、未分组 220~320 */
      const BAND = { "甲队": [0, 100], "乙队": [110, 210], "未分组": [220, 320] };
      const layout = (pg) => {
        pg.made["rank-list"].children.forEach(b => {
          const band = BAND[b.attrs["data-team"]];
          if (band) setRect(b, band[0], band[1]);
        });
        return pg;
      };
      const mkFinal = () => {
        const pg = makePage();
        pg.P.setBoard("final");
        pg.P.setData({ updatedAt: "", teams: ["甲队", "乙队"], list: [
          { name: "甲一", base: 300, multiplier: 1, total: 300, league: "甲队" },
          { name: "乙一", base: 200, multiplier: 1, total: 200, league: "乙队" },
          { name: "散人", base: 60,  multiplier: 1, total: 60,  league: "" },
          { name: "散二", base: 40,  multiplier: 1, total: 40,  league: "" }
        ]});
        pg.P.render();
        layout(pg);
        return pg;
      };
      const boxOf  = (pg, nm) => pg.made["rank-list"].children.find(b => b.attrs["data-team"] === nm);
      const bodyOf = (pg, nm) => boxOf(pg, nm).children[1];
      const yOf    = (nm) => (BAND[nm][0] + BAND[nm][1]) / 2;      // 框的竖直中点
      const leagueOf = (pg, nm) => {
        const r = pg.P.getData().list.find(x => x.name === nm);
        return r ? r.league : undefined;
      };
      /* 一次完整的搬运：在某行的**选手名格**上按下 → 纵向移动（落到目标框的中点）→ 松手 */
      const moveTo = (pg, row, to) => {
        pressAt(pg, row.children[1], 400, yOf("未分组"));
        pmoveTo(pg, 400, yOf("未分组") - 24);      // 先纵向动一下，进入搬运模式
        pmoveTo(pg, 400, yOf(to));                 // 指针移到落点框上
        pupTo(pg, 400, yOf(to));
      };

      // (a) 把未分组的散人拖进「甲队」：全程有幽灵 / 虚线 / 落点高亮，松手落位并落盘
      {
        const pg = mkFinal();
        const rows = bodyOf(pg, "未分组").children;
        const target = boxOf(pg, "甲队");
        eq(rows.map(r => r.attrs["data-name"]), ["散人", "散二"], "未分组里有两位散人");
        eq(pg.P.isGroupedView(), true, "决赛 = 分组视图（纵向拖动会被接管）");

        pressAt(pg, rows[0].children[1], 400, 300);
        pmoveTo(pg, 400, 276);               // 纵向 24px > DRAG_TRIGGER
        eq(pg.P.moveDragActive(), true, "纵向拖过阈值 → 进入搬运模式");
        eq(hasCls(rows[0], "is-dragging"), true, "被搬的行带 is-dragging（虚线 + 淡出）");
        eq(hasCls(rows[0], "is-swiping"), false, "…走的不是「向左拖」那条路");
        const gh = pg.P.dragGhostEl();
        eq(!!gh, true, "造出了跟着指针的幽灵");
        eq(gh.textContent, "散人", "幽灵上写着被搬的选手名");
        eq(gh.parentNode === pg.doc.body, true, "幽灵挂在 document.body 上（不污染 #rank-list 的 children）");
        eq(pg.made["rank-list"].children.length, 3, "…所以队伍框仍是 3 个（幽灵没混进去）");
        eq(pg.P.dragTargetName(), "未分组", "指针还在原框里 → 落点仍是未分组（松手＝原地放下）");
        eq(hasCls(target, "is-drop-target"), false, "…甲队还没高亮");

        pmoveTo(pg, 400, yOf("甲队"));        // 指针移到甲队框上
        eq(pg.P.dragTargetName(), "甲队", "指针落在甲队框里 → 落点就是甲队");
        eq(hasCls(target, "is-drop-target"), true, "甲队框被高亮");
        eq(hasCls(boxOf(pg, "未分组"), "is-drop-target"), false, "同一时刻只亮一个落点");
        eq(gh.style.left, "414px", "幽灵跟着指针水平跑（x + 14）");

        pupTo(pg, 400, yOf("甲队"));
        eq(leagueOf(pg, "散人"), "甲队", "松手 → 散人归入甲队");
        eq(leagueOf(pg, "散二"), "", "只搬被拖的那一条，另一位散人没动");
        eq(pg.P.moveDragActive(), false, "松手后搬运状态清干净");
        eq(pg.P.dragGhostEl(), null, "幽灵已从页面上摘掉");
        eq(hasCls(target, "is-drop-target"), false, "落点高亮也灭了");
        eq(pg.P.dragTargetName(), "", "落点记录清空");
        eq(pg.made["rank-list"].children.length, 3, "仍只有 3 个框（幽灵没留下）");
        eq(/rank-toast ok/.test(pg.made["rank-toast"].className), true, "给了绿色成功提示");
        eq(/散人/.test(pg.made["rank-toast"].innerHTML || ""), true, "提示里点了选手名");
        eq(/甲队/.test(pg.made["rank-toast"].innerHTML || ""), true, "提示里点了目标队伍名");
        eq(/"league":"甲队"/.test(pg.win.localStorage.getItem("hlsh_zhoujibei_ranking_final_v1")), true,
           "归属已落盘（刷新后还在）");
        eq(pg.P.teamTotal("甲队"), 360, "甲队合计分 = 300 + 60");
        eq(pg.P.teamTotal("未分组"), 40, "未分组只剩散二（40）");
        eq(pg.P.groupByTeam().map(g => g.name), ["甲队", "乙队", "未分组"], "队伍顺序跟着重算");
      }

      // (b) 拖到框外松手 → 一个字都不动，且不留残留、不提示
      {
        const pg = mkFinal();
        const rows = bodyOf(pg, "未分组").children;
        pressAt(pg, rows[0].children[1], 400, 300);
        pmoveTo(pg, 400, 270);
        pmoveTo(pg, 400, 600);               // 各框之外的空白
        eq(pg.P.dragTargetName(), "", "指针不在任何队伍框里 → 没有落点");
        pupTo(pg, 400, 600);
        eq(leagueOf(pg, "散人"), "", "落在框外 → 归属不变");
        eq(hasCls(rows[0], "is-dragging"), false, "…虚线也摘了");
        eq(pg.P.dragGhostEl(), null, "…幽灵收掉");
        eq(/rank-toast ok/.test(pg.made["rank-toast"].className), false, "…静默取消，不给成功提示");
      }

      // (c) 从队伍里拖回「未分组」= 移出队伍（同一个手势反向用）
      {
        const pg = mkFinal();
        const rows = bodyOf(pg, "甲队").children;
        eq(rows[0].attrs["data-name"], "甲一", "甲队里有甲一");
        pressAt(pg, rows[0].children[1], 400, yOf("甲队"));
        pmoveTo(pg, 400, yOf("甲队") + 24);
        pmoveTo(pg, 400, yOf("未分组"));
        pupTo(pg, 400, yOf("未分组"));
        eq(leagueOf(pg, "甲一"), "", "拖回未分组 = 归属清空");
        eq(pg.P.teamList().join(), "甲队,乙队", "队伍本身还在（只是没人了）");
        eq(pg.P.teamTotal("甲队"), 0, "甲队合计分归零");
        eq(pg.P.teamTotal("未分组"), 400, "未分组 = 甲一 300 + 散人 60 + 散二 40");
        eq(/移出/.test(pg.made["rank-toast"].innerHTML || ""), true, "提示说「移出」而不是「移入」");
      }

      // (d) 队伍之间互拖
      {
        const pg = mkFinal();
        pressAt(pg, bodyOf(pg, "乙队").children[0].children[1], 400, yOf("乙队"));
        pmoveTo(pg, 400, yOf("乙队") - 26);
        pmoveTo(pg, 400, yOf("甲队"));
        pupTo(pg, 400, yOf("甲队"));
        eq(leagueOf(pg, "乙一"), "甲队", "乙队的选手可以拖进甲队");
        eq(pg.P.teamTotal("甲队"), 500, "甲队 300 + 200");
        eq(pg.P.teamTotal("乙队"), 0, "乙队空了");
      }

      // (e) 原地放下 / 拖到没登记过的队 → 都不动、也不提示
      {
        const pg = mkFinal();
        pressAt(pg, bodyOf(pg, "甲队").children[0].children[1], 400, yOf("甲队"));
        pmoveTo(pg, 400, yOf("甲队") + 24);
        pmoveTo(pg, 400, yOf("甲队"));
        pupTo(pg, 400, yOf("甲队"));
        eq(leagueOf(pg, "甲一"), "甲队", "放回原队 → 归属不变");
        eq(/rank-toast ok/.test(pg.made["rank-toast"].className), false, "…也不给提示（无事发生）");
        eq(pg.P.movePlayerToTeam("甲一", "查无此队").ok, false, "拖到没登记过的队名 → 不成功");
        eq(leagueOf(pg, "甲一"), "甲队", "…归属也不变（不会凭空建队）");
        eq(pg.P.teamList().length, 2, "…队伍列表没被偷偷加一项");
        eq(pg.P.movePlayerToTeam("查无此人", "甲队").ok, false, "找不到选手 → 不成功");
      }

      // (f) 纵向没动够阈值 → 不进入搬运（防手抖）
      {
        const pg = mkFinal();
        const rows = bodyOf(pg, "未分组").children;
        pressAt(pg, rows[0].children[1], 400, 300);
        pmoveTo(pg, 400, 295);               // 只动了 5px
        eq(pg.P.moveDragActive(), false, "纵向只动 5px（< " + pg.P.DRAG_TRIGGER + "px）→ 不进入搬运");
        eq(hasCls(rows[0], "is-dragging"), false, "…行也没被搬起来");
        pupTo(pg, 400, 295);
        eq(leagueOf(pg, "散人"), "", "…归属不变");
      }

      // (g) 横向向左仍然是「亮删除键」，不会顺带搬队伍
      {
        const pg = mkFinal();
        const rows = bodyOf(pg, "未分组").children;
        pressAt(pg, rows[0].children[1], 400, 300);
        pmoveTo(pg, 340, 300);
        eq(pg.P.moveDragActive(), false, "横向拖动不走搬运那条路");
        eq(pg.P.swipeActive(), true, "…走的是「向左拖」那条路");
        pupTo(pg, 340, 300);
        eq(pg.P.armedPlayer(), "散人", "向左拖 60px → 亮出它行尾的删除键");
        eq(leagueOf(pg, "散人"), "", "…归属一点没变");
      }

      // (h) pointercancel（系统抢走指针）→ 回位、不改数据
      {
        const pg = mkFinal();
        const rows = bodyOf(pg, "未分组").children;
        pressAt(pg, rows[0].children[1], 400, 300);
        pmoveTo(pg, 400, yOf("甲队"));
        pg.doc.handlers.pointercancel({ pointerId: 1 });
        eq(pg.P.moveDragActive(), false, "pointercancel 后搬运状态清空");
        eq(pg.P.dragGhostEl(), null, "…幽灵收掉");
        eq(hasCls(rows[0], "is-dragging"), false, "…虚线摘掉");
        eq(hasCls(boxOf(pg, "甲队"), "is-drop-target"), false, "…落点高亮灭掉");
        eq(leagueOf(pg, "散人"), "", "…归属没被改");
      }

      // (i) 重渲染会顺手清掉拖拽痕迹（旧行整批被丢掉，不留悬空引用）
      {
        const pg = mkFinal();
        const rows = bodyOf(pg, "未分组").children;
        pressAt(pg, rows[0].children[1], 400, 300);
        pmoveTo(pg, 400, yOf("甲队"));
        pg.P.render();
        eq(pg.P.moveDragActive(), false, "render() 后拖拽状态清空");
        eq(pg.P.dragGhostEl(), null, "…幽灵收掉");
        eq(pg.P.dragTargetName(), "", "…落点高亮也清空");
      }

      // (j) 初赛（平铺视图）没有可落的地方 → 纵向拖动照旧不算数，滚动留给页面
      {
        const pg = makePage();
        pg.P.setData({ updatedAt: "", list: [
          { name: "甲", base: 10, multiplier: 1, total: 10 }
        ]});
        pg.P.render();
        eq(pg.P.isGroupedView(), false, "初赛不是分组视图");
        const row = pg.made["rank-list"].children[0];
        pressAt(pg, row.children[1], 400, 100);
        pmoveTo(pg, 400, 40);
        eq(pg.P.moveDragActive(), false, "初赛里纵向拖不进入搬运");
        pupTo(pg, 400, 40);
        eq(pg.P.armedPlayer(), "", "…也不会点亮删除键");
      }

      // (k) 几条静态约束（样式与实现细节，桩跑不出来 → 读源码断言）
      {
        const cssTxt = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
        const rjTxt = fs.readFileSync(path.join(__dirname, "..", "js", "ranking.js"), "utf8");
        eq(/\.team-box-loose\s+\.team-body\s+\.rank-row\{[^}]*touch-action:none/.test(cssTxt), true,
           "未分组筐里的行把纵向手势交给 JS（触屏也能拖动；队伍框内保持 pan-y）");
        eq(/\.rank-drag-ghost\{[^}]*pointer-events:none/.test(cssTxt), true,
           "幽灵必须 pointer-events:none，否则它会挡住指针");
        eq(/\.team-box\.is-drop-target\{/.test(cssTxt), true, "落点高亮的样式存在");
        eq(cssTxt.indexOf(".team-box.team-top1{") < cssTxt.indexOf(".team-box.is-drop-target{"), true,
           "落点高亮写在冠亚季描边之后（否则拖到冠军队时看不出选中）");
        eq(/var host = document\.body \|\| elList/.test(rjTxt), true,
           "幽灵优先挂 document.body（免得污染 #rank-list 的 children）");
        eq(/elementFromPoint\s*\(/.test(rjTxt), false,
           "落点不用 elementFromPoint（改成矩形遍历：鼠标/触摸一套逻辑、桩里可注入假矩形）");
        eq(/getBoundingClientRect\(\)/.test(rjTxt), true, "…而是真的去量队伍框的矩形");
      }
    }

    /* ---------- ⑨ 双击队名就地改名（2026-09-24） ----------
       用户要求：「双击队伍名称时可以直接更改队伍名称，同时在队伍名称后面新填一个确定的
       对勾按钮，按下后（或按 enter）确定」。 */
    console.log("--- ⑨ 双击队名就地改名 ---");
    {
      const CSS = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
      const RJ2 = fs.readFileSync(path.join(__dirname, "..", "js", "ranking.js"), "utf8");
      const hasCls = (el, cls) => (" " + (el.className || "") + " ").indexOf(" " + cls + " ") > -1;
      const kids   = (el, cls) => el.children.filter(c => hasCls(c, cls));
      const boxOf  = (pg, nm) => pg.made["rank-list"].children.find(b => b.attrs["data-team"] === nm);
      const headOf = (pg, nm) => boxOf(pg, nm).children[0];
      const nameOf = (pg, nm) => kids(headOf(pg, nm), "team-name")[0];
      const inpOf  = (pg, nm) => kids(headOf(pg, nm), "team-name-input")[0];
      const okOf   = (pg, nm) => kids(headOf(pg, nm), "team-rename-ok")[0];
      const dbl    = (pg, target) => pg.made["rank-list"].handlers.dblclick({ target });
      const leagueOf = (pg, nm) => {
        const r = pg.P.getData().list.find(x => x.name === nm);
        return r ? r.league : undefined;
      };
      const mkFinal = (list, teams) => {
        const pg = makePage();
        pg.P.setBoard("final");
        pg.P.setData({
          updatedAt: "", teams: teams || ["甲队", "乙队"],
          list: list || [
            { name: "甲一", base: 300, multiplier: 1, total: 300, league: "甲队" },
            { name: "乙一", base: 200, multiplier: 1, total: 200, league: "乙队" },
            { name: "散人", base: 60, multiplier: 1, total: 60, league: "" }
          ]
        });
        pg.P.render();
        return pg;
      };

      // (a) 平时队头上干净得很：没有输入框、也没有对勾（现插现摘，不常驻占位）
      {
        const pg = mkFinal();
        eq(inpOf(pg, "甲队"), undefined, "平时队头上没有输入框");
        eq(okOf(pg, "甲队"), undefined, "…也没有对勾");
        eq(nameOf(pg, "甲队").attrs["data-rename-team"], "1", "真实队伍的队名带 data-rename-team");
        eq(nameOf(pg, "未分组").attrs["data-rename-team"], undefined,
           "「未分组」是虚拟筐 → 连改名入口都不给");
        eq(nameOf(pg, "甲队").title, "双击可改队名", "队名带提示（否则没人知道能双击）");
        eq(pg.P.renameActive(), false, "初始不在编辑态");
      }

      // (b) 双击队名 → 进编辑态：输入框预填原队名 + 右侧一个对勾，队名本体只是被藏起来
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队").children[0]);      // 双击「3 人」那个小标签：一样算双击队名（委托上溯）
        eq(pg.P.renameActive(), true, "双击队名 → 进入编辑态");
        eq(hasCls(boxOf(pg, "甲队"), "is-renaming"), true, "框带上 is-renaming");
        eq(!!inpOf(pg, "甲队"), true, "队头上冒出一个输入框");
        eq(inpOf(pg, "甲队").value, "甲队", "输入框预填现有队名（改一半不用重打）");
        eq(inpOf(pg, "甲队").maxLength, 24, "输入上限 24 字（与「添加队伍」弹框同一口径）");
        eq(okOf(pg, "甲队").textContent, "✓", "旁边是个对勾按钮");
        {
          const hc = headOf(pg, "甲队").children;
          eq(hc.indexOf(okOf(pg, "甲队")) - hc.indexOf(inpOf(pg, "甲队")), 1,
             "对勾紧挨在输入框右边（序：次序 · 输入框 · 对勾 · …）");
        }
        eq(nameOf(pg, "甲队").attrs["data-rename-team"], "1", "队名本体没被删掉，只是交给 css 藏起来");
        eq(pg.P.renameOf(boxOf(pg, "甲队")), "甲队", "renameOf() 读的是框上的 data-team");
        eq(pg.P.renameActive(), true, "随时可以问「现在在改名吗」");
      }

      // (c) 回车确定：队名改了、⚠️ 队员的 league 跟着一起改
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队"));
        const inp = inpOf(pg, "甲队");
        inp.value = "先锋大队";
        inp.handlers.keydown({ key: "Enter", keyCode: 13 });
        eq(pg.P.teamList(), ["先锋大队", "乙队"], "回车 → 队名改掉");
        eq(leagueOf(pg, "甲一"), "先锋大队",
           "⚠️ 队员的 league 跟着一起改（只改队名不改 league，队员会集体掉回未分组）");
        eq(leagueOf(pg, "乙一"), "乙队", "…别的队的人不受影响");
        eq(pg.P.groupByTeam().map(g => g.name), ["先锋大队", "乙队", "未分组"], "分组重算后仍是一队一筐");
        eq(pg.P.groupByTeam().find(g => g.name === "先锋大队").total, 300, "甲一（300）还在这一队里");
        eq(pg.P.teamTotal("未分组"), 60, "未分组没被误塞人");
        eq(pg.P.renameActive(), false, "确定后编辑态收起");
        eq(inpOf(pg, "先锋大队"), undefined, "…输入框摘掉了");
        eq(hasCls(boxOf(pg, "先锋大队"), "is-renaming"), false, "…类也去掉了（队名原地显回来）");
        eq(/rank-toast ok/.test(pg.made["rank-toast"].className), true, "给了绿色成功提示");
        eq(/先锋大队/.test(pg.made["rank-toast"].innerHTML || ""), true, "提示里点了新队名");
        eq(/甲队/.test(pg.made["rank-toast"].innerHTML || ""), true, "…也点了旧队名（看得出是从谁改来的）");
        eq(/"league":"先锋大队"/.test(pg.win.localStorage.getItem("hlsh_zhoujibei_ranking_final_v1")), true,
           "队员归属已落盘（刷新后还在）");
        eq(/"teams":\["先锋大队","乙队"\]/.test(pg.win.localStorage.getItem("hlsh_zhoujibei_ranking_final_v1")), true,
           "队伍列表也落盘");
      }

      // (d) 点对勾 → 与回车等价
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "乙队"));
        inpOf(pg, "乙队").value = "近锋队";
        pg.made["rank-list"].handlers.click({ target: okOf(pg, "乙队") });
        eq(pg.P.teamList(), ["甲队", "近锋队"], "点对勾 → 同样确定");
        eq(leagueOf(pg, "乙一"), "近锋队", "队员归属一起改");
        eq(pg.P.renameActive(), false, "编辑态收起");
        eq(/rank-toast ok/.test(pg.made["rank-toast"].className), true, "也是绿色成功提示");
      }

      // (e) 输入法组字期间的回车不算数（与「规则输入框」「添加队伍」同一套保护）
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队"));
        const inp = inpOf(pg, "甲队");
        inp.value = "拼音中";
        inp.handlers.keydown({ key: "Enter", keyCode: 229 });
        eq(pg.P.renameActive(), true, "组字中的回车（keyCode 229）不提交");
        inp.handlers.keydown({ key: "Enter", keyCode: 13, isComposing: true });
        eq(pg.P.teamList(), ["甲队", "乙队"], "isComposing 的回车也不提交");
        inp.handlers.keydown({ key: "Enter", keyCode: 13 });
        eq(pg.P.teamList(), ["拼音中", "乙队"], "组字结束后的回车才生效");
      }

      // (f) 空名 → 报错、**留在编辑态**、数据一个字不动
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队"));
        const inp = inpOf(pg, "甲队");
        inp.value = "   ";
        const res = pg.P.commitRename();
        eq(res && res.error, "队名不能为空", "纯空格 → 报错");
        eq(pg.P.teamList(), ["甲队", "乙队"], "…队伍列表没动");
        eq(pg.P.renameActive(), true, "…留在编辑态（不能把用户敲的字丢掉）");
        eq(inp.value, "   ", "…输入框内容原样保留");
        eq(/rank-toast err/.test(pg.made["rank-toast"].className), true, "…给的是红色错误提示");
        eq(leagueOf(pg, "甲一"), "甲队", "…队员归属不动");
      }

      // (g) 重名 → 报错、留在编辑态（大小写/空格不同也算重名）
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队"));
        inpOf(pg, "甲队").value = " 乙队 ";
        const res = pg.P.commitRename();
        eq(/已经有叫/.test(res.error || ""), true, "重名 → 报错");
        eq(pg.P.teamList(), ["甲队", "乙队"], "…没变成两支「乙队」");
        eq(pg.P.renameActive(), true, "…留在编辑态");
        eq(leagueOf(pg, "甲一"), "甲队", "…甲一的归属没被牵走");
        eq(pg.P.teamTotal("甲队"), 300, "…合计分照旧");
      }

      // (h) 只改大小写 = 改自己，不算撞名
      {
        const pg = mkFinal([{ name: "甲一", base: 300, multiplier: 1, total: 300, league: "TeamA" }], ["TeamA"]);
        dbl(pg, nameOf(pg, "TeamA"));
        inpOf(pg, "TeamA").value = "  teama  ";
        const res = pg.P.commitRename();
        eq(res && res.name, "teama", "只改大小写/首尾空格 → 允许（不是撞名）");
        eq(pg.P.teamList(), ["teama"], "队伍列表里就是新写法");
        eq(leagueOf(pg, "甲一"), "teama", "队员的 league 也跟着规范成新写法");
      }

      // (i) Esc → 放弃；队名原地显回来
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队"));
        const inp = inpOf(pg, "甲队");
        inp.value = "不要这个名字";
        inp.handlers.keydown({ key: "Escape", keyCode: 27 });
        eq(pg.P.teamList(), ["甲队", "乙队"], "Esc → 放弃，队名不变");
        eq(pg.P.renameActive(), false, "…编辑态收起");
        eq(inpOf(pg, "甲队"), undefined, "…输入框摘掉");
        eq(hasCls(boxOf(pg, "甲队"), "is-renaming"), false, "…类去掉");
        eq(/rank-toast ok|rank-toast err/.test(pg.made["rank-toast"].className), false, "…不打扰用户");
      }

      // (j) 点框外 → 放弃；点框**内**（哪怕点的是队员行）→ 继续编辑
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队"));
        const inp = inpOf(pg, "甲队");
        inp.value = "改到一半";
        pg.doc.handlers.pointerdown({ target: pg.made["rank-toast"], clientX: 0, clientY: 0, pointerId: 1, button: 0 });
        eq(pg.P.renameActive(), false, "点框外 → 放弃编辑");
        eq(pg.P.teamList(), ["甲队", "乙队"], "…队名不变");

        dbl(pg, nameOf(pg, "甲队"));
        eq(pg.P.renameActive(), true, "重新双击又进编辑态");
        const memberRow = boxOf(pg, "甲队").children[1].children[0];
        pg.doc.handlers.pointerdown({ target: memberRow, clientX: 0, clientY: 0, pointerId: 1, button: 0 });
        eq(pg.P.renameActive(), true, "点框**内**的队员行不算「点别处」→ 继续编辑");
        eq(!!inpOf(pg, "甲队"), true, "…输入框还在");
      }

      // (k) 一个字没改就回车 → 静静收摊，既不提示也不重渲染
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队"));
        inpOf(pg, "甲队").value = "  甲队  ";        // 规范化后还是原样
        const res = pg.P.commitRename();
        eq(res, null, "没有实质改动 → 返回 null");
        eq(pg.P.renameActive(), false, "…静静收摊");
        eq(/rank-toast ok|rank-toast err/.test(pg.made["rank-toast"].className), false, "…不打扰用户");
      }

      // (l) 双击别处（队员行 / 名单空白）不会进编辑态，也不会顺带点亮删除键
      {
        const pg = mkFinal();
        dbl(pg, boxOf(pg, "甲队").children[1].children[0]);
        eq(pg.P.renameActive(), false, "双击队员行不进入改名（只认队名）");
        dbl(pg, pg.made["rank-list"]);
        eq(pg.P.renameActive(), false, "双击名单空白处也不进入");
        eq(pg.P.armedPlayer(), "", "…也没顺带点亮删除键");
      }

      // (m) 换一队双击 → 上一个编辑态自动收掉（同一时刻只编一个）
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队"));
        dbl(pg, nameOf(pg, "乙队"));
        eq(!!inpOf(pg, "甲队"), false, "换一队双击 → 上一框的输入框收掉");
        eq(!!inpOf(pg, "乙队"), true, "…现在编的是乙队");
        eq(pg.P.teamList(), ["甲队", "乙队"], "光双击不改名 → 数据不动");
      }

      // (n) 两道门：未分组不可改；初赛（非分组视图）不可改
      {
        const pg = mkFinal();
        eq(pg.P.enterRename(boxOf(pg, "未分组")), false, "「未分组」不可改名");
        eq(pg.P.renameActive(), false, "…也没进入编辑态");

        const realBox = boxOf(pg, "甲队");
        eq(pg.P.enterRename(realBox), true, "决赛里真实队伍框可以进入改名（对照组）");
        pg.P.cancelRename();

        const pg2 = makePage();
        pg2.P.setData({ updatedAt: "", list: [{ name: "甲", base: 10, multiplier: 1, total: 10 }] });
        pg2.P.render();
        eq(pg2.P.isGroupedView(), false, "初赛不是分组视图");
        eq(pg2.P.enterRename(realBox), false, "初赛里同一个框被拒 —— 挡的是 groupedView 这道门");
        eq(pg2.P.renameActive(), false, "…也没进编辑态");
      }

      // (o) render() 会顺手清掉编辑态（旧节点整批被丢，留着就是悬空引用）
      {
        const pg = mkFinal();
        dbl(pg, nameOf(pg, "甲队"));
        eq(pg.P.renameActive(), true, "先进编辑态");
        pg.P.render();
        eq(pg.P.renameActive(), false, "render() 后编辑态清空");
        eq(inpOf(pg, "甲队"), undefined, "…新渲染里没有输入框");
      }

      // (p) 静态约束（样式与实现细节，桩跑不出来 → 读源码断言）
      {
        eq(/\.team-box\.is-renaming\s*\.team-name\{display:none\}/.test(CSS), true,
           "编辑态把队名藏起来让位给输入框");
        eq(CSS.indexOf(".team-box.team-top1{") < CSS.indexOf(".team-box.is-renaming{"), true,
           "编辑态描边写在冠亚季之后（同特异度，同分靠源码顺序决胜负）");
        eq(/\.team-rename-ok\{/.test(CSS), true, "对勾按钮有样式");
        eq(/\.team-rename-ok:focus-visible\{/.test(CSS), true, "对勾有键盘焦点样式");
        eq(/\.team-name-input\{[^}]*flex:1 1 auto/.test(CSS), true, "输入框接住队名原本的 flex:1 位置");
        eq(CSS.indexOf(".team-name-input{") > CSS.indexOf(".team-box.is-renaming .team-name"), true,
           "输入框规则写在「藏队名」那条之后（先讲让位、再讲顶上来的东西）");
        eq(/addEventListener\("blur"/.test(RJ2), false,
           '输入框上不挂 blur —— 点对勾会先 blur，在 blur 里收摊会把对勾摘掉、click 落空');
        eq(/renameBox && !renameBox\.contains\(ev\.target\)\) cancelRename\(\)/.test(RJ2), true,
           "「点框外收摊」挂在 document 的 pointerdown 上，且只判落点在不在这个框里");
        eq(/data-rename-ok", "1"/.test(RJ2), true,
           '对勾的属性值写「1」而不是空串（空串是假值，closestByAttr 会找不到）');
        eq(/data-rename-input", "1"/.test(RJ2), true, "输入框的属性值同样是「1」");
        eq(/inp\.maxLength = TEAM_NAME_MAX/.test(RJ2), true,
           "就地改名与「添加队伍」共用同一个长度上限常量");
      }
    }

    /* ---------- ⑩ 榜单 txt 导出 / 导入（2026-09-26） ----------
       用户要求：「为初赛和决赛页面下的实时选手榜单也做一个导出导入功能，
       按钮在最左和最右侧，导出成 txt 文本形式」。

       这一节钉住四件事：
         ① 两个按钮的**位置**（最左 / 最右）与做法；
         ② 导出的文本既是给人看的汇总、又带一行给机器读的 DATA；
         ③ 导入只认 DATA 行，且**只覆盖当前赛程**（另一场一个字不动）；
         ④ 出错时报人话、榜单一个字不动（绝不半途写坏）。 */
    console.log("--- ⑩ 榜单 txt 导出 / 导入 ---");
    {
      const RHTML2 = fs.readFileSync(path.join(__dirname, "..", "ranking.html"), "utf8");
      const CSS2   = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
      const RJ3    = fs.readFileSync(path.join(__dirname, "..", "js", "ranking.js"), "utf8");
      const settle = () => new Promise(r => setTimeout(r, 0));
      const flush  = async (n) => { for(let i = 0; i < (n || 12); i++) await settle(); };

      /* Blob 只用来装文本：换成「记住写进去的字符串」的替身，读回来才能断言文件内容。
         （Node 自带的 Blob 是真异步的，测试里没必要为它绕一圈。） */
      const RealBlob = global.Blob;
      global.Blob = function(parts){ this.__parts = parts; };
      const useSave = (pg, out) => {
        pg.win.showSaveFilePicker = (opts) => {
          out.name = (opts && opts.suggestedName) || "";
          return Promise.resolve({
            createWritable: () => Promise.resolve({
              write: (blob) => { out.text = (blob.__parts || []).join(""); return Promise.resolve(); },
              close: () => Promise.resolve()
            })
          });
        };
      };
      const useOpen = (pg, file) => {
        pg.win.showOpenFilePicker = () => Promise.resolve([{ getFile: () => file }]);
      };
      const boardFile = (text) => ({ name: "b.txt", text });

      const PRELIM = {
        updatedAt: "2026-09-26 10:00", teams: [],
        list: [
          { name: "甲", base: 100, multiplier: 1,   team: 0,  yuan: 12, total: 100, league: "" },
          { name: "乙", base: 100, multiplier: 1.3, team: 0,  yuan: 30, total: 130, league: "" },
          { name: "丙", base: 200, multiplier: 1,   team: 60, yuan: 5,  total: 260, league: "" }
        ]
      };
      const FINALB = {
        updatedAt: "2026-09-26 11:00", teams: ["甲队", "乙队"],
        list: [
          { name: "甲一", base: 300, multiplier: 1, team: 0, yuan: 90, total: 300, league: "甲队" },
          { name: "乙一", base: 200, multiplier: 1, team: 0, yuan: 15, total: 200, league: "乙队" },
          { name: "散人", base: 60,  multiplier: 1, team: 0, yuan: 0,  total: 60,  league: "" }
        ]
      };
      const mkBoard = (data, m) => {
        const pg = makePage();
        pg.P.setBoard(m || "prelim");
        pg.P.setData(JSON.parse(JSON.stringify(data)));
        pg.P.render();
        return pg;
      };
      const dataLine  = (t) => (String(t).split(/\r?\n/).filter(l => l.indexOf("DATA:") === 0)[0] || "");
      const payloadOf = (t) => JSON.parse(dataLine(t).slice(5));

      // (a) 两个按钮的**位置**：导出=操作区第一个、导入=最后一个
      {
        const iA = RHTML2.indexOf('class="rank-actions"');
        const seg = RHTML2.slice(iA, RHTML2.indexOf("</div>", iA));
        const iExp = seg.indexOf('id="btn-export-board"');
        const iImp = seg.indexOf('id="btn-import-board"');
        eq(iExp > -1, true, "「导出 txt」按钮存在");
        eq(iImp > -1, true, "「导入 txt」按钮存在");
        eq(/>导出 txt</.test(seg), true, "文案是「导出 txt」");
        eq(/>导入 txt</.test(seg), true, "文案是「导入 txt」");
        const rest = ['id="btn-add-team"', 'id="btn-add-player"',
                      'href="index.html"', 'id="btn-clear-board"'].map(s => seg.indexOf(s));
        eq(rest.every(i => i > -1), true, "其余四个按钮都在同一个操作区里");
        eq(rest.every(i => i > iExp), true, "导出排在其余按钮**之前**（= 最左）");
        eq(rest.every(i => i < iImp), true, "导入排在其余按钮**之后**（= 最右）");
      }

      // (b) 样式：靠 auto 外边距顶到两端，中间那组自然居中
      {
        eq(/\.rank-actions #btn-export-board\{margin-right:auto\}/.test(CSS2), true,
           "导出用 margin-right:auto 顶到最左");
        eq(/\.rank-actions #btn-import-board\{margin-left:auto\}/.test(CSS2), true,
           "导入用 margin-left:auto 顶到最右");
        const rule = (CSS2.match(/\.rank-actions\{[^}]*\}/) || [""])[0];
        eq(/space-between/.test(rule), false,
           "⚠️ 不用 justify-content:space-between（那会把 6 个按钮等距摊开、中间那组散掉）");
        eq(/justify-content:center/.test(rule), true, "仍保留居中（窄屏 auto 边距失效时兜底）");
      }

      // (c) 导出（初赛）：可读汇总 + **只有一行** DATA
      {
        const pg = mkBoard(PRELIM, "prelim");
        const txt = pg.P.buildBoardText();
        eq(/黑流树海粥集杯#1 实时排名榜单 · 初赛/.test(txt), true, "标题里写明是哪一场");
        eq(/导出时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(txt), true, "印了导出时间");
        eq(/榜单更新：2026-09-26 10:00/.test(txt), true, "印了榜单更新时间");
        eq(/【排名】共 3 位/.test(txt), true, "印了人数");
        eq(/1\. 丙/.test(txt), true, "名次与榜面同源（第一名是丙）");
        eq(txt.split(/\r?\n/).filter(l => l.indexOf("DATA:") === 0).length, 1, "DATA 行只有一行");
        eq(/【队伍】/.test(txt), false, "初赛没有队伍概念 → 不出现【队伍】段");

        const p = payloadOf(txt);
        eq(p.v, 1, "DATA 行带格式版本号");
        eq(p.mode, "prelim", "记下它来自哪一场");
        eq(p.list.map(r => r.name), ["丙", "乙", "甲"], "按总分降序（与榜面完全一致）");
        eq(p.list[0].total, 260, "分数照搬");
        eq(p.list[0].yuan, 5, "源石锭消耗也带上");
        eq(p.list[0].base === 200 && p.list[0].multiplier === 1 && p.list[0].team === 60, true,
           "基础分 / 倍率 / 团队加分三个字段都在");
        eq(p.teams.length, 0, "初赛没有队伍");
        eq(/yuanInit/i.test(dataLine(txt)), false,
           "⚠️ DATA 行不含源石锭余额设置（免得造出「文件里的基准」与「本机基准」两个真相）");
      }

      // (d) 并列名次：同分同名次，下一位不留空档（与 render() 同一份逻辑）
      {
        const pg = makePage();
        pg.P.setBoard("prelim");
        pg.P.setData({ updatedAt: "", teams: [], list: [
          { name: "甲", base: 100, multiplier: 1, total: 100 },
          { name: "乙", base: 100, multiplier: 1, total: 100 },
          { name: "丙", base: 90,  multiplier: 1, total: 90 }
        ]});
        pg.P.render();
        const txt = pg.P.buildBoardText();
        eq(/1\. 甲/.test(txt) && /1\. 乙/.test(txt), true, "同分并列第 1");
        eq(/3\. 丙/.test(txt), true, "下一位是第 3（不留空档）");
        eq(payloadOf(txt).list.length, 3, "并列不影响条数");
      }

      // (e) 导出（决赛）：多一段按队汇总，且「剩余」用与榜面同一个基准
      {
        const pg = mkBoard(FINALB, "final");
        const txt = pg.P.buildBoardText();
        eq(/实时排名榜单 · 决赛/.test(txt), true, "标题写明决赛");
        eq(/【队伍】共 2 支/.test(txt), true, "决赛印队伍段");
        eq(/决赛初始源石锭余额/.test(txt), true, "留档一行「剩余」的基准（给人看的）");
        eq(/已使用 90/.test(txt), true, "甲队已使用 90");
        eq(/剩余 30/.test(txt), true, "剩余 = 120 − 90（默认基准 120）");
        eq(/合计 300/.test(txt), true, "甲队合计 300");
        eq(/甲队/.test(txt) && /未分组/.test(txt), true, "真实队伍与「未分组」都列了出来");
        const p = payloadOf(txt);
        eq(p.mode, "final", "记的是决赛");
        eq(p.teams, ["甲队", "乙队"], "队伍列表照带");
        eq(p.list.find(r => r.name === "甲一").league, "甲队", "队员归属照带");
        eq(/yuanInit/i.test(dataLine(txt)), false, "DATA 行里仍不含余额设置");
      }

      // (f) parseBoardText：只认 DATA 行，坏文件都给人话，绝不抛异常
      {
        const pg = makePage();
        const P = pg.P;
        eq(!!P.parseBoardText("").error, true, "空文件 → 报错");
        eq(!!P.parseBoardText("随便写点什么").error, true, "没有 DATA 行 → 报错");
        eq(/DATA:/.test(P.parseBoardText("xx").error), true, "错误文案里点出要找 DATA 行");
        eq(!!P.parseBoardText("DATA:{坏掉的").error, true, "DATA 行不是 JSON → 报错");
        eq(!!P.parseBoardText("DATA:[1,2,3]").error, true, "JSON 是数组 → 报错");
        eq(!!P.parseBoardText('DATA:{"list":[]}').error, true, "缺版本号 → 报错");
        const counter = 'DATA:{"v":1,"playerName":"祁星","counts":{},"toggles":{}}';
        const r1 = P.parseBoardText(counter);
        eq(!!r1.error, true, "计分器的存档（有 v 但没有 list）→ 报错，不会把两份数据搅在一起");
        eq(/list/.test(r1.error), true, "错误文案点出缺的是 list");
        eq(!!P.parseBoardText('DATA:{"v":1}').error, true, "没有 list 字段 → 报错");

        const mixed = '上半部分随便写\nDATA:{"v":1,"mode":"final","list":[]}\n\n后面还有别的东西';
        const ok = P.parseBoardText(mixed);
        eq(!ok.error, true, "DATA 行不在最后一行也能认（从末尾往上找）");
        eq(ok.mode, "final", "读出它来自决赛");
        eq(!P.parseBoardText('\ufeffDATA:{"v":1,"list":[]}').error, true, "带 BOM 也认（记事本另存常见）");
        eq(P.parseBoardText('DATA:{"v":1,"list":[],"mode":"乱写"}').mode, "",
           "文件里的赛程名不合法 → 回落空串（不当成警告依据）");
      }

      // (g) sanitizeBoard：洗数据 + ⚠️ 给没登记的队伍兜底
      {
        const pg = makePage();
        const b = pg.P.sanitizeBoard({
          updatedAt: 12345,                      // 不是字符串 → 丢掉、补一个当前时间
          teams: ["甲队", " 甲队 ", "", "未分组", "乙队"],
          list: [
            { name: " 甲一 ", league: " 甲队 ", total: "300", base: "300",
              multiplier: "1", team: "0", yuan: "90" },
            { name: "甲二", league: "丙队" },     // 数值全缺 + 队伍没登记
            { name: "", total: 999 },             // 无名 → 丢掉
            null,                                 // 脏数据 → 丢掉
            { name: "散人", league: "未分组", total: 60 }
          ]
        });
        eq(b.teams, ["甲队", "乙队", "丙队"], "队名去空白 / 按大小写去重 / 丢掉空名与「未分组」");
        eq(b.list.length, 3, "无名与脏数据被丢掉");
        eq(b.list[0].name, "甲一", "选手名去首尾空白");
        eq(b.list[0].total, 300, "字符串数字归一成数字");
        eq(b.list[1].base === 0 && b.list[1].yuan === 0, true, "缺字段 → 0，不出 NaN");
        eq(b.list[1].multiplier, 1, "缺倍率 → 1（与 buildRows 同口径）");
        eq(b.teams.indexOf("丙队") > -1, true,
           "⚠️ 没登记的队自动补进 teams（否则分组匹配不到、人会整批掉进「未分组」）");
        eq(b.list[1].league, "丙队", "…队员的归属照留");
        eq(b.list[2].league, "", "「未分组」归一成「没归队」（那是虚拟筐，不是真队名）");
        eq(typeof b.updatedAt === "string" && b.updatedAt !== "", true, "没有更新时间就补一个");
      }

      // (h) applyBoard：只改字段、不换对象；只落当前赛程的键
      {
        const pg = mkBoard(PRELIM, "prelim");
        const d0 = pg.P.getData();
        const mine = pg.P.sanitizeBoard(JSON.parse(JSON.stringify(FINALB)));
        pg.P.applyBoard(mine);
        eq(pg.P.getData() === d0, true,
           "⚠️ 只改 DATA 的字段、不替换对象（整份替换会让后续写入落到孤儿对象上）");
        eq(pg.P.getData().list.map(r => r.name), ["甲一", "乙一", "散人"], "初赛榜被覆盖");
        eq(String(pg.P.getData().teams), "甲队,乙队", "队伍也换了过来");
        eq(/甲一/.test(pg.win.localStorage.getItem("hlsh_zhoujibei_ranking_v1")), true,
           "落盘到初赛自己的键");
        eq(pg.win.localStorage.getItem("hlsh_zhoujibei_ranking_final_v1"), null,
           "⚠️ 决赛那份存档一个字都没被碰");
        eq(pg.made["rank-list"].children.length > 0, true, "榜单界面跟着重画了");
      }

      // (i) importBoard：取消 / 不确认 / 确认 → 三条路都干净
      {
        // ① 用户在系统选文件框里取消
        const pg = mkBoard(PRELIM, "prelim");
        pg.win.showOpenFilePicker = () => Promise.reject({ name: "AbortError" });
        pg.P.importBoard();
        await flush();
        eq(pg.P.getData().list.length, 3, "取消选文件 → 榜单原样（3 位）");
        eq(pg.made["rank-toast"].className, "", "…也不弹任何提示（取消不算失败）");

        // ② 选了文件、但确认框按「取消」
        useOpen(pg, boardFile(pg.P.buildBoardText().replace(/prelim/, "final")));   // 顺手换赛程标记
        pg.win.confirm = () => false;
        pg.P.importBoard();
        await flush();
        eq(pg.P.getData().list.length, 3, "确认框按取消 → 一个字不动");
        eq(pg.made["rank-toast"].className, "", "…也没有成功提示");

        // ③ 确认 → 覆盖
        pg.win.confirm = () => true;
        const file2 = boardFile(pg.P.buildBoardText());
        useOpen(pg, file2);
        pg.P.importBoard();
        await flush();
        eq(pg.P.getData().list.map(r => r.name), ["丙", "乙", "甲"], "确认后榜单被替换");
        eq(/rank-toast ok/.test(pg.made["rank-toast"].className), true, "给了绿色成功提示");
        eq(/已导入 3 位选手/.test(pg.made["rank-toast"].innerHTML || ""), true, "提示里点了条数");
        eq(/【初赛】/.test(pg.made["rank-toast"].innerHTML || ""), true, "提示里点了是哪个赛程");

        // ④ 文件来自**另一场**赛程 → 确认框里必须多一句警告
        const finalText = (function(){
          const p = mkBoard(FINALB, "final");
          return p.P.buildBoardText();
        })();
        let seen = "";
        const pg2 = mkBoard(PRELIM, "prelim");
        pg2.win.confirm = (m) => { seen = String(m); return false; };
        useOpen(pg2, boardFile(finalText));
        pg2.P.importBoard();
        await flush();
        eq(/【决赛】/.test(seen), true, "确认框里说清了文件来自决赛");
        eq(/⚠️/.test(seen), true, "…并给出警告");
        eq(/覆盖当前【初赛】榜单/.test(seen), true, "…也说明了会覆盖当前这一块");

        // ⑤ 空榜单文件 → 拒收（要清空请用「清空榜单」）
        const pg3 = mkBoard(PRELIM, "prelim");
        pg3.win.confirm = () => true;
        useOpen(pg3, boardFile('DATA:{"v":1,"mode":"prelim","list":[],"teams":[]}'));
        pg3.P.importBoard();
        await flush();
        eq(pg3.P.getData().list.length, 3, "空文件被拒收，榜单没动");
        eq(/rank-toast err/.test(pg3.made["rank-toast"].className), true, "给了红色失败提示");

        // ⑥ 误选计分器的存档 → 人话报错
        const pg4 = mkBoard(PRELIM, "prelim");
        pg4.win.confirm = () => true;
        useOpen(pg4, boardFile('DATA:{"v":1,"playerName":"祁星","counts":{},"toggles":{}}'));
        pg4.P.importBoard();
        await flush();
        eq(pg4.P.getData().list.length, 3, "误选计分器 txt → 榜单没动");
        eq(/导入失败/.test(pg4.made["rank-toast"].innerHTML || ""), true, "提示里写明导入失败");
        eq(pg4.made["rank-toast"].className.indexOf("err") > -1, true, "…是红色提示");
      }

      // (j) exportBoard：文件名 / 内容 / 用户取消不邀功
      {
        const pg = mkBoard(FINALB, "final");
        const out = {};
        useSave(pg, out);
        pg.made["btn-export-board"].handlers.click();
        await flush();
        eq(/^黑流树海粥集杯#1榜单-决赛-\d{8}-\d{4}\.txt$/.test(out.name), true,
           "文件名：黑流树海粥集杯#1榜单-决赛-YYYYMMDD-HHMM.txt");
        eq(!!out.text, true, "确实写出了内容");
        const back = pg.P.parseBoardText(out.text);
        eq(!back.error, true, "写出去的 txt 能被自己的解析器读回来（闭环）");
        eq(pg.P.sanitizeBoard(back.board).list.map(r => r.name), ["甲一", "乙一", "散人"],
           "读回来还是那三个人");
        eq(/rank-toast ok/.test(pg.made["rank-toast"].className), true, "给了绿色成功提示");
        eq(/已导出【决赛】榜单/.test(pg.made["rank-toast"].innerHTML || ""), true,
           "提示里点明了导的是哪一场");

        // 用户在「另存为」里点取消 → 不算失败、也不该说「已导出」
        const pg2 = mkBoard(PRELIM, "prelim");
        pg2.win.showSaveFilePicker = () => Promise.reject({ name: "AbortError" });
        pg2.made["btn-export-board"].handlers.click();
        await flush();
        eq(pg2.made["rank-toast"].className, "", "另存为点取消 → 不弹「已导出」也不报错");
      }

      // (k) 静态约束：两条系统通道、只读 DATA 行、名次同源
      {
        eq(/function buildBoardText\(/.test(RJ3), true, "导出文本由 buildBoardText() 组装");
        eq(/var BOARD_MARKER\s*=\s*"DATA:"/.test(RJ3), true, "机器可读行沿用 DATA: 标记");
        eq(/var BOARD_VERSION\s*=\s*1/.test(RJ3), true, "带格式版本号");
        eq(/showSaveFilePicker/.test(RJ3) && /showOpenFilePicker/.test(RJ3), true,
           "优先用 File System Access API（用户可选保存位置 / 选文件）");
        eq(/a\.download = name/.test(RJ3), true, "API 不可用时退回 <a download> 普通下载");
        eq(/inp\.type = "file"/.test(RJ3), true, "…选文件退回临时 <input type=file>");
        eq((RJ3.match(/AbortError/g) || []).length >= 2, true,
           "保存与打开两条路都认 AbortError（用户取消别当成失败弹错）");
        eq(/if\(elExport\)/.test(RJ3) && /if\(elImport\)/.test(RJ3), true,
           "两个按钮都判存在再绑事件（节点缺失时不炸）");
        eq(/function applyBoard\(board\)\{\s*DATA\.list = board\.list/.test(RJ3), true,
           "导入只改 DATA 的字段，不替换 DATA 这个对象");
        eq(/function rankedRows\(/.test(RJ3), true, "名次由 rankedRows() 统一算");
        eq(/var rows = rankedRows\(\)/.test(RJ3), true,
           "render() 也走同一份名次 → 导出的名次与屏幕上的永远一致");
        eq(/buildBoardText: buildBoardText/.test(RJ3) && /importBoard: importBoard/.test(RJ3), true,
           "导出 / 导入都挂在 window.RANKING_PAGE 上（可调试、可回归）");
      }

      global.Blob = RealBlob;
    }
  }
}
}

/* ==================================================================
   ⑩ 源石锭余额设置弹框（2026-09-25 加）

   用户要求：源石锭面板标题右侧加一个齿轮按钮 → 弹框上方改初赛 / 决赛的
             源石锭余额 → 下方「应用」「取消」两个按键。
   ================================================================== */
(function(){
  const htmlNow = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const appNow  = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const cssNow  = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
  /* 榜单页那份源码也要看一眼：`.modal-*` 样式是两页共用的，别只改一边 */
  const rjNow   = fs.readFileSync(path.join(__dirname, "..", "js", "ranking.js"), "utf8");

  const gear   = byId["btn-yuan-settings"];
  const modal  = byId["yuan-modal"];
  const pIn    = byId["yuan-init-prelim"];
  const fIn    = byId["yuan-init-final"];
  const applyB = byId["yuan-modal-apply"];
  const cancelB= byId["yuan-modal-cancel"];

  const clickEl   = (el, target) => el.handlers.click({ target: target || el });
  const pressKey  = (k, extra) => keydownHandlers.forEach(fn =>
    fn(Object.assign({ key: k, preventDefault(){} }, extra || {})));
  const openModal = () => clickEl(gear);
  const setInputs = (p, f) => { pIn.value = String(p); fIn.value = String(f); };
  /** 每个用例开始前把余额与弹框都归到「刚打开页面」的样子 */
  const fresh = () => {
    modal.hidden = true;
    S.yuanInitPrelim = B.YUAN_INIT_PRELIM;
    S.yuanInitFinal  = B.YUAN_INIT_FINAL;
    setInputs(B.YUAN_INIT_PRELIM, B.YUAN_INIT_FINAL);
    B.updateUI();
  };

  console.log("--- ⑩a 齿轮按钮与弹框的静态结构 ---");
  eq(/<h2>源石锭<button type="button" class="panel-gear" id="btn-yuan-settings"/.test(htmlNow), true,
     "源石锭标题右侧就是齿轮按钮（h2 与 button 之间不留空白，否则 flex 会多出一个匿名项把齿轮挤离右端）");
  eq(/id="btn-yuan-settings"[\s\S]{0,220}?title="源石锭余额设置"/.test(htmlNow), true,
     "齿轮带 title 提示");
  eq(/id="btn-yuan-settings"[\s\S]{0,260}?aria-label="源石锭余额设置"/.test(htmlNow), true,
     "齿轮带 aria-label（图标按钮没有可读文本，无障碍必须有）");
  eq(/<svg viewBox="0 0 24 24"[\s\S]{0,900}?<path fill="currentColor"/.test(htmlNow), true,
     "图标是内联 SVG（不用 ⚙ 字符 —— 它在部分平台会被渲染成 emoji，颜色也跟不上主题）");
  eq(/aria-hidden="true"/.test(htmlNow), true, "SVG 对读屏隐藏（有 aria-label 就够了）");

  eq(/<div class="modal-overlay" id="yuan-modal" hidden/.test(htmlNow), true,
     "弹框用 .modal-overlay，且初始带 hidden");
  eq(/id="yuan-modal"[\s\S]{0,200}?role="dialog"[\s\S]{0,120}?aria-modal="true"/.test(htmlNow), true,
     "弹框有 dialog 语义");
  eq(/id="yuan-init-prelim"/.test(htmlNow), true, "上方有「初赛余额」输入框");
  eq(/id="yuan-init-final"/.test(htmlNow), true, "上方有「决赛余额」输入框");
  eq(/class="big-btn green" id="yuan-modal-apply">应用</.test(htmlNow), true,
     "「应用」是绿色主按钮");
  eq(/class="big-btn" id="yuan-modal-cancel">取消</.test(htmlNow), true, "「取消」是普通按钮");

  const iModal = htmlNow.indexOf('id="yuan-modal"');
  eq(iModal > htmlNow.indexOf('class="total-panel"'), true,
     "弹框在 #layout 与总分面板之后（它是全屏遮罩，不是面板，不参与分栏配平）");
  eq(iModal > htmlNow.lastIndexOf("</section>"), true, "弹框在所有面板之外");
  eq(htmlNow.indexOf('id="yuan-modal"') < htmlNow.indexOf("<script src=\"js/app.js\""), true,
     "弹框是静态标记（在脚本之前），不是 JS 拼出来的");

  console.log("--- ⑩b 样式：与榜单页共用同一套弹框样式 ---");
  eq(/\.modal-overlay,\.rank-modal\{/.test(cssNow), true,
     "`.modal-overlay` 与榜单页的 `.rank-modal` 并列共用一条规则（不复制一份样式）");
  eq(/\.modal-overlay\[hidden\],\.rank-modal\[hidden\]\{display:none\}/.test(cssNow), true,
     "`[hidden]` 必须显式 display:none —— display:flex 会盖掉 UA 的 none，否则弹框关不掉");
  eq(/\.panel-gear\{[^}]*margin-left:auto/.test(cssNow), true,
     "齿轮靠 margin-left:auto 推到标题行最右端（.panel h2 是 flex 容器）");
  eq(/\.panel-gear:hover\{[^}]*color:var\(--warn\)/.test(cssNow), true,
     "齿轮 hover 用 --warn（与源石锭面板的 warn 主题一致）");
  eq(/\.panel-gear:focus-visible/.test(cssNow), true, "齿轮有键盘焦点样式");
  eq(/\.rank-modal\b/.test(rjNow) === false, true,
     "榜单页 JS 里不出现类名（它只操作 id），改名不会牵动它");

  console.log("--- ⑩c 打开弹框：填的是当前值 ---");
  fresh();
  eq(B.yuanModalIsOpen(), false, "初始是关着的");
  eq(B.yuanInit("prelim"), 60, "初赛余额默认 60");
  eq(B.yuanInit("final"), 120, "决赛初始余额默认 120");
  eq(gear.handlers.click !== undefined, true, "齿轮上挂了点击处理器");
  eq(modal.handlers.click !== undefined, true, "遮罩上挂了点击处理器");

  openModal();
  eq(B.yuanModalIsOpen(), true, "点齿轮 → 弹框打开");
  eq(pIn.value, 60, "输入框被填成当前初赛余额");
  eq(fIn.value, 120, "输入框被填成当前决赛余额");

  // 改过值之后重开，填的应该是改后的值（不是常量默认值）
  S.yuanInitPrelim = 75; S.yuanInitFinal = 150;
  modal.hidden = true;
  openModal();
  eq(pIn.value, 75, "重开时填的是 state 里的新值（不是默认 60）");
  eq(fIn.value, 150, "…决赛同理");

  console.log("--- ⑩d 应用：写回 state + 界面重算 + 落盘 ---");
  fresh();
  openModal();
  setInputs(80, 150);
  clickEl(applyB);
  eq(S.yuanInitPrelim, 80, "初赛余额写回 state");
  eq(S.yuanInitFinal, 150, "决赛余额写回 state");
  eq(B.yuanModalIsOpen(), false, "应用后弹框自动关闭");
  eq(byId["yuan-prelim-bal"].textContent, 80, "初赛面板上的「源石锭余额」随即变成 80");
  eq(byId["yuan-init"].textContent, 150, "决赛区的「初始源石锭余额」随即变成 150");
  eq(JSON.parse(store[B.STORAGE_KEY] || "{}").yuanInitPrelim, 80, "余额已写进计分存档（刷新后还在）");
  eq(JSON.parse(store[B.STORAGE_KEY] || "{}").yuanInitFinal, 150, "…决赛余额同理");

  console.log("--- ⑩e 应用会立刻改变算分结果 ---");
  fresh();
  S.yuanMode = "prelim"; S.yuanStart = 120; S.yuanEnd = 0;   // 消耗 120
  eq(B.yuanPenalty().penalty, -3000, "默认上限 60：消耗 120 → (60−120)×50 = −3000");
  openModal(); setInputs(120, 120); clickEl(applyB);
  eq(B.yuanPenalty().penalty, 0, "把初赛上限提到 120 → 消耗 120 刚好不超额");
  eq(byId["yuan-taken"].textContent, 120, "消耗点数照旧 120");
  eq(byId["yuan-avail"].textContent, 120, "可用余额跟着变成 120");
  eq(B.computeAll().total === B.computeAll().personalScore * B.computeAll().multiplier, true,
     "总分也按新余额重算（源石小计从 −3000 变 0）");

  S.yuanMode = "final"; S.yuanStart = 300; S.yuanEnd = 100; S.yuanPrev = 50;  // 消耗 200
  eq(B.yuanPenalty().avail, 70, "决赛：上限 120 − 上一位 50 = 可用 70");
  openModal(); setInputs(60, 300); clickEl(applyB);
  eq(B.yuanPenalty().avail, 250, "决赛上限提到 300 − 上一位 50 = 可用 250");
  eq(B.yuanPenalty().penalty, 0, "消耗 200 ≤ 250 → 不再超额");
  S.yuanMode = "prelim";

  console.log("--- ⑩f 取消 / Esc / 点遮罩：一个字不改 ---");
  fresh();
  openModal();
  setInputs(999, 999);
  clickEl(cancelB);
  eq(B.yuanModalIsOpen(), false, "点「取消」关掉弹框");
  eq([S.yuanInitPrelim, S.yuanInitFinal], [60, 120], "…余额一个字没改");
  eq(byId["yuan-prelim-bal"].textContent, 60, "…界面上也没变");

  openModal(); setInputs(7, 7);
  pressKey("Escape");
  eq(B.yuanModalIsOpen(), false, "Esc 关掉弹框");
  eq([S.yuanInitPrelim, S.yuanInitFinal], [60, 120], "…Esc 等同取消，不改余额");

  openModal(); setInputs(8, 8);
  clickEl(modal, modal);                       // 点遮罩本身
  eq(B.yuanModalIsOpen(), false, "点遮罩（卡片外的空白）关掉弹框");
  eq([S.yuanInitPrelim, S.yuanInitFinal], [60, 120], "…同样不改余额");

  openModal(); setInputs(9, 9);
  clickEl(modal, pIn);                         // 点在卡片内部
  eq(B.yuanModalIsOpen(), true, "点卡片内部不会关（只有点遮罩才关）");
  eq([S.yuanInitPrelim, S.yuanInitFinal], [60, 120], "…更不会改余额");

  console.log("--- ⑩g 回车 = 应用（含中文输入法组字的放过） ---");
  fresh();
  openModal();
  setInputs(90, 190);
  pressKey("Enter");
  eq(B.yuanModalIsOpen(), false, "回车关掉弹框");
  eq([S.yuanInitPrelim, S.yuanInitFinal], [90, 190], "…回车等同「应用」");

  openModal(); setInputs(11, 11);
  pressKey("Enter", { isComposing: true });
  eq(B.yuanModalIsOpen(), true, "组字中的回车（isComposing）不算「应用」，弹框不关");
  eq(S.yuanInitPrelim, 90, "…余额也没被改");
  pressKey("Enter", { keyCode: 229 });
  eq(B.yuanModalIsOpen(), true, "keyCode 229（输入法组字）同样放过");
  clickEl(cancelB);

  pressKey("Escape");
  eq(B.yuanModalIsOpen(), false, "弹框关着时按 Esc 什么也不发生（不报错、不误开）");

  console.log("--- ⑩h 输入的健壮性：剔非数字 / 空 → 0 / 超上界截断 ---");
  fresh();
  openModal(); setInputs("8a0", "1 5 0"); clickEl(applyB);
  eq([S.yuanInitPrelim, S.yuanInitFinal], [80, 150], "非数字字符被剔掉（8a0 → 80，1 5 0 → 150）");

  openModal(); setInputs("", ""); clickEl(applyB);
  eq([S.yuanInitPrelim, S.yuanInitFinal], [0, 0], "空 → 0（0 是合法余额，不当成错误）");

  openModal(); setInputs("999999", "12345678"); clickEl(applyB);
  eq([S.yuanInitPrelim, S.yuanInitFinal], [B.YUAN_MODAL_MAX, B.YUAN_MODAL_MAX],
     "超上界一律截到 " + B.YUAN_MODAL_MAX + "（挡住误输入的天文数字）");

  openModal(); setInputs(-5, "-3"); clickEl(applyB);
  eq([S.yuanInitPrelim, S.yuanInitFinal], [5, 3], "负号被剔掉（" + "-5" + " → 5）");

  eq(B.applyYuanModal(), false, "弹框关着时调 applyYuanModal() 直接返回 false（不凭空改数）");
  eq(B.closeYuanModal(), true, "closeYuanModal() 对外返回 true（幂等，重复关不报错）");

  console.log("--- ⑩i 弹框输入框不受 updateUI() 干扰（关键设计取舍） ---");
  fresh();
  openModal();
  pIn.value = "7";                        // 用户正在敲字（还没点应用）
  B.syncDOM();                            // 背后有人调了「把 state 回填到界面」
  eq(pIn.value, "7", "syncDOM() 不回填弹框输入框 —— 否则用户敲到一半的数字会被刷回旧值");
  B.updateUI();
  eq(pIn.value, "7", "updateUI() 也不碰它");
  eq(modal.hidden, false, "…弹框还开着");
  clickEl(cancelB);

  eq(typeof B.openYuanModal, "function", "对外暴露 openYuanModal");
  eq(typeof B.closeYuanModal, "function", "对外暴露 closeYuanModal");
  eq(typeof B.applyYuanModal, "function", "对外暴露 applyYuanModal");
  eq(typeof B.yuanModalIsOpen, "function", "对外暴露 yuanModalIsOpen");
  eq(typeof B.yuanInit, "function", "对外暴露 yuanInit（算分/界面/导出三处共用的取值口）");

  console.log("--- ⑩j 归零 / 导入 / 导出 与余额的关系 ---");
  fresh();
  S.yuanInitPrelim = 90; S.yuanInitFinal = 200;
  B.clearState();
  eq([S.yuanInitPrelim, S.yuanInitFinal], [90, 200],
     "「归零」不清余额（它是赛制配置，不是某位选手的成绩）");
  eq(S.yuanStart, 0, "…但选手的源石锭数字照旧归零");

  B.applySnapshot({ v: 1, counts: {}, toggles: {}, yuanInitPrelim: 77 }, true);
  eq(S.yuanInitPrelim, 77, "导入带余额字段的存档 → 覆盖（余额是算分参数，必须随存档复现）");
  eq(S.yuanInitFinal, 200, "…没带的那一项保持原值（不会被顺手清成默认）");

  B.applySnapshot({ v: 1, counts: {}, toggles: {} }, true);
  eq([S.yuanInitPrelim, S.yuanInitFinal], [77, 200], "导入老档（没有这两个字段）→ 一律保持现值");

  B.applySnapshot({ v: 1, counts: {}, toggles: {}, yuanInitPrelim: -9, yuanInitFinal: "abc" }, true);
  eq([S.yuanInitPrelim, S.yuanInitFinal], [0, 200], "负数按 0；非法值整项跳过（不是写成 NaN）");

  fresh();
  S.yuanInitPrelim = 88; S.yuanInitFinal = 188;
  const txt10 = B.buildExportText();
  eq(/初赛余额上限\s*\.*\s*88/.test(txt10), true, "txt 可读区印出初赛余额上限（留档）");
  eq(/决赛初始余额\s*\.*\s*188/.test(txt10), true, "txt 可读区印出决赛初始余额");
  const pl10 = JSON.parse(txt10.slice(txt10.lastIndexOf("DATA:") + 5));
  eq([pl10.yuanInitPrelim, pl10.yuanInitFinal], [88, 188], "DATA 行里也带上这两个字段（可复现）");

  /* ⚠️ 榜单页解析器要能容忍新增的两行：它只认【源石锭】段里的「消耗点数」那一行 */
  eq(/消耗点数/.test(txt10), true, "「消耗点数」那一行照旧在（榜单页靠它取源石锭消耗）");

  console.log("--- ⑩k 实现细节的静态约束 ---");
  eq(/function yuanInit\(mode\)/.test(appNow), true, "取值统一走 yuanInit()");
  eq(/const YUAN_MODAL_MAX = 9999/.test(appNow), true, "上限常量是 9999");
  eq((appNow.match(/yuanInit\("prelim"\)/g) || []).length >= 3, true,
     "算分 / 界面 / 导出三处都经 yuanInit()，不存在「显示 100 却按 60 算」");
  eq(/readYuanInput[\s\S]{0,260}?replace\(\/\[\^0-9\]\/g, ""\)/.test(appNow), true,
     "输入只收数字（非数字字符一律剔掉）");
  /* 弹框的两个输入框绝不能进 syncDOM 的 numMap */
  const numMapBlock = /const numMap = \{([\s\S]*?)\};/.exec(appNow);
  eq(!!numMapBlock, true, "找得到 syncDOM 的 numMap");
  eq(/yuan-init-prelim/.test(numMapBlock[1]) === false, true,
     "numMap 里没有弹框输入框（进了就会被 updateUI 刷掉正在敲的字）");
  eq(/yuan-init-final/.test(numMapBlock[1]) === false, true, "…决赛那个也没有");
  /* 键盘挂在 document 上而不是两个输入框上 */
  eq(/document\.addEventListener\("keydown", function\(ev\)\{\s*if\(!yuanModalIsOpen\(\)\) return;/.test(appNow), true,
     "Esc / 回车挂在 document 上，且先判弹框是否开着（关着时页面其余部分一个字不受影响）");
  eq(/if\(ev\.isComposing \|\| ev\.keyCode === 229\) return;/.test(appNow), true,
     "组字中的回车被放过（isComposing / 229 两种都挡）");
  /* 齿轮按钮不进 PANELS，也不进 app.js 的布局逻辑 */
  eq(/btn-yuan-settings/.test(appNow), true, "齿轮在 app.js 里被接线");
  eq(/yuan-modal/.test(appNow), true, "弹框在 app.js 里被接线");
  eq(B.PANELS.filter(p => /gear|yuan-modal/.test(String(p))).length, 0,
     "齿轮与弹框都不在 PANELS 里（不参与分栏配平）");

  fresh();
})();

// ⚠️ 第 25/26 节里有 await（ingest 的 Promise 链），必须等它跑完再统计，
//    否则「通过 N 项」会先于最后一批断言打印出来，看起来像被吞了。
sectionRankingAsync().then(function(){
  console.log("\n========================================");
  console.log("  通过 " + PASS + " 项，失败 " + FAIL + " 项");
  console.log("========================================");
  process.exit(FAIL ? 1 : 0);
}, function(err){
  console.error("回归脚本自身抛错：", err);
  process.exit(2);
});
