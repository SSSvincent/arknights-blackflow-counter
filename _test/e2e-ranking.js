/* 真 Chrome 端到端验证：计分器导出 txt → 榜单页「添加选手」→ 六个值上屏
   用法： node _test/e2e-ranking.js
   产出的样本 txt 落在 _test/_e2e/ 下，可人工打开核对。 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_e2e");
/* ⚠️ 开跑前先把上次的临时目录整个删掉：浏览器 profile 就建在里面，
   残留的 localStorage 会让「决赛应该是空的」这类断言假失败（踩过 —— 上一次跑崩了没清干净）。 */
if (fs.existsSync(OUT)) { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* 继续 */ } }
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
].find(p => fs.existsSync(p));
if (!CHROME) { console.error("找不到 Chrome/Edge"); process.exit(1); }
console.log("浏览器:", CHROME);

const fileUrl = p => "file:///" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:");

/* ⚠️ 不能用 execFileSync 收集 stdout：本机 Chrome 在沙箱里会 EBUSY。
   改成 spawnSync + 自己把 stdout 重定向到文件，再读回来（与手工命令行行为一致）。 */
function chrome(args, label) {
  const optFile = path.join(OUT, "_dom_" + label + ".txt");
  const fd = fs.openSync(optFile, "w");
  const r = spawnSync(CHROME, args, { stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  if (r.error) { console.error("启动浏览器失败:", r.error.message); process.exit(1); }
  return fs.readFileSync(optFile, "utf8");
}

/* 一个探针页：链接真实 app.js，用 BFC 接口配置一名选手并导出文本，
   结果塞进 <pre id=probe-out>（base64，避免中文被 GBK 弄乱）。 */
function runProbe(scripts, script, label, copyFrom, size) {
  const probe = path.join(OUT, "_probe.html");
  const tags = scripts.map(s => `<script src="${s}"></script>`).join("\n");
  /* copyFrom：把某个真实页面的 <body> 内容整段抄进来 —— 榜单页的脚本要真的 getElementById
     到 #rank-list / #rank-count / #rank-toast，光有脚本没有 DOM 是跑不起来的。 */
  let bodyHtml = '<pre id="probe-out" style="display:none">PENDING</pre>\n' + tags;
  if (copyFrom) {
    const src = fs.readFileSync(path.join(ROOT, copyFrom), "utf8");
    const inner = src.slice(src.indexOf("<body>") + 6, src.lastIndexOf("</body>"));
    bodyHtml = inner.replace(/<script[\s\S]*?<\/script>/g, "") +
               '\n<pre id="probe-out" style="display:none">PENDING</pre>\n' + tags;
  }
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<link rel="stylesheet" href="../../css/style.css">
</head><body>
${bodyHtml}
<script>
window.__ERR = [];
window.onerror = function(m){ window.__ERR.push(String(m)); };
/* 造「真格式」存档文本的工具，供探针脚本生成夹具（缺省时探针不依赖它） */
window.__mkTxt = ${sampleExport.toString()};
try {
  Promise.resolve((function(){ ${script} })()).then(function(out){
    document.getElementById("probe-out").textContent =
      btoa(unescape(encodeURIComponent(JSON.stringify(out))));
  }, function(e){
    document.getElementById("probe-out").textContent =
      btoa(unescape(encodeURIComponent(JSON.stringify({fatal:String(e && e.stack || e)}))));
  });
} catch(e){
  document.getElementById("probe-out").textContent =
    btoa(unescape(encodeURIComponent(JSON.stringify({fatal:String(e && e.stack || e)}))));
}
<\/script></body></html>`;
  fs.writeFileSync(probe, html, "utf8");

  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--user-data-dir=" + path.join(OUT, "_ud_" + label),
    "--virtual-time-budget=15000",
    "--dump-dom", fileUrl(probe)
  ];
  /* size（可选，"宽,高"）：要测窄屏（@media max-width:720px 那套字号/间距）就得显式给窗口尺寸，
     否则无头默认 800×600 —— 断点之外，量到的是宽屏那套，断言会「假通过」。 */
  if (size) args.splice(4, 0, "--window-size=" + size);
  const dom = chrome(args, label);

  const m = /<pre id="probe-out"[^>]*>([A-Za-z0-9+/=]*)<\/pre>/.exec(dom);
  if (!m || !m[1] || m[1] === "PENDING") {
    console.error("探针没吐出结果。原始 DOM 片段：");
    const i = dom.indexOf("probe-out");
    console.error(dom.slice(Math.max(0, i - 200), i + 400));
    process.exit(1);
  }
  return JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
}

/* ---------------- ① 用真实 app.js 生成一份导出 txt ----------------
   走**决赛**模式 —— 只有决赛才拆团队分，txt 里才会出现「团队得分」行；
   决赛又会打印【源石锭】区（含「消耗点数」）—— 这正是这次新加的列要验的东西。 */
console.log("\n[1] 用真实 app.js 生成导出 txt（决赛模式，含团队得分与源石锭消耗）…");
const exported = runProbe(["../../js/app.js"], `
  var B = window.BFC, S = B.state;
  S.playerName = "祁星";
  S.counts.six = 4; S.counts.five = 2; S.counts.four = 1;
  S.toggles["stage_chijin"] = true;      // 赤金厄运 +200（TEAM_KEYS → 决赛拆进团队分）
  S.toggles["stage_aidao"] = true;       // 哀悼铁腕 +160（团队项）
  S.toggles["stage_heidan_nao"] = true;  // 黑诞·闹乐 +100（个人项）
  S.toggles["stage_jidong"] = true;      // 假设不存在也不会炸
  S.toggles["r_chenlun"] = true;         // 沉沦者 → ×1.3
  S.toggles["k_kannuote"] = true;        // 商店 +50
  S.durH = 1; S.durM = 50;               // ≤2:00 → +60
  S.settleScore = 500; S.partsCount = 20;// 通关得分 = (500-100)/2 = 200
  S.yuanMode = "final"; S.yuanPrev = 0; S.yuanStart = 120; S.yuanEnd = 100;
  B.sanitizeToggles(); B.updateUI();
  var txt = B.buildExportText();
  var r = B.computeAll();
  return { txt: txt, total: r.total, base: r.personalBase, mult: r.multiplier,
           team: r.teamScore, yuan: r.yuanUsed, splitTeam: r.splitTeam,
           name: S.playerName, err: window.__ERR };
`, "a");

if (exported.fatal) { console.error("生成失败:", exported.fatal); process.exit(1); }
const txtPath = path.join(OUT, "祁星-存档.txt");
fs.writeFileSync(txtPath, exported.txt, "utf8");
console.log("  写出:", txtPath, "（" + exported.txt.length + " 字节）");
console.log("  预期六个值: name=" + exported.name + " base=" + exported.base +
            " mult=" + exported.mult + " team=" + exported.team +
            " yuan=" + exported.yuan + " total=" + exported.total);
console.log("  splitTeam=" + exported.splitTeam + "（决赛应为 true）");

/* 把 txt 里的【总分】区 + 【源石锭】区打出来核对 */
console.log("  --- txt 的【总分】区 / 【源石锭】区 ---");
exported.txt.split(/\r?\n/).slice(-26).forEach(l => console.log("  | " + l));

/* ---------------- ② 把这份 txt 解析一遍（node 里直接调 ranking.js 解析器） ---------------- */
console.log("\n[2] 用 ranking.js 的解析器读这份真实 txt …");
const parsed = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
  var t = ${JSON.stringify(exported.txt)};
  return window.RANKING_PAGE.parseExport(t);
`, "b");
console.log("  " + JSON.stringify(parsed));

let bad = 0, total = 0;
function chk(cond, label) { total++; console.log((cond ? "  OK   " : "  FAIL ") + label); if (!cond) bad++; }
chk(parsed.name === exported.name, "选手名一致（" + parsed.name + "）");
chk(parsed.base === exported.base, "基础分一致（" + parsed.base + "）");
chk(parsed.multiplier === exported.mult, "倍率一致（×" + parsed.multiplier + "）");
chk(parsed.team === exported.team, "团队加分一致（" + parsed.team + "）");
chk(parsed.yuan === exported.yuan, "源石锭消耗一致（" + parsed.yuan + "）");
chk(parsed.total === exported.total, "总分一致（" + parsed.total + "）");

/* ---------------- ③ 在 ranking.html 上真跑一次「添加选手」 ---------------- */
console.log("\n[3] 在 ranking.html 里模拟「添加选手」…");
const shown = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
  var P = window.RANKING_PAGE;
  var txt = ${JSON.stringify(exported.txt)};
  var q = function(id){ return document.getElementById(id); };
  var tx = function(id){ var e = q(id); return e ? e.textContent : null; };
  var hid = function(id){ var e = q(id); return e ? !!e.hidden : null; };
  // 造两个假 File（带 __text），再用 FileReader 替身喂给 ingest。
  // ⚠️ 不要用 setTimeout 等 Promise 链 —— headless 下 --virtual-time-budget 推不动真实定时器，
  //    必须在 async 函数里 await，才能保证把结果取回来。
  var realFR = window.FileReader;
  window.FileReader = function(){
    var self = this;
    this.readAsText = function(file){
      Promise.resolve().then(function(){ self.result = file.__text; self.onload(); });
    };
  };
  return (async function(){
    P.ingest([{ name: "祁星.txt", __text: txt }]);
    for(var i = 0; i < 50; i++) await Promise.resolve();   // 让 ingest 的 .then 链全部跑完
    window.FileReader = realFR;
    var rows = window.RANKING_ROWS || [];
    var cells = [];
    var list = q("rank-list");
    if(list && list.children[0]){
      cells = Array.prototype.map.call(list.children[0].children, function(c){ return c.textContent; });
    }
    var head = q("rank-head");
    var headLabels = head
      ? Array.prototype.map.call(head.children, function(c){ return c.textContent; })
      : [];
    return {
      rows: rows.map(function(r){ return {name:r.name,base:r.base,multiplier:r.multiplier,team:r.team,yuan:r.yuan,total:r.total,rank:r.rank}; }),
      cells: cells,
      headLabels: headLabels,
      rowClass: list && list.children[0] ? list.children[0].className : "",
      rowCount: list ? list.children.length : -1,
      count: tx("rank-count"),
      time: tx("rank-time"),
      emptyHidden: hid("rank-empty"),
      toast: q("rank-toast") ? q("rank-toast").innerHTML : "",
      toastClass: q("rank-toast") ? q("rank-toast").className : "",
      toastHidden: hid("rank-toast"),
      stored: window.localStorage.getItem(P.LS_KEY),
      err: window.__ERR
    };
  })();
`, "c", "ranking.html");

if (shown.fatal) { console.error("失败:", shown.fatal); process.exit(1); }
console.log("  toast:", shown.toastClass, "→", shown.toast.replace(/<[^>]*>/g, " "));
console.log("  行内单元格:", JSON.stringify(shown.cells));

chk(shown.rows.length === 1, "榜单上出现 1 位选手");
chk(shown.rows[0] && shown.rows[0].name === "祁星", "选手名上屏");
chk(shown.rows[0] && shown.rows[0].base === exported.base, "基础分上屏");
chk(shown.rows[0] && shown.rows[0].multiplier === exported.mult, "倍率上屏");
chk(shown.rows[0] && shown.rows[0].team === exported.team, "团队加分上屏");
chk(shown.rows[0] && shown.rows[0].yuan === exported.yuan, "源石锭消耗上屏");
chk(shown.rows[0] && shown.rows[0].total === exported.total, "总分上屏");
chk(shown.rows[0] && shown.rows[0].rank === 1, "名次 = 1");
chk(shown.rowCount === 1, "DOM 里渲出 1 行");
chk(shown.cells.length === 8, "每行 8 格 = 7 个数据格 + 行尾删除键");
chk(shown.cells[0] === "1", "第 1 格是名次");
chk(shown.cells[3] && shown.cells[3].indexOf("×") === 0, "倍率格带 × 号（" + shown.cells[3] + "）");
chk(shown.cells[4] === "+" + exported.team, "第 5 格是团队加分（" + shown.cells[4] + "）");
chk(shown.cells[5] === String(exported.yuan), "第 6 格是源石锭消耗（" + shown.cells[5] + "）");
chk(shown.cells[6] === String(exported.total), "第 7 格总分 = " + exported.total);
chk(shown.cells[7] === "✕", "第 8 格是行尾删除键（✕）");
chk(shown.rowClass === "rank-row top1", "带 top1 高亮");
chk(shown.count === "1", "元信息人数 = 1");
chk(!!shown.time && shown.time !== "—", "元信息显示了更新时间（" + shown.time + "）");
chk(shown.emptyHidden === true, "空态已隐藏");
chk(shown.headLabels.length === 7, "表头渲染出 7 个标签");
chk(shown.headLabels.join("/") === "名次/选手/基础分/倍率/团队加分/源石锭消耗/总分",
    "表头标签依次是 " + shown.headLabels.join("/"));
chk(shown.toastHidden === false, "提示条已显示");
chk(shown.toastClass === "rank-toast ok", "绿色成功提示");
chk(/祁星/.test(shown.toast), "提示里点名了选手");
chk(!!shown.stored && JSON.parse(shown.stored).list.length === 1, "已写入 localStorage");
chk((shown.err || []).length === 0, "页面无 JS 报错");

/* ---------------- ③b 真浏览器里点「清空榜单」 ---------------- */
{
  console.log("\n[3b] 在真页面里点「清空榜单」（先试取消、再试确定）…");
  const btnInfo = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var q = function(id){ return document.getElementById(id); };
    var b = q("btn-clear-board");
    return { tag: b ? b.tagName : null, text: b ? b.textContent : null,
             cls: b ? b.className : null, hidden: b ? !!b.hidden : null };
  `, "d", "ranking.html");
  chk(btnInfo.tag === "BUTTON", "「清空榜单」是真按钮（" + btnInfo.tag + "）");
  chk(btnInfo.text === "清空榜单", "按钮文案是「清空榜单」");
  chk(/big-btn/.test(btnInfo.cls) && /danger/.test(btnInfo.cls), "带 danger 红色样式（" + btnInfo.cls + "）");
  chk(btnInfo.hidden === false, "按钮可见");

  const cleared = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE;
    var q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    var txt = ${JSON.stringify(exported.txt)};
    return (async function(){
      P.ingest([{ name: "祁星.txt", __text: txt }]);
      for(var i = 0; i < 50; i++) await Promise.resolve();

      // (1) 用户点「取消」→ 必须原样不动
      window.confirm = function(){ return false; };
      q("btn-clear-board").click();
      for(var i = 0; i < 10; i++) await Promise.resolve();
      var afterCancel = { n: P.getData().list.length, rows: q("rank-list").children.length };

      // (2) 用户点「确定」→ 清空
      window.confirm = function(){ return true; };
      q("btn-clear-board").click();
      for(var i = 0; i < 10; i++) await Promise.resolve();
      var afterOk = {
        n: P.getData().list.length,
        rows: q("rank-list").children.length,
        emptyHidden: q("rank-empty").hidden,
        count: q("rank-count").textContent,
        time: q("rank-time").textContent,
        toastClass: q("rank-toast").className,
        toast: q("rank-toast").innerHTML,
        stored: window.localStorage.getItem(P.LS_KEY)
      };
      window.FileReader = realFR;
      return { afterCancel: afterCancel, afterOk: afterOk, err: window.__ERR };
    })();
  `, "e", "ranking.html");

  if (cleared.fatal) { console.error("失败:", cleared.fatal); process.exit(1); }
  chk(cleared.afterCancel.n === 1, "点「取消」时榜单一条不少（" + cleared.afterCancel.n + "）");
  chk(cleared.afterCancel.rows === 1, "点「取消」时界面也没变（1 行）");
  chk(cleared.afterOk.n === 0, "点「确定」后数据清空");
  chk(cleared.afterOk.rows === 0, "界面行被清空");
  chk(cleared.afterOk.emptyHidden === false, "空态重新出现");
  chk(cleared.afterOk.count === "0", "人数显示 0");
  chk(cleared.afterOk.time === "—", "更新时间回到破折号");
  chk(cleared.afterOk.toastClass === "rank-toast ok", "给了绿色提示（" + cleared.afterOk.toastClass + "）");
  chk(/已清空/.test(cleared.afterOk.toast), "提示说明已清空");
  chk(!!cleared.afterOk.stored && JSON.parse(cleared.afterOk.stored).list.length === 0,
      "空榜单已落盘（刷新后仍是空的）");
  chk((cleared.err || []).length === 0, "清空过程中页面无 JS 报错");
}

/* ---------------- ③c 赛程切换：初赛 / 决赛两块独立榜单 ---------------- */
{
  console.log("\n[3c] 真页面里切「初赛 / 决赛」（两块独立榜单）…");
  const sw = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE;
    var q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    var txt = ${JSON.stringify(exported.txt)};
    var modeBtn = function(m){
      var bs = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === m) return bs[i];
      return null;
    };
    var heads = function(){
      var bs = q("rank-modes").querySelectorAll(".rank-mode");
      return Array.prototype.map.call(bs, function(b){ return b.textContent; });
    };
    var activeOf = function(){
      var bs = q("rank-modes").querySelectorAll(".rank-mode");
      var out = [];
      Array.prototype.forEach.call(bs, function(b){
        if(/is-active/.test(b.className)) out.push(b.getAttribute("data-mode"));
      });
      return out;
    };
    return (async function(){
      // 起点：初赛
      var start = { mode: P.currentMode(), labels: heads(), active: activeOf(),
                    panelBoard: q("rank-list") ? document.querySelector(".rank-panel").getAttribute("data-board") : null };

      // 初赛里加一位
      P.ingest([{ name: "初赛.txt", __text: txt }]);
      for(var i = 0; i < 50; i++) await Promise.resolve();
      var prelim = { n: P.getData().list.length, rows: q("rank-list").children.length,
                     stored: !!window.localStorage.getItem(P.LS_KEY_PRELIM) };

      // 点「决赛」→ 应切到空榜
      modeBtn("final").click();
      for(var i = 0; i < 10; i++) await Promise.resolve();
      var afterSwitch = {
        mode: P.currentMode(), active: activeOf(),
        n: P.getData().list.length, rows: q("rank-list").children.length,
        emptyHidden: q("rank-empty").hidden, count: q("rank-count").textContent,
        panelBoard: document.querySelector(".rank-panel").getAttribute("data-board"),
        prelimStored: JSON.parse(window.localStorage.getItem(P.LS_KEY_PRELIM) || "{}").list.length
      };

      // 决赛里加另一位（同一份 txt、同一个名字，落在决赛键上）
      P.ingest([{ name: "决赛.txt", __text: txt }]);
      for(var i = 0; i < 50; i++) await Promise.resolve();
      var inFinal = { n: P.getData().list.length,
                      finalStored: JSON.parse(window.localStorage.getItem(P.LS_KEY_FINAL) || "{}").list.length,
                      prelimStored: JSON.parse(window.localStorage.getItem(P.LS_KEY_PRELIM) || "{}").list.length,
                      toast: q("rank-toast").innerHTML };

      // 再切回初赛 → 初赛那条还在
      modeBtn("prelim").click();
      for(var i = 0; i < 10; i++) await Promise.resolve();
      var backToPrelim = { mode: P.currentMode(), active: activeOf(),
                           n: P.getData().list.length, rows: q("rank-list").children.length,
                           first: q("rank-list").children[0] ? q("rank-list").children[0].children[1].textContent : "",
                           panelBoard: document.querySelector(".rank-panel").getAttribute("data-board") };

      window.FileReader = realFR;
      return { start: start, prelim: prelim, afterSwitch: afterSwitch,
               inFinal: inFinal, backToPrelim: backToPrelim, err: window.__ERR };
    })();
  `, "f", "ranking.html");

  if (sw.fatal) { console.error("失败:", sw.fatal); process.exit(1); }
  chk(sw.start.mode === "prelim", "打开时停在「初赛」（" + sw.start.mode + "）");
  chk(sw.start.labels.join("/") === "初赛/决赛", "切换条两个选项是 初赛/决赛（" + sw.start.labels.join("/") + "）");
  chk(sw.start.active.join() === "prelim", "初始选中「初赛」");
  chk(sw.start.panelBoard === "prelim", "面板标了 data-board=prelim");
  chk(sw.prelim.n === 1, "初赛能正常上榜（1 位）");
  chk(sw.prelim.stored, "初赛数据落在初赛键上");

  chk(sw.afterSwitch.mode === "final", "点「决赛」后当前赛程 = final");
  chk(sw.afterSwitch.active.join() === "final", "选中态转到「决赛」");
  chk(sw.afterSwitch.panelBoard === "final", "面板 data-board 跟着变 final");
  chk(sw.afterSwitch.n === 0, "决赛是**新的空榜单**（不继承初赛数据）");
  chk(sw.afterSwitch.rows === 0, "决赛界面为空");
  chk(sw.afterSwitch.emptyHidden === false, "决赛显示空态");
  chk(sw.afterSwitch.count === "0", "决赛人数 0");
  chk(sw.afterSwitch.prelimStored === 1, "切到决赛后，**初赛存档仍是 1 条**（互不干扰）");

  chk(sw.inFinal.n === 1, "决赛里能正常上榜（1 位）");
  chk(sw.inFinal.finalStored === 1, "决赛数据落在决赛键上");
  chk(sw.inFinal.prelimStored === 1, "决赛上榜**没有动初赛存档**（还是 1 条）");
  chk(/决赛/.test(sw.inFinal.toast), "上榜提示点名了「决赛」");

  chk(sw.backToPrelim.mode === "prelim", "切回初赛");
  chk(sw.backToPrelim.active.join() === "prelim", "选中态回到「初赛」");
  chk(sw.backToPrelim.n === 1, "初赛数据还在（1 位）");
  chk(sw.backToPrelim.rows === 1, "初赛界面恢复 1 行");
  chk(sw.backToPrelim.first.indexOf(exported.name) === 0,
      "初赛那一行还是原来那位（" + sw.backToPrelim.first + "）");
  chk(sw.backToPrelim.panelBoard === "prelim", "面板 data-board 回到 prelim");
  chk((sw.err || []).length === 0, "整个切换过程页面无 JS 报错");
}

