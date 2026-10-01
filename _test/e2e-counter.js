/* 计分器首页（index.html）的真 Chrome 验证：几何测量 + 视觉截图。
   用法： node _test/e2e-counter.js

   为什么需要它：单测跑的是「最小 DOM 桩」，桩里**没有 css**，
   所以「齿轮是不是真贴在标题行右端」「弹框到底关不关得掉」这类问题它答不了 ——
   必须让真浏览器渲染一遍、拿 getComputedStyle / getBoundingClientRect 说事。

   本次覆盖 2026-09-25 新增的「源石锭余额设置弹框」。 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_e2e_counter");
/* ⚠️ 开跑前清掉上次的临时目录：浏览器 profile 就建在里面，
   残留的 localStorage 会让「初始余额应为 60」这类断言假失败。 */
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
const esc = s => JSON.stringify(String(s));

/* ⚠️ 不能用 execFileSync 收 stdout：本机 Chrome 在沙箱里 EBUSY。
   改成 spawnSync + 把 stdout/stderr 重定向到文件再读回来。 */
function chrome(args, label) {
  const optFile = path.join(OUT, "_out_" + label + ".txt");
  const fd = fs.openSync(optFile, "w");
  const r = spawnSync(CHROME, args, { stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  if (r.error) { console.error("启动浏览器失败:", r.error.message); process.exit(1); }
  return fs.readFileSync(optFile, "utf8");
}

/* 把真实的 index.html 的 <body> 整段抄进探针页，再挂上真实 app.js ——
   这样量到的是**真实页面**的布局，而不是另写一份仿真标记。
   ⚠️ `<base href="../../">`：探针页在 _test/_e2e_counter/ 下，
      不设 base 的话 index.html 里的 `img/...` 相对路径会全部找不到。 */
function buildPage(extra, label, extraHead) {
  const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const inner = src.slice(src.indexOf("<body>") + 6, src.lastIndexOf("</body>"))
                   .replace(/<script[\s\S]*?<\/script>/g, "");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<base href="../../">
<link rel="stylesheet" href="css/style.css">
<style id="no-anim">/* 无头浏览器的虚拟时钟不推进 css 动画/过渡：
   不禁掉的话，弹框卡片会僵在 modalIn 的起始帧（透明 + 缩小 + 上移 8px），
   量出来的几何和截出来的图都是错的。 */
*{animation:none!important;transition:none!important}</style>
${extraHead || ""}
</head><body>
${inner}
<script src="js/app.js"></script>
<script>
${extra}
<\/script></body></html>`;
}

/* 探针：跑完把结果 base64 塞进 <pre id="probe-out">，再 --dump-dom 取回来
   （base64 是为了躲开控制台编码，中文直接吐会变乱码）。 */
function runProbe(script, label) {
  const page = path.join(OUT, "_probe_" + label + ".html");
  fs.writeFileSync(page, buildPage(`
window.__ERR = [];
window.onerror = function(m){ window.__ERR.push(String(m)); };
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
}`, label).replace("<body>", '<body><pre id="probe-out" style="display:none">PENDING</pre>'), "utf8");

  const dom = chrome([
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--user-data-dir=" + path.join(OUT, "_ud_" + label),
    "--virtual-time-budget=15000",
    "--dump-dom", fileUrl(page)
  ], label);

  const m = /<pre id="probe-out"[^>]*>([A-Za-z0-9+/=]*)<\/pre>/.exec(dom);
  if (!m || !m[1] || m[1] === "PENDING") {
    console.error("探针没吐出结果。原始 DOM 片段：");
    const i = dom.indexOf("probe-out");
    console.error(dom.slice(Math.max(0, i - 200), i + 400));
    process.exit(1);
  }
  return JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
}

function shot(script, label, name, size) {
  const out = path.join(__dirname, name);
  const page = path.join(OUT, "_shot_" + label + ".html");
  fs.writeFileSync(page, buildPage(`
try { Promise.resolve((function(){ ${script} })()).then(function(out){
  document.body.setAttribute("data-shot-ready", "1");
  document.body.setAttribute("data-shot-out", String(out));
}); } catch(e){ document.body.setAttribute("data-shot-err", String(e)); }`, label), "utf8");
  chrome([
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--user-data-dir=" + path.join(OUT, "_ud_" + label),
    "--window-size=" + size, "--virtual-time-budget=8000",
    "--screenshot=" + out, fileUrl(page)
  ], label);
  console.log("  " + label + "  " + out +
    (fs.existsSync(out) ? "  (" + fs.statSync(out).size + " 字节)" : " 失败"));
}

let bad = 0, total = 0;
function chk(cond, label) {
  total++;
  if (!cond) bad++;
  console.log((cond ? "  OK   " : "  FAIL ") + label);
}

/* ---------------- ① 几何与样式：齿轮真的贴在标题行右端吗 ---------------- */
console.log("\n[1] 齿轮按钮的几何与样式（真渲染）…");
const geo = runProbe(`
  var B = window.BFC, S = B.state;
  var panel = document.querySelector("#layout section.panel.warn");
  if(!panel) return {fatal:"找不到源石锭面板（.panel.warn）"};
  var h2    = panel.querySelector("h2");
  var gear  = document.getElementById("btn-yuan-settings");
  var modal = document.getElementById("yuan-modal");
  var pIn   = document.getElementById("yuan-init-prelim");
  var fIn   = document.getElementById("yuan-init-final");
  var applyB= document.getElementById("yuan-modal-apply");
  var cancelB = document.getElementById("yuan-modal-cancel");
  if(!h2 || !gear || !modal) return {fatal:"齿轮 / 弹框元素缺一个"};

  var cs = function(el, p){ return getComputedStyle(el)[p]; };
  var rect = function(el){ var b = el.getBoundingClientRect();
    return {l:Math.round(b.left), r:Math.round(b.right), t:Math.round(b.top),
            w:Math.round(b.width), h:Math.round(b.height)}; };

  var out = {};
  out.titleText = (h2.textContent || "").trim();
  out.h2Display = cs(h2, "display");
  out.gearMarginLeft = cs(gear, "marginLeft");
  out.gearCursor = cs(gear, "cursor");
  out.gearColor = cs(gear, "color");
  out.gearBg = cs(gear, "backgroundColor");
  out.gearSvg = !!gear.querySelector("svg");
  out.gearChars = (gear.textContent || "").trim();     // 应为空：图标是 SVG，不是字符
  out.h2Rect = rect(h2);
  out.gearRect = rect(gear);
  /* 关键：齿轮右边缘距标题行右边缘多远（margin-left:auto 的成效） */
  out.gearRightGap = Math.round(h2.getBoundingClientRect().right - gear.getBoundingClientRect().right);
  /* 齿轮必须在标题文字右侧 */
  var svgRect = gear.querySelector("svg") ? gear.querySelector("svg").getBoundingClientRect() : null;
  out.gearAfterDot = svgRect ? svgRect.left > h2.getBoundingClientRect().left : false;

  // 弹框初始
  out.modalHidden = modal.hidden;
  out.modalDisplay = cs(modal, "display");             // 必须 none
  out.modalPosition = cs(modal, "position");

  // 打开
  gear.click();
  out.openHidden = modal.hidden;
  out.openDisplay = cs(modal, "display");              // 应 flex
  out.pInValue = pIn.value;
  out.fInValue = fIn.value;
  var card = modal.querySelector(".modal-card");
  out.cardRect = rect(card);
  var cb = card.getBoundingClientRect();
  /* ⚠️ 居中参照必须是**可用视口** documentElement.clientWidth/Height。
     window.innerWidth 把滚动条也算进去了，本项目滚动条 10px → 中心会假偏 5px。
     （这条一开始就是踩出来的：按 innerWidth 量出来「卡片偏左 5px」。） */
  out.viewport = [document.documentElement.clientWidth, document.documentElement.clientHeight];
  out.innerSize = [window.innerWidth, window.innerHeight];
  out.cardCenterDX = Math.round((cb.left + cb.right) / 2 - document.documentElement.clientWidth / 2);
  out.cardCenterDY = Math.round((cb.top + cb.bottom) / 2 - document.documentElement.clientHeight / 2);
  out.btns = Array.prototype.map.call(modal.querySelectorAll(".modal-btns .big-btn"),
             function(b){ return (b.textContent || "").trim(); });
  out.applyBg = cs(applyB, "backgroundColor");
  out.changeField = cs(document.querySelector("#yuan-modal .modal-input"), "color");
  // 点卡片内部不该关
  card.click();
  out.afterCardClickHidden = modal.hidden;

  // 改值 → 应用
  pIn.value = "80"; fIn.value = "150";
  applyB.click();
  out.applied = [S.yuanInitPrelim, S.yuanInitFinal];
  out.appliedHidden = modal.hidden;
  out.appliedDisplay = cs(modal, "display");           // 应 none
  out.prelimBalText = (document.getElementById("yuan-prelim-bal") || {}).textContent;
  S.yuanMode = "final"; B.updateUI();
  out.finalInitText = (document.getElementById("yuan-init") || {}).textContent;
  out.finalIsVisible = !document.getElementById("yuan-final").hidden;

  // 取消：重开 → 点取消 → 一个字不改
  S.yuanMode = "prelim"; B.updateUI();
  gear.click();
  out.reopened = modal.hidden === false;
  pIn.value = "3"; fIn.value = "4";
  cancelB.click();
  out.afterCancel = [S.yuanInitPrelim, S.yuanInitFinal];
  out.cancelDisplay = cs(modal, "display");            // 应 none ← 这一条就在验证 [hidden] 规则生效

  // Esc
  gear.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  out.escHidden = modal.hidden;
  out.escDisplay = cs(modal, "display");

  // 回车 = 应用
  gear.click();
  pIn.value = "70"; fIn.value = "130";
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  out.enterApplied = [S.yuanInitPrelim, S.yuanInitFinal];
  out.enterHidden = modal.hidden;

  // 点遮罩关闭
  gear.click();
  modal.click();                                       // target 就是遮罩本身
  out.overlayClickHidden = modal.hidden;
  out.overlayClickDisplay = cs(modal, "display");

  // 收尾：恢复默认，免得截图页继承奇怪的值
  S.yuanInitPrelim = B.YUAN_INIT_PRELIM; S.yuanInitFinal = B.YUAN_INIT_FINAL; B.updateUI();
  out.err = window.__ERR;
  return out;
`, "geo");

if (geo.fatal) { console.error("探针炸了:", geo.fatal); process.exit(1); }

chk(geo.titleText === "源石锭", "源石锭面板标题文字是对的（" + geo.titleText + "）");
chk(geo.h2Display === "flex", "标题仍是 flex 容器（齿轮靠它排版）");
chk(geo.gearSvg === true, "齿轮图标是内联 SVG（不是 ⚙ 字符）");
chk(geo.gearChars === "", "…所以按钮里没有文字节点");
chk(parseFloat(geo.gearMarginLeft) > 0,
    "margin-left:auto 生效（flex 把它撑成了实际距离 " + geo.gearMarginLeft +
    " —— ⚠️ getComputedStyle 对 auto 边距返回的是 used value 而非字符串 \"auto\"）");
chk(geo.gearRightGap <= 2, "齿轮右边缘贴着标题行右端（差 " + geo.gearRightGap + "px）");
chk(geo.gearAfterDot === true, "齿轮在标题文字的右侧");
chk(geo.gearRect.w >= 18 && geo.gearRect.h >= 18,
    "齿轮有可点面积（" + geo.gearRect.w + "×" + geo.gearRect.h + "）");
chk(geo.gearCursor === "pointer", "齿轮光标是手型");
chk(geo.h2Rect.h >= geo.gearRect.h, "齿轮不会把标题行撑高（标题行高 " + geo.h2Rect.h + " ≥ 齿轮 " + geo.gearRect.h + "）");

chk(geo.modalHidden === true, "弹框初始 hidden");
chk(geo.modalDisplay === "none", "⚠️ 初始 display 就是 none —— 这条在验证 .modal-overlay[hidden] 真的生效，否则弹框会一直挂在屏幕上");
chk(geo.modalPosition === "fixed", "弹框是 fixed 全屏遮罩");

chk(geo.openHidden === false, "点齿轮 → 弹框打开");
chk(geo.openDisplay === "flex", "…display 变 flex（遮罩铺满并居中卡片）");
chk(geo.pInValue === "60", "初赛输入框预填当前值 60");
chk(geo.fInValue === "120", "决赛输入框预填当前值 120");
chk(Math.abs(geo.cardCenterDX) <= 1,
    "卡片水平居中（偏移 " + geo.cardCenterDX + "px；参照可用视口 " + geo.viewport[0] +
    " 而非 window.innerWidth " + geo.innerSize[0] + " —— 后者含 10px 滚动条，会假偏 5px）");
chk(Math.abs(geo.cardCenterDY) <= 1, "卡片垂直居中（偏移 " + geo.cardCenterDY + "px）");
chk(JSON.stringify(geo.btns) === JSON.stringify(["应用", "取消"]),
    "卡片下方两个按键就是「应用」「取消」（实测 " + geo.btns.join(" / ") + "）");
chk(/^rgba?\(0, ?255, ?163/.test(geo.applyBg), "「应用」是绿色主按钮（实测底色 " + geo.applyBg + "）");
chk(geo.afterCardClickHidden === false, "点卡片内部不会关（只有点遮罩才关）");

chk(JSON.stringify(geo.applied) === JSON.stringify([80, 150]),
    "点「应用」→ 两个余额写回 state（" + geo.applied.join(" / ") + "）");
chk(geo.appliedHidden === true && geo.appliedDisplay === "none", "…弹框随即关闭");
chk(geo.prelimBalText === "80", "初赛面板上的「源石锭余额」真渲染成 80");
chk(geo.finalInitText === "150", "切到决赛，初始余额真渲染成 150");
chk(geo.finalIsVisible === true, "…决赛区也真的展开了");

chk(geo.reopened === true, "重开弹框");
chk(JSON.stringify(geo.afterCancel) === JSON.stringify([80, 150]), "点「取消」一个字不改");
chk(geo.cancelDisplay === "none", "…并且弹框真的消失了");
chk(geo.escHidden === true && geo.escDisplay === "none", "Esc 也能关掉弹框");
chk(JSON.stringify(geo.enterApplied) === JSON.stringify([70, 130]), "回车等同「应用」");
chk(geo.enterHidden === true, "…并且随即关框");
chk(geo.overlayClickHidden === true && geo.overlayClickDisplay === "none", "点遮罩空白处关掉弹框");
chk((geo.err || []).length === 0, "整个过程页面无 JS 报错" + (geo.err && geo.err.length ? "：" + geo.err.join(" | ") : ""));

/* ---------------- ② 页脚署名：三个外链真渲染出来是什么样 ---------------- */
/* 2026-09-26 协同开发加了第三位「祁星qimstar」。桩里量不到的是三件真事：
   ① 三行署名里那一行会不会被挤到换行；② 第二位与第三位之间那个分隔是不是**真的一个全角空格**
   （U+3000 的宽度 = 1em = 字号，半角空格只有它 1/4 —— 宽度一量就知道有没有写错字符，
   而静态断言只能证明源码里是 U+3000、证明不了它渲染成多宽）；③ 外链有没有把版心撑破。 */
console.log("\n[2] 页脚署名的真渲染 …");
const foot = runProbe(`
  var foot = document.querySelector("footer.page-footer");
  if(!foot) return {fatal:"找不到页脚 .page-footer"};
  var cs = function(el, p){ return getComputedStyle(el)[p]; };
  var rect = function(el){ var b = el.getBoundingClientRect();
    return {l:b.left, t:b.top, r:b.right, b:b.bottom, w:b.width, h:b.height}; };
  var links = Array.prototype.slice.call(foot.querySelectorAll("a"));
  var wrap = document.querySelector(".wrapper") || document.body;
  return {
    count: links.length,
    texts: links.map(function(a){ return a.textContent; }),
    hrefs: links.map(function(a){ return a.getAttribute("href"); }),
    targets: links.map(function(a){ return a.getAttribute("target"); }),
    rels: links.map(function(a){ return a.getAttribute("rel"); }),
    rs: links.map(rect),
    font: cs(foot, "fontSize"),
    align: cs(foot, "textAlign"),
    color: cs(foot, "color"),
    linkDecoration: cs(links[0], "textDecorationLine"),
    footRect: rect(foot),
    wrapRect: rect(wrap),
    scrollW: foot.scrollWidth,
    clientW: foot.clientWidth,
    err: window.__ERR
  };
`, "foot");

if (foot.fatal) { console.error("探针炸了:", foot.fatal); process.exit(1); }

chk(foot.count === 3, "页脚真渲染出三个外链（实测 " + foot.count + " 个）");
chk(JSON.stringify(foot.texts) === JSON.stringify(["拾柒ACTV", "WorkBuddy", "祁星qimstar"]),
    "三位署名顺序是 拾柒ACTV / WorkBuddy / 祁星qimstar（实测 " + foot.texts.join(" / ") + "）");
chk(foot.hrefs[2] === "https://space.bilibili.com/11417698",
    "第三位指向 B 站空间 11417698（实测 " + foot.hrefs[2] + "）");
chk(JSON.stringify(foot.targets) === JSON.stringify(["_blank", "_blank", "_blank"]),
    "三个外链都是新标签打开");
chk(JSON.stringify(foot.rels) === JSON.stringify(
      ["noopener noreferrer", "noopener noreferrer", "noopener noreferrer"]),
    "三个外链都带 rel=noopener noreferrer");
chk(foot.rs.every(t => t.w > 0 && t.h > 0), "三个外链都真的渲染出面积（不是零宽 / 被藏起来）");

/* 三行署名：各自一行。用「每行第一个链接的 top」比 —— 不能用整块的 lineCount，
   因为它数的是 <footer> 自己的行盒数，跟 <a> 是不是被挤下去无关。 */
{
  const tops = foot.rs.map(t => Math.round(t.t));
  chk(tops.every(t => Math.abs(t - tops[0]) <= 1),
      "三个外链在同一行（top 实测 " + tops.join(" / ") + "）—— 加第三位没把它挤到第二行");
}
chk(foot.rs[2].l >= foot.rs[1].r - 0.5,
    "第三位排在第二位右侧、不重叠（间隙 " + (foot.rs[2].l - foot.rs[1].r).toFixed(1) + "px）");

/* 分隔符宽度 = 全角空格宽度 = 1em。半角空格只有 0.25em 左右，一量就能区分。 */
{
  const gap = foot.rs[2].l - foot.rs[1].r;
  const em  = parseFloat(foot.font);
  chk(Math.abs(gap - em) <= 2,
      "两位协同开发者之间是**一个全角空格**（实测 " + gap.toFixed(1) +
      "px ≈ 字号 " + em + "px；半角空格会只有约 " + (em / 4).toFixed(1) + "px）");
}
chk(foot.align === "center", "页脚整块居中（text-align 实测 " + foot.align + "）");
chk(foot.scrollW <= foot.clientW + 1,
    "页脚内容没撑破版心（scrollWidth " + foot.scrollW + " ≤ clientWidth " + foot.clientW + "）");
chk(foot.rs[2].r <= foot.wrapRect.r + 1,
    "第三位右边缘没越过 .wrapper（" + foot.rs[2].r.toFixed(1) + " ≤ " +
    foot.wrapRect.r.toFixed(1) + "）");
chk(foot.linkDecoration.indexOf("none") > -1,
    "链接仍无下划线（改用虚线下边框，实测 " + foot.linkDecoration + "）");
chk((foot.err || []).length === 0,
    "页脚渲染过程无 JS 报错" + (foot.err && foot.err.length ? "：" + foot.err.join(" | ") : ""));

/* ---------------- ③ 截图 ---------------- */
console.log("\n[3] 截图 …");

shot(`
  var B = window.BFC;
  B.updateUI();
  /* 只留源石锭面板：3 栏布局下它排在第 2 栏中部，直接整页截会被别的面板挤到画面外。
     把其余面板 + 头图 + 规则面板一并收起，它自然升到最前，齿轮在标题行右端才看得清。
     （⚠️ 不调 syncColumns()：全部隐藏后面板高度都是 0，交给 grid 自己上移就行。） */
  var p = document.querySelector("#layout section.panel.warn");
  [ "header.header", ".rules-panel", ".total-panel", "footer.page-footer" ]
    .forEach(function(sel){ var e = document.querySelector(sel); if(e) e.style.display = "none"; });
  /* ⚠️ 用后代选择器（#layout 下的 section.panel），不要用直接子元素选择器：
     syncColumns() 运行时会建出栏容器、把面板搬进去，面板已不是 #layout 的直接子元素。 */
  Array.prototype.forEach.call(document.querySelectorAll("#layout section.panel"), function(s){
    if(s !== p) s.style.display = "none";
  });
  window.scrollTo(0, 0);
  return "gear";
`, "gear", "_yuan-gear.png", "900,600");

shot(`
  var B = window.BFC;
  B.updateUI();
  var gear = document.getElementById("btn-yuan-settings");
  var pIn = document.getElementById("yuan-init-prelim");
  var fIn = document.getElementById("yuan-init-final");
  gear.click();
  pIn.value = "80"; fIn.value = "150";     // 拍一张「正在改」的样子
  return "modal";
`, "modal", "_yuan-modal.png", "1400,900");

/* 页脚署名（2026-09-26 加第三位协同开发者）：页脚在整页最底下，
   上面全部收起后它自己升到最前，才截得到清晰的一行。 */
shot(`
  /* ⚠️ 不调 syncColumns()：面板全隐藏后高度都是 0，交给网格自己上移即可。 */
  [ "header.header", ".rules-panel", "#layout", ".total-panel" ]
    .forEach(function(sel){ var e = document.querySelector(sel); if(e) e.style.display = "none"; });
  window.scrollTo(0, 0);
  return "footer";
`, "footshot", "_footer.png", "900,150");

console.log("\n" + (bad ? "有 " + bad + " 项不符（共 " + total + " 项）" : "全部通过（共 " + total + " 项）"));

/* 跑完把临时目录整个删掉（探针页 / 截图页 / 浏览器 profile 全在里面）——
   留着会让下次跑的「初始余额应为 60」类断言被残留 localStorage 带偏，也把仓库弄脏。 */
try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* 删不掉就算了，下次开头还会清 */ }
process.exit(bad ? 1 : 0);
