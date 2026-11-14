package com.hourglass.dto;

import com.hourglass.entity.TagCount;
import com.hourglass.entity.Task;
import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Data
public class BoardResponse {

    /** 看板列定义（含系统「已完成」列，按显示顺序） */
    private List<ColumnDef> columnDefs = new ArrayList<ColumnDef>();
    /** key: 列 id */
    private Map<String, ColumnData> columns = new LinkedHashMap<String, ColumnData>();
    private Counts counts = new Counts();
    private Meta meta = new Meta();

    @Data
    public static class ColumnDef {
        private String id;
        private String name;
        private String color;
        private String processingRule;
        private boolean done;

        public ColumnDef() {
        }

        public ColumnDef(String id, String name, String color, boolean done) {
            this(id, name, color, null, done);
        }

        public ColumnDef(String id, String name, String color, String processingRule, boolean done) {
            this.id = id;
            this.name = name;
            this.color = color;
            this.processingRule = processingRule;
            this.done = done;
        }
    }

    @Data
    public static class ColumnData {
        private List<Task> items = new ArrayList<Task>();
        /** 应用筛选后的条数 */
        private int matched;
        /** 筛选前、当前范围（已完成列受 week/all 影响）内的条数 */
        private int total;
        /** 全部条数（不受范围与筛选影响，已完成列「历史记录」提示用） */
        private int allTotal;
        private boolean hasMore;
    }

    @Data
    public static class Counts {
        private int over;
        private int today;
        private int soon;
    }

    @Data
    public static class Meta {
        private List<NameCount> owners = new ArrayList<NameCount>();
        /** 测试负责人候选（按显示名快照计数） */
        private List<NameCount> testOwners = new ArrayList<NameCount>();
        private List<NameCount> pris = new ArrayList<NameCount>();
        private List<CatCount> cats = new ArrayList<CatCount>();
        /** 工作项类型计数（story/task/bug/epic 固定顺序） */
        private List<NameCount> types = new ArrayList<NameCount>();
        /** 看板列（状态）计数，name 为列 ID */
        private List<NameCount> columns = new ArrayList<NameCount>();
        /** 有任务绑定的影响版本及计数（含项目名，同名版本跨项目时用于区分） */
        private List<VersionCount> versions = new ArrayList<VersionCount>();
        private List<ReqCount> reqs = new ArrayList<ReqCount>();
        /** 有任务关联的标签及计数 */
        private List<TagCount> tags = new ArrayList<TagCount>();
        /** 未归类任务数 */
        private int unassigned;
        /** 未绑定版本（待规划）任务数 */
        private int versionUnassigned;
        /** 未指定负责人任务数 */
        private int ownerUnassigned;
        /** 未指定测试负责人（待领取）任务数 */
        private int testOwnerUnassigned;
        /** 未指定模块任务数 */
        private int catUnassigned;
    }

    @Data
    public static class VersionCount {
        private String id;
        private String name;
        private String projectName;
        /** 版本状态：planned/active/released（active 在筛选中高亮为进行中） */
        private String status;
        private int count;

        public VersionCount(String id, String name, String projectName, String status, int count) {
            this.id = id;
            this.name = name;
            this.projectName = projectName;
            this.status = status;
            this.count = count;
        }
    }

    @Data
    public static class NameCount {
        private String name;
        private int count;

        public NameCount(String name, int count) {
            this.name = name;
            this.count = count;
        }
    }

    /** 模块筛选计数：值用 ID（改名/删除稳定），名称由服务端随行下发供前端直接展示 */
    @Data
    public static class CatCount {
        private String id;
        private String name;
        private int count;

        public CatCount(String id, String name, int count) {
            this.id = id;
            this.name = name;
            this.count = count;
        }
    }

    @Data
    public static class ReqCount {
        private String id;
        private String name;
        private String status;
        private int count;
    }
}
