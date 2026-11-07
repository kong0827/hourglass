package com.hourglass.entity;

import lombok.Data;

/** 需求池需求与需求文档的多对多关联。 */
@Data
public class DemandDocLink {
    private String workspaceId;
    private String demandId;
    private String docId;
    private String createdBy;
}