/* ---------------- ③d 「添加队伍」仅决赛可见 ---------------- */
{
  console.log("\n[3d] 真页面里核对「添加队伍」只在决赛出现…");
  const bt = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE;
    var q = function(id){ return document.getElementById(id); };
    var modeBtn = function(m){
      var bs = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === m) return bs[i];
      return null;
    };
    // 可见性用 getBoundingClientRect 判断（display:none 时宽高为 0）——
    // 这样 css 的显示规则与 hidden 属性两条路都覆盖到了。
    var visible = function(id){
      var e = q(id);
      if(!e) return null;
      var r = e.getBoundingClientRect();
      return !(e.hidden) && r.width > 0 && r.height > 0;
    };
    var box = function(id){
      var e = q(id), r = e.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) };
    };
    var acts = document.querySelector(".rank-actions");
    return (async function(){
      var prelimState = {
        visible: visible("btn-add-team"),
        hidden: q("btn-add-team").hidden,
        actsBoard: acts.getAttribute("data-board"),
        cls: q("btn-add-team").className
      };
      modeBtn("final").click();
      for(var i = 0; i < 10; i++) await Promise.resolve();
      var finalState = {
        visible: visible("btn-add-team"),
        hidden: q("btn-add-team").hidden,
        actsBoard: acts.getAttribute("data-board"),
        cls: q("btn-add-team").className,
        team: box("btn-add-team"),
        add: box("btn-add-player"),
        text: q("btn-add-team").textContent
      };
      // 点一下 → 应弹出居中弹框（不再是占位提示）
      var before = JSON.stringify(P.getData());
      /* ⚠️ 卡片带 animation:modalIn .16s，**起始帧**是 translateY(-8px) scale(.98)。
         无头 Chrome 的虚拟时钟**不推进 CSS 动画**，所以不加处理地量 rect，
         卡片会永远停在起始帧：中心比视口中心高 8px、高度还缩了 2%（187 vs 191）。
         那是**入场动画中途的合法位置**，不是布局错误 —— 要验的是「布局上是否居中」，
         因此这里临时禁掉动画再量。 */
      var probeStyle = document.createElement("style");
      probeStyle.textContent = "*, *::before, *::after{animation:none !important; transition:none !important;}";
      document.head.appendChild(probeStyle);
      q("btn-add-team").click();
      for(var i = 0; i < 10; i++) await Promise.resolve();
      var modalEl = q("rank-modal");
      var cardEl = modalEl.querySelector(".modal-card");
      var mr = modalEl.getBoundingClientRect(), cr = cardEl.getBoundingClientRect();
      /* ⚠️ 居中的参照系是**可用视口**（要扣掉滚动条），不是 window.innerWidth/Height。
         本页内容比一屏高，右侧有滚动条，所以卡片中心会比视口中心偏左/偏上几个像素 ——
         这是**正确**行为。这里用 documentElement.clientWidth/Height 做参照，
         让判定真正反映「视觉上居中」。 */
      var vw = document.documentElement.clientWidth;
      var vh = document.documentElement.clientHeight;
      var afterClick = {
        same: JSON.stringify(P.getData()) === before,
        open: !modalEl.hidden,
        title: q("rank-modal-title").textContent,
        okText: q("rank-modal-ok").textContent,
        cancelText: q("rank-modal-cancel").textContent,
        // 居中判定：卡片中心与**可用视口**中心之差（吸附在 1px 内）
        dx: Math.abs((cr.left + cr.width / 2) - (vw / 2)),
        dy: Math.abs((cr.top + cr.height / 2) - (vh / 2)),
        // 遮罩铺满可用视口
        covers: Math.round(mr.width) >= vw && Math.round(mr.height) >= vh,
        // 弹框里应有一个队名输入框
        hasInput: !!q("rank-modal-body").querySelector("input"),
        inputId: q("rank-modal-body").querySelector("input") ? q("rank-modal-body").querySelector("input").id : ""
      };
      // 取消应关窗
      q("rank-modal-cancel").click();
      for(var i = 0; i < 10; i++) await Promise.resolve();
      afterClick.closedByCancel = q("rank-modal").hidden;
      modeBtn("prelim").click();
      for(var i = 0; i < 10; i++) await Promise.resolve();
      var backState = { visible: visible("btn-add-team"), hidden: q("btn-add-team").hidden };
      return { prelimState: prelimState, finalState: finalState,
               afterClick: afterClick, backState: backState, err: window.__ERR };
    })();
  `, "g", "ranking.html");

  if (bt.fatal) { console.error("失败:", bt.fatal); process.exit(1); }
  chk(bt.prelimState.hidden === true, "初赛：「添加队伍」hidden = true");
  chk(bt.prelimState.visible === false, "初赛：实际也看不见（css + hidden 都挡住）");
  chk(bt.prelimState.actsBoard === "prelim", "初赛：操作区 data-board=prelim");

  chk(bt.finalState.hidden === false, "决赛：hidden 被拿掉");
  chk(bt.finalState.visible === true, "决赛：真的显示出来了（有宽高）");
  chk(bt.finalState.actsBoard === "final", "决赛：操作区 data-board=final");
  chk(bt.finalState.text === "添加队伍", "按钮文案是「添加队伍」");
  chk(/gold/.test(bt.finalState.cls || ""), "用金色样式（" + bt.finalState.cls + "）");
  chk(bt.finalState.team.t === bt.finalState.add.t, "与「添加选手」**同一行**（top 相同）");
  chk(bt.finalState.team.l < bt.finalState.add.l, "排在「添加选手」**左侧**（left 更小）");
  chk(bt.finalState.team.w === bt.finalState.add.w, "与「添加选手」等宽（同一套布局规则）");

  chk(bt.afterClick.same === true, "点「添加队伍」不改动榜单数据（只是打开弹框）");
  chk(bt.afterClick.open === true, "点它真的把弹框打开了");
  chk(bt.afterClick.title === "添加队伍", "弹框标题是「添加队伍」");
  chk(bt.afterClick.okText === "确定", "弹框有「确定」按钮");
  chk(bt.afterClick.cancelText === "取消", "弹框有「取消」按钮");
  chk(bt.afterClick.dx <= 1, "弹框**横向居中**（卡片中心 − 视口中心 = " + bt.afterClick.dx + "px）");
  chk(bt.afterClick.dy <= 1, "弹框**纵向居中**（卡片中心 − 视口中心 = " + bt.afterClick.dy + "px）");
  chk(bt.afterClick.covers, "遮罩铺满整个视口");
  chk(bt.afterClick.hasInput === true, "弹框里有一个可输入的控件");
  chk(bt.afterClick.inputId === "modal-team-name", "…是队名输入框 #modal-team-name");
  chk(bt.afterClick.closedByCancel === true, "点「取消」把弹框关掉了");

  chk(bt.backState.hidden === true && bt.backState.visible === false, "切回初赛又藏起来");
  chk((bt.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ③e 队伍大框：建队 → 归队 → 分组渲染（真页面） ---------------- */
{
  console.log("\n[3e] 真页面里走一遍「建队 → 加人 → 分组大框」…");
  const tm = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE;
    var q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    var modeBtn = function(m){
      var bs = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === m) return bs[i];
      return null;
    };
    var mkTxt = window.__mkTxt;
    return (async function(){
      /* ⚠️ 「剩余」的基准读的是**计分器的存档**（本机 Chrome 里可能真有一份 —— 开发者用过
         计分器），不固定住断言就会随环境漂移。这里显式种一份 120 的档。 */
      localStorage.setItem(P.COUNTER_KEY, JSON.stringify({ yuanInitFinal: 120 }));
      modeBtn("final").click();
      for(var i = 0; i < 10; i++) await Promise.resolve();

      // ① 点「添加队伍」→ 填队名 → 确定
      q("btn-add-team").click();
      for(var i = 0; i < 5; i++) await Promise.resolve();
      var inp = q("rank-modal-body").querySelector("input");
      inp.value = "近锋最强队";
      q("rank-modal-ok").click();
      for(var i = 0; i < 5; i++) await Promise.resolve();
      var afterCreate = {
        teams: P.teamList().slice(),
        modalClosed: q("rank-modal").hidden,
        boxes: q("rank-list").children.length,
        firstBoxName: q("rank-list").children[0] ? q("rank-list").children[0].getAttribute("data-team") : null,
        // 空队框：次序在队名左侧、队名在左、合计分在右
        headFlex: q("rank-list").children[0]
          ? getComputedStyle(q("rank-list").children[0].children[0]).display : null,
        teamIdx: q("rank-list").children[0] ? q("rank-list").children[0].children[0].children[0].textContent : null,
        sumText: q("rank-list").children[0] ? q("rank-list").children[0].children[0].children[3].textContent : null,
        yuanText: q("rank-list").children[0] ? q("rank-list").children[0].children[0].children[2].children[0].children[1].textContent : null,
        restText: q("rank-list").children[0] ? q("rank-list").children[0].children[0].children[2].children[1].children[1].textContent : null
      };

      // ② 点「添加选手」→ 选这个队 + 喂两个 txt → 确定
      q("btn-add-player").click();
      for(var i = 0; i < 5; i++) await Promise.resolve();
      var playerModal = {
        title: q("rank-modal-title").textContent,
        hasSelect: !!q("rank-modal-body").querySelector("select"),
        options: Array.prototype.map.call(
          q("rank-modal-body").querySelectorAll("option"),
          function(o){ return o.textContent; })
      };
      var sel = q("rank-modal-body").querySelector("select");
      sel.value = "近锋最强队";
      var far = q("rank-modal-body").querySelector("input[type=file]");
      far.__files = [
        { name: "a.txt", __text: window.__mkTxt({name:"祁星", base:1450, multiplier:1.3, team:520, yuan:30, total:2405}, true) },
        { name: "b.txt", __text: window.__mkTxt({name:"诗怀雅", base:1180, multiplier:1.3, team:300, yuan:60, total:1834}, true) }
      ];
      // ⚠️ FileReader 替身读的是 __text；但 ingest 拿的是 input.files（真 DOM 只读），
      //    所以直接调 P.ingest 模拟「弹框确定后发生的事」，再单独断言弹框本身的结构。
      P.ingest(far.__files, sel.value);
      for(var i = 0; i < 40; i++) await Promise.resolve();

      var list = q("rank-list");
      var box0 = list.children[0];
      var body = box0.children[1];
      var afterAdd = {
        teams: P.teamList().slice(),
        listLen: P.getData().list.length,
        leagues: P.getData().list.map(function(x){ return x.league; }),
        view: list.getAttribute("data-view"),
        boxName: box0.getAttribute("data-team"),
        // 队头：左侧**次序** + 队名（含人数）+ 源石锭（2026-09-24 加）+ 右侧合计分
        teamIdx: box0.children[0].children[0].textContent,
        headName: box0.children[0].children[1].textContent,
        headYuan: box0.children[0].children[2].children[0].children[1].textContent,
        headRest: box0.children[0].children[2].children[1].children[1].textContent,
        headSum: box0.children[0].children[3].textContent,
        memberRows: body.children.length,
        memberRanks: Array.prototype.map.call(body.children, function(r){ return r.children[0].textContent; }),
        // ⚠️ 选手名格子里还会追一个 <small>（录入时间），所以取**第一个子节点**的文本
        memberNames: Array.prototype.map.call(body.children, function(r){
          var c = r.children[1];
          return c.firstChild ? c.firstChild.textContent : c.textContent;
        }),
        // 队员行 8 格（7 数据 + 行尾删除键）
        memberCols: body.children[0] ? body.children[0].children.length : 0,
        /* 队头四件的横向次序：次序 ＜ 队名 ＜ 源石锭 ＜ 合计分（次序在队名左侧） */
        idxLeftOfName: box0.children[0].children[0].getBoundingClientRect().left <
                       box0.children[0].children[1].getBoundingClientRect().left,
        nameLeftOfSum: box0.children[0].children[1].getBoundingClientRect().left <
                       box0.children[0].children[3].getBoundingClientRect().left,
        yuanLeftOfSum: box0.children[0].children[2].getBoundingClientRect().left <
                       box0.children[0].children[3].getBoundingClientRect().left,
        /* 源石锭要「同样用绿色标注」—— 最贴切的判法是**与合计分取同一个计算色** */
        yuanColor: getComputedStyle(box0.children[0].children[2].children[0].children[1]).color,
        restColor: getComputedStyle(box0.children[0].children[2].children[1].children[1]).color,
        sumColor: getComputedStyle(box0.children[0].children[3]).color,
        /* 「已使用」与「剩余」两块之间的水平距离，必须**大于**块内「标签↔数字」的距离，
           否则四个元素等距排开，看不出是两个「标签 + 数值」对。 */
        gapBetween: (function(){
          var y = box0.children[0].children[2];
          return Math.round(y.children[1].getBoundingClientRect().left -
                            y.children[0].children[1].getBoundingClientRect().right);
        })(),
        gapInside: (function(){
          var y = box0.children[0].children[2];
          return Math.round(y.children[0].children[1].getBoundingClientRect().left -
                            y.children[0].children[0].getBoundingClientRect().right);
        })(),
        /* ⚠️ 队名 .team-name 是个 flex 容器（里面还有 .team-count），它的盒子会比
           合计数那一格高一点点，两个 getBoundingClientRect().top 天然有 1~2px 差。
           判「同一行」应该看**队头容器**各子项的垂直中心是否接近（取极差）。 */
        sameRow: (function(){
          var cy = function(el){
            var r = el.getBoundingClientRect();
            return r.top + r.height / 2;
          };
          var cs = [cy(box0.children[0].children[0]), cy(box0.children[0].children[1]),
                    cy(box0.children[0].children[2]), cy(box0.children[0].children[3])];
          return Math.max.apply(null, cs) - Math.min.apply(null, cs) < 3;
        })(),
        err: window.__ERR
      };
      window.FileReader = realFR;
      return { afterCreate: afterCreate, playerModal: playerModal, afterAdd: afterAdd };
    })();
  `, "h", "ranking.html");

  if (tm.fatal) { console.error("失败:", tm.fatal); process.exit(1); }
  chk(tm.afterCreate.teams.join() === "近锋最强队", "点弹框确定后队伍建起来了");
  chk(tm.afterCreate.modalClosed === true, "确定后弹框关掉了");
  chk(tm.afterCreate.boxes === 1, "选手栏里长出一个大框");
  chk(tm.afterCreate.firstBoxName === "近锋最强队", "框上标着队名");
  chk(tm.afterCreate.headFlex === "flex", "队头是 flex（队名与合计分左右分布）");
  chk(tm.afterCreate.sumText === "0", "刚建的队合计分是 0");
  chk(tm.afterCreate.yuanText === "0", "刚建的队已使用源石锭是 0");
  chk(tm.afterCreate.restText === "120", "刚建的队剩余 = 整份初始余额 120（" + tm.afterCreate.restText + "）");
  chk(tm.afterCreate.teamIdx === "1", "刚建的空队也带次序 1（队名左侧）");

  chk(tm.playerModal.title === "添加选手", "「添加选手」弹框标题正确");
  chk(tm.playerModal.hasSelect === true, "弹框里有选队伍的下拉");
  chk(tm.playerModal.options.join("/") === "未分组/近锋最强队",
     "下拉是「未分组 + 近锋最强队」（" + tm.playerModal.options.join("/") + "）");

  chk(tm.afterAdd.view === "grouped", "决赛选手栏进入分组视图");
  chk(tm.afterAdd.listLen === 2, "两位选手都入库了");
  chk(tm.afterAdd.leagues.join() === "近锋最强队,近锋最强队", "都归到了「近锋最强队」");
  chk(tm.afterAdd.boxName === "近锋最强队", "那一队是一个大框");
  chk(/近锋最强队/.test(tm.afterAdd.headName) && /2 人/.test(tm.afterAdd.headName),
     "框左上角是队名 + 人数（" + tm.afterAdd.headName + "）");
  chk(tm.afterAdd.teamIdx === "1", "队名**左侧**标着次序（" + tm.afterAdd.teamIdx + "）");
  chk(tm.afterAdd.idxLeftOfName === true, "次序确实在队名左边");
  chk(tm.afterAdd.memberRows === 2, "框里 2 个队员行");
  chk(tm.afterAdd.memberCols === 8, "队员行 8 格 = 7 个数据格 + 行尾删除键（与表头对齐）");
  chk(tm.afterAdd.memberNames[0] === "祁星", "队员按总分降序（祁星 2405 在前）");
  chk(tm.afterAdd.memberRanks.join() === "1,2", "队员带着全局名次 1 / 2");
  chk(tm.afterAdd.headSum === "4239", "队伍合计分 = 2405 + 1834 = 4239");
  chk(tm.afterAdd.headYuan === "90", "全队「已使用」源石锭 = 30 + 60 = 90");
  chk(tm.afterAdd.headRest === "30", "全队「剩余」= 初始余额 120 − 已使用 90（" + tm.afterAdd.headRest + "）");
  chk(tm.afterAdd.yuanColor === tm.afterAdd.sumColor,
     "已使用源石锭与合计分**同一种绿**（" + tm.afterAdd.yuanColor + "）");
  chk(tm.afterAdd.restColor === tm.afterAdd.sumColor,
     "剩余也用同一种绿（" + tm.afterAdd.restColor + "）");
  chk(tm.afterAdd.gapBetween > tm.afterAdd.gapInside,
     "两块之间比块内更疏，读得出是两个「标签 + 数值」对（实测 " +
     tm.afterAdd.gapBetween + "px > " + tm.afterAdd.gapInside + "px）");
  chk(tm.afterAdd.yuanLeftOfSum === true, "源石锭排在合计分**左侧**");
  chk(tm.afterAdd.nameLeftOfSum === true, "队名在**左**、合计分在**右**（参考图布局）");
  chk(tm.afterAdd.sameRow === true, "次序/队名/源石锭/合计分在**同一行**");
  chk((tm.afterAdd.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ③f 行尾删除键：向左拖动唤起 / 点别处收起 / 确认后删除（真页面） ---------------- */
{
  console.log("\n[3f] 真页面里在「选手分数条」上向左拖动，核对行尾删除键…");
  const dl = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE;
    var q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    var cs = function(el, prop){ return getComputedStyle(el)[prop]; };
    var r = function(el){ return el.getBoundingClientRect(); };
    /* ⚠️ 无头 Chrome 的虚拟时钟**不推进 CSS 动画/过渡**：.row-del 的 opacity 带
       transition:.14s，不处理的话量到的永远是起始值 0（与弹框那次 8px 偏移同源）。
       这里先把动画/过渡全禁掉，量到的才是**终态**（要验的本来就是「亮起来之后」的样子）。 */
    var probeStyle = document.createElement("style");
    probeStyle.textContent = "*, *::before, *::after{animation:none !important; transition:none !important;}";
    document.head.appendChild(probeStyle);
    /* 真指针序列：按下派发在**格子**上（冒泡到 #rank-list 的委托），
       移动 / 松手派发到 **document**（源码就监听在那儿 —— 指针很容易滑出行外）。
       ⚠️ 桩测不到「浏览器是否真的派发这些事件」，这里用真 PointerEvent 走一遍。 */
    var pd = function(el, x, y){
      el.dispatchEvent(new PointerEvent("pointerdown",
        { bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: 1,
          clientX: x, clientY: y }));
    };
    var pm = function(x, y){
      document.dispatchEvent(new PointerEvent("pointermove",
        { bubbles: true, pointerId: 7, buttons: 1, clientX: x, clientY: y }));
    };
    var pu = function(x, y){
      document.dispatchEvent(new PointerEvent("pointerup",
        { bubbles: true, pointerId: 7, button: 0, buttons: 0, clientX: x, clientY: y }));
    };
    /* 在（行内）某个元素上按下并向左拖 dx 像素，**先不松手**，返回松手用坐标 */
    var swipe = async function(cell, dx, dy){
      var rr = cell.getBoundingClientRect();
      var x = rr.left + 20, y = rr.top + rr.height / 2;
      pd(cell, x, y);
      for(var k = 0; k < 3; k++) await Promise.resolve();
      pm(x + dx, y + (dy || 0));
      for(var k = 0; k < 3; k++) await Promise.resolve();
      return { x: x + dx, y: y + (dy || 0) };
    };
    var click = function(el){
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    };
    /* 点在**行外**的地方（真页面里也是一次 pointerdown），用来验「点别处收起」 */
    var away = function(){
      var el = document.querySelector(".rank-meta-item") || document.body;
      el.dispatchEvent(new PointerEvent("pointerdown",
        { bubbles: true, cancelable: true, pointerId: 9, button: 0, buttons: 1,
          clientX: 5, clientY: 5 }));
    };
    var colsTrans = function(row){
      return Array.prototype.map.call(row.children, function(c){ return cs(c, "transform"); });
    };
    return (async function(){
      var rows = [
        { name: "祁星",   base: 1450, multiplier: 1.3, team: 520, yuan: 30, total: 2405 },
        { name: "诗怀雅", base: 1180, multiplier: 1.3, team: 300, yuan: 60, total: 1834 },
        { name: "阿米娅", base: 760,  multiplier: 1,   team: 0,   yuan: 90, total: 760  }
      ];
      for(var i = 0; i < rows.length; i++){
        P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], false) }]);
        for(var k = 0; k < 30; k++) await Promise.resolve();
      }

      var list = q("rank-list");
      var row  = list.children[0];
      var cell = row.children[1];                  // .rk-name
      var key  = row.children[7];                  // .row-del
      var total= row.children[6];                  // .rk-total

      // ① 默认状态：删除键在 DOM 里、但看不见
      var initial = {
        rowCells: row.children.length,
        headCells: document.querySelector(".rank-head").children.length,
        keyClass: key ? key.className : null,
        keyFor: key ? key.getAttribute("data-del-player") : null,
        visibility: key ? cs(key, "visibility") : null,
        opacity: key ? cs(key, "opacity") : null,
        // ⚠️ visibility:hidden 仍然占位（这正是我们要的），所以宽度**不为 0**
        keyWidth: key ? Math.round(r(key).width) : 0,
        armed: /(^|\\s)is-armed(\\s|$)/.test(row.className),
        armedPlayer: P.armedPlayer()
      };

      // ② 在这一行的选手名格子上**向左拖 70px** → 松手后亮出删除键
      var sw = await swipe(cell, -70);
      var mid = {
        transform: colsTrans(row),        // 拖动**中**（还没松手）
        cls: row.className,
        active: P.swipeActive()
      };
      pu(sw.x, sw.y);                     // 松手
      for(var k = 0; k < 5; k++) await Promise.resolve();
      var rr = r(row), kr = r(key), tr = r(total);
      var hr = r(document.querySelector(".rank-head").children[6]);   // 表头的「总分」格
      var armed = {
        armedPlayer: P.armedPlayer(),
        isArmed: /(^|\\s)is-armed(\\s|$)/.test(row.className),
        visibility: cs(key, "visibility"),
        opacity: cs(key, "opacity"),
        // 删除键应当落在**这一行内部**的右半边
        insideRow: kr.left >= rr.left && kr.right <= rr.right + 0.5,
        onRightHalf: (kr.left + kr.width / 2) > (rr.left + rr.width / 2),
        // 垂直居中于这一行
        vCentered: Math.abs((kr.top + kr.height / 2) - (rr.top + rr.height / 2)) < 3,
        // ⚠️ 关键：它**不覆盖总分那一格**（第 8 条预留轨道的意义所在）
        gapFromTotal: Math.round((kr.left - tr.right) * 10) / 10,
        noOverlapTotal: kr.left >= tr.right - 0.5,
        /* 总分列仍与表头对齐（预留轨道没有挤动前 7 列）。
           ⚠️ 容差 2px：数据行有 border:1px solid，而表头只有 border-bottom，
              两者**内容盒**的起点因此天然差 1px（既有行为，与本次改动无关）。 */
        alignDiff: Math.round((tr.left - hr.left) * 10) / 10,
        totalAlignsWithHead: Math.abs(tr.left - hr.left) < 2,
        /* --- 拖动过程本身 --- */
        // 拖动中 7 个数据格一起左移、删除键那格原地不动
        midCellTransform: mid.transform[0],
        midKeyTransform: mid.transform[7],
        midSwiping: /(^|\\s)is-swiping(\\s|$)/.test(mid.cls),
        midActive: mid.active,
        // 松手后数据格归位、手势状态清空（静止时才能与表头逐列对齐）
        afterTransform: colsTrans(row)[0],
        afterActive: P.swipeActive(),
        trigger: P.SWIPE_TRIGGER,
        max: P.SWIPE_MAX
      };

      // ③ 点页面别处（真 pointerdown）→ 收起
      away();
      for(var k = 0; k < 5; k++) await Promise.resolve();
      var afterAway = {
        armedPlayer: P.armedPlayer(),
        isArmed: /(^|\\s)is-armed(\\s|$)/.test(row.className),
        visibility: cs(key, "visibility")
      };

      // ④ 再拖开 → 点删除键（确认）→ 这一条被删掉
      var sw2 = await swipe(cell, -70);
      pu(sw2.x, sw2.y);
      for(var k = 0; k < 5; k++) await Promise.resolve();
      var beforeN = P.getData().list.length;
      var realConfirm = window.confirm;
      window.confirm = function(){ return true; };
      click(key);
      for(var k = 0; k < 20; k++) await Promise.resolve();
      window.confirm = realConfirm;
      var afterDel = {
        before: beforeN,
        after: P.getData().list.length,
        names: P.getData().list.map(function(x){ return x.name; }),
        domRows: q("rank-list").children.length,
        ranks: Array.prototype.map.call(q("rank-list").children, function(x){ return x.children[0].textContent; }),
        count: q("rank-count").textContent,
        toast: q("rank-toast").className,
        anyArmed: /is-armed/.test(q("rank-list").innerHTML),
        stored: String(window.localStorage.getItem(P.LS_KEY_PRELIM) || ""),
        err: window.__ERR
      };

      // ⑤ 取消确认 → 一个字都不动
      var row2 = q("rank-list").children[0];
      var sw3 = await swipe(row2.children[1], -70);
      pu(sw3.x, sw3.y);
      for(var k = 0; k < 5; k++) await Promise.resolve();
      var beforeCancel = P.getData().list.length;
      window.confirm = function(){ return false; };
      click(row2.children[7]);
      for(var k = 0; k < 20; k++) await Promise.resolve();
      window.confirm = realConfirm;
      var cancel = {
        before: beforeCancel,
        after: P.getData().list.length,
        domRows: q("rank-list").children.length,
        stillArmed: P.armedPlayer()
      };

      // ⑥ 手势边界：不够阈值 / 向右拖 / 纵向为主 / 同一行再拖一次＝收起
      var row3 = q("rank-list").children[0], c3 = row3.children[1];
      P.disarmRow();
      var t1 = await swipe(c3, -20);  pu(t1.x, t1.y);
      for(var k = 0; k < 5; k++) await Promise.resolve();
      var belowTrigger = P.armedPlayer();
      var t2 = await swipe(c3, 60);   pu(t2.x, t2.y);
      for(var k = 0; k < 5; k++) await Promise.resolve();
      var rightDrag = { armed: P.armedPlayer(), transform: colsTrans(row3)[0] };
      var t3 = await swipe(c3, -30, 70); pu(t3.x, t3.y);
      for(var k = 0; k < 5; k++) await Promise.resolve();
      var vertical = { armed: P.armedPlayer(),
                       swiping: /(^|\\s)is-swiping(\\s|$)/.test(row3.className) };
      var t4 = await swipe(c3, -70);  pu(t4.x, t4.y);
      for(var k = 0; k < 5; k++) await Promise.resolve();
      var armedOnce = P.armedPlayer();
      var t5 = await swipe(c3, -70);  pu(t5.x, t5.y);
      for(var k = 0; k < 5; k++) await Promise.resolve();
      var edge = {
        belowTrigger: belowTrigger,
        rightDragArmed: rightDrag.armed,
        rightDragTransform: rightDrag.transform,
        verticalArmed: vertical.armed,
        verticalSwiping: vertical.swiping,
        armedOnce: armedOnce,
        armedAfterSecondSwipe: P.armedPlayer()
      };

      window.FileReader = realFR;
      return { initial: initial, armed: armed, afterAway: afterAway,
               afterDel: afterDel, cancel: cancel, edge: edge };
    })();
  `, "i", "ranking.html");

  if (dl.fatal) { console.error("失败:", dl.fatal); process.exit(1); }
  // ① 默认
  chk(dl.initial.rowCells === 8, "每行 8 格 = 7 数据 + 行尾删除键");
  chk(dl.initial.headCells === 7, "表头仍是 7 格（第 8 条轨道在表头里空着）");
  chk(dl.initial.keyClass === "row-del", "第 8 格是 .row-del 删除键");
  chk(dl.initial.keyFor === "祁星", "删除键标着对应选手名");
  chk(dl.initial.visibility === "hidden" && dl.initial.opacity === "0",
     "默认看不见（visibility:hidden + opacity:0）");
  chk(dl.initial.keyWidth > 0, "…但**位置仍在**（占位 26px 宽，不是 display:none）");
  chk(dl.initial.armed === false && dl.initial.armedPlayer === "",
     "默认没有任何一行被点亮");
  // ② 向左拖动
  chk(dl.armed.armedPlayer === "祁星", "在分数条上**向左拖** " + dl.armed.trigger + "px 以上 → 点亮「祁星」这一行");
  chk(dl.armed.isArmed === true, "该行加上 is-armed 类");
  chk(dl.armed.visibility === "visible" && dl.armed.opacity === "1",
     "删除键显示出来了（visibility=" + dl.armed.visibility + " opacity=" + dl.armed.opacity + "）");
  chk(dl.armed.insideRow === true, "删除键落在这一行**内部**");
  chk(dl.armed.onRightHalf === true, "…且在**行尾**（右侧，如用户要求）");
  chk(dl.armed.vCentered === true, "…垂直居中于这一行");
  chk(dl.armed.noOverlapTotal === true,
     "**不覆盖总分那一格**（与总分列相距 " + dl.armed.gapFromTotal + "px）");
  chk(dl.armed.totalAlignsWithHead === true,
     "总分列仍与表头逐列对齐（预留轨道没有挤动前 7 列，偏移 " + dl.armed.alignDiff + "px）");
  // ②b 拖动过程本身
  chk(/^matrix\(1, 0, 0, 1, -\d/.test(dl.armed.midCellTransform || ""),
     "拖动中数据格真的跟着左移了（transform=" + dl.armed.midCellTransform + "）");
  chk(dl.armed.midKeyTransform === "none",
     "…而删除键那一格**原地不动**（transform=" + dl.armed.midKeyTransform + "）");
  chk(dl.armed.midSwiping === true, "拖动中该行带 is-swiping（期间关掉过渡才跟得上手）");
  chk(dl.armed.midActive === true, "拖动过程中 swipeActive() 为 true");
  chk(dl.armed.afterTransform === "none" && dl.armed.afterActive === false,
     "松手后数据格归位（transform=" + dl.armed.afterTransform + "）、手势状态清空");
  // ③ 点别处收起
  chk(dl.afterAway.armedPlayer === "", "点页面其它地方 → 收起删除键");
  chk(dl.afterAway.isArmed === false, "该行也不再带 is-armed");
  chk(dl.afterAway.visibility === "hidden", "删除键重新变成看不见");
  // ④ 确认删除
  chk(dl.afterDel.after === dl.afterDel.before - 1, "点删除键并确认 → 少了一位选手");
  chk(dl.afterDel.names.indexOf("祁星") === -1, "被删的正是「祁星」");
  chk(dl.afterDel.domRows === dl.afterDel.after, "界面行数跟着减少");
  chk(dl.afterDel.ranks.join() === "1,2", "剩下的重排名次 1,2");
  chk(dl.afterDel.count === String(dl.afterDel.after), "元信息行的人数同步更新");
  chk(/rank-toast ok/.test(dl.afterDel.toast), "给了绿色成功提示");
  chk(dl.afterDel.anyArmed === false, "删完删除键已收起");
  chk(/"祁星"/.test(dl.afterDel.stored) === false, "被删的选手已从 localStorage 里移除");
  // ⑤ 取消
  chk(dl.cancel.after === dl.cancel.before, "确认框按「取消」→ 一位选手都没少");
  chk(dl.cancel.domRows === dl.cancel.before, "界面行数不变");
  chk(dl.cancel.stillArmed === "诗怀雅", "取消后删除键仍亮着（可以再点一次）");
  // ⑥ 手势边界
  chk(dl.edge.belowTrigger === "",
     "向左只拖 20px（不足 " + dl.armed.trigger + "px）→ 松手不点亮");
  chk(dl.edge.rightDragArmed === "", "向右拖不点亮（只认向左）");
  chk(dl.edge.rightDragTransform === "none", "…而且一点都不位移");
  chk(dl.edge.verticalArmed === "" && dl.edge.verticalSwiping === false,
     "纵向为主的拖动（|dy|>|dx|）在**初赛平铺视图**下放弃手势，也不留 is-swiping（滚动照旧归页面）");
  chk(dl.edge.armedOnce === "诗怀雅", "先拖开「诗怀雅」的删除键");
  chk(dl.edge.armedAfterSecondSwipe === "", "同一行**再向左拖一次 → 收起**（手势可逆）");
  chk((dl.afterDel.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ③g 队伍次序：按合计分降序编号 / 未分组沉底不编号 / 冠亚季染色 ---------------- */
{
  console.log("\n[3g] 真页面里核对「队伍按合计分降序编号 + 未分组沉底不编号 + 冠亚季配色」…");
  const ord = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE, q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    var feed = async function(rows){
      for(var i = 0; i < rows.length; i++){
        P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], true) }], rows[i].lg);
        for(var k = 0; k < 30; k++) await Promise.resolve();
      }
    };
    var read = function(){
      var boxes = q("rank-list").children;
      return Array.prototype.map.call(boxes, function(b){
        var head = b.children[0];
        var cx = function(el){
          var r = el.getBoundingClientRect();
          return { left: r.left, mid: r.top + r.height / 2 };
        };
        var nameBox = cx(head.children[1]), yuanBox = cx(head.children[2]), sumBox = cx(head.children[3]);
        return {
          team: b.getAttribute("data-team"),
          cls: b.className,
          idx: head.children[0].textContent,
          nameLeft: nameBox.left,
          // 次序 ＜ 队名 ＜ 源石锭 ＜ 合计分（左→右）
          idxLeftOfName: cx(head.children[0]).left < nameBox.left,
          nameLeftOfYuan: nameBox.left < yuanBox.left,
          yuanLeftOfSum: yuanBox.left < sumBox.left,
          nameLeftOfSum: nameBox.left < sumBox.left,
          // 同一行（垂直中心极差 < 3px）
          sameRow: Math.abs(nameBox.mid - sumBox.mid) < 3 &&
                   Math.abs(cx(head.children[0]).mid - nameBox.mid) < 3 &&
                   Math.abs(yuanBox.mid - sumBox.mid) < 3,
          // 全队源石锭（2026-09-24 加「已使用」、2026-09-25 加「剩余」）：数值 + 实测颜色
          yuan: head.children[2].children[0].children[1].textContent,
          rest: head.children[2].children[1].children[1].textContent,
          yuanLabel: head.children[2].children[0].children[0].textContent,
          restLabel: head.children[2].children[1].children[0].textContent,
          yuanColor: getComputedStyle(head.children[2].children[0].children[1]).color,
          restColor: getComputedStyle(head.children[2].children[1].children[1]).color,
          sumColor: getComputedStyle(head.children[3]).color,
          // 冠亚季皮算出来的**实际边框色**（不是只查 class 在不在）
          borderColor: getComputedStyle(b).borderTopColor,
          idxColor: getComputedStyle(head.children[0]).color,
          borderStyle: getComputedStyle(b).borderTopStyle
        };
      });
    };
    return (async function(){
      /* ⚠️ 「剩余」的基准读的是**计分器的存档**，显式固定成 120，断言才不随环境漂移 */
      localStorage.setItem(P.COUNTER_KEY, JSON.stringify({ yuanInitFinal: 120 }));
      var ms = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < ms.length; i++) if(ms[i].getAttribute("data-mode") === "final") ms[i].click();
      for(var k = 0; k < 30; k++) await Promise.resolve();
      P.addTeam("甲队"); P.addTeam("乙队"); P.addTeam("丙队"); P.addTeam("丁队");
      await feed([
        { name: "甲一", base: 400, multiplier: 1, team: 0, yuan: 20, total: 400, lg: "甲队" },
        { name: "乙一", base: 800, multiplier: 1, team: 0, yuan: 5,  total: 800, lg: "乙队" },
        { name: "丙一", base: 600, multiplier: 1, team: 0, yuan: 0,  total: 600, lg: "丙队" },
        { name: "丁一", base: 200, multiplier: 1, team: 0, yuan: 0,  total: 200, lg: "丁队" },
        { name: "散人", base: 999, multiplier: 1, team: 0, yuan: 7,  total: 999, lg: "" }
      ]);
      var before = read();
      // 给甲队补 500 分（顺带 3 点源石锭）→ 900 分，应窜到第 1，编号与冠亚季皮一起换人
      await feed([{ name: "甲二", base: 0, multiplier: 1, team: 0, yuan: 3, total: 500, lg: "甲队" }]);
      var after = read();
      window.FileReader = realFR;
      return { before: before, after: after, err: window.__ERR };
    })();
  `, "j", "ranking.html");

  if (ord.fatal) { console.error("失败:", ord.fatal); process.exit(1); }
  const names = ord.before.map(x => x.team + "#" + x.idx).join("  ");
  chk(ord.before.map(x => x.team).join() === "乙队,丙队,甲队,丁队,未分组",
     "五队按**合计分降序**排（800/600/400/200），「未分组」沉底（" + names + "）");
  chk(ord.before.map(x => x.idx).join() === "1,2,3,4,",
     "真实队伍编号 1/2/3/4；「未分组」不编号（" + ord.before.map(x => x.idx).join("/") + "）");
  chk(ord.before[4].cls.indexOf("team-box-loose") > -1, "「未分组」仍是虚线框");
  chk(ord.before.slice(0, 4).every(x => x.cls.indexOf("team-box-loose") === -1),
     "真实队伍都是实线框");

  // 冠亚季：金 / 银 / 铜，且只有前三
  chk(/255,\s*181,\s*71/.test(ord.before[0].borderColor) && /team-top1/.test(ord.before[0].cls),
     "冠军队伍框描边是金色（实测 " + ord.before[0].borderColor + "）");
  chk(/200,\s*214,\s*232/.test(ord.before[1].borderColor) && /team-top2/.test(ord.before[1].cls),
     "亚军描边是银色（" + ord.before[1].borderColor + "）");
  chk(/214,\s*146,\s*90/.test(ord.before[2].borderColor) && /team-top3/.test(ord.before[2].cls),
     "季军描边是铜色（" + ord.before[2].borderColor + "）");
  chk(ord.before[3].cls.indexOf("team-top") === -1,
     "第 4 名素着，没有冠亚季皮（" + ord.before[3].borderColor + "）");
  chk(ord.before[4].cls.indexOf("team-top") === -1,
     "「未分组」素着（idx=0，不吃冠亚季皮）");
  chk(ord.before[0].idxColor !== ord.before[3].idxColor,
     "冠军的次序数字也染了色（金 " + ord.before[0].idxColor + " ≠ 素色 " + ord.before[3].idxColor + "）");
  chk(ord.before.every(x => x.borderStyle !== undefined), "能读到边框样式");
  chk(ord.before.slice(0, 4).every(x => x.borderStyle === "solid"),
     "冠亚季只改颜色、**没改** border-style（虚线是「未分组」专属）");
  chk(ord.before[4].borderStyle === "dashed", "「未分组」保持虚线");

  // 队名左端对齐：未分组不编号，但次序格**保留占位**，名字不该左移
  const realNames = ord.before.slice(0, 4).map(x => x.nameLeft);
  const looseLeft = ord.before[4].nameLeft;
  chk(realNames.every(l => Math.abs(l - looseLeft) < 1),
     "「未分组」的队名与真实队伍**同一条竖线**（差 " +
     Math.max.apply(null, realNames.map(l => Math.abs(l - looseLeft))).toFixed(2) + "px）");
  chk(ord.before.every(x => x.idxLeftOfName === true), "每个框的次序都在队名左边");
  chk(ord.before.every(x => x.nameLeftOfSum === true), "每个框的合计分都在队名右边");
  chk(ord.before.every(x => x.sameRow === true), "次序 / 队名 / 源石锭 / 合计分都在同一行");

  // 全队源石锭（已使用 + 剩余）：排在合计分左侧、同一种绿、数值随队员变化
  chk(ord.before.map(x => x.yuan).join() === "5,0,20,0,7",
     "每个框都印着各自的「已使用」源石锭（" + ord.before.map(x => x.yuan).join("/") + "）");
  chk(ord.before.every(x => x.yuanLabel === "已使用"), "…标签统一是三个字「已使用」");
  chk(ord.before.map(x => x.rest).join() === "115,120,100,120,113",
     "每个框也印着「剩余」= 120 − 已使用（" + ord.before.map(x => x.rest).join("/") + "）");
  chk(ord.before.every(x => x.restLabel === "剩余"), "…标签是「剩余」");
  chk(ord.before.every(x => x.yuanColor === x.sumColor && x.restColor === x.sumColor),
     "已使用 / 剩余 / 合计分**三者同一种绿**（实测 " + ord.before[0].yuanColor + "）");
  chk(ord.before.every(x => x.yuanLeftOfSum === true), "源石锭排在合计分**左侧**");
  chk(ord.before.every(x => x.nameLeftOfYuan === true), "队名排在源石锭左侧");
  chk(ord.after[0].yuan === "23", "甲队补人后「已使用」涨到 23（20+3），而排序仍按合计分");
  chk(ord.after[0].rest === "97", "…「剩余」同步落回 97（= 120 − 23）");

  // 分数一变，编号与皮一起重排
  chk(ord.after.map(x => x.team + "#" + x.idx).join("  ") === "甲队#1  乙队#2  丙队#3  丁队#4  未分组#",
     "甲队涨到 900 分后立刻窜到第 1，编号整体重排（" +
     ord.after.map(x => x.team + "#" + x.idx).join("  ") + "）");
  chk(/team-top1/.test(ord.after[0].cls) && /255,\s*181,\s*71/.test(ord.after[0].borderColor),
     "金色皮跟着换到甲队身上");
  chk(ord.after[4].cls.indexOf("team-top") === -1, "「未分组」依旧不吃皮");
  chk((ord.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ③h 纵向拖动：把「未分组」的选手拖进已有队伍 ---------------- */
{
  console.log("\n[3h] 真页面里【纵向拖动】把「未分组」的选手拖进队伍…");
  const dg = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE, q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    var cs = function(el, p){ return getComputedStyle(el)[p]; };
    var wait = async function(n){ for(var k = 0; k < (n || 5); k++) await Promise.resolve(); };
    var feed = async function(rows, lg){
      for(var i = 0; i < rows.length; i++){
        P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], true) }], lg[i]);
        await wait(30);
      }
    };
    /* ⚠️ 禁掉动画 / 过渡：无头 Chrome 的虚拟时钟不推进它们，量到的会是起始帧
       （与 [3f] 同源，那里踩过 .row-del 的 opacity 恒为 0）。 */
    var st = document.createElement("style");
    st.textContent = "*, *::before, *::after{animation:none !important; transition:none !important;}";
    document.head.appendChild(st);
    /* ⚠️ 把 scrollBy 换成「记账版」：真滚起来会让各队伍框的矩形在拖动中途改变，
       探针坐标就不再确定。记账版既能验证「指针靠近视口边缘确实触发了自动滚动」，
       又让矩形与坐标在整个拖动过程中保持稳定。 */
    var scrolls = [];
    window.scrollBy = function(dx, dy){ scrolls.push([dx, dy]); };
    var pev = function(type, x, y){
      return new PointerEvent(type, { bubbles: true, cancelable: true,
        pointerId: 11, button: 0, buttons: 1, clientX: x, clientY: y });
    };
    var boxOf = function(name){
      var bs = q("rank-list").querySelectorAll(".team-box");
      for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-team") === name) return bs[i];
      return null;
    };
    var ghost = function(){ return document.querySelector(".rank-drag-ghost"); };
    var namesIn = function(box){
      if(!box) return [];
      return Array.prototype.map.call(box.querySelectorAll(".rank-row"),
        function(m){ return m.getAttribute("data-name"); });
    };
    return (async function(){
      var bs = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === "final") bs[i].click();
      await wait(30);
      P.addTeam("甲队");
      P.addTeam("乙队");
      await feed([
        { name: "甲一", base: 300, multiplier: 1, team: 0, yuan: 10, total: 300 },
        { name: "乙一", base: 200, multiplier: 1, team: 0, yuan: 20, total: 200 },
        { name: "散人", base: 60,  multiplier: 1, team: 0, yuan: 5,  total: 60  },
        { name: "散二", base: 40,  multiplier: 1, team: 0, yuan: 0,  total: 40  }
      ], ["甲队", "乙队", "", ""]);
      await wait(10);

      var loose = boxOf("未分组"), jia = boxOf("甲队"), yi = boxOf("乙队");
      var looseRow = loose.querySelector(".rank-row");
      var cell = looseRow.children[1];
      /* ⚠️ touch-action 必须**现在**量：松手后 render() 会把这些行整批换掉，
         拿旧节点去 getComputedStyle 只会得到空串（脱离文档的节点算不出样式）。 */
      var touch = {
        loose: cs(looseRow, "touchAction"),
        real: cs(jia.querySelector(".rank-row"), "touchAction")
      };
      var lr = loose.getBoundingClientRect();
      var jr = jia.getBoundingClientRect();
      var yr = yi.getBoundingClientRect();
      var x    = Math.round(lr.left + lr.width / 2);
      var y0   = Math.round(lr.top + lr.height - 8);      // 在「未分组」框里按下
      var yJia = Math.round(jr.top + jr.height / 2);      // 甲队框正中
      var yGap = Math.round((yr.bottom + lr.top) / 2);    // 两个框之间的缝隙

      /* ① 按下 + 纵向拖 30px → 进入搬运模式 */
      cell.dispatchEvent(pev("pointerdown", x, y0));
      await wait();
      document.dispatchEvent(pev("pointermove", x, y0 - 30));
      await wait();
      var g0 = ghost();
      var gr = g0 ? g0.getBoundingClientRect() : null;
      var mid = {
        active: P.moveDragActive(),
        dragging: looseRow.className.indexOf("is-dragging") > -1,
        swiping: looseRow.className.indexOf("is-swiping") > -1,
        opacity: cs(looseRow, "opacity"),
        borderStyle: cs(looseRow, "borderStyle"),
        ghostText: g0 ? g0.textContent : null,
        ghostInBody: g0 ? (g0.parentNode === document.body) : false,
        ghostPE: g0 ? cs(g0, "pointerEvents") : null,
        ghostPos: g0 ? cs(g0, "position") : null,
        ghostNear: gr ? (Math.abs(gr.left - (x + 14)) < 40 &&
                         Math.abs((gr.top + gr.height / 2) - (y0 - 30)) < 40) : false,
        listChildren: q("rank-list").children.length,
        target: P.dragTargetName()
      };

      /* ② 拖到甲队框上 → 落点高亮；再拖进两框之间的缝隙 → 谁都不亮 */
      document.dispatchEvent(pev("pointermove", x, yJia));
      await wait();
      var over = {
        target: P.dragTargetName(),
        hi: jia.className.indexOf("is-drop-target") > -1,
        border: cs(jia, "borderColor"),
        shadow: cs(jia, "boxShadow"),
        bg: cs(jia, "backgroundColor"),
        looseHi: loose.className.indexOf("is-drop-target") > -1,
        gapPx: Math.round((lr.top - yr.bottom) * 10) / 10
      };
      document.dispatchEvent(pev("pointermove", x, yGap));
      await wait();
      var gap = {
        target: P.dragTargetName(),
        hi: jia.className.indexOf("is-drop-target") > -1,
        looseHi: loose.className.indexOf("is-drop-target") > -1
      };

      /* ③ 回到甲队框上松手 → 落位 */
      document.dispatchEvent(pev("pointermove", x, yJia));
      await wait();
      document.dispatchEvent(pev("pointerup", x, yJia));
      await wait(20);

      var jia2 = boxOf("甲队"), loose2 = boxOf("未分组");
      var rec = P.getData().list.filter(function(r){ return r.name === "散人"; })[0] || {};
      var after = {
        league: rec.league,
        jiaNames: namesIn(jia2),
        looseNames: namesIn(loose2),
        ghostGone: !ghost(),
        draggingGone: !jia2 || jia2.innerHTML.indexOf("is-dragging") === -1,
        hiGone: !jia2 || jia2.className.indexOf("is-drop-target") === -1,
        toast: q("rank-toast").className,
        jiaTotal: P.teamTotal("甲队"),
        jiaYuan: P.teamYuan("甲队"),
        stored: String(window.localStorage.getItem(P.LS_KEY_FINAL) || ""),
        order: P.groupByTeam().map(function(g){ return g.name + "#" + g.idx + "=" + g.total; }).join("  ")
      };
      /* ④ 触屏相关的 touch-action 已在拖动前量好，这里只把自动滚动的账一并带上 */
      touch.scrolls = scrolls;
      window.FileReader = realFR;
      return { mid: mid, over: over, gap: gap, after: after, touch: touch, err: window.__ERR };
    })();
  `, "k", "ranking.html");

  if (dg.fatal) { console.error("失败:", dg.fatal); process.exit(1); }
  // ① 拖动过程
  chk(dg.mid.active === true, "在「未分组」的行上纵向拖动 → 进入搬运模式");
  chk(dg.mid.dragging === true, "被搬的那一行带 is-dragging");
  chk(Number(dg.mid.opacity) < 0.5, "…而且淡下去了（实测 opacity=" + dg.mid.opacity + "）");
  chk(dg.mid.borderStyle === "dashed", "…边框转成虚线，一眼看出「正在被挪走」");
  chk(dg.mid.swiping === false, "…并没有走「向左拖」那条手势路径");
  chk(dg.mid.ghostText === "散人", "跟着指针的小牌子上写着被搬的选手名（" + dg.mid.ghostText + "）");
  chk(dg.mid.ghostInBody === true, "小牌子挂在 <body> 下（不混进 #rank-list 的队伍框里）");
  chk(dg.mid.listChildren === 3, "…所以名单区仍然只有 3 个队伍框");
  chk(dg.mid.ghostPE === "none", "小牌子 pointer-events:none（不会挡住指针下的队伍框）");
  chk(dg.mid.ghostPos === "fixed", "小牌子用 fixed 定位跟手（不参与布局、不引起重排）");
  chk(dg.mid.ghostNear === true, "小牌子跟着指针跑（贴在指针右下方）");
  // ② 落点高亮
  chk(dg.over.target === "甲队", "指针移到甲队框上 → 落点识别为「甲队」");
  chk(dg.over.hi === true, "甲队框加上 is-drop-target 高亮");
  chk(/0,\s*255,\s*163/.test(dg.over.border), "高亮描边是主题绿（实测 " + dg.over.border + "）");
  chk(dg.over.shadow !== "none", "…还带一圈辉光（box-shadow=" + dg.over.shadow + "）");
  chk(dg.over.looseHi === false, "原框（未分组）同时被取消高亮（只亮一个）");
  chk(dg.over.gapPx > 1, "两个队伍框之间确实有缝隙（" + dg.over.gapPx + "px）");
  chk(dg.gap.target === "" && dg.gap.hi === false && dg.gap.looseHi === false,
     "指针落进框与框之间的缝隙里 → 谁都不亮，松手就是原地不动");
  // ③ 松手落位
  chk(dg.after.league === "甲队", "松手 → 散人的队伍归属变成「甲队」");
  chk(dg.after.jiaNames.join() === "甲一,散人", "界面：甲队框里出现散人（" + dg.after.jiaNames.join("/") + "）");
  chk(dg.after.looseNames.join() === "散二", "界面：未分组里只剩散二（" + dg.after.looseNames.join("/") + "）");
  chk(dg.after.jiaTotal === 360, "甲队合计分跟着重算 = 300 + 60（" + dg.after.jiaTotal + "）");
  chk(dg.after.jiaYuan === 15, "全队源石锭也跟着变 = 10 + 5（" + dg.after.jiaYuan + "）");
  chk(dg.after.order === "甲队#1=360  乙队#2=200  未分组#0=40",
     "队伍次序按新合计分重排（" + dg.after.order + "）");
  chk(dg.after.ghostGone === true, "松手后小牌子已从页面上摘掉");
  chk(dg.after.draggingGone === true && dg.after.hiGone === true, "虚线/落点高亮也都收干净");
  chk(/rank-toast ok/.test(dg.after.toast), "给了绿色成功提示");
  chk(/"league":"甲队"/.test(dg.after.stored), "归属已写进【决赛】榜单的 localStorage");
  // ④ touch-action 与自动滚动
  chk(dg.touch.loose === "none",
     "「未分组」筐里的行把纵向手势交给 JS（touch-action=" + dg.touch.loose + "），触屏也能拖");
  chk(dg.touch.real === "pan-y",
     "真实队伍框里的行仍然纵向滚动优先（touch-action=" + dg.touch.real + "）");
  chk(dg.touch.scrolls.length > 0 && dg.touch.scrolls.every(s => s[0] === 0),
     "指针靠近视口边缘时触发自动滚动，便于拖到屏幕外的队伍（记到 " +
     dg.touch.scrolls.length + " 次 scrollBy）");
  chk((dg.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ③i 双击队名就地改名（2026-09-24） ---------------- */
{
  console.log("\n[3i] 真页面里【双击队名】就地改名（回车 / 对勾确定，Esc / 点框外放弃）…");
  const rn = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE, q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    var cs = function(el, p){ return getComputedStyle(el)[p]; };
    var wait = async function(n){ for(var k = 0; k < (n || 5); k++) await Promise.resolve(); };
    var feed = async function(rows, lg){
      for(var i = 0; i < rows.length; i++){
        P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], true) }], lg[i]);
        await wait(30);
      }
    };
    // 禁掉过渡：无头 Chrome 的虚拟时钟不推进它们（同 [3f] / [3h]）
    var st = document.createElement("style");
    st.textContent = "*, *::before, *::after{animation:none !important; transition:none !important;}";
    document.head.appendChild(st);

    var boxOf = function(name){
      var bs = q("rank-list").querySelectorAll(".team-box");
      for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-team") === name) return bs[i];
      return null;
    };
    var nameElOf = function(name){
      var b = boxOf(name);
      return b ? b.querySelector(".team-name") : null;
    };
    var dblOn = function(el){
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
    };
    var keyOn = function(el, key, code){
      el.dispatchEvent(new KeyboardEvent("keydown", { key: key, keyCode: code, which: code,
        bubbles: true, cancelable: true }));
    };

    return (async function(){
      var bs = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === "final") bs[i].click();
      await wait(30);
      P.addTeam("甲队");
      P.addTeam("乙队");
      await feed([
        { name: "甲一", base: 300, multiplier: 1, team: 0, yuan: 10, total: 300 },
        { name: "乙一", base: 200, multiplier: 1, team: 0, yuan: 20, total: 200 },
        { name: "散人", base: 60,  multiplier: 1, team: 0, yuan: 5,  total: 60  }
      ], ["甲队", "乙队", ""]);
      await wait(20);

      /* 0. 改名前：队头干净（没有常驻的输入框 / 对勾），入口属性只在真实队伍的队名上 */
      var jia = boxOf("甲队"), nm = nameElOf("甲队"), looseName = nameElOf("未分组");
      var before = {
        inputs: q("rank-list").querySelectorAll(".team-name-input").length,
        oks: q("rank-list").querySelectorAll(".team-rename-ok").length,
        jiaAttr: nm.getAttribute("data-rename-team"),
        jiaTitle: nm.getAttribute("title"),
        looseAttr: !!(looseName && looseName.getAttribute("data-rename-team")),
        border: cs(jia, "borderColor"),
        nameDisplay: cs(nm, "display")
      };

      /* 1. 真 dblclick 队名 → 进编辑态（input 顶上来、金边变青边、对勾在右边） */
      dblOn(nm);
      await wait();
      var box2 = boxOf("甲队");
      var inp  = box2.querySelector(".team-name-input");
      var ok   = box2.querySelector(".team-rename-ok");
      var nm2  = box2.querySelector(".team-name");
      var ir = inp.getBoundingClientRect(), orr = ok.getBoundingClientRect();
      var nr = nm2.getBoundingClientRect(), br = box2.getBoundingClientRect();
      var editing = {
        active: P.renameActive(),
        cls: box2.className,
        border: cs(box2, "borderColor"),
        shadow: cs(box2, "boxShadow"),
        nameDisplay: cs(nm2, "display"),
        nameStillInDom: !!nm2,
        value: inp.value,
        maxLength: inp.maxLength,
        flexGrow: cs(inp, "flexGrow"),
        inputFontSize: cs(inp, "fontSize"),
        okText: ok.textContent,
        okColor: cs(ok, "color"),
        okRightOfInput: (orr.left >= ir.right - 1),
        sameRow: (Math.abs((ir.top + ir.height / 2) - (orr.top + orr.height / 2)) < 6),
        okInBox: (orr.left >= br.left && orr.right <= br.right + 1),
        inputWidth: Math.round(ir.width),
        inputHeight: Math.round(ir.height),
        nameWasWide: Math.round(nr.width),
        focused: (document.activeElement === inp),
        otherBoxUntouched: (boxOf("乙队").querySelectorAll(".team-name-input").length === 0)
      };

      /* 2. 输入新队名 + 真回车 → 队名与队员归属一起改 */
      inp.value = "先锋大队";
      keyOn(inp, "Enter", 13);
      var toastCls = q("rank-toast").className, toastTxt = q("rank-toast").textContent;
      await wait(20);
      var box3 = boxOf("先锋大队");
      var rec = P.getData().list.filter(function(r){ return r.name === "甲一"; })[0] || {};
      var after = {
        teams: P.teamList().join("/"),
        league: rec.league,
        nameText: box3 ? box3.querySelector(".team-name").textContent : null,
        oldBoxGone: !boxOf("甲队"),
        inputsLeft: q("rank-list").querySelectorAll(".team-name-input").length,
        oksLeft: q("rank-list").querySelectorAll(".team-rename-ok").length,
        active: P.renameActive(),
        nameDisplay: box3 ? cs(box3.querySelector(".team-name"), "display") : null,
        border: box3 ? cs(box3, "borderColor") : null,
        toastCls: toastCls,
        toastTxt: toastTxt,
        total: P.teamTotal("先锋大队"),
        looseTotal: P.teamTotal("未分组"),
        order: P.groupByTeam().map(function(g){ return g.name + "#" + g.idx + "=" + g.total; }).join("  "),
        stored: String(window.localStorage.getItem(P.LS_KEY_FINAL) || "")
      };

      /* 3. Esc → 放弃（队名不变、输入框摘掉、队名显回来） */
      dblOn(nameElOf("乙队"));
      await wait();
      var inp2 = boxOf("乙队").querySelector(".team-name-input");
      inp2.value = "不该生效的名字";
      keyOn(inp2, "Escape", 27);
      await wait();
      var boxY = boxOf("乙队");
      var esc = {
        teams: P.teamList().join("/"),
        active: P.renameActive(),
        inputGone: !boxY.querySelector(".team-name-input"),
        okGone: !boxY.querySelector(".team-rename-ok"),
        nameDisplay: cs(boxY.querySelector(".team-name"), "display"),
        renameClsGone: boxY.className.indexOf("is-renaming") === -1
      };

      /* 4. 点框外 → 同样放弃；点框**内**（队员行）→ 继续编辑 */
      dblOn(nameElOf("乙队"));
      await wait();
      var entered = P.renameActive();
      var rowCell = boxOf("乙队").querySelector(".rank-row").children[1];
      rowCell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true,
        pointerId: 21, button: 0, buttons: 1, clientX: 3, clientY: 3 }));
      await wait();
      var insideKept = P.renameActive();
      var rr2 = rowCell.getBoundingClientRect();
      q("rank-toast").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true,
        pointerId: 22, button: 0, buttons: 1,
        clientX: Math.round(rr2.left - 40), clientY: Math.round(rr2.top) }));
      await wait();
      var out = {
        entered: entered,
        insideKept: insideKept,
        active: P.renameActive(),
        inputGone: !boxOf("乙队").querySelector(".team-name-input"),
        teams: P.teamList().join("/")
      };

      /* 5. 双击队员行 / 双击名单空白 → 都不该进编辑态 */
      var stray = { before: P.renameActive() };
      dblOn(boxOf("乙队").querySelector(".rank-row"));
      await wait();
      stray.afterRow = P.renameActive();
      dblOn(q("rank-list"));
      await wait();
      stray.afterBlank = P.renameActive();
      stray.armed = P.armedPlayer();

      window.FileReader = realFR;
      return { before: before, editing: editing, after: after, esc: esc, out: out,
               stray: stray, err: window.__ERR };
    })();
  `, "m", "ranking.html");

  if (rn.fatal) { console.error("失败:", rn.fatal); process.exit(1); }

  // 0. 改名前
  chk(rn.before.inputs === 0 && rn.before.oks === 0,
     "平时队头上没有常驻的输入框 / 对勾（现插现摘，不占宽度）");
  chk(rn.before.jiaAttr === "1", "真实队伍的队名带 data-rename-team（改名的入口）");
  chk(rn.before.jiaTitle === "双击可改队名", "队名上有提示文案（" + rn.before.jiaTitle + "）");
  chk(rn.before.looseAttr === false, "「未分组」的队名没有入口属性");
  chk(rn.before.nameDisplay === "flex", "改名前队名是显示着的");

  // 1. 编辑态
  chk(rn.editing.active === true, "双击队名 → 进入编辑态");
  chk(/is-renaming/.test(rn.editing.cls), "队伍框带上 is-renaming（" + rn.editing.cls + "）");
  chk(/57,\s*208,\s*255/.test(rn.editing.border),
     "编辑态的描边是主题青（实测 " + rn.editing.border + "）—— 甲队本来是冠军金边，说明它压得住 team-top1");
  chk(rn.editing.border !== rn.before.border,
     "…确实与改名前不同（改名前 " + rn.before.border + "）");
  chk(rn.editing.shadow !== "none", "…还带一圈辉光（" + rn.editing.shadow + "）");
  chk(rn.editing.nameDisplay === "none", "队名本体被藏起来（display:none）让位给输入框");
  chk(rn.editing.nameStillInDom === true, "…但节点还在 DOM 里（只是被 css 藏了，退出时不用复原结构）");
  chk(rn.editing.value === "甲队", "输入框预填现有队名（" + rn.editing.value + "）");
  chk(rn.editing.maxLength === 24, "输入上限 24 字（与「添加队伍」弹框同一口径）");
  chk(rn.editing.flexGrow === "1", "输入框接住队名原本的 flex:1 位置（flex-grow=" + rn.editing.flexGrow + "）");
  chk(rn.editing.inputWidth > 0 && rn.editing.inputHeight > 0,
     "输入框有真实尺寸（" + rn.editing.inputWidth + "×" + rn.editing.inputHeight + "）");
  chk(rn.editing.okText === "✓", "右边是个对勾按钮（" + rn.editing.okText + "）");
  chk(/0,\s*255,\s*163/.test(rn.editing.okColor), "对勾是主题绿（" + rn.editing.okColor + "）");
  chk(rn.editing.okRightOfInput === true, "对勾排在输入框**右边**");
  chk(rn.editing.sameRow === true, "…与输入框同一行（不是换行掉下去）");
  chk(rn.editing.okInBox === true, "…而且没溢出队伍框右边界");
  chk(rn.editing.focused === true, "进编辑态时输入框已聚焦（可以直接打字）");
  chk(rn.editing.otherBoxUntouched === true, "「乙队」框不受影响（一次只编一个）");

  // 2. 回车确定
  chk(rn.after.teams === "先锋大队/乙队", "回车 → 队名改掉（" + rn.after.teams + "）");
  chk(rn.after.league === "先锋大队",
     "⚠️ 队员的 league 跟着一起改（" + rn.after.league + "）—— 只改队名不改它就全掉进未分组");
  chk(rn.after.nameText === "先锋大队1 人", "新框上印着新队名 + 人数（" + rn.after.nameText + "）");
  chk(rn.after.oldBoxGone === true, "旧「甲队」框已消失");
  chk(rn.after.inputsLeft === 0 && rn.after.oksLeft === 0, "输入框与对勾都摘干净了");
  chk(rn.after.active === false, "编辑态已收起");
  chk(rn.after.nameDisplay === "flex", "队名显回来了（display=" + rn.after.nameDisplay + "）");
  chk(/255,\s*181,\s*71/.test(String(rn.after.border)),
     "描边回到「冠军金」（实测 " + rn.after.border + "）—— 编辑态的青边是临时的");
  chk(/rank-toast ok/.test(rn.after.toastCls), "给了绿色成功提示（" + rn.after.toastCls + "）");
  chk(/先锋大队/.test(rn.after.toastTxt) && /甲队/.test(rn.after.toastTxt),
     "提示里新名旧名都点了（" + rn.after.toastTxt + "）");
  chk(rn.after.total === 300, "合计分跟着搬过去（先锋大队 = 300）");
  chk(rn.after.looseTotal === 60, "未分组没被误塞人（" + rn.after.looseTotal + "）");
  chk(rn.after.order === "先锋大队#1=300  乙队#2=200  未分组#0=60",
     "分组与次序跟着重算（" + rn.after.order + "）");
  chk(/"league":"先锋大队"/.test(rn.after.stored), "队员归属已写进【决赛】榜单的 localStorage");
  chk(/"teams":\["先锋大队","乙队"\]/.test(rn.after.stored), "队伍列表也写进去了");

  // 3. Esc
  chk(rn.esc.teams === "先锋大队/乙队", "Esc → 队名一个字没改（" + rn.esc.teams + "）");
  chk(rn.esc.active === false && rn.esc.inputGone === true && rn.esc.okGone === true,
     "…输入框与对勾都摘掉");
  chk(rn.esc.renameClsGone === true, "…is-renaming 类也去掉了");
  chk(rn.esc.nameDisplay === "flex", "…队名原地显回来");

  // 4. 点框内 / 框外
  chk(rn.out.entered === true && rn.out.insideKept === true,
     "点框**内**的队员行不算「点别处」→ 继续编辑");
  chk(rn.out.active === false && rn.out.inputGone === true, "点框外 → 放弃编辑、输入框摘掉");
  chk(rn.out.teams === "先锋大队/乙队", "…队名没变");

  // 5. 双击别处
  chk(rn.stray.before === false && rn.stray.afterRow === false && rn.stray.afterBlank === false,
     "双击队员行 / 名单空白都不进编辑态（只认队名）");
  chk(rn.stray.armed === "", "…也没顺带点亮行尾删除键");
  chk((rn.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ③j 窄屏下队头一行仍放得下（队头从 1 个源石锭数字变成「已使用 + 剩余」两块后） ----------------
   队头是「次序 + 队名(flex:1) + 已使用(小标签 + 绿数字) + 剩余(小标签 + 绿数字) + 合计分」。
   2026-09-25 起队头多了一整块（剩余），窄屏（≤720px）本来就最挤：
   必须真在 680px 下量一次，确认两个标签都**不换行、不把队名挤没、不溢出框右边界**。
   （runProbe 默认窗口 800×600 在断点之外，量到的是宽屏那套字号 —— 不传 size 这条断言等于白测。） */
{
  console.log("\n[3j] 窄屏 680px 下队头两块（已使用 + 剩余）仍放得下…");
  const nl = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE;
    var q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    /* ⚠️ 必须先把 FileReader 换成桩：ingest 读的是伪 File 对象（只有 name + __text），
       真 FileReader 读不了它，readAsText 会报错 → 三条数据一条都灌不进去
       （症状很隐蔽：空队框照样渲染，只有「未分组」整个不出现）。 */
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    var feed = async function(rows){
      for(var i = 0; i < rows.length; i++){
        P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], true) }], rows[i].lg);
        for(var k = 0; k < 30; k++) await Promise.resolve();
      }
    };
    return (async function(){
      /* ⚠️ 「剩余」的基准读的是**计分器的存档**，显式固定成 120，断言才不随环境漂移 */
      localStorage.setItem(P.COUNTER_KEY, JSON.stringify({ yuanInitFinal: 120 }));
      var ms = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < ms.length; i++) if(ms[i].getAttribute("data-mode") === "final") ms[i].click();
      for(var k = 0; k < 30; k++) await Promise.resolve();
      /* 队名刻意用长名（5 字），逼出最挤的情况 */
      P.addTeam("近锋最强队"); P.addTeam("深海猎人");
      await feed([
        { name: "祁星",   base: 1450, multiplier: 1.3, team: 520, yuan: 30, total: 2405, lg: "近锋最强队" },
        { name: "诗怀雅", base: 1180, multiplier: 1.3, team: 300, yuan: 60, total: 1834, lg: "近锋最强队" },
        { name: "阿米娅", base: 760,  multiplier: 1,   team: 0,   yuan: 90, total: 760,  lg: "" }
      ]);
      window.FileReader = realFR;
      var boxes = q("rank-list").children;
      var out = [];
      for(var i = 0; i < boxes.length; i++){
        var b = boxes[i], head = b.children[0];
        var yb = head.children[2];                    // 整个源石锭块（已使用 + 剩余）
        var used = yb.children[0], rest = yb.children[1];
        var hr = head.getBoundingClientRect();
        var nr = head.children[1].getBoundingClientRect();
        var yr = yb.getBoundingClientRect();
        var sr = head.children[3].getBoundingClientRect();
        out.push({
          team: b.getAttribute("data-team"),
          usedLabel: used.children[0].textContent,
          restLabel: rest.children[0].textContent,
          usedText: used.children[1].textContent,
          restText: rest.children[1].textContent,
          /* ⚠️ 行数看 getClientRects() 的数量：inline 元素一旦折行就会给出多个矩形，
                比「高度 ÷ 行高」稳（padding/行高的取整误差不会把它算歪）。 */
          usedLines: used.children[0].getClientRects().length,
          restLines: rest.children[0].getClientRects().length,
          /* 队头横向溢出量（flex 容器里内容被挤出去时 scrollWidth 会超过 clientWidth） */
          headOverflow: Math.round(head.scrollWidth - head.clientWidth),
          yuanRight: Math.round(yr.right),
          sumLeft: Math.round(sr.left),
          nameW: Math.round(nr.width),
          yuanRightInHead: Math.round(hr.right - yr.right),
          /* 两块之间（gap）必须比块内「标签↔数字」的间距大，否则四个元素等距、读不出配对 */
          gapBetween: Math.round(rest.getBoundingClientRect().left - used.getBoundingClientRect().right),
          gapInside: Math.round(used.children[1].getBoundingClientRect().left -
                                used.children[0].getBoundingClientRect().right)
        });
      }
      return {
        boxes: out,
        list: P.getData().list.map(function(r){ return r.name + ":" + (r.league || "-") + ":" + r.total; }),
        winW: window.innerWidth,
        narrow: window.matchMedia("(max-width:720px)").matches,
        err: window.__ERR
      };
    })();
  `, "n", "ranking.html", "680,1180");

  if (nl.fatal) { console.error("失败:", nl.fatal); process.exit(1); }
  chk(nl.narrow === true, "确实落在窄屏断点内（viewport " + nl.winW + "px）—— 否则这套测量没意义");
  chk(nl.boxes.length === 3, "两个队伍框 + 未分组（" + nl.boxes.map(x => x.team).join("/") +
     " :: " + (nl.list || []).join(" " ) + "）");
  chk(nl.boxes.every(x => x.usedLabel === "已使用" && x.restLabel === "剩余"),
     "队头两块小标签是「已使用」+「剩余」（实测 " +
     nl.boxes.map(x => x.usedLabel + "/" + x.restLabel).join("  ") + "）");
  chk(nl.boxes.map(x => x.team + "=" + x.usedText + "/" + x.restText).join("  ") ===
      "近锋最强队=90/30  深海猎人=0/120  未分组=90/30",
     "已使用/剩余：近锋 90/30、**空队 0/120**、未分组 90/30（实测 " +
     nl.boxes.map(x => x.team + "=" + x.usedText + "/" + x.restText).join("  ") + "）");
  chk(nl.boxes.every(x => x.usedLines === 1 && x.restLines === 1),
     "两个标签都仍是**一行**，没被挤到折行（实测行数 " +
     nl.boxes.map(x => x.usedLines + "/" + x.restLines).join("  ") + "）");
  chk(nl.boxes.every(x => x.headOverflow <= 0),
     "队头没有横向溢出（溢出量 " + nl.boxes.map(x => x.headOverflow).join("/") + "px）");
  chk(nl.boxes.every(x => x.yuanRight <= x.sumLeft + 1),
     "「已使用 + 剩余」整块仍排在合计分左侧、没压上去");
  chk(nl.boxes.every(x => x.nameW >= 24),
     "队名没被长标签挤没（队名格宽 " + nl.boxes.map(x => x.nameW).join("/") + "px）");
  chk(nl.boxes.every(x => x.yuanRightInHead >= 0),
     "标签右端没顶出队伍框（余量 " + nl.boxes.map(x => x.yuanRightInHead).join("/") + "px）");
  chk(nl.boxes.every(x => x.gapBetween > x.gapInside),
     "窄屏下两块之间仍比块内疏（实测 " +
     nl.boxes.map(x => x.gapBetween + ">" + x.gapInside).join("  ") + " px）");
  chk((nl.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ③l 「导出 / 导入」按钮钉在操作区的**最左与最右**（2026-09-26） ----------------
   用户要求：「按钮在最左和最右侧，导出成 txt 文本形式」。
   做法：导出 = 操作区的第一个子元素、导入 = 最后一个，再用 auto 外边距把剩余空间
   **均分**掉（flex 会把自由空间平分给两个 auto 边距）→ 导出贴左边、导入贴右边、
   中间那组自然落在正中。这里量**真矩形**把三条都钉住（桩里没 css，量不了）。 */
{
  console.log("\n[3l] 真页面里核对「导出 / 导入」按钮在最左与最右…");
  const ge = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var q = function(id){ return document.getElementById(id); };
    var mid = ["btn-add-team", "btn-add-player", "btn-clear-board"];
    return (async function(){
      /* 决赛：六个按钮全在场（初赛的「添加队伍」是 display:none，量不到） */
      var ms = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < ms.length; i++) if(ms[i].getAttribute("data-mode") === "final") ms[i].click();
      for(var k = 0; k < 20; k++) await Promise.resolve();

      var acts = document.querySelector(".rank-actions");
      var a = acts.getBoundingClientRect();
      var back = acts.querySelector("a.big-btn");          // 「返回计分器」是链接型按钮
      var info = function(el){
        var r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), left: r.left, right: r.right,
                 top: r.top, w: r.width, h: r.height };
      };
      var ids = ["btn-export-board", "btn-import-board"].concat(mid);
      var b = {};
      ids.forEach(function(id){ b[id] = info(q(id)); });
      var bk = info(back);

      var midBox = [].concat(mid.map(function(id){ return b[id]; }), [bk]);
      var midLeft  = Math.min.apply(null, midBox.map(function(x){ return x.left; }));
      var midRight = Math.max.apply(null, midBox.map(function(x){ return x.right; }));
      var tops = ids.map(function(id){ return b[id].top; });

      return {
        acts: { left: a.left, right: a.right, center: a.left + a.width / 2 },
        mid:  { left: midLeft, right: midRight, center: (midLeft + midRight) / 2 },
        backText: bk.text,
        oneLine: Math.max.apply(null, tops) - Math.min.apply(null, tops) < 4,
        allVisible: ids.every(function(id){ return b[id].w > 0 && b[id].h > 0; }),
        b: b,
        err: window.__ERR
      };
    })();
  `, "l", "ranking.html", "1280,900");

  if (ge.fatal) { console.error("失败:", ge.fatal); process.exit(1); }
  if (process.env.E2E_DEBUG) console.log("DEBUG " + JSON.stringify(ge, null, 1));
  chk(ge.oneLine === true, "六个按钮在同一行（没被挤到换行）");
  chk(Math.abs(ge.b["btn-export-board"].left - ge.acts.left) <= 1,
     "「导出 txt」左边缘贴住操作区左端（实测差 " +
     Math.round(ge.b["btn-export-board"].left - ge.acts.left) + "px）");
  chk(Math.abs(ge.b["btn-import-board"].right - ge.acts.right) <= 1,
     "「导入 txt」右边缘贴住操作区右端（实测差 " +
     Math.round(ge.b["btn-import-board"].right - ge.acts.right) + "px）");
  chk(["btn-add-team", "btn-add-player", "btn-clear-board"].every(function(id){
        return ge.b["btn-export-board"].left < ge.b[id].left;
      }), "导出排在其余按钮的左边（= 最左）");
  chk(["btn-add-team", "btn-add-player", "btn-clear-board"].every(function(id){
        return ge.b["btn-import-board"].right > ge.b[id].right;
      }), "导入排在其余按钮的右边（= 最右）");
  chk(Math.abs(ge.mid.center - ge.acts.center) <= 2,
     "中间那组仍居中（组中心与操作区中心差 " +
     Math.round(ge.mid.center - ge.acts.center) + "px）");
  chk(ge.b["btn-export-board"].text === "导出 txt", "左边的按钮文案是「导出 txt」（" + ge.b["btn-export-board"].text + "）");
  chk(ge.b["btn-import-board"].text === "导入 txt", "右边的按钮文案是「导入 txt」（" + ge.b["btn-import-board"].text + "）");
  chk((ge.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ③o 窄屏（680px）下两个按钮仍占首尾两端 ----------------
   窄屏每个按钮各占整行（`.rank-actions .big-btn{flex:1 1 100%}`），
   此时 auto 外边距自动失效、退化成正常堆叠 —— 顺序必须仍是「导出在最上、导入在最下」。 */
{
  console.log("\n[3o] 窄屏 680px 下「导出 / 导入」仍占首尾…");
  const nw = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var q = function(id){ return document.getElementById(id); };
    var mid = ["btn-add-team", "btn-add-player", "btn-clear-board"];
    return (async function(){
      var ms = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < ms.length; i++) if(ms[i].getAttribute("data-mode") === "final") ms[i].click();
      for(var k = 0; k < 20; k++) await Promise.resolve();
      var acts = document.querySelector(".rank-actions");
      var a = acts.getBoundingClientRect();
      var t = function(id){ return q(id).getBoundingClientRect().top; };
      var w = function(id){ return q(id).getBoundingClientRect().width; };
      var ids = ["btn-export-board", "btn-import-board"].concat(mid);
      return {
        actsW: a.width,
        tops: (function(){ var o = {}; ids.forEach(function(id){ o[id] = t(id); }); return o; })(),
        widths: (function(){ var o = {}; ids.forEach(function(id){ o[id] = w(id); }); return o; })(),
        backTop: acts.querySelector("a.big-btn").getBoundingClientRect().top,
        err: window.__ERR
      };
    })();
  `, "o", "ranking.html", "680,1180");

  if (nw.fatal) { console.error("失败:", nw.fatal); process.exit(1); }
  chk(nw.tops["btn-export-board"] < nw.tops["btn-add-team"] &&
      nw.tops["btn-export-board"] < nw.backTop &&
      nw.tops["btn-export-board"] < nw.tops["btn-clear-board"],
     "窄屏下「导出 txt」在其它按钮之上（= 首）");
  chk(nw.tops["btn-import-board"] > nw.tops["btn-add-team"] &&
      nw.tops["btn-import-board"] > nw.backTop &&
      nw.tops["btn-import-board"] > nw.tops["btn-clear-board"],
     "窄屏下「导入 txt」在其它按钮之下（= 尾）");
  chk(Object.keys(nw.widths).every(function(id){ return Math.abs(nw.widths[id] - nw.actsW) <= 2; }),
     "窄屏每个按钮各占整行（实测宽 " +
     Object.keys(nw.widths).map(function(id){ return Math.round(nw.widths[id]); }).join("/") +
     " vs 操作区 " + Math.round(nw.actsW) + "）");
  chk((nw.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ③s 真页面里走一遍「导出 txt → 清空 → 导入 txt」闭环（2026-09-26） ----------------
   这一节验的是**真浏览器里的文件通道**：另存为 / 打开都换成桩（不弹系统框），
   但 Blob、Promise、getBoundingClientRect 全是真的 —— 导出的文本再喂回导入，
   榜单必须一字节不差地回来。 */
{
  console.log("\n[3s] 真页面里走一遍「导出 → 清空 → 导入」闭环…");
  const rt = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE, q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    return (async function(){
      var saved = {};
      /* ⚠️ 真 Blob 的读取是**真异步 I/O**，无头 Chrome 的虚拟时钟不推它 →
         探针会永远等不到内容（踩过：文件名抓到了、文本却是空的，后面十条断言全歪）。
         所以把 Blob 换成「记住写进去的字符串」的替身 —— 除它以外的一切都是真的。 */
      var RealBlob = window.Blob;
      window.Blob = function(parts, opts){ this.__parts = parts; this.type = opts && opts.type; };
      window.showSaveFilePicker = function(opts){
        saved.name = opts && opts.suggestedName;
        return Promise.resolve({ createWritable: function(){
          return Promise.resolve({
            write: function(blob){ saved.text = (blob.__parts || []).join(""); return Promise.resolve(); },
            close: function(){ return Promise.resolve(); }
          });
        }});
      };
      var tick = function(n){ return (async function(){ for(var i = 0; i < n; i++) await Promise.resolve(); })(); };

      /* 决赛：建两支队伍 + 三个人（含一个未分组） */
      var ms = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < ms.length; i++) if(ms[i].getAttribute("data-mode") === "final") ms[i].click();
      await tick(20);
      P.addTeam("甲队"); P.addTeam("乙队");
      P.ingest([{ name: "甲一.txt", __text: window.__mkTxt({name:"甲一", base:300, multiplier:1, team:0, yuan:90, total:300}, true) }], "甲队");
      await tick(30);
      P.ingest([{ name: "乙一.txt", __text: window.__mkTxt({name:"乙一", base:200, multiplier:1, team:0, yuan:15, total:200}, true) }], "乙队");
      await tick(30);
      P.ingest([{ name: "散人.txt", __text: window.__mkTxt({name:"散人", base:60, multiplier:1, team:0, yuan:0, total:60}, true) }], "");
      await tick(30);

      var before = JSON.stringify(P.getData());
      var boxesBefore = q("rank-list").children.length;

      /* ① 点「导出 txt」 */
      q("btn-export-board").click();
      await tick(30);
      var head = String(saved.text || "").split("\\n").slice(0, 3).join(" | ");
      var dataLines = String(saved.text || "").split(/\\r?\\n/).filter(function(l){ return l.indexOf("DATA:") === 0; });
      var payload = dataLines.length ? JSON.parse(dataLines[0].slice(5)) : null;

      /* ② 清空榜单（把导出前的内容彻底抹掉） */
      window.confirm = function(){ return true; };
      q("btn-clear-board").click();
      await tick(20);
      var afterClear = P.getData().list.length;

      /* ③ 把刚导出的文本原样导回去 */
      window.showOpenFilePicker = function(){
        return Promise.resolve([{ getFile: function(){ return { name: "back.txt", __text: saved.text }; } }]);
      };
      q("btn-import-board").click();
      await tick(40);

      var after = JSON.stringify(P.getData());
      window.FileReader = realFR;
      window.Blob = RealBlob;
      return {
        name: saved.name,
        title: head,
        mode: payload && payload.mode,
        listLen: payload && payload.list.length,
        teams: payload && payload.teams,
        hasYuanInit: /yuanInit/i.test(dataLines[0] || ""),
        afterClear: afterClear,
        restoresTeams: q("rank-list").children.length === boxesBefore,
        same: after === before,
        names: P.getData().list.map(function(r){ return r.name; }).sort(),
        toast: q("rank-toast").className,
        full: saved.text,
        err: window.__ERR
      };
    })();
  `, "s", "ranking.html");

  if (rt.fatal) { console.error("失败:", rt.fatal); process.exit(1); }
  if (process.env.E2E_DEBUG) {
    console.log("----- 导出的 txt 原文 -----\n" + rt.full + "\n---------------------------");
    /* 顺手留一份样本文件，方便肉眼看格式（只在调试开关打开时写，平时不落盘） */
    fs.writeFileSync(path.join(__dirname, "_sample-board.txt"), rt.full, "utf8");
  }
  chk(/^黑流树海粥集杯#1榜单-决赛-\d{8}-\d{4}\.txt$/.test(rt.name),
     "导出的文件名带赛程与时间戳（" + rt.name + "）");
  chk(/实时排名榜单 · 决赛/.test(rt.title), "导出的文本第一段是给人看的可读汇总");
  chk(rt.mode === "final" && rt.listLen === 3, "DATA 行记下赛程与 3 位选手");
  chk(String(rt.teams) === "甲队,乙队", "队伍列表一起带上（" + rt.teams + "）");
  chk(rt.hasYuanInit === false, "DATA 行不含源石锭余额设置（基准只住在计分器存档里）");
  chk(rt.afterClear === 0, "点「清空榜单」后确实清空了");
  chk(rt.same === true, "导入回来与导出前**一模一样**（含队伍归属与更新时间）");
  chk(rt.restoresTeams === true, "分组大框也跟着回来了（两个队框 + 未分组）");
  chk(String(rt.names) === "乙一,散人,甲一", "三个人一个不少（" + rt.names + "）");
  chk(/rank-toast ok/.test(rt.toast), "导入成功给了绿色提示");
  chk((rt.err || []).length === 0, "整个过程页面无 JS 报错");
}


