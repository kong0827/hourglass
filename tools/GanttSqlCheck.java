import com.devstudio.kanban.dto.GanttQuery;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * 甘特图动态 SQL 手动校验（不连数据库）。
 *
 * 目的：确认 TaskMapper.xml 里的 ganttWhere / foreach / OGNL 能生成正确 SQL，
 * 覆盖「全部筛选」和「默认无筛选」两种分支。
 *
 * 运行（项目根目录，先 mvn -o -DskipTests compile，再把 mybatis / slf4j 的 jar 加进 classpath）：
 *   javac -encoding UTF-8 -cp "target/classes;<mybatis.jar>;<slf4j-api.jar>" -d tools/sqlcheck tools/GanttSqlCheck.java
 *   java -cp "tools/sqlcheck;target/classes;<mybatis.jar>;<slf4j-api.jar>" GanttSqlCheck
 */
public class GanttSqlCheck {

    public static void main(String[] args) throws Exception {
        Configuration cfg = new Configuration(new Environment("test", new JdbcTransactionFactory(), new UnpooledDataSource()));
        cfg.setMapUnderscoreToCamelCase(true);
        cfg.getTypeAliasRegistry().registerAliases("com.devstudio.kanban.entity");
        for (String r : new String[]{"mapper/TaskMapper.xml", "mapper/SubtaskMapper.xml", "mapper/TimeLogMapper.xml"}) {
            new XMLMapperBuilder(GanttSqlCheck.class.getClassLoader().getResourceAsStream(r), cfg, r, cfg.getSqlFragments()).parse();
        }

        System.out.println("===== 场景 1：全部筛选 + 区间 + includeDone=false =====");
        print(cfg, allFilters());

        System.out.println("===== 场景 2：默认无筛选 + includeDone=true =====");
        print(cfg, noFilters());
    }

    private static GanttQuery allFilters() {
        GanttQuery q = new GanttQuery();
        q.setQ("支付");
        q.setOwners(new ArrayList<String>(Arrays.asList("我", "陈工")));
        q.setPris(new ArrayList<String>(Arrays.asList("P0", "P1")));
        q.setCats(new ArrayList<String>(Arrays.asList("后端")));
        q.setTags(new ArrayList<String>(Arrays.asList("上线")));
        q.setReqNone(true);
        q.setReqIds(new ArrayList<String>(Arrays.asList("R1")));
        q.setDue("soon");
        q.setFocus(true);
        q.setBlocked(true);
        q.setNoDue(false);
        q.setIncludeDone(false);
        q.setToday(LocalDate.of(2026, 10, 30));
        q.setFrom(LocalDate.of(2026, 10, 1));
        q.setTo(LocalDate.of(2026, 10, 31));
        return q;
    }

    private static GanttQuery noFilters() {
        GanttQuery q = new GanttQuery();
        q.setToday(LocalDate.of(2026, 10, 30));
        return q;
    }

    private static void print(Configuration cfg, GanttQuery q) {
        Map<String, Object> p = new HashMap<String, Object>();
        p.put("workspaceId", "W1");
        p.put("query", q);
        p.put("offset", 0);
        p.put("limit", 500);
        p.put("taskIds", Arrays.asList("K1", "K2"));

        String prefix = "com.devstudio.kanban.mapper.TaskMapper.";
        for (String id : new String[]{"selectGantt", "countGantt", "selectGanttUnscheduled",
                "countGanttUnscheduled", "countCommentsByTaskIds"}) {
            MappedStatement ms = cfg.getMappedStatement(prefix + id);
            BoundSql bs = ms.getBoundSql(p);
            System.out.println("---- " + id + " ----");
            System.out.println(bs.getSql().replaceAll("\\s+", " "));
        }
    }
}
