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
        private boolean done;

        public ColumnDef() {
        }

        public ColumnDef(String id, String name, String color, boolean done) {
            this.id = id;
            this.name = name;
            this.color = color;
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
        private List<NameCount> pris = new ArrayList<NameCount>();
        private List<NameCount> cats = new ArrayList<NameCount>();
        /** 工作项类型计数（story/task/bug/epic 固定顺序） */
        private List<NameCount> types = new ArrayList<NameCount>();
        /** 有任务绑定的影响版本及计数（含项目名，同名版本跨项目时用于区分） */
        private List<VersionCount> versions = new ArrayList<VersionCount>();
        private List<ReqCount> reqs = new ArrayList<ReqCount>();
        /** 有任务关联的标签及计数 */
        private List<TagCount> tags = new ArrayList<TagCount>();
        /** 未归类任务数 */
        private int unassigned;
        /** 未绑定版本（待规划）任务数 */
        private int versionUnassigned;
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

    @Data
    public static class ReqCount {
        private String id;
        private String name;
        private String status;
        private int count;
    }
}