/* ---------------- ③k 「剩余」跟着计分器的设置走（含另一个标签页改设置、坏档回落） ----------------
   基准是**计分器存档里的 yuanInitFinal**（齿轮弹框改的就是它）。
   用户在另一个标签页改完切回来，本页靠浏览器的 `storage` 事件感知 → 自动重算，不必手动刷新。
   （这里用真 StorageEvent 派发；跨标签页投递本身是浏览器的职责，不必真开两个 tab。） */
{
  console.log("\n[3k] 真页面里核对「剩余」跟着计分器余额走…");
  const yb = runProbe(["../../js/ranking-data.js", "../../js/ranking.js"], `
    var P = window.RANKING_PAGE, q = function(id){ return document.getElementById(id); };
    var realFR = window.FileReader;
    window.FileReader = function(){
      var self = this;
      this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
    };
    var restOf = function(){
      var b = q("rank-list").children[0];
      return b.children[0].children[2].children[1].children[1].textContent;
    };
    var fire = function(key){
      window.dispatchEvent(new StorageEvent("storage", { key: key, storageArea: localStorage }));
    };
    return (async function(){
      localStorage.setItem(P.COUNTER_KEY, JSON.stringify({ yuanInitPrelim: 60, yuanInitFinal: 120 }));
      var ms = q("rank-modes").querySelectorAll(".rank-mode");
      for(var i = 0; i < ms.length; i++) if(ms[i].getAttribute("data-mode") === "final") ms[i].click();
      for(var k = 0; k < 30; k++) await Promise.resolve();
      P.addTeam("甲队");
      P.ingest([{ name: "甲一.txt",
        __text: window.__mkTxt({name:"甲一", base:10, multiplier:1, team:0, yuan:30, total:10}, true) }], "甲队");
      for(var k = 0; k < 30; k++) await Promise.resolve();
      var base = restOf();                       // 120 − 30 = 90

      /* 模拟「在另一个标签页的计分器里点齿轮把余额改成 300」 */
      localStorage.setItem(P.COUNTER_KEY, JSON.stringify({ yuanInitFinal: 300 }));
      var rowBefore = q("rank-list").children[0];
      fire(P.COUNTER_KEY);
      var changed = { rest: restOf(), rerendered: q("rank-list").children[0] !== rowBefore };

      /* 与余额无关的键（榜单自己的档）→ 不该白重算 */
      var rowKeep = q("rank-list").children[0];
      fire(P.LS_KEY_FINAL);
      var ignored = q("rank-list").children[0] === rowKeep;

      /* 存档被手改坏 → 回落 120，绝不按 0 算（那样会显示成「全员严重超支」） */
      localStorage.setItem(P.COUNTER_KEY, "这不是 JSON");
      fire(P.COUNTER_KEY);
      var fallback = restOf();

      window.FileReader = realFR;
      return { base: base, changed: changed, ignored: ignored, fallback: fallback, err: window.__ERR };
    })();
  `, "p", "ranking.html");
  /* ⚠️ label 必须**全局唯一**：它会拼成 --user-data-dir=_ud_ 加 label，撞车就复用同一个
     Chrome profile → 上一次探针灌进 localStorage 的榜单数据还在，断言全歪
     （本小节首次写成 "k"、与 [3h] 撞车：榜单里凭空多出 3 位选手，剩余算出来是 100 而不是 90）。 */

  if (yb.fatal) { console.error("失败:", yb.fatal); process.exit(1); }
  chk(yb.base === "90", "基准 120 → 剩余 = 120 − 30 = 90（实测 " + yb.base + "）");
  chk(yb.changed.rest === "270", "计分器那边把余额改成 300 → 剩余立刻变 270（" + yb.changed.rest + "）");
  chk(yb.changed.rerendered === true, "…是真的重渲染了一遍（行是新建的），不是只改了数字");
  chk(yb.ignored === true, "其它键的 storage 事件不触发重算");
  chk(yb.fallback === "90", "计分器存档被改坏 → 回落 120（" + yb.fallback + "），不按 0 算");
  chk((yb.err || []).length === 0, "整个过程页面无 JS 报错");
}

