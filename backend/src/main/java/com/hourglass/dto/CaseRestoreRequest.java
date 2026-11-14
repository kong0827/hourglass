package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Size;
import java.util.List;

/** 撤销批量移动：把每条用例恢复到移动前的目录节点（一次事务，避免逐组回放中途失败） */
@Data
public class CaseRestoreRequest {

    @NotEmpty(message = "没有可撤销的用例")
    @Size(max = 2000, message = "单次最多撤销 2000 条")
    private List<Item> items;

    @Data
    public static class Item {
        private String id;
        /** 移动前的节点 ID；空 = 恢复为未归类 */
        private String moduleId;
    }
}