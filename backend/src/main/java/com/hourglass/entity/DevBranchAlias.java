package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 分支改名识别记录：同一最后提交 SHA 的「旧名消失 + 新名出现」。 */
@Data
public class DevBranchAlias {

    private String id;
    private String workspaceId;
    private String repoId;
    private String branchId;
    private String oldName;
    private String newName;
    private LocalDateTime detectedAt;
}