/* ---------------- ④ 截图：空态 / 初赛 / 决赛 / 窄屏 / 拖动删除键 / 拖动入队 / 改名 ---------------- */
console.log("\n[4] 截图 …");

/* ⚠️ 截图页不能靠 `<script>localStorage.setItem(...); location.replace(...)</script>`
   那种「种完再跳」的写法：headless 下导航会把刚写的值丢掉（实测跳过去还是默认初赛）。
   改为把真实 ranking.html 的 <body> 整段抄进图里、在同一文档内直接调 RANKING_PAGE 灌数据、
   再 .click() 真胶囊切到决赛 —— 这样截的就是脚本跑完之后的那一帧。 */
function shot(script, label, name, size) {
  const out = path.join(ROOT, "_test", name);
  const page = path.join(OUT, "_shot_" + label + ".html");
  const tags = ["../../js/ranking-data.js", "../../js/ranking.js"]
    .map(s => `<script src="${s}"></script>`).join("\n");
  const src = fs.readFileSync(path.join(ROOT, "ranking.html"), "utf8");
  const inner = src.slice(src.indexOf("<body>") + 6, src.lastIndexOf("</body>"))
                   .replace(/<script[\s\S]*?<\/script>/g, "");
  fs.writeFileSync(page, `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<link rel="stylesheet" href="../../css/style.css">
</head><body>
${inner}
${tags}
<script>
window.__mkTxt = ${sampleExport.toString()};
try { Promise.resolve((function(){ ${script} })()).then(function(out){
  document.body.setAttribute("data-shot-ready", "1");
  document.body.setAttribute("data-shot-out", String(out));
}); } catch(e){ document.body.setAttribute("data-shot-err", String(e)); }
<\/script></body></html>`, "utf8");
  chrome([
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--user-data-dir=" + path.join(OUT, "_ud_" + label),
    "--window-size=" + size, "--virtual-time-budget=8000",
    "--screenshot=" + out, fileUrl(page)
  ], label);
  console.log("  " + label + "  " + out + (fs.existsSync(out) ? "  (" + fs.statSync(out).size + " 字节)" : " 失败"));
}

