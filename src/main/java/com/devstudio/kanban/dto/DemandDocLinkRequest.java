package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 需求池需求关联文档：只传文档 ID，项目一致性由服务层校验 */
@Data
public class DemandDocLinkRequest {

    @NotBlank(message = "请选择要关联的文档")
    @Size(max = 32, message = "文档不合法")
    private String docId;
}
