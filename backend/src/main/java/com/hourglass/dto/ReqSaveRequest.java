package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

@Data
public class ReqSaveRequest {

    /** 选填：导入时由前端指定 ID，不填则服务端生成 */
    @Size(max = 32, message = "需求ID不合法")
    private String id;

    @NotBlank(message = "请填写需求名称")
    @Size(max = 40, message = "需求名称不能超过 40 字")
    private String name;

    @Size(max = 1000, message = "需求描述不能超过 1000 字")
    private String description;

    @Size(max = 400, message = "项目目标不能超过 400 字")
    private String objective;

    @Size(max = 32, message = "项目负责人不合法")
    private String ownerUserId;

    private java.time.LocalDate plannedStart;
    private java.time.LocalDate plannedEnd;

    @Pattern(regexp = "active|done|hold", message = "需求状态不合法")
    private String status = "active";

    /** 仅新建时生效：blank / standard / test；留空按空白项目处理 */
    @Pattern(regexp = "^(blank|standard|test)?$", message = "项目模板不合法")
    private String template;
}