/* 生成一份**真格式**的计分器存档文本（parseExport 认的是这个，不是裸 JSON）。
   照抄 app.js 的 `d(label,26)`：标签靠左、点线填充、末尾留一个空格再跟值。 */
function sampleExport(r, withTeam) {
  const d = (label, w) => {
    const out = "  " + label + " ";
    return out + ".".repeat(Math.max(1, w - label.length - 2)) + " ";
  };
  return [
    "==============================================================",
    "  黑流树海粥集杯#1 计分器 · 计分存档",
    "==============================================================",
    "导出时间：2026-09-23 22:10:00",
    "格式版本：1（导入时读取文件末尾 DATA: 开头的那一行）",
    "",
    "【选手】",
    d("选手名", 26) + r.name,
    "",
    "--------------------------------------------------------------",
    "【总分】",
    d("个人基础分", 26) + r.base,
    d("沉沦者倍率", 26) + "×" + r.multiplier,
    withTeam ? (d("团队得分", 26) + r.team) : null,
    d("总分", 26) + r.total,
    "==============================================================",
    "",
    "【源石锭】",
    d("消耗点数", 26) + r.yuan,
    "==============================================================",
    ""
  ].filter(l => l !== null).join("\n");
}

const SEED_INGEST = `
  var P = window.RANKING_PAGE;
  /* ⚠️ 队头的「剩余」= **计分器设置的决赛初始余额** − 已使用，基准是从计分器存档里读的；
     本机 Chrome 里可能真有一份（开发者用过计分器）→ 固定成 120，截图才不随环境变。 */
  localStorage.setItem(P.COUNTER_KEY, JSON.stringify({ yuanInitFinal: 120 }));
  var realFR = window.FileReader;
  window.FileReader = function(){
    var self = this;
    this.readAsText = function(f){ Promise.resolve().then(function(){ self.result = f.__text; self.onload(); }); };
  };
  var q = function(id){ return document.getElementById(id); };
  var feed = async function(rows, withTeam){
    for(var i = 0; i < rows.length; i++){
      P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], withTeam) }]);
      for(var k = 0; k < 30; k++) await Promise.resolve();
    }
  };
`;

