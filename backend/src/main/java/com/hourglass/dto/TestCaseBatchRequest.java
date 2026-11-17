package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Size;
import java.util.List;

/**
 * 用例列表批量维护：模块 / 优先级各自支持「保持不变 / 清空 / 设为」，删除只取范围。
 * 范围二选一：ids（勾选已加载的行）或 allFiltered + filter（全选筛选结果，含未加载行）。
 */
@Data
public class TestCaseBatchRequest {

    @Size(max = 200, message = "单次最多勾选 200 条")
    private List<String> ids;

    /** true = 按 filter 命中的全部用例生效 */
    private boolean allFiltered;

    private CaseQuery filter;

    @Size(max = 500, message = "取消勾选的行最多 500 条")
    private List<String> excludeIds;

    /** keep（默认）/ clear / set */
    private String moduleAction;

    @Size(max = 50, message = "分类最多 50 字")
    private String module;

    /** set 时按目录节点归类（与 module 文本二选一，节点优先）；空串 = 移出目录 */
    private String moduleId;

    /** keep（默认）/ clear / set */
    private String priorityAction;

    /** set 时必填：P0/P1/P2/P3 */
    private String priority;
}