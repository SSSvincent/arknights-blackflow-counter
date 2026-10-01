/* 分栏调参用的一次性脚本（不属于回归测试，test.js 不依赖它）：
   拿实测的 9 块面板高度，穷举 3^9 种分栏方案，输出
   「阅读顺序逆序对 → 可达到的最小栏高极差」的权衡曲线，
   用来决定 js/app.js 里 ORDER_WEIGHT（每打乱一对阅读顺序 = 愿意多忍受多少 px 高度差）。
   重新调参时：先用无头 Chrome 量出 heights，再改下面的 H 跑一遍。
   2026-09-20 实测结论：保持阅读顺序（逆序对 0）时极差 181px 已是代价最低的方案；
   想压到 56px 要乱序 5 处、压到 21px 要乱序 12 处，得不偿失 → ORDER_WEIGHT 维持 45。 */
const H = [111, 207, 659, 283, 367, 174, 243, 420, 133];   // 三栏实测高度
const GAP = 10, N = 3;

function inv(assign, m) {
  const seq = [];
  for (let c = 0; c < N; c++) for (let i = 0; i < m; i++) if (assign[i] === c) seq.push(i);
  let n = 0;
  for (let a = 0; a < seq.length; a++) for (let b = a + 1; b < seq.length; b++) if (seq[a] > seq[b]) n++;
  return n;
}

const best = {};   // inv -> [diff, assign]
const total = Math.pow(N, H.length);
for (let mask = 0; mask < total; mask++) {
  const sums = [0, 0, 0], assign = [];
  let x = mask;
  for (let i = 0; i < H.length; i++) { const c = x % N; x = (x - c) / N; assign.push(c); sums[c] += H[i] + GAP; }
  if (assign[0] !== 0) continue;
  if (sums.some(s => s === 0)) continue;
  const diff = Math.max(...sums) - Math.min(...sums);
  const k = inv(assign, H.length);
  if (!best[k] || diff < best[k][0]) best[k] = [diff, assign.slice(), sums.slice()];
}

console.log("逆序对 | 最小极差 | 分栏（栏1 | 栏2 | 栏3）");
const NAMES = ["选手", "临时招募", "关卡通关", "通关时长", "源石锭", "违规扣分", "特敌", "藏品路线", "商店"];
Object.keys(best).map(Number).sort((a, b) => a - b).forEach(k => {
  const [d, a] = best[k];
  const cols = [[], [], []];
  a.forEach((c, i) => cols[c].push(NAMES[i]));
  console.log(String(k).padStart(5) + "  | " + String(d).padStart(6) + "  | " + cols.map(c => c.join("+")).join("  |  "));
});
console.log("\n当前 ORDER_WEIGHT=45 的选择：");
Object.keys(best).map(Number).forEach(k => {
  const [d] = best[k];
  console.log("  inv=" + k + " → cost=" + (d + k * 45) + " (diff " + d + " + inv " + k + "×45)");
});
