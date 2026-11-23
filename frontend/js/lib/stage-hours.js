/* lib/stage-hours · 阶段工时口径（无 DOM、无请求）
   只有测试有真实阶段数据：测试窗口（提测 → 测试结束）内的计时归「测试」。
   剩余计时按工作项类型拆：需求类（story）归「产品 / 设计」，任务 / 缺陷归「开发」。
   先扣测试再拆剩余，三段互不重叠，合计始终等于实际工时；史诗只做分组，不参与工时。 */

export var STAGE_META = [
  { key:"product", name:"产品 / 设计", note:"需求类工作项的计时（含分析、评审跟进）", color:"var(--plum)" },
  { key:"dev", name:"开发", note:"任务 / 缺陷在测试窗口外的计时", color:"var(--primary)" },
  { key:"test", name:"测试", note:"测试窗口内的计时", color:"var(--palette-6)" }
];

export function stageEpic(t){ return !!t && t.itemType === "epic"; }
export function stageActualOf(t){
  var total = Math.max(0, Number(t && t.totalMinutes) || 0);
  var test = Math.min(total, Math.max(0, Number(t && t.testMinutes) || 0));
  var rest = Math.max(0, total - test);
  if(t && t.itemType === "story") return { product:rest, dev:0, test:test };
  return { product:0, dev:rest, test:test };
}
export function stageEstimateOf(t){
  var est = Math.max(0, Number(t && t.estimateMinutes) || 0);
  var test = Math.max(0, Number(t && t.testEstimateMinutes) || 0);
  if(t && t.itemType === "story") return { product:est, dev:0, test:test };
  return { product:0, dev:est, test:test };
}
/* 需求类工作项有人计时就算产品投入；任务 / 缺陷同理归开发。
   测试按窗口内分钟判断，不按类型。 */
export function summarizeStages(tasks){
  var s = {
    items:0, timed:0, estimated:0, unestimated:0,
    count:{ product:0, dev:0, test:0 },
    est:{ product:0, dev:0, test:0 },
    act:{ product:0, dev:0, test:0 }
  };
  (tasks || []).forEach(function(t){
    if(stageEpic(t)) return;
    var e = stageEstimateOf(t), a = stageActualOf(t);
    s.items++;
    if(Number(t && t.totalMinutes) > 0) s.timed++;
    if(e.product + e.dev + e.test > 0) s.estimated++; else s.unestimated++;
    s.est.product += e.product; s.est.dev += e.dev; s.est.test += e.test;
    s.act.product += a.product; s.act.dev += a.dev; s.act.test += a.test;
    /* 条目不可相加：同一工作项可能同时出现在多个阶段，阶段条目各自计数 */
    if(a.product > 0) s.count.product++;
    if(a.dev > 0) s.count.dev++;
    if(a.test > 0) s.count.test++;
  });
  s.estTotal = s.est.product + s.est.dev + s.est.test;
  s.actTotal = s.act.product + s.act.dev + s.act.test;
  return s;
}
/* 阶段明细：只取该阶段有实际计时的工作项，史诗不出现 */
export function stageTasksOf(tasks, key){
  return (tasks || []).filter(function(t){
    return !stageEpic(t) && stageActualOf(t)[key] > 0;
  });
}