// (a) 空态：页面原样打开
shot(`return 0;`, "空态", "_rank-empty.png", "1280,780");

// (b) 初赛有数据：走真实 ingest 路径灌 4 条（不是直接写 localStorage）
shot(`${SEED_INGEST}
  var rows = ${JSON.stringify([
    { name: "祁星",   base: 860, multiplier: 1.3, team: 360, yuan: 20,  total: 1478 },
    { name: "阿米娅", base: 640, multiplier: 1,   team: 160, yuan: 45,  total: 800  },
    { name: "诗怀雅", base: 490, multiplier: 1.3, team: 0,   yuan: 0,   total: 637  },
    { name: "博士",   base: 210, multiplier: 1,   team: 0,   yuan: 120, total: 210  }
  ])};
  return (async function(){
    await feed(rows, false);     // 初赛不拆团队分 → 不打印「团队得分」行
    return P.getData().list.length;
  })();
`, "初赛", "_rank-shot.png", "1280,880");

// (c) 决赛态：切到决赛 → 建两个队 → 把选手分别归队 + 留一个未分组，
//     用来目视确认「金色添加队伍在添加选手左侧」「队名**左侧有序次**、右上角是合计分」
//     「队伍按合计分降序排（近锋 4239 → 深海 1394 → 未分组 1380 沉底且不编号）」
//     「未分组大框是虚线边框」「成员行照常有名次」。
shot(`${SEED_INGEST}
  var rows = ${JSON.stringify([
    { name: "祁星",   base: 1450, multiplier: 1.3, team: 520, yuan: 30, total: 2405 },
    { name: "诗怀雅", base: 1180, multiplier: 1.3, team: 300, yuan: 60, total: 1834 },
    { name: "阿米娅", base: 760,  multiplier: 1,   team: 0,   yuan: 90, total: 760  },
    { name: "凯尔希", base: 980,  multiplier: 1.3, team: 120, yuan: 15, total: 1394 },
    { name: "陈",     base: 620,  multiplier: 1,   team: 0,   yuan: 0,  total: 620  }
  ])};
  var modeBtn = function(m){
    var bs = q("rank-modes").querySelectorAll(".rank-mode");
    for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === m) return bs[i];
    return null;
  };
  return (async function(){
    modeBtn("final").click();                       // ← 真点一下胶囊，切到决赛
    for(var k = 0; k < 30; k++) await Promise.resolve();
    P.addTeam("近锋最强队");                        // ← 走真接口建队（页面按钮走的是同一条路）
    P.addTeam("深海猎人");
    // 逐条归队：ingest 第二参 = 目标队伍，与「添加选手」弹框里选队伍是同一条路。
    // 前两条进「近锋最强队」，第 4 条进「深海猎人」，阿米娅/陈 不指定 → 落到「未分组」。
    for(var i = 0; i < rows.length; i++){
      var lg = i < 2 ? "近锋最强队" : (i === 3 ? "深海猎人" : "");
      P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], true) }], lg);
      for(var m = 0; m < 30; m++) await Promise.resolve();
    }
    /* 返回值会打进日志：顺带把**框的顺序 + 次序**写下来，肉眼可核对 */
    return P.currentMode() + "/" + P.getData().list.length + "/" +
      P.groupByTeam().map(function(g){ return g.name + "#" + g.idx + "=" + g.total; }).join("  ");
  })();
`, "决赛", "_rank-final.png", "1280,1180");

