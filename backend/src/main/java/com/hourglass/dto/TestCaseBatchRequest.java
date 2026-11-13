package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Size;
import java.util.List;

/** 用例列表批量维护：模块 / 优先级各自支持「保持不变 / 清空 / 设为」，删除只取 ids。 */
@Data
public class TestCaseBatchRequest {

    @NotEmpty(message = "请先勾选用例")
    @Size(max = 200, message = "单次最多勾选 200 条")
    private List<String> ids;

    /** keep（默认）/ clear / set */
    private String moduleAction;

    @Size(max = 50, message = "功能模块最多 50 字")
    private String module;

    /** keep（默认）/ clear / set */
    private String priorityAction;

    /** set 时必填：P0/P1/P2/P3 */
    private String priority;
}
