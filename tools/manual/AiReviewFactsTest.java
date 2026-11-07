import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.ReviewResponse;
import com.hourglass.entity.Task;

import java.lang.reflect.Method;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * AiReviewService 的纯函数口径单测（不起 Spring、不连数据库）。
 *
 * <p>编不过/用不起来时的跑法（Windows，注意 classpath 用分号、路径别用 /tmp）：
 * <pre>
 *   mvn -q dependency:build-classpath -Dmdep.outputFile=target/cp.txt
 *   javac -encoding UTF-8 -cp "target/classes;$(cat target/cp.txt)" -d target/tools tools/manual/AiReviewFactsTest.java
 *   java -cp "target/classes;target/tools;$(cat target/cp.txt)" AiReviewFactsTest
 * </pre>
 *
 * <p>测的是两件最容易悄悄错的事：**事实清单漏了哪些字段**、**输出清洗会不会吃掉正文**。
 */
public class AiReviewFactsTest {

    private static int pass = 0, fail = 0;

    public static void main(String[] args) throws Exception {
        testFacts();
        testFactsEmptyLists();
        testCleanFence();
        testCleanPreamble();
        testCleanKeepsHeadings();
        System.out.println("\n" + pass + " 通过 / " + fail + " 失败");
        if (fail > 0) {
            System.exit(1);
        }
    }

    /* 反射调用包内方法：不想给生产类开 public 口子，也不想为测试加依赖 */
    private static String callBuildFacts(ReviewResponse d, String note) throws Exception {
        Class<?> c = Class.forName("com.hourglass.service.AiReviewService");
        Object svc = alloc(c);
        Method m = c.getDeclaredMethod("buildFacts", ReviewResponse.class, String.class);
        m.setAccessible(true);
        return (String) m.invoke(svc, d, note);
    }

    private static String callClean(String s) throws Exception {
        Class<?> c = Class.forName("com.hourglass.service.AiReviewService");
        Method m = c.getDeclaredMethod("clean", String.class);
        m.setAccessible(true);
        return (String) m.invoke(null, s);
    }

    /** 无参构造（Spring 用的是带参的，但字段都没初始化，纯函数用不到） */
    private static Object alloc(Class<?> c) throws Exception {
        java.lang.reflect.Constructor<?> k = c.getDeclaredConstructor(
                Class.forName("com.hourglass.service.ReviewService"),
                Class.forName("com.hourglass.service.AiConfigService"),
                Class.forName("com.hourglass.common.AiClient"));
        k.setAccessible(true);
        return k.newInstance(null, null, null);
    }

    private static void testFacts() throws Exception {
        ReviewResponse d = new ReviewResponse();
        d.setWeekOffset(-1);
        d.setLabel("上周");
        d.setWeekStart("2026-10-19");
        d.setWeekEnd("2026-10-25");

        ReviewResponse.Stats s = new ReviewResponse.Stats();
        s.setDone(2);
        s.setWithDue(2);
        s.setOnTime(1);
        s.setLate(1);
        s.setOnTimeRate(50);
        s.setMembers(2);
        d.setStats(s);

        Task a = task("重构权限校验中间件", "后端", "我", "2026-10-21", "2026-10-20");
        Task b = task("导出 CSV 补工时列", "前端", "小王", "2026-10-23", null);
        d.setCompleted(new ArrayList<Task>(Arrays.asList(a, b)));

        Task p = task("结算改造-对账口径", "后端", "我", null, null);
        p.setProgress(60);
        d.setProgressTasks(new ArrayList<Task>(Arrays.asList(p)));

        Task pend = task("归档任务异常重试", "后端", "我", null, null);
        pend.setProgress(100);
        d.setPendingDone(new ArrayList<Task>(Arrays.asList(pend)));

        ReqProgress r = new ReqProgress();
        r.setName("流程引擎");
        r.setProgressPct(62);
        r.setTaskCount(4);
        r.setDoneCount(2);
        d.setReqDist(new ArrayList<ReqProgress>(Arrays.asList(r)));

        ReviewResponse.MemberStat m1 = member("我", 2);
        ReviewResponse.MemberStat m2 = member("小王", 1);
        d.setMembers(new ArrayList<ReviewResponse.MemberStat>(Arrays.asList(m1, m2)));

        ReviewResponse.WorkMinutes w = new ReviewResponse.WorkMinutes();
        w.setSpaceWeek(705);
        w.setMine(1255);
        d.setWorkMinutes(w);
        d.setDoing(2);
        d.setBacklog(8);
        d.setOpenP0(10);
        com.hourglass.dto.BoardResponse.Counts c = new com.hourglass.dto.BoardResponse.Counts();
        c.setOver(3);
        c.setToday(1);
        d.setCounts(c);

        StringBuilder note = new StringBuilder();
        for (int i = 0; i < 100; i++) {
            note.append("线上排查");   /* 400 字 → 服务端应截到 200 字（"线上排查" 4 字 = 50 段） */
        }
        String facts = callBuildFacts(d, note.toString());

        ok(facts.contains("周期：上周（10-19 — 10-25）"), "周期行用 MM-dd 且带周标签", head(facts));
        ok(facts.contains("完成 2 项") && facts.contains("按期率 50%"), "统计行带完成数与按期率");
        ok(facts.contains("有截止日期 2 项、延期 1 项"), "有截止日期时才写延期");
        ok(facts.contains("；逾期 3 项、今日到期 1 项"), "逾期/今日到期来自 counts");
        ok(facts.contains("P0 未关闭 10 项"), "P0 未关闭带上");
        ok(facts.contains("本周期全空间 11.8 小时"), "工时换成小时", facts.contains("11.8") ? "11.8h" : "");
        ok(facts.contains("已完成（共 2 项）"), "已完成分节");
        ok(facts.contains("1. 重构权限校验中间件（后端 · 我 · 10-21 · 延期完成）"), "延期完成要标出来");
        ok(!facts.contains("导出 CSV 补工时列（前端 · 小王 · 10-23 · 延期完成）"),
                "没有截止日期的不能误标延期");
        ok(facts.contains("进行中（共 1 项）") && facts.contains("进度 60%"), "进行中带进度");
        ok(facts.contains("进度 100% 但还没移入已完成列（共 1 项）"), "待确认完成单独一节");
        ok(facts.contains("- 流程引擎 62%（2/4 项）"), "项目进展带完成比");
        ok(facts.contains("成员交付") && facts.contains("- 小王 1 项"), "多人时才列成员交付");
        ok(facts.contains("当事人补充"), "补充说明要进事实清单");
        ok(countOf(facts, "线上排查") == 50,
                "补充说明截断到 200 字（400 字 → 50 段）", "出现 " + countOf(facts, "线上排查") + " 次（每次 4 字）");
    }

