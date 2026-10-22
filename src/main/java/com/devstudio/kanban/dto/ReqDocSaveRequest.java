package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 新建 / 保存需求 */
@Data
public class ReqDocSaveRequest {

    @NotBlank(message = "请选择所属项目")
    @Size(max = 32, message = "所属项目不合法")
    private String reqId;

    @NotBlank(message = "需求标题不能为空")
    @Size(max = 100, message = "标题最多 100 字")
    private String title;

    /** 富文本 HTML；服务端会做白名单清洗 */
    private String content;

    /** draft / active / done，空则按 draft */
    @Pattern(regexp = "^(draft|active|done)?$", message = "需求状态不合法")
    private String status;

    @Size(max = 32, message = "负责人不合法")
    private String owner;
}
