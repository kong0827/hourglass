package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 批量落库结果：逐条处理，一条失败不影响其它条 */
@Data
public class AiApplyResult {

    private int created;
    private int skipped;
    /** 按草稿依赖关系连上的依赖条数 */
    private int linked;
    private List<Item> failed = new ArrayList<Item>();

    @Data
    public static class Item {
        private String title;
        private String reason;

        public Item() {
        }

        public Item(String title, String reason) {
            this.title = title;
            this.reason = reason;
        }
    }
}
