package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 需求更换所属项目的迁移预览：随迁数量、留在原项目的关联，以及不可回退的阻断项。 */
@Data
public class DemandMovePreview {

    private String targetReqId;
    private String targetName;

    /** 关联工作项：总数 / 已开工 / 回收站 */
    private int tasks;
    private int startedTasks;
    private int trashedTasks;

    /** 主归口用例（随迁并重新取号） */
    private int cases;
    /** 这些用例在原项目测试计划里的圈选条数（迁出时解除） */
    private int planLinks;

    /** 需求关联文档（文档本身留在原项目） */
    private int docLinks;
    /** 历史发布记录（不可变，留在原项目） */
    private int releases;

    /** 当前已排期的目标版本名：迁移时按撤销排期处理 */
    private String versionName;

    /** 阻断原因；非空时不能迁移 */
    private List<String> blockers = new ArrayList<String>();
}
