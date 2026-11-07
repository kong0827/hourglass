package com.hourglass.dto;

import lombok.Data;

import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotEmpty;
import java.util.List;

/**
 * 文档（阅读/树）批量排序：同一项目、同一父级下的兄弟节点重新排顺序。
 */
@Data
public class ReqDocReorderRequest {

    @NotEmpty(message = "排序列表不能为空")
    @Valid
    private List<Item> items;

    @Data
    public static class Item {

        @NotBlank(message = "文档 ID 不能为空")
        private String id;

        /** 新顺序，越小越靠前 */
        private Integer sortOrder;

        /** 新的父文档 ID，空表示提升到根级 */
        private String parentId;
    }
}
