import com.devstudio.kanban.common.WorkTime;

import java.time.LocalDateTime;

/** 独立验证「工作时段」口径：09:00-18:00 默认，0-9 点与 18 点后不计，跨夜不涨 */
public class WorkTimeTest {

    static int fails = 0;

    static void eq(String name, int got, int want) {
        boolean ok = got == want;
        System.out.println((ok ? "PASS " : "FAIL ") + name + "  got=" + got + " want=" + want);
        if (!ok) fails++;
    }

    static LocalDateTime t(int day, int h, int m) {
        /* 2026-10-05 是周一 */
        return LocalDateTime.of(2026, 10, day, h, m);
    }

    public static void main(String[] args) {
        /* 1. 工作时段内 */
        eq("周一 10:00→12:00", WorkTime.effectiveMinutes(t(5, 10, 0), t(5, 12, 0)), 120);
        /* 2. 只算交集：07:00→09:30 从 9 点起算 */
        eq("周一 07:00→09:30 = 30", WorkTime.effectiveMinutes(t(5, 7, 0), t(5, 9, 30)), 30);
        /* 3. 下班之后不计 */
        eq("周一 19:00→21:00 = 0", WorkTime.effectiveMinutes(t(5, 19, 0), t(5, 21, 0)), 0);
        /* 4. 关键：忘停表过夜 18:00→次日 10:00，只算次日 9-10 点 */
        eq("跨夜 周一18:00→周二10:00 = 60", WorkTime.effectiveMinutes(t(5, 18, 0), t(6, 10, 0)), 60);
        /* 5. 整夜（22:00→次日 08:00）应为 0 */
        eq("整夜 周一22:00→周二08:00 = 0", WorkTime.effectiveMinutes(t(5, 22, 0), t(6, 8, 0)), 0);
        /* 6. 周末不计（10-10 周六） */
        eq("周六 10:00→12:00 = 0", WorkTime.effectiveMinutes(t(10, 10, 0), t(10, 12, 0)), 0);
        eq("周五18:00→下周一10:00 = 60", WorkTime.effectiveMinutes(t(9, 18, 0), t(12, 10, 0)), 60);
        /* 7. 单日封顶 8h（9-18 共 9 小时窗口 → 封 8h） */
        eq("周一 09:00→18:00 = 480(封顶)", WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0)), 480);
        /* 8. 自定义时段 8:00-20:00 */
        eq("自定义 8-20：08:00→09:00 = 60",
                WorkTime.effectiveMinutes(t(5, 8, 0), t(5, 9, 0), 8, 20, null), 60);
        /* 9. 结束=24 表示到当天 24:00 */
        eq("结束24：20:00→23:00 = 180",
                WorkTime.effectiveMinutes(t(5, 20, 0), t(5, 23, 0), 9, 24, null), 180);
        /* 10. 非法配置（结束早于开始）回落 9-18 */
        eq("非法 9-5 回落 18 点：09:00→18:00 = 480",
                WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0), 9, 5, null), 480);
        /* 11. 扣减当天已记录 */
        eq("当天已记 300 分钟 → 只补 180",
                WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0), 9, 18, d -> 300), 180);
        /* 12. 反向区间 */
        eq("结束早于开始 = 0", WorkTime.effectiveMinutes(t(5, 12, 0), t(5, 10, 0)), 0);
        /* 13. 每天上限可配：4 小时 */
        eq("上限 4h：09:00→18:00 = 240",
                WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0), 9, 18, 4 * 60, null), 240);
        /* 14. 上限 12h + 时段到 24 点：09:00→22:00 应封顶 720 */
        eq("上限 12h/时段到24：09:00→22:00 = 720",
                WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 22, 0), 9, 24, 12 * 60, null), 720);
        /* 15. 上限越界回落 8h */
        eq("上限 99h 越界回落 8h：09:00→18:00 = 480",
                WorkTime.effectiveMinutes(t(5, 9, 0), t(5, 18, 0), 9, 18, 99 * 60, null), 480);
        /* 16. 跨夜仍不受上限放宽影响：18:00→次日 10:00 = 60 */
        eq("上限 12h 也不能让整夜计入：18:00→次日10:00 = 60",
                WorkTime.effectiveMinutes(t(5, 18, 0), t(6, 10, 0), 9, 18, 12 * 60, null), 60);

        System.out.println(fails == 0 ? "\nALL PASS" : ("\n" + fails + " FAILED"));
        System.exit(fails == 0 ? 0 : 1);
    }
}