    private static void testFactsEmptyLists() throws Exception {
        ReviewResponse d = new ReviewResponse();
        d.setLabel("本周");
        d.setWeekStart("2026-10-26");
        d.setWeekEnd("2026-11-01");
        d.setStats(new ReviewResponse.Stats());
        d.setCompleted(new ArrayList<Task>());
        d.setProgressTasks(new ArrayList<Task>());
        d.setPendingDone(new ArrayList<Task>());
        d.setReqDist(new ArrayList<ReqProgress>());
        d.setMembers(new ArrayList<ReviewResponse.MemberStat>());
        d.setWorkMinutes(new ReviewResponse.WorkMinutes());
        d.setCounts(new com.hourglass.dto.BoardResponse.Counts());
        String facts = callBuildFacts(d, null);
        ok(!facts.contains("已完成（共"), "没有已完成就不写这一节");
        ok(!facts.contains("进行中（共"), "没有进行中就不写这一节");
        ok(!facts.contains("工时："), "工时全是 0 时不写工时行");
        ok(facts.contains("完成项都没有设截止日期，不计按期率"), "无截止日期时换个说法");
        ok(facts.contains("成员交付") == false, "单人/无成员不写成员交付");
    }

    private static void testCleanFence() throws Exception {
        String out = callClean("```markdown\n## 本周完成\n- 做了 A\n```");
        ok(out.startsWith("## 本周完成"), "去掉 ``` 围栏", head(out));
        ok(out.contains("- 做了 A"), "围栏内的正文保留");
        ok(!out.contains("```"), "不残留围栏标记");
    }

    private static void testCleanPreamble() throws Exception {
        ok(callClean("好的，以下是本周周报：\n## 本周完成\n- 做了 A").startsWith("## 本周完成"),
                "去掉「好的，以下是…」开场");
        ok(callClean("这是你的周报：\n\n## 进行中\n- 在做 B").startsWith("## 进行中"),
                "去掉「这是你的周报：」开场");
        /* 正文第一行本身是个短句但不像客套 → 不能误删 */
        ok(callClean("## 本周完成\n- 做了 A").startsWith("## 本周完成"), "标题开头原样保留");
        ok(callClean("- 只有一条列表\n- 第二条").startsWith("- 只有一条列表"), "不是客套的第一行不删");
    }

    private static void testCleanKeepsHeadings() throws Exception {
        String out = callClean("## 本周完成\n- A\n\n\n\n## 下周计划\n- B");
        ok(out.contains("## 本周完成") && out.contains("## 下周计划"), "两个标题都在");
        ok(out.indexOf("\n\n\n") < 0, "连续空行被压成一行");
    }

    // ---------- 工具 ----------

    private static Task task(String title, String cat, String owner, String completedAt, String dueDate) {
        Task t = new Task();
        t.setId("T" + Math.abs(title.hashCode()));
        t.setTitle(title);
        t.setCategory(cat);
        t.setOwner(owner);
        t.setProgress(100);
        if (completedAt != null) {
            t.setCompletedAt(LocalDate.parse(completedAt));
        }
        if (dueDate != null) {
            t.setDueDate(LocalDate.parse(dueDate));
        }
        return t;
    }

    private static ReviewResponse.MemberStat member(String name, int count) {
        ReviewResponse.MemberStat m = new ReviewResponse.MemberStat();
        m.setName(name);
        m.setCount(count);
        return m;
    }

    private static int countOf(String hay, String needle) {
        int n = 0, i = 0;
        while ((i = hay.indexOf(needle, i)) >= 0) {
            n++;
            i += needle.length();
        }
        return n;
    }

    private static String head(String s) {
        String t = s.replace("\n", "\\n");
        return t.length() > 60 ? t.substring(0, 60) + "…" : t;
    }

    private static void ok(boolean cond, String name) {
        ok(cond, name, "");
    }

    private static void ok(boolean cond, String name, String extra) {
        System.out.println((cond ? "PASS " : "FAIL ") + name + (extra.isEmpty() ? "" : "  => " + extra));
        if (cond) {
            pass++;
        } else {
            fail++;
        }
    }
}