// (c2) 窄屏决赛态：680px 下队名左侧的次序格收紧到 20px，确认队名 / 人数 / 合计分不打架
shot(`${SEED_INGEST}
  var rows = ${JSON.stringify([
    { name: "祁星",   base: 1450, multiplier: 1.3, team: 520, yuan: 30, total: 2405 },
    { name: "诗怀雅", base: 1180, multiplier: 1.3, team: 300, yuan: 60, total: 1834 },
    { name: "阿米娅", base: 760,  multiplier: 1,   team: 0,   yuan: 90, total: 760  }
  ])};
  var modeBtn = function(m){
    var bs = q("rank-modes").querySelectorAll(".rank-mode");
    for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === m) return bs[i];
    return null;
  };
  return (async function(){
    modeBtn("final").click();
    for(var k = 0; k < 30; k++) await Promise.resolve();
    P.addTeam("近锋最强队");
    P.addTeam("深海猎人");
    for(var i = 0; i < rows.length; i++){
      var lg = i < 2 ? "近锋最强队" : "";
      P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], true) }], lg);
      for(var m = 0; m < 30; m++) await Promise.resolve();
    }
    return P.groupByTeam().map(function(g){ return g.name + "#" + g.idx; }).join("  ");
  })();
`, "窄屏决赛", "_rank-narrow.png", "680,1180");

// (d) 向左拖动唤出删除键：决赛态下在一行上向左拖，
//     截下来确认「删除键从行尾亮出来、没盖住总分」。
shot(`${SEED_INGEST}
  var rows = ${JSON.stringify([
    { name: "祁星",   base: 1450, multiplier: 1.3, team: 520, yuan: 30, total: 2405 },
    { name: "诗怀雅", base: 1180, multiplier: 1.3, team: 300, yuan: 60, total: 1834 },
    { name: "阿米娅", base: 760,  multiplier: 1,   team: 0,   yuan: 90, total: 760  }
  ])};
  return (async function(){
    /* ⚠️ 无头 Chrome 的虚拟时钟**不推进 CSS 过渡**：.rk-col 的 transform 带
       transition:.18s，松手归位时若不禁掉过渡，画面会**永远卡在拖走的位置**上
       （截图就成了一张错位图）。禁掉后量到/拍到的是终态。 */
    var st = document.createElement("style");
    st.textContent = "*, *::before, *::after{transition:none !important; animation:none !important;}";
    document.head.appendChild(st);
    var bs = q("rank-modes").querySelectorAll(".rank-mode");
    for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === "final") bs[i].click();
    for(var k = 0; k < 30; k++) await Promise.resolve();
    P.addTeam("近锋最强队");
    for(var i = 0; i < rows.length; i++){
      var lg = i < 2 ? "近锋最强队" : "";
      P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], true) }], lg);
      for(var m = 0; m < 30; m++) await Promise.resolve();
    }
    /* 在「诗怀雅」那一行（队内第 2 行）上向左拖 70px 唤出删除键 */
    var row = q("rank-list").querySelectorAll(".rank-row")[1];
    var cell = row.children[1];
    var rr = cell.getBoundingClientRect();
    var x = rr.left + 20, y = rr.top + rr.height / 2;
    var pev = function(type, tx, ty){
      return new PointerEvent(type, { bubbles: true, cancelable: true,
        pointerId: 3, button: 0, buttons: 1, clientX: tx, clientY: ty });
    };
    cell.dispatchEvent(pev("pointerdown", x, y));
    for(var n = 0; n < 5; n++) await Promise.resolve();
    document.dispatchEvent(pev("pointermove", x - 70, y));
    for(var n = 0; n < 5; n++) await Promise.resolve();
    document.dispatchEvent(pev("pointerup", x - 70, y));
    for(var n = 0; n < 10; n++) await Promise.resolve();
    return P.armedPlayer();
  })();
`, "删除键", "_rank-del.png", "1280,1180");

// (e) 纵向拖动入队「进行中」的那一帧：未分组的散人被抬起（虚线 + 淡出 + 跟着指针的小牌子），
//     指针所在的队伍框整体发绿光。用来目视确认「拖到哪个框、就进哪个队」。
shot(`${SEED_INGEST}
  var rows = ${JSON.stringify([
    { name: "祁星",   base: 1450, multiplier: 1.3, team: 520, yuan: 30, total: 2405 },
    { name: "诗怀雅", base: 1180, multiplier: 1.3, team: 300, yuan: 60, total: 1834 },
    { name: "凯尔希", base: 980,  multiplier: 1.3, team: 120, yuan: 15, total: 1394 },
    { name: "阿米娅", base: 760,  multiplier: 1,   team: 0,   yuan: 90, total: 760  },
    { name: "陈",     base: 620,  multiplier: 1,   team: 0,   yuan: 0,  total: 620  }
  ])};
  var modeBtn = function(m){
    var bs = q("rank-modes").querySelectorAll(".rank-mode");
    for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === m) return bs[i];
    return null;
  };
  var boxOf = function(name){
    var bs = q("rank-list").querySelectorAll(".team-box");
    for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-team") === name) return bs[i];
    return null;
  };
  return (async function(){
    var st = document.createElement("style");
    st.textContent = "*, *::before, *::after{transition:none !important; animation:none !important;}";
    document.head.appendChild(st);
    /* 截图要的是「拖动中」这一帧：把自动滚动停掉，免得页面在拍摄前滚走、把画面拍偏。
       （自动滚动本身在 [3h] 里单独验过。） */
    window.scrollBy = function(){};
    modeBtn("final").click();
    for(var k = 0; k < 30; k++) await Promise.resolve();
    P.addTeam("近锋最强队");
    P.addTeam("深海猎人");
    for(var i = 0; i < rows.length; i++){
      var lg = i < 2 ? "近锋最强队" : (i === 2 ? "深海猎人" : "");
      P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], true) }], lg);
      for(var m = 0; m < 30; m++) await Promise.resolve();
    }
    var loose = boxOf("未分组"), jia = boxOf("甲队") || boxOf("近锋最强队");
    var cell = loose.querySelector(".rank-row").children[1];
    var lr = loose.getBoundingClientRect(), jr = jia.getBoundingClientRect();
    var x  = Math.round(lr.left + lr.width / 2);
    var y0 = Math.round(lr.top + lr.height - 8);
    var yTo = Math.round(jr.top + jr.height / 2);
    var pev = function(t, tx, ty){
      return new PointerEvent(t, { bubbles: true, cancelable: true,
        pointerId: 3, button: 0, buttons: 1, clientX: tx, clientY: ty });
    };
    cell.dispatchEvent(pev("pointerdown", x, y0));                       // 按在散人那一行上
    for(var n = 0; n < 5; n++) await Promise.resolve();
    document.dispatchEvent(pev("pointermove", x, y0 - 30));              // 纵向 → 抬起
    for(var n = 0; n < 5; n++) await Promise.resolve();
    document.dispatchEvent(pev("pointermove", x, yTo));                  // 移到目标队伍框上
    for(var n = 0; n < 5; n++) await Promise.resolve();
    var g = document.querySelector(".rank-drag-ghost");
    return "拖到 " + P.dragTargetName() + " / 小牌子=" + (g ? g.textContent : "无");
  })();
`, "拖动入队", "_rank-drag.png", "1280,1600");

// (f) 双击队名改名的「编辑中」那一帧：队名位置变成输入框、右侧一个绿对勾，
//     队伍框描边由冠亚季的金/银/铜转成主题青（一眼看出「这个框正在被编辑」）。
shot(`${SEED_INGEST}
  var rows = ${JSON.stringify([
    { name: "祁星",   base: 1450, multiplier: 1.3, team: 520, yuan: 30, total: 2405 },
    { name: "诗怀雅", base: 1180, multiplier: 1.3, team: 300, yuan: 60, total: 1834 },
    { name: "凯尔希", base: 980,  multiplier: 1.3, team: 120, yuan: 15, total: 1394 },
    { name: "阿米娅", base: 760,  multiplier: 1,   team: 0,   yuan: 90, total: 760  },
    { name: "陈",     base: 620,  multiplier: 1,   team: 0,   yuan: 0,  total: 620  }
  ])};
  var boxOf = function(name){
    var bs = q("rank-list").querySelectorAll(".team-box");
    for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-team") === name) return bs[i];
    return null;
  };
  return (async function(){
    var st = document.createElement("style");
    st.textContent = "*, *::before, *::after{transition:none !important; animation:none !important;}";
    document.head.appendChild(st);
    var bs = q("rank-modes").querySelectorAll(".rank-mode");
    for(var i = 0; i < bs.length; i++) if(bs[i].getAttribute("data-mode") === "final") bs[i].click();
    for(var k = 0; k < 30; k++) await Promise.resolve();
    P.addTeam("深海猎人");
    P.addTeam("近锋最强队");
    for(var i = 0; i < rows.length; i++){
      var lg = i < 3 ? "近锋最强队" : (i === 3 ? "深海猎人" : "");
      P.ingest([{ name: (rows[i].name + ".txt"), __text: window.__mkTxt(rows[i], true) }], lg);
      for(var m = 0; m < 30; m++) await Promise.resolve();
    }
    var nm = boxOf("近锋最强队").querySelector(".team-name");
    nm.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
    for(var n = 0; n < 10; n++) await Promise.resolve();
    var inp = boxOf("近锋最强队").querySelector(".team-name-input");
    if(inp){ inp.value = "近锋最强队（改）"; }
    for(var n2 = 0; n2 < 10; n2++) await Promise.resolve();
    return "编辑态=" + P.renameActive() + " 输入框=" + (inp ? inp.value : "无") +
      " 对勾=" + (boxOf("近锋最强队") ? boxOf("近锋最强队").querySelector(".team-rename-ok").textContent : "无");
  })();
`, "改名", "_rank-rename.png", "1280,1300");

console.log("\n" + (bad ? "有 " + bad + " 项不符（共 " + total + " 项）" : "全部通过（共 " + total + " 项）"));

/* 清理探针页与浏览器临时 profile —— 只留最终截图供人查看。
   （index.html / ranking.html 本身从未被修改，探针页在 _test/_e2e/ 下另建。）
   ⚠️ Chrome 退出后还会往 profile 目录里补写几个文件，所以删两轮并留一点间隔。 */
try {
  for (let pass = 0; pass < 3 && fs.existsSync(OUT); pass++) {
    fs.readdirSync(OUT).forEach(f => {
      const p = path.join(OUT, f);
      try {
        if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
        else fs.unlinkSync(p);
      } catch (e) { /* 下一轮再试 */ }
    });
    if (fs.existsSync(OUT)) {
      try { fs.rmdirSync(OUT); } catch (e) { /* 还有没删干净的子文件 */ }
    }
  }
  console.log(fs.existsSync(OUT) ? "⚠️ _test/_e2e/ 里有浏览器残留，可手工删" : "已清理 _test/_e2e/");
} catch (e) { console.log("清理 _test/_e2e/ 失败（可手工删）：", e.message); }

process.exit(bad ? 1 : 0);
